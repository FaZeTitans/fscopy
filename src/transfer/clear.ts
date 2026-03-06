import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { Config } from '../types.js';
import type { Output } from '../utils/output.js';
import { withRetry } from '../utils/retry.js';
import { getFilteredSubcollections, getDestCollectionPath } from './helpers.js';
import { CLEAR_PAGE_SIZE } from '../constants.js';

async function clearDocSubcollections(
    db: Firestore,
    doc: QueryDocumentSnapshot,
    collectionPath: string,
    config: Config,
    output: Output
): Promise<number> {
    let deletedCount = 0;
    const subcollections = await getFilteredSubcollections(doc.ref, config.exclude);

    for (const subId of subcollections) {
        const subPath = `${collectionPath}/${doc.id}/${subId}`;
        deletedCount += await clearCollection(db, subPath, config, output, true);
    }

    return deletedCount;
}

async function deleteBatch(
    db: Firestore,
    batch: QueryDocumentSnapshot[],
    collectionPath: string,
    config: Config,
    output: Output
): Promise<number> {
    const writeBatch = db.batch();

    for (const doc of batch) {
        writeBatch.delete(doc.ref);
    }

    if (!config.dryRun) {
        await withRetry(() => writeBatch.commit(), {
            retries: config.retries,
            onRetry: (attempt, max, err, delay) => {
                output.logError(`Retry delete ${attempt}/${max} for ${collectionPath}`, {
                    error: err.message,
                    delay,
                });
            },
        });
    }

    output.logInfo(`Deleted ${batch.length} documents from ${collectionPath}`);
    return batch.length;
}

export async function clearCollection(
    db: Firestore,
    collectionPath: string,
    config: Config,
    output: Output,
    includeSubcollections: boolean
): Promise<number> {
    let deletedCount = 0;
    let lastDoc: QueryDocumentSnapshot | undefined;
    const pageSize = Math.min(config.batchSize, CLEAR_PAGE_SIZE);

    // Paginate through the collection to avoid loading all docs into memory
    while (true) {
        let query = db.collection(collectionPath).select().limit(pageSize);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }

        const snapshot = await query.get();
        if (snapshot.empty) break;

        // Delete subcollections first if enabled
        if (includeSubcollections) {
            for (const doc of snapshot.docs) {
                deletedCount += await clearDocSubcollections(
                    db,
                    doc,
                    collectionPath,
                    config,
                    output
                );
            }
        }

        // Delete documents in batches
        for (let i = 0; i < snapshot.docs.length; i += config.batchSize) {
            const batch = snapshot.docs.slice(i, i + config.batchSize);
            deletedCount += await deleteBatch(db, batch, collectionPath, config, output);
        }

        // In dry-run mode, we need to paginate using the last doc since docs aren't actually deleted
        if (config.dryRun) {
            lastDoc = snapshot.docs[snapshot.docs.length - 1];
            if (snapshot.docs.length < pageSize) break;
        }
        // In live mode, docs are deleted so we always query from the start (no lastDoc needed)
    }

    return deletedCount;
}

async function deleteOrphanBatch(
    destDb: Firestore,
    batch: QueryDocumentSnapshot[],
    destCollectionPath: string,
    config: Config,
    output: Output
): Promise<number> {
    let deletedCount = 0;
    const writeBatch = destDb.batch();

    for (const doc of batch) {
        if (config.includeSubcollections) {
            deletedCount += await clearDocSubcollections(
                destDb,
                doc,
                destCollectionPath,
                config,
                output
            );
        }
        writeBatch.delete(doc.ref);
        deletedCount++;
    }

    if (!config.dryRun) {
        await withRetry(() => writeBatch.commit(), {
            retries: config.retries,
            onRetry: (attempt, max, err, delay) => {
                output.logError(
                    `Retry delete orphans ${attempt}/${max} for ${destCollectionPath}`,
                    {
                        error: err.message,
                        delay,
                    }
                );
            },
        });
    }

    output.logInfo(`Deleted ${batch.length} orphan documents from ${destCollectionPath}`);
    return deletedCount;
}

async function processSubcollectionOrphansWithProgress(
    sourceDb: Firestore,
    destDb: Firestore,
    sourceSnapshot: FirebaseFirestore.QuerySnapshot,
    sourceCollectionPath: string,
    config: Config,
    output: Output,
    progress?: DeleteOrphansProgress
): Promise<number> {
    let deletedCount = 0;

    for (const sourceDoc of sourceSnapshot.docs) {
        const sourceSubcollections = await getFilteredSubcollections(sourceDoc.ref, config.exclude);
        for (const subId of sourceSubcollections) {
            const subPath = `${sourceCollectionPath}/${sourceDoc.id}/${subId}`;
            progress?.onSubcollectionScan?.(subPath);
            deletedCount += await deleteOrphanDocuments(
                sourceDb,
                destDb,
                subPath,
                config,
                output,
                progress
            );
        }
    }

    return deletedCount;
}

export interface DeleteOrphansProgress {
    onScanStart?: (collection: string) => void;
    onScanComplete?: (collection: string, orphanCount: number, totalDest: number) => void;
    onBatchDeleted?: (collection: string, deletedSoFar: number, total: number) => void;
    onSubcollectionScan?: (path: string) => void;
}

export async function deleteOrphanDocuments(
    sourceDb: Firestore,
    destDb: Firestore,
    sourceCollectionPath: string,
    config: Config,
    output: Output,
    progress?: DeleteOrphansProgress
): Promise<number> {
    const destCollectionPath = getDestCollectionPath(sourceCollectionPath, config.renameCollection);

    progress?.onScanStart?.(destCollectionPath);

    // Paginate source to build ID set (strings only, minimal memory)
    const sourceIds = new Set<string>();
    let lastSourceDoc: QueryDocumentSnapshot | undefined;
    while (true) {
        let query = sourceDb.collection(sourceCollectionPath).select().limit(CLEAR_PAGE_SIZE);
        if (lastSourceDoc) query = query.startAfter(lastSourceDoc);
        const snapshot = await query.get();
        if (snapshot.empty) break;
        for (const doc of snapshot.docs) sourceIds.add(doc.id);
        lastSourceDoc = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.size < CLEAR_PAGE_SIZE) break;
    }

    // Paginate dest and find/delete orphans in batches
    let deletedCount = 0;
    let totalDest = 0;
    let totalOrphans = 0;
    let lastDestDoc: QueryDocumentSnapshot | undefined;

    while (true) {
        let query = destDb.collection(destCollectionPath).select().limit(CLEAR_PAGE_SIZE);
        if (lastDestDoc) query = query.startAfter(lastDestDoc);
        const snapshot = await query.get();
        if (snapshot.empty) break;

        totalDest += snapshot.size;
        const orphanDocs = snapshot.docs.filter((doc) => !sourceIds.has(doc.id));
        totalOrphans += orphanDocs.length;

        if (orphanDocs.length > 0) {
            output.logInfo(`Found ${orphanDocs.length} orphan documents in ${destCollectionPath}`);

            for (let i = 0; i < orphanDocs.length; i += config.batchSize) {
                const batch = orphanDocs.slice(i, i + config.batchSize);
                deletedCount += await deleteOrphanBatch(
                    destDb,
                    batch,
                    destCollectionPath,
                    config,
                    output
                );
                progress?.onBatchDeleted?.(destCollectionPath, deletedCount, totalOrphans);
            }
        }

        lastDestDoc = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.size < CLEAR_PAGE_SIZE) break;
    }

    progress?.onScanComplete?.(destCollectionPath, totalOrphans, totalDest);

    // Process subcollection orphans (paginate source docs)
    if (config.includeSubcollections) {
        let lastSubDoc: QueryDocumentSnapshot | undefined;
        while (true) {
            let query = sourceDb.collection(sourceCollectionPath).select().limit(CLEAR_PAGE_SIZE);
            if (lastSubDoc) query = query.startAfter(lastSubDoc);
            const snapshot = await query.get();
            if (snapshot.empty) break;

            deletedCount += await processSubcollectionOrphansWithProgress(
                sourceDb,
                destDb,
                snapshot,
                sourceCollectionPath,
                config,
                output,
                progress
            );

            lastSubDoc = snapshot.docs[snapshot.docs.length - 1];
            if (snapshot.size < CLEAR_PAGE_SIZE) break;
        }
    }

    return deletedCount;
}
