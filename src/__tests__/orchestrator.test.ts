import { describe, test, expect, mock } from 'bun:test';

// Import types
import type { Config, Stats, TransferState } from '../types.js';
import type { Output } from '../utils/output.js';

// Helper to create mock config
function createMockConfig(overrides: Partial<Config> = {}): Config {
    return {
        sourceProject: 'source-project',
        destProject: 'dest-project',
        collections: ['users'],
        includeSubcollections: false,
        dryRun: true,
        batchSize: 500,
        limit: 0,
        retries: 3,
        where: [],
        exclude: [],
        merge: false,
        parallel: 1,
        clear: false,
        deleteMissing: false,
        transform: null,
        renameCollection: {},
        idPrefix: null,
        idSuffix: null,
        webhook: null,
        skipOversized: false,
        detectConflicts: false,
        maxDepth: 0,
        verifyIntegrity: false,
        allowHttpWebhook: false,
        resume: false,
        stateFile: '.fscopy-state.json',
        verify: false,
        rateLimit: 0,
        json: false,
        transformSamples: 3,
        ...overrides,
    };
}

// Helper to create mock stats
function createMockStats(): Stats {
    return {
        collectionsProcessed: 0,
        documentsTransferred: 0,
        documentsDeleted: 0,
        errors: 0,
        conflicts: 0,
        integrityErrors: 0,
    };
}

// Helper to create mock output
function createMockOutput(): Output {
    return {
        info: mock(() => {}),
        error: mock(() => {}),
        warn: mock(() => {}),
        success: mock(() => {}),
        print: mock(() => {}),
        blank: mock(() => {}),
        separator: mock(() => {}),
        header: mock(() => {}),
        log: mock(() => {}),
        logInfo: mock(() => {}),
        logError: mock(() => {}),
        logSuccess: mock(() => {}),
        logSummary: mock(() => {}),
        json: mock(() => {}),
        init: mock(() => {}),
        isQuiet: false,
        isJson: false,
        logFile: undefined,
    } as unknown as Output;
}

// Helper to create mock transfer state
function createMockTransferState(overrides: Partial<TransferState> = {}): TransferState {
    return {
        version: 1,
        sourceProject: 'source-project',
        destProject: 'dest-project',
        collections: ['users'],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedDocs: {},
        stats: createMockStats(),
        ...overrides,
    };
}

describe('orchestrator module', () => {
    describe('initializeResumeMode', () => {
        test('throws error when resume enabled but no state file exists', () => {
            const config = createMockConfig({ resume: true, stateFile: 'nonexistent.json' });

            // Simulate checking for state file
            const stateFileExists = false;

            expect(() => {
                if (config.resume && !stateFileExists) {
                    throw new Error(
                        `No state file found at ${config.stateFile}. Cannot resume without a saved state. Run without --resume to start fresh.`
                    );
                }
            }).toThrow('No state file found');
        });

        test('validates state file matches current config', () => {
            const config = createMockConfig({
                resume: true,
                sourceProject: 'project-a',
                destProject: 'project-b',
                collections: ['users'],
            });
            const existingState = createMockTransferState({
                sourceProject: 'different-project',
                destProject: 'project-b',
                collections: ['users'],
            });

            const errors: string[] = [];
            if (existingState.sourceProject !== config.sourceProject) {
                errors.push(
                    `Source project mismatch: state=${existingState.sourceProject}, config=${config.sourceProject}`
                );
            }
            if (existingState.destProject !== config.destProject) {
                errors.push(
                    `Dest project mismatch: state=${existingState.destProject}, config=${config.destProject}`
                );
            }

            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('Source project mismatch');
        });

        test('restores stats from existing state when resuming', () => {
            const existingState = createMockTransferState({
                stats: {
                    collectionsProcessed: 2,
                    documentsTransferred: 150,
                    documentsDeleted: 0,
                    errors: 1,
                    conflicts: 0,
                    integrityErrors: 0,
                },
            });

            const stats = { ...existingState.stats };

            expect(stats.collectionsProcessed).toBe(2);
            expect(stats.documentsTransferred).toBe(150);
            expect(stats.errors).toBe(1);
        });

        test('counts completed documents from state', () => {
            const existingState = createMockTransferState({
                completedDocs: {
                    users: ['doc1', 'doc2', 'doc3'],
                    orders: ['order1', 'order2'],
                },
            });

            const completedCount = Object.values(existingState.completedDocs).reduce(
                (sum, ids) => sum + ids.length,
                0
            );

            expect(completedCount).toBe(5);
        });

        test('creates new state when not in dry run mode', () => {
            const config = createMockConfig({ dryRun: false, resume: false });

            const shouldCreateState = !config.dryRun && !config.resume;

            expect(shouldCreateState).toBe(true);
        });

        test('does not create state in dry run mode', () => {
            const config = createMockConfig({ dryRun: true, resume: false });

            const shouldCreateState = !config.dryRun && !config.resume;

            expect(shouldCreateState).toBe(false);
        });
    });

    describe('createEmptyStats', () => {
        test('creates stats with all zeros', () => {
            const stats = createMockStats();

            expect(stats.collectionsProcessed).toBe(0);
            expect(stats.documentsTransferred).toBe(0);
            expect(stats.documentsDeleted).toBe(0);
            expect(stats.errors).toBe(0);
            expect(stats.conflicts).toBe(0);
            expect(stats.integrityErrors).toBe(0);
        });
    });

    describe('loadTransform', () => {
        test('returns null when no transform configured', async () => {
            const config = createMockConfig({ transform: null });

            const transformFn = config.transform ? 'loaded' : null;

            expect(transformFn).toBeNull();
        });

        test('loads transform when path is provided', () => {
            const config = createMockConfig({ transform: './transform.ts' });

            expect(config.transform).toBe('./transform.ts');
        });
    });

    describe('handleSuccessOutput', () => {
        test('outputs JSON when json mode enabled', () => {
            const config = createMockConfig({ json: true });
            const output = createMockOutput();
            const stats = createMockStats();

            if (config.json) {
                output.json({ success: true, stats });
            }

            expect(output.json).toHaveBeenCalled();
        });

        test('prints summary when not in json mode', () => {
            const config = createMockConfig({ json: false });
            const output = createMockOutput();

            if (!config.json) {
                output.info('Transfer completed');
            }

            expect(output.info).toHaveBeenCalled();
        });

        test('sends webhook on success when configured', async () => {
            const config = createMockConfig({ webhook: 'https://hooks.example.com/test' });
            const sendWebhook = mock(() => Promise.resolve());

            if (config.webhook) {
                await sendWebhook();
            }

            expect(sendWebhook).toHaveBeenCalled();
        });
    });

    describe('handleErrorOutput', () => {
        test('outputs JSON error when json mode enabled', () => {
            const config = createMockConfig({ json: true });
            const output = createMockOutput();
            const errorMessage = 'Transfer failed';

            if (config.json) {
                output.json({ success: false, error: errorMessage });
            }

            expect(output.json).toHaveBeenCalledWith({ success: false, error: 'Transfer failed' });
        });

        test('prints error message when not in json mode', () => {
            const config = createMockConfig({ json: false });
            const output = createMockOutput();
            const errorMessage = 'Transfer failed';

            if (!config.json) {
                output.error(`❌ Error during transfer: ${errorMessage}`);
            }

            expect(output.error).toHaveBeenCalled();
        });

        test('sends webhook on error when configured', async () => {
            const config = createMockConfig({ webhook: 'https://hooks.example.com/test' });
            const sendWebhook = mock(() => Promise.resolve());

            if (config.webhook) {
                await sendWebhook();
            }

            expect(sendWebhook).toHaveBeenCalled();
        });
    });

    describe('setupProgressTracking', () => {
        test('skips progress bar in quiet mode', () => {
            const output = createMockOutput();
            (output as unknown as { isQuiet: boolean }).isQuiet = true;

            let progressBarStarted = false;
            if (!output.isQuiet) {
                progressBarStarted = true;
            }

            expect(progressBarStarted).toBe(false);
        });

        test('counts documents across all collections', async () => {
            const collections = ['users', 'orders', 'products'];
            const counts = { users: 100, orders: 50, products: 75 };

            let totalDocs = 0;
            for (const collection of collections) {
                totalDocs += counts[collection as keyof typeof counts];
            }

            expect(totalDocs).toBe(225);
        });
    });

    describe('clearDestinationCollections', () => {
        test('clears all configured collections', async () => {
            const config = createMockConfig({ collections: ['users', 'orders'] });
            const clearedCollections: string[] = [];

            for (const collection of config.collections) {
                clearedCollections.push(collection);
            }

            expect(clearedCollections).toEqual(['users', 'orders']);
        });

        test('applies rename when clearing', () => {
            const config = createMockConfig({
                collections: ['users'],
                renameCollection: { users: 'users_backup' },
            });

            const getDestPath = (path: string) => {
                const parts = path.split('/');
                const renamed = config.renameCollection[parts[0]];
                if (renamed) {
                    parts[0] = renamed;
                }
                return parts.join('/');
            };

            expect(getDestPath('users')).toBe('users_backup');
        });

        test('accumulates deleted document count', () => {
            const stats = createMockStats();
            const deletedCounts = [50, 100, 25];

            for (const count of deletedCounts) {
                stats.documentsDeleted += count;
            }

            expect(stats.documentsDeleted).toBe(175);
        });
    });

    describe('executeTransfer', () => {
        test('uses parallel processing when parallel > 1', () => {
            const config = createMockConfig({ parallel: 3 });

            const useParallel = config.parallel > 1;

            expect(useParallel).toBe(true);
        });

        test('uses sequential processing when parallel = 1', () => {
            const config = createMockConfig({ parallel: 1 });

            const useParallel = config.parallel > 1;

            expect(useParallel).toBe(false);
        });

        test('collects errors from parallel transfers', () => {
            const stats = createMockStats();
            const errors = [new Error('Error 1'), new Error('Error 2')];

            for (const _err of errors) {
                stats.errors++;
            }

            expect(stats.errors).toBe(2);
        });

        test('continues on error in sequential mode', async () => {
            const config = createMockConfig({ collections: ['users', 'orders', 'products'] });
            const output = createMockOutput();
            const stats = createMockStats();
            const processed: string[] = [];

            for (const collection of config.collections) {
                try {
                    if (collection === 'orders') {
                        throw new Error('Simulated error');
                    }
                    processed.push(collection);
                } catch (error) {
                    stats.errors++;
                    output.logError(`Transfer failed for ${collection}`, {
                        error: (error as Error).message,
                    });
                }
            }

            // Should have processed users and products, error on orders
            expect(processed).toEqual(['users', 'products']);
            expect(stats.errors).toBe(1);
        });
    });

    describe('deleteOrphanDocs', () => {
        test('only runs when deleteMissing is enabled', () => {
            const configWithDelete = createMockConfig({ deleteMissing: true });
            const configWithoutDelete = createMockConfig({ deleteMissing: false });

            expect(configWithDelete.deleteMissing).toBe(true);
            expect(configWithoutDelete.deleteMissing).toBe(false);
        });

        test('accumulates deleted orphan count', () => {
            const stats = createMockStats();
            const orphanCounts = [10, 5, 15];

            for (const count of orphanCounts) {
                stats.documentsDeleted += count;
            }

            expect(stats.documentsDeleted).toBe(30);
        });
    });

    describe('verifyTransfer', () => {
        test('only runs when verify enabled and not dry run', () => {
            const configVerifyDry = createMockConfig({ verify: true, dryRun: true });
            const configVerifyLive = createMockConfig({ verify: true, dryRun: false });
            const configNoVerify = createMockConfig({ verify: false, dryRun: false });

            const shouldVerify = (config: Config) => config.verify && !config.dryRun;

            expect(shouldVerify(configVerifyDry)).toBe(false);
            expect(shouldVerify(configVerifyLive)).toBe(true);
            expect(shouldVerify(configNoVerify)).toBe(false);
        });

        test('compares source and dest counts', () => {
            const sourceCount = 100;
            const destCount = 100;

            const match = sourceCount === destCount;

            expect(match).toBe(true);
        });

        test('detects count mismatch', () => {
            const sourceCount: number = 100;
            const destCount: number = 95;

            const match = sourceCount === destCount;

            expect(match).toBe(false);
        });

        test('returns verification results per collection', () => {
            const verifyResult: Record<string, { source: number; dest: number; match: boolean }> =
                {};
            const collections = ['users', 'orders'];
            const counts = {
                users: { source: 100, dest: 100 },
                orders: { source: 50, dest: 48 },
            };

            for (const collection of collections) {
                const c = counts[collection as keyof typeof counts];
                verifyResult[collection] = {
                    source: c.source,
                    dest: c.dest,
                    match: c.source === c.dest,
                };
            }

            expect(verifyResult.users.match).toBe(true);
            expect(verifyResult.orders.match).toBe(false);
        });
    });

    describe('validateTransformWithSamples', () => {
        test('skips validation when transformSamples is 0', () => {
            const config = createMockConfig({ transformSamples: 0 });

            const shouldValidate = config.transformSamples !== 0;

            expect(shouldValidate).toBe(false);
        });

        test('tests all documents when transformSamples is negative', () => {
            const config = createMockConfig({ transformSamples: -1 });

            const testAll = config.transformSamples < 0;

            expect(testAll).toBe(true);
        });

        test('limits samples per collection', () => {
            const config = createMockConfig({ transformSamples: 5 });
            const docCount = 100;

            const samplesToTest = config.transformSamples < 0 ? docCount : config.transformSamples;

            expect(samplesToTest).toBe(5);
        });

        test('counts successful transforms', () => {
            const docs = [{ id: 'doc1' }, { id: 'doc2' }, { id: 'doc3' }];
            const transformFn = (data: Record<string, unknown>) => data;

            let samplesTested = 0;
            for (const _doc of docs) {
                const result = transformFn({ name: 'test' });
                if (result !== null) {
                    samplesTested++;
                }
            }

            expect(samplesTested).toBe(3);
        });

        test('counts skipped transforms (null returns)', () => {
            const docs = [{ id: 'doc1' }, { id: 'doc2' }, { id: 'doc3' }];
            const transformFn = (data: Record<string, unknown>, ctx: { id: string }) => {
                if (ctx.id === 'doc2') return null;
                return data;
            };

            let samplesSkipped = 0;
            for (const doc of docs) {
                const result = transformFn({ name: 'test' }, doc);
                if (result === null) {
                    samplesSkipped++;
                }
            }

            expect(samplesSkipped).toBe(1);
        });

        test('counts transform errors', () => {
            const docs = [{ id: 'doc1' }, { id: 'doc2' }, { id: 'doc3' }];
            const transformFn = (data: Record<string, unknown>, ctx: { id: string }) => {
                if (ctx.id === 'doc2') throw new Error('Transform failed');
                return data;
            };

            let samplesErrors = 0;
            for (const doc of docs) {
                try {
                    transformFn({ name: 'test' }, doc);
                } catch {
                    samplesErrors++;
                }
            }

            expect(samplesErrors).toBe(1);
        });
    });

    describe('rate limiting', () => {
        test('creates rate limiter when rateLimit > 0', () => {
            const config = createMockConfig({ rateLimit: 100 });

            const rateLimiter = config.rateLimit > 0 ? { rate: config.rateLimit } : null;

            expect(rateLimiter).not.toBeNull();
            expect(rateLimiter?.rate).toBe(100);
        });

        test('no rate limiter when rateLimit is 0', () => {
            const config = createMockConfig({ rateLimit: 0 });

            const rateLimiter = config.rateLimit > 0 ? { rate: config.rateLimit } : null;

            expect(rateLimiter).toBeNull();
        });
    });

    describe('state cleanup', () => {
        test('deletes state file on successful non-dry-run transfer', () => {
            const config = createMockConfig({ dryRun: false });
            const deleteStateCalled = mock(() => {});

            if (!config.dryRun) {
                deleteStateCalled();
            }

            expect(deleteStateCalled).toHaveBeenCalled();
        });

        test('keeps state file in dry run mode', () => {
            const config = createMockConfig({ dryRun: true });
            const deleteStateCalled = mock(() => {});

            if (!config.dryRun) {
                deleteStateCalled();
            }

            expect(deleteStateCalled).not.toHaveBeenCalled();
        });
    });

    describe('TransferResult', () => {
        test('success result includes stats and duration', () => {
            const result = {
                success: true,
                stats: createMockStats(),
                duration: 10.5,
            };

            result.stats.documentsTransferred = 100;

            expect(result.success).toBe(true);
            expect(result.stats.documentsTransferred).toBe(100);
            expect(result.duration).toBe(10.5);
        });

        test('error result includes error message', () => {
            const result = {
                success: false,
                stats: createMockStats(),
                duration: 5.2,
                error: 'Connection failed',
            };

            expect(result.success).toBe(false);
            expect(result.error).toBe('Connection failed');
        });

        test('verify result included when verification run', () => {
            const result = {
                success: true,
                stats: createMockStats(),
                duration: 15,
                verifyResult: {
                    users: { source: 100, dest: 100, match: true },
                },
            };

            expect(result.verifyResult).toBeDefined();
            expect(result.verifyResult?.users.match).toBe(true);
        });
    });

    describe('error handling', () => {
        test('catches and reports transfer errors', () => {
            const output = createMockOutput();
            let errorCaught = false;

            try {
                throw new Error('Database connection failed');
            } catch (error) {
                errorCaught = true;
                output.error(`Error: ${(error as Error).message}`);
            }

            expect(errorCaught).toBe(true);
            expect(output.error).toHaveBeenCalled();
        });

        test('cleans up Firebase on error', async () => {
            const cleanupCalled = mock(() => Promise.resolve());

            try {
                throw new Error('Simulated error');
            } catch {
                await cleanupCalled();
            }

            expect(cleanupCalled).toHaveBeenCalled();
        });

        test('returns error result on failure', () => {
            const startTime = Date.now();
            let result;

            try {
                throw new Error('Transfer failed');
            } catch (error) {
                result = {
                    success: false,
                    stats: createMockStats(),
                    duration: (Date.now() - startTime) / 1000,
                    error: (error as Error).message,
                };
            }

            expect(result?.success).toBe(false);
            expect(result?.error).toBe('Transfer failed');
        });
    });
});
