import type { Firestore } from 'firebase-admin/firestore';

import { PROGRESS_LOG_INTERVAL_MS, SEPARATOR_LENGTH } from './constants.js';
import type { Config, ValidatedConfig, Stats, TransferState, TransformFunction, CliArgs, ConflictInfo } from './types.js';
import { Output } from './utils/output.js';
import { RateLimiter } from './utils/rate-limiter.js';
import { ProgressBarWrapper } from './utils/progress.js';
import { loadTransferState, saveTransferState, createInitialState, validateStateForResume, deleteTransferState, StateSaver } from './state/index.js';
import { sendWebhook } from './webhook/index.js';
import { countDocuments, transferCollection, clearCollection, deleteOrphanDocuments, processInParallel, getDestCollectionPath, type TransferContext, type CountProgress, type DeleteOrphansProgress } from './transfer/index.js';
import { initializeFirebase, checkDatabaseConnectivity, cleanupFirebase } from './firebase/index.js';
import { loadTransformFunction } from './transform/loader.js';
import { printSummary, formatJsonOutput } from './output/display.js';

export interface TransferResult {
    success: boolean;
    stats: Stats;
    duration: number;
    error?: string;
    verifyResult?: Record<string, { source: number; dest: number; match: boolean }> | null;
}

interface ResumeResult {
    state: TransferState | null;
    stats: Stats;
}

function initializeResumeMode(config: ValidatedConfig, output: Output): ResumeResult {
    if (config.resume) {
        const existingState = loadTransferState(config.stateFile);
        if (!existingState) {
            throw new Error(`No state file found at ${config.stateFile}. Cannot resume without a saved state. Run without --resume to start fresh.`);
        }

        const stateErrors = validateStateForResume(existingState, config);
        if (stateErrors.length > 0) {
            throw new Error(`Cannot resume: state file incompatible with current config:\n   - ${stateErrors.join('\n   - ')}`);
        }

        const completedCount = Object.values(existingState.completedDocs).reduce((sum, ids) => sum + ids.length, 0);
        output.info(`\n🔄 Resuming transfer from ${config.stateFile}`);
        output.info(`   Started: ${existingState.startedAt}`);
        output.info(`   Previously completed: ${completedCount} documents`);

        return { state: existingState, stats: { ...existingState.stats } };
    }

    if (!config.dryRun) {
        const newState = createInitialState(config);
        saveTransferState(config.stateFile, newState);
        output.info(`\n💾 State will be saved to ${config.stateFile} (use --resume to continue if interrupted)`);
        return { state: newState, stats: createEmptyStats() };
    }

    return { state: null, stats: createEmptyStats() };
}

function createEmptyStats(): Stats {
    return { collectionsProcessed: 0, documentsTransferred: 0, documentsDeleted: 0, errors: 0, conflicts: 0, integrityErrors: 0 };
}

async function loadTransform(config: Config, output: Output): Promise<TransformFunction | null> {
    if (!config.transform) return null;

    output.info(`\n🔧 Loading transform: ${config.transform}`);
    const transformFn = await loadTransformFunction(config.transform);
    output.info('   Transform loaded successfully');
    return transformFn;
}

async function handleSuccessOutput(
    config: ValidatedConfig,
    argv: CliArgs,
    stats: Stats,
    duration: number,
    verifyResult: Record<string, { source: number; dest: number; match: boolean }> | null,
    output: Output
): Promise<void> {
    if (config.json) {
        output.json(JSON.parse(formatJsonOutput(true, config, stats, duration, undefined, verifyResult)));
    } else {
        printSummary(stats, duration.toFixed(2), argv.log, config.dryRun, config.verifyIntegrity);
    }

    if (config.webhook) {
        await sendWebhook(config.webhook, {
            source: config.sourceProject,
            destination: config.destProject,
            collections: config.collections,
            stats,
            duration,
            dryRun: config.dryRun,
            success: true,
        }, output);
    }
}

async function handleErrorOutput(
    config: ValidatedConfig,
    stats: Stats,
    duration: number,
    errorMessage: string,
    output: Output
): Promise<void> {
    if (config.json) {
        output.json(JSON.parse(formatJsonOutput(false, config, stats, duration, errorMessage)));
    } else {
        output.error(`\n❌ Error during transfer: ${errorMessage}`);
    }

    if (config.webhook) {
        await sendWebhook(config.webhook, {
            source: config.sourceProject,
            destination: config.destProject,
            collections: config.collections,
            stats,
            duration,
            dryRun: config.dryRun,
            success: false,
            error: errorMessage,
        }, output);
    }
}

function displayTransferOptions(config: Config, rateLimiter: RateLimiter | null, output: Output): void {
    let hasOptions = false;

    if (rateLimiter) {
        output.info(`⏱️  Rate limiting enabled: ${config.rateLimit} docs/s`);
        hasOptions = true;
    }

    if (config.detectConflicts) {
        output.info('🔒 Conflict detection enabled: Conflicts will be logged but won\'t stop the transfer');
        hasOptions = true;
    }

    if (config.maxDepth > 0 && config.includeSubcollections) {
        output.info(`📊 Max depth: ${config.maxDepth} - Subcollections beyond this level will be skipped`);
        hasOptions = true;
    }

    if (hasOptions) {
        output.blank();
    }
}

export async function runTransfer(config: ValidatedConfig, argv: CliArgs, output: Output): Promise<TransferResult> {
    const startTime = Date.now();

    try {
        const { state: transferState, stats } = initializeResumeMode(config, output);
        const transformFn = await loadTransform(config, output);

        output.blank();
        const { sourceDb, destDb } = initializeFirebase(config);
        await checkDatabaseConnectivity(sourceDb, destDb, config, output);

        if (transformFn && config.dryRun && config.transformSamples !== 0) {
            await validateTransformWithSamples(sourceDb, config, transformFn, output);
        }

        const currentStats = config.resume ? stats : createEmptyStats();

        if (config.clear) {
            await clearDestinationCollections(destDb, config, currentStats, output);
        }

        const { progressBar } = await setupProgressTracking(sourceDb, config, currentStats, output);

        const rateLimiter = config.rateLimit > 0 ? new RateLimiter(config.rateLimit) : null;
        displayTransferOptions(config, rateLimiter, output);

        const stateSaver = transferState ? new StateSaver(config.stateFile, transferState) : null;

        const conflictList: ConflictInfo[] = [];
        const ctx: TransferContext = {
            sourceDb, destDb, config, stats: currentStats, output, progressBar, transformFn, stateSaver, rateLimiter, conflictList
        };

        await executeTransfer(ctx, output);
        stateSaver?.flush();
        cleanupProgressBar(progressBar);

        if (config.deleteMissing) {
            await deleteOrphanDocs(sourceDb, destDb, config, currentStats, output);
        }

        const duration = (Date.now() - startTime) / 1000;
        output.logSuccess('Transfer completed', { stats: currentStats as unknown as Record<string, unknown>, duration: duration.toFixed(2) });
        output.logSummary(currentStats, duration.toFixed(2));

        const verifyResult = config.verify && !config.dryRun
            ? await verifyTransfer(sourceDb, destDb, config, output)
            : null;

        if (!config.dryRun) {
            deleteTransferState(config.stateFile);
        }

        await handleSuccessOutput(config, argv, currentStats, duration, verifyResult, output);
        await cleanupFirebase();

        return { success: true, stats: currentStats, duration, verifyResult };
    } catch (error) {
        const errorMessage = (error as Error).message;
        const duration = (Date.now() - startTime) / 1000;

        await handleErrorOutput(config, createEmptyStats(), duration, errorMessage, output);
        await cleanupFirebase();

        return { success: false, stats: createEmptyStats(), duration, error: errorMessage };
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

async function validateTransformWithSamples(
    sourceDb: Firestore,
    config: Config,
    transformFn: TransformFunction,
    output: Output
): Promise<void> {
    const samplesPerCollection = config.transformSamples;
    const testAll = samplesPerCollection < 0;

    output.info(`🧪 Validating transform with ${testAll ? 'all' : samplesPerCollection} sample(s) per collection...`);
    let samplesTested = 0;
    let samplesSkipped = 0;
    let samplesErrors = 0;

    for (const collection of config.collections) {
        let query: FirebaseFirestore.Query = sourceDb.collection(collection);
        if (!testAll) {
            query = query.limit(samplesPerCollection);
        }

        const snapshot = await query.get();
        for (const doc of snapshot.docs) {
            try {
                const result = transformFn(doc.data() as Record<string, unknown>, {
                    id: doc.id,
                    path: `${collection}/${doc.id}`,
                });
                if (result === null) {
                    samplesSkipped++;
                } else {
                    samplesTested++;
                }
            } catch (error) {
                samplesErrors++;
                const err = error as Error;
                output.error(`   ⚠️  Transform error on ${collection}/${doc.id}: ${err.message}`);
            }
        }
    }

    if (samplesErrors > 0) {
        output.info(`   ❌ ${samplesErrors} sample(s) failed - review your transform function`);
    } else if (samplesTested > 0 || samplesSkipped > 0) {
        output.info(`   ✓ Tested ${samplesTested} sample(s), ${samplesSkipped} would be skipped`);
    }
    output.blank();
}

function canWriteProgress(output: Output): boolean {
    return !output.isQuiet && !output.isJson;
}

function clearLine(): void {
    process.stdout.write('\r' + ' '.repeat(SEPARATOR_LENGTH) + '\r');
}

function formatNameList(names: Set<string>, max: number = 8): string {
    const arr = [...names];
    if (arr.length <= max) return arr.join(', ');
    return arr.slice(0, max).join(', ') + `, ... (+${arr.length - max})`;
}

async function setupProgressTracking(
    sourceDb: Firestore,
    config: Config,
    stats: Stats,
    output: Output
): Promise<{ totalDocs: number; progressBar: ProgressBarWrapper }> {
    let totalDocs = 0;
    const progressBar = new ProgressBarWrapper();

    if (!output.isQuiet) {
        output.info('📊 Counting documents...');

        for (const collection of config.collections) {
            let rootCount = 0;
            let subcollectionInstances = 0;
            const subcollectionNames = new Set<string>();
            const excludedNames = new Set<string>();
            let lastLog = Date.now();
            let showedScanLine = false;

            if (canWriteProgress(output)) {
                process.stdout.write(`   Counting ${collection}...`);
                showedScanLine = true;
            }

            const countProgress: CountProgress = {
                onCollection: (_path, count) => {
                    rootCount = count;
                },
                onSubcollection: (path) => {
                    subcollectionInstances++;
                    const segments = path.split('/');
                    subcollectionNames.add(segments[segments.length - 1]);

                    if (!canWriteProgress(output)) return;
                    const now = Date.now();
                    if (now - lastLog > PROGRESS_LOG_INTERVAL_MS) {
                        process.stdout.write(`\r   Scanning ${collection}... (${subcollectionInstances} subcollections found)`);
                        showedScanLine = true;
                        lastLog = now;
                    }
                },
                onSubcollectionExcluded: (name) => {
                    excludedNames.add(name);
                },
            };

            const collectionTotal = await countDocuments(sourceDb, collection, config, 0, countProgress);
            totalDocs += collectionTotal;

            // Clear live indicator line
            if (showedScanLine && canWriteProgress(output)) {
                clearLine();
            }

            // Print collection summary
            output.info(`   ${collection}: ${rootCount} documents`);

            if (subcollectionInstances > 0) {
                const subDocs = collectionTotal - rootCount;
                output.info(`      + ${subDocs} in subcollections (${formatNameList(subcollectionNames)})`);
            }
            if (excludedNames.size > 0) {
                output.info(`      Excluded: ${formatNameList(excludedNames)}`);
            }
        }

        output.info(`\n   Total: ${totalDocs} documents to transfer\n`);
        progressBar.start(totalDocs, stats);
    }

    return { totalDocs, progressBar };
}

async function clearDestinationCollections(
    destDb: Firestore,
    config: Config,
    stats: Stats,
    output: Output
): Promise<void> {
    output.info('🗑️  Clearing destination collections...');
    for (const collection of config.collections) {
        const destCollection = getDestCollectionPath(collection, config.renameCollection);
        const deleted = await clearCollection(
            destDb,
            destCollection,
            config,
            output,
            config.includeSubcollections
        );
        stats.documentsDeleted += deleted;
    }
    output.info(`   Deleted ${stats.documentsDeleted} documents\n`);
}

async function executeParallelTransfer(ctx: TransferContext, output: Output): Promise<void> {
    const { errors } = await processInParallel(ctx.config.collections, ctx.config.parallel, (collection) =>
        transferCollection(ctx, collection)
    );
    for (const err of errors) {
        output.logError('Parallel transfer error', { error: err.message });
        ctx.stats.errors++;
    }
}

async function executeSequentialTransfer(ctx: TransferContext, output: Output): Promise<void> {
    for (const collection of ctx.config.collections) {
        try {
            await transferCollection(ctx, collection);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            output.logError(`Transfer failed for ${collection}`, { error: err.message });
            ctx.stats.errors++;
        }
    }
}

async function executeTransfer(ctx: TransferContext, output: Output): Promise<void> {
    if (ctx.config.parallel > 1) {
        await executeParallelTransfer(ctx, output);
    } else {
        await executeSequentialTransfer(ctx, output);
    }
}

function cleanupProgressBar(progressBar: ProgressBarWrapper): void {
    progressBar.stop();
}

async function deleteOrphanDocs(
    sourceDb: Firestore,
    destDb: Firestore,
    config: Config,
    stats: Stats,
    output: Output
): Promise<void> {
    output.info('\n🔄 Deleting orphan documents (sync mode)...');

    let lastProgressLog = Date.now();
    let subcollectionCount = 0;

    const showProgress = canWriteProgress(output);

    const progress: DeleteOrphansProgress = {
        onScanStart: (collection) => {
            if (showProgress) process.stdout.write(`   Scanning ${collection}...`);
        },
        onScanComplete: (collection, orphanCount, totalDest) => {
            if (showProgress) process.stdout.write(`\r   ${collection}: ${orphanCount}/${totalDest} orphan docs\n`);
        },
        onBatchDeleted: (collection, deletedSoFar, total) => {
            if (!showProgress) return;
            process.stdout.write(`\r   Deleting from ${collection}... ${deletedSoFar}/${total}`);
            if (deletedSoFar === total) {
                process.stdout.write('\n');
            }
        },
        onSubcollectionScan: (_path) => {
            subcollectionCount++;
            if (!showProgress) return;
            const now = Date.now();
            if (now - lastProgressLog > PROGRESS_LOG_INTERVAL_MS) {
                process.stdout.write(`\r   Scanning subcollections... (${subcollectionCount} checked)`);
                lastProgressLog = now;
            }
        },
    };

    for (const collection of config.collections) {
        const deleted = await deleteOrphanDocuments(
            sourceDb,
            destDb,
            collection,
            config,
            output,
            progress
        );
        stats.documentsDeleted += deleted;
    }

    if (subcollectionCount > 0 && showProgress) {
        clearLine();
    }

    if (stats.documentsDeleted > 0) {
        output.info(`   Deleted ${stats.documentsDeleted} orphan documents`);
    } else {
        output.info('   No orphan documents found');
    }
}

async function verifyTransfer(
    sourceDb: Firestore,
    destDb: Firestore,
    config: Config,
    output: Output
): Promise<Record<string, { source: number; dest: number; match: boolean }>> {
    output.info('\n🔍 Verifying transfer...');

    const verifyResult: Record<string, { source: number; dest: number; match: boolean }> = {};
    let verifyPassed = true;

    for (const collection of config.collections) {
        const destCollection = getDestCollectionPath(collection, config.renameCollection);

        const sourceCount = await sourceDb.collection(collection).count().get();
        const sourceTotal = sourceCount.data().count;

        const destCount = await destDb.collection(destCollection).count().get();
        const destTotal = destCount.data().count;

        const match = sourceTotal === destTotal;
        verifyResult[collection] = { source: sourceTotal, dest: destTotal, match };

        if (match) {
            output.info(`   ✓ ${collection}: ${sourceTotal} docs (matched)`);
        } else {
            output.info(`   ⚠️  ${collection}: source=${sourceTotal}, dest=${destTotal} (mismatch)`);
        }
        if (!match) verifyPassed = false;
    }

    if (verifyPassed) {
        output.info('   ✓ Verification passed');
    } else {
        output.info('   ⚠️  Verification found mismatches');
    }

    return verifyResult;
}
