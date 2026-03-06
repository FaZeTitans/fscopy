import type { Firestore, WriteBatch, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { Config, Stats, TransformFunction, ConflictInfo } from '../types.js';
import type { Output } from '../utils/output.js';
import type { RateLimiter } from '../utils/rate-limiter.js';
import type { ProgressBarWrapper } from '../utils/progress.js';
import type { StateSaver } from '../state/index.js';
import { withRetry } from '../utils/retry.js';
import { estimateDocumentSize, formatBytes, FIRESTORE_MAX_DOC_SIZE } from '../utils/doc-size.js';
import { hashDocumentData, compareHashes } from '../utils/integrity.js';
import {
    getDestCollectionPath,
    getDestDocId,
    getFilteredSubcollections,
    buildQueryWithFilters,
} from './helpers.js';

export interface TransferContext {
    sourceDb: Firestore;
    destDb: Firestore;
    config: Config;
    stats: Stats;
    output: Output;
    progressBar: ProgressBarWrapper;
    transformFn: TransformFunction | null;
    stateSaver: StateSaver | null;
    rateLimiter: RateLimiter | null;
    conflictList: ConflictInfo[];
}

interface DocProcessResult {
    skip: boolean;
    data?: Record<string, unknown>;
    markCompleted: boolean;
}

// Map of destDocId -> updateTime (as ISO string for comparison)
type UpdateTimeMap = Map<string, string | null>;

/**
 * Capture updateTime of destination documents and detect conflicts in a single API call.
 * Captures initial state, then after writing, compares with a second call.
 */
async function captureDestUpdateTimes(
    destDb: Firestore,
    destCollectionPath: string,
    destDocIds: string[]
): Promise<UpdateTimeMap> {
    const updateTimes: UpdateTimeMap = new Map();

    const docRefs = destDocIds.map((id) => destDb.collection(destCollectionPath).doc(id));
    const docs = await destDb.getAll(...docRefs);

    for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        const docId = destDocIds[i];
        if (doc.exists) {
            const updateTime = doc.updateTime;
            updateTimes.set(docId, updateTime ? updateTime.toDate().toISOString() : null);
        } else {
            updateTimes.set(docId, null);
        }
    }

    return updateTimes;
}

/**
 * Detect conflicts by comparing current dest state with previously captured times.
 * Uses local comparison against the already-fetched captured times (no additional API call).
 */
function detectConflicts(
    capturedTimes: UpdateTimeMap,
    currentDocs: FirebaseFirestore.DocumentSnapshot[],
    destDocIds: string[]
): string[] {
    const conflicts: string[] = [];

    for (let i = 0; i < currentDocs.length; i++) {
        const doc = currentDocs[i];
        const docId = destDocIds[i];
        const capturedTime = capturedTimes.get(docId);

        const currentTime =
            doc.exists && doc.updateTime ? doc.updateTime.toDate().toISOString() : null;

        // Conflict: doc state changed between capture and now
        const isConflict =
            (doc.exists && capturedTime === null) ||
            (doc.exists && currentTime !== capturedTime) ||
            (!doc.exists && capturedTime !== null);

        if (isConflict) {
            conflicts.push(docId);
        }
    }

    return conflicts;
}

function applyTransform(
    docData: Record<string, unknown>,
    doc: QueryDocumentSnapshot,
    collectionPath: string,
    transformFn: TransformFunction,
    output: Output,
    stats: Stats
): { success: boolean; data: Record<string, unknown> | null; markCompleted: boolean } {
    try {
        const transformed = transformFn(docData, {
            id: doc.id,
            path: `${collectionPath}/${doc.id}`,
        });

        if (transformed === null) {
            output.logInfo('Skipped document (transform returned null)', {
                collection: collectionPath,
                docId: doc.id,
            });
            return { success: false, data: null, markCompleted: true };
        }

        return { success: true, data: transformed, markCompleted: false };
    } catch (transformError) {
        const errMsg =
            transformError instanceof Error ? transformError.message : String(transformError);
        output.logError(`Transform failed for document ${doc.id}`, {
            collection: collectionPath,
            error: errMsg,
        });
        stats.errors++;
        return { success: false, data: null, markCompleted: false };
    }
}

function checkDocumentSize(
    docData: Record<string, unknown>,
    doc: QueryDocumentSnapshot,
    collectionPath: string,
    destCollectionPath: string,
    destDocId: string,
    config: Config,
    output: Output
): { valid: boolean; markCompleted: boolean } {
    const docSize = estimateDocumentSize(docData, `${destCollectionPath}/${destDocId}`);

    if (docSize <= FIRESTORE_MAX_DOC_SIZE) {
        return { valid: true, markCompleted: false };
    }

    const sizeStr = formatBytes(docSize);
    if (config.skipOversized) {
        output.logInfo(`Skipped oversized document (${sizeStr})`, {
            collection: collectionPath,
            docId: doc.id,
        });
        return { valid: false, markCompleted: true };
    }

    throw new Error(
        `Document ${collectionPath}/${doc.id} exceeds 1MB limit (${sizeStr}). Use --skip-oversized to skip.`
    );
}

// Track which collections have already shown the max-depth warning (to avoid spam)
const maxDepthWarningsShown = new Set<string>();

async function processSubcollections(
    ctx: TransferContext,
    doc: QueryDocumentSnapshot,
    collectionPath: string,
    depth: number
): Promise<void> {
    const { config, output } = ctx;

    // Check max depth limit (0 = unlimited)
    if (config.maxDepth > 0 && depth >= config.maxDepth) {
        // Show console warning only once per root collection
        const rootCollection = collectionPath.split('/')[0];
        if (!maxDepthWarningsShown.has(rootCollection)) {
            maxDepthWarningsShown.add(rootCollection);
            output.warn(
                `⚠️  Subcollections in ${rootCollection} beyond depth ${config.maxDepth} will be skipped`
            );
        }

        output.logInfo(`Skipping subcollections at depth ${depth} (max: ${config.maxDepth})`, {
            collection: collectionPath,
            docId: doc.id,
        });
        return;
    }

    const subcollections = await getFilteredSubcollections(doc.ref, config.exclude);

    for (const subcollectionId of subcollections) {
        const subcollectionPath = `${collectionPath}/${doc.id}/${subcollectionId}`;
        const subCtx = { ...ctx, config: { ...config, limit: 0, where: [] } };
        await transferCollection(subCtx, subcollectionPath, depth + 1);
    }
}

function processDocument(
    doc: QueryDocumentSnapshot,
    ctx: TransferContext,
    collectionPath: string,
    destCollectionPath: string
): DocProcessResult {
    const { config, output, stateSaver, stats, transformFn } = ctx;

    // Skip if already completed (resume mode) - O(1) lookup via Set
    if (stateSaver?.isCompleted(collectionPath, doc.id)) {
        stats.documentsTransferred++;
        return { skip: true, markCompleted: false };
    }

    const destDocId = getDestDocId(doc.id, config.idPrefix, config.idSuffix);
    let docData = doc.data() as Record<string, unknown>;

    // Apply transform if provided
    if (transformFn) {
        const transformResult = applyTransform(
            docData,
            doc,
            collectionPath,
            transformFn,
            output,
            stats
        );
        if (!transformResult.success) {
            return { skip: true, markCompleted: transformResult.markCompleted };
        }
        docData = transformResult.data!;
    }

    // Check document size
    const sizeResult = checkDocumentSize(
        docData,
        doc,
        collectionPath,
        destCollectionPath,
        destDocId,
        config,
        output
    );
    if (!sizeResult.valid) {
        return { skip: true, markCompleted: sizeResult.markCompleted };
    }

    return { skip: false, data: docData, markCompleted: true };
}

function incrementProgress(progressBar: ProgressBarWrapper): void {
    progressBar.increment();
}

async function commitBatchWithRetry(
    destBatch: WriteBatch,
    batchDocIds: string[],
    ctx: TransferContext,
    collectionPath: string
): Promise<void> {
    const { config, output, stateSaver, stats, rateLimiter } = ctx;

    if (rateLimiter) {
        await rateLimiter.acquire(batchDocIds.length);
    }

    try {
        await withRetry(() => destBatch.commit(), {
            retries: config.retries,
            onRetry: (attempt, max, err, delay) => {
                output.logError(`Retry commit ${attempt}/${max}`, { error: err.message, delay });
            },
        });
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        stats.errors += batchDocIds.length;
        output.logError(
            `Batch commit failed for ${batchDocIds.length} documents after ${config.retries} retries`,
            {
                collection: collectionPath,
                error: err.message,
                docIds: batchDocIds.slice(0, 10),
            }
        );
        output.warn(
            `⚠️  Batch commit failed: ${batchDocIds.length} documents in ${collectionPath} were NOT written (${err.message})`
        );
        // Re-decrement documentsTransferred since they weren't actually committed
        stats.documentsTransferred -= batchDocIds.length;
        return;
    }

    if (stateSaver && batchDocIds.length > 0) {
        stateSaver.markBatchCompleted(collectionPath, batchDocIds, stats);
    }
}

function addDocToBatch(
    destBatch: FirebaseFirestore.WriteBatch,
    destDb: Firestore,
    destCollectionPath: string,
    destDocId: string,
    data: Record<string, unknown>,
    merge: boolean
): void {
    const destDocRef = destDb.collection(destCollectionPath).doc(destDocId);
    if (merge) {
        destBatch.set(destDocRef, data, { merge: true });
    } else {
        destBatch.set(destDocRef, data);
    }
}

interface PreparedDoc {
    sourceDoc: QueryDocumentSnapshot;
    sourceDocId: string;
    destDocId: string;
    data: Record<string, unknown>;
    sourceHash?: string;
}

async function prepareDocForTransfer(
    doc: QueryDocumentSnapshot,
    ctx: TransferContext,
    collectionPath: string,
    destCollectionPath: string
): Promise<PreparedDoc | null> {
    const { config, progressBar } = ctx;
    const result = processDocument(doc, ctx, collectionPath, destCollectionPath);
    incrementProgress(progressBar);

    if (result.skip) {
        return null;
    }

    const destDocId = getDestDocId(doc.id, config.idPrefix, config.idSuffix);
    const prepared: PreparedDoc = {
        sourceDoc: doc,
        sourceDocId: doc.id,
        destDocId,
        data: result.data!,
    };

    // Compute source hash if integrity verification is enabled
    if (config.verifyIntegrity) {
        prepared.sourceHash = hashDocumentData(result.data!);
    }

    return prepared;
}

async function verifyBatchIntegrity(
    preparedDocs: PreparedDoc[],
    destDb: Firestore,
    destCollectionPath: string,
    stats: Stats,
    output: Output
): Promise<void> {
    const docRefs = preparedDocs.map((p) => destDb.collection(destCollectionPath).doc(p.destDocId));
    const destDocs = await destDb.getAll(...docRefs);

    for (let i = 0; i < destDocs.length; i++) {
        const prepared = preparedDocs[i];
        const destDoc = destDocs[i];

        if (!destDoc.exists) {
            stats.integrityErrors++;
            output.warn(
                `⚠️  Integrity error: ${destCollectionPath}/${prepared.destDocId} not found after write`
            );
            output.logError('Integrity verification failed', {
                collection: destCollectionPath,
                docId: prepared.destDocId,
                reason: 'document_not_found',
            });
            continue;
        }

        const destData = destDoc.data() as Record<string, unknown>;
        const destHash = hashDocumentData(destData);

        if (!compareHashes(prepared.sourceHash!, destHash)) {
            stats.integrityErrors++;
            output.warn(
                `⚠️  Integrity error: ${destCollectionPath}/${prepared.destDocId} hash mismatch`
            );
            output.logError('Integrity verification failed', {
                collection: destCollectionPath,
                docId: prepared.destDocId,
                reason: 'hash_mismatch',
                sourceHash: prepared.sourceHash,
                destHash,
            });
        }
    }
}

async function commitPreparedDocs(
    preparedDocs: PreparedDoc[],
    ctx: TransferContext,
    collectionPath: string,
    destCollectionPath: string,
    depth: number
): Promise<string[]> {
    const { destDb, config, stats, output } = ctx;
    const destBatch = destDb.batch();
    const batchDocIds: string[] = [];

    for (const prepared of preparedDocs) {
        if (!config.dryRun) {
            addDocToBatch(
                destBatch,
                destDb,
                destCollectionPath,
                prepared.destDocId,
                prepared.data,
                config.merge
            );
        }

        batchDocIds.push(prepared.sourceDocId);
        stats.documentsTransferred++;

        output.logInfo('Transferred document', {
            source: collectionPath,
            dest: destCollectionPath,
            sourceDocId: prepared.sourceDocId,
            destDocId: prepared.destDocId,
        });

        if (config.includeSubcollections) {
            await processSubcollections(ctx, prepared.sourceDoc, collectionPath, depth);
        }
    }

    if (!config.dryRun && preparedDocs.length > 0) {
        await commitBatchWithRetry(destBatch, batchDocIds, ctx, collectionPath);

        // Verify integrity after commit if enabled
        if (config.verifyIntegrity) {
            await verifyBatchIntegrity(preparedDocs, destDb, destCollectionPath, stats, output);
        }
    }

    return batchDocIds;
}

async function processBatch(
    batch: QueryDocumentSnapshot[],
    ctx: TransferContext,
    collectionPath: string,
    destCollectionPath: string,
    depth: number
): Promise<string[]> {
    const { destDb, config, stats, output, conflictList } = ctx;

    // Step 1: Prepare all docs for transfer
    const preparedDocs: PreparedDoc[] = [];
    for (const doc of batch) {
        const prepared = await prepareDocForTransfer(doc, ctx, collectionPath, destCollectionPath);
        if (prepared) {
            preparedDocs.push(prepared);
        }
    }

    if (preparedDocs.length === 0) {
        return [];
    }

    // Step 2: If conflict detection is enabled, capture dest updateTimes before writing
    let docsToWrite = preparedDocs;
    let capturedTimes: UpdateTimeMap | null = null;
    if (config.detectConflicts && !config.dryRun) {
        const destDocIds = preparedDocs.map((p) => p.destDocId);
        capturedTimes = await captureDestUpdateTimes(destDb, destCollectionPath, destDocIds);

        // Check for pre-existing conflicts (docs modified between count and transfer start)
        const docRefs = destDocIds.map((id) => destDb.collection(destCollectionPath).doc(id));
        const currentDocs = await destDb.getAll(...docRefs);
        const conflictingIds = detectConflicts(capturedTimes, currentDocs, destDocIds);

        if (conflictingIds.length > 0) {
            const conflictSet = new Set(conflictingIds);

            // Filter out conflicting docs
            docsToWrite = preparedDocs.filter((p) => !conflictSet.has(p.destDocId));

            // Record conflicts
            for (const prepared of preparedDocs) {
                if (conflictSet.has(prepared.destDocId)) {
                    stats.conflicts++;
                    conflictList.push({
                        collection: destCollectionPath,
                        docId: prepared.destDocId,
                        reason: 'Document was modified during transfer',
                    });
                    output.warn(
                        `⚠️  Conflict detected: ${destCollectionPath}/${prepared.destDocId} was modified during transfer`
                    );
                    output.logError('Conflict detected', {
                        collection: destCollectionPath,
                        docId: prepared.destDocId,
                        reason: 'modified_during_transfer',
                    });
                }
            }
        }
    }

    // Step 3: Commit non-conflicting docs
    return commitPreparedDocs(docsToWrite, ctx, collectionPath, destCollectionPath, depth);
}

export async function transferCollection(
    ctx: TransferContext,
    collectionPath: string,
    depth: number = 0
): Promise<void> {
    const { sourceDb, config, stats, output } = ctx;
    const destCollectionPath = getDestCollectionPath(collectionPath, config.renameCollection);

    const baseQuery = buildQueryWithFilters(sourceDb, collectionPath, config, depth);
    const userLimit = config.limit > 0 && depth === 0 ? config.limit : 0;

    let totalProcessed = 0;
    let lastDoc: QueryDocumentSnapshot | undefined;

    while (true) {
        // Calculate page size respecting user limit
        let pageSize = config.batchSize;
        if (userLimit > 0) {
            const remaining = userLimit - totalProcessed;
            if (remaining <= 0) break;
            pageSize = Math.min(pageSize, remaining);
        }

        // Build paginated query
        let pageQuery = baseQuery.limit(pageSize);
        if (lastDoc) {
            pageQuery = pageQuery.startAfter(lastDoc);
        }

        const snapshot = await withRetry(() => pageQuery.get(), {
            retries: config.retries,
            onRetry: (attempt, max, err, delay) => {
                output.logError(`Retry ${attempt}/${max} for ${collectionPath}`, {
                    error: err.message,
                    delay,
                });
            },
        });

        if (snapshot.empty) break;

        if (totalProcessed === 0) {
            stats.collectionsProcessed++;
            output.logInfo(`Processing collection: ${collectionPath}`);
        }

        await processBatch(snapshot.docs, ctx, collectionPath, destCollectionPath, depth);

        totalProcessed += snapshot.docs.length;
        lastDoc = snapshot.docs[snapshot.docs.length - 1];

        // Fewer docs than requested means we've reached the end
        if (snapshot.docs.length < pageSize) break;
    }
}
