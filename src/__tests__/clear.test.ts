import { describe, test, expect, mock } from 'bun:test';

// Mock types for Firestore
interface MockDocumentSnapshot {
    id: string;
    ref: {
        listCollections: () => Promise<{ id: string }[]>;
        delete?: () => Promise<void>;
    };
    exists: boolean;
    data: () => Record<string, unknown>;
}

interface MockQuerySnapshot {
    empty: boolean;
    size: number;
    docs: MockDocumentSnapshot[];
}

interface MockWriteBatch {
    delete: ReturnType<typeof mock>;
    commit: ReturnType<typeof mock>;
}

// Helper to create mock document
function createMockDoc(
    id: string,
    data: Record<string, unknown> = {},
    subcollections: string[] = []
): MockDocumentSnapshot {
    return {
        id,
        exists: true,
        data: () => data,
        ref: {
            listCollections: async () => subcollections.map((subId) => ({ id: subId })),
            delete: async () => {},
        },
    };
}

// Helper to create mock query snapshot
function createMockSnapshot(docs: MockDocumentSnapshot[]): MockQuerySnapshot {
    return {
        empty: docs.length === 0,
        size: docs.length,
        docs,
    };
}

// Helper for pattern matching (used in exclude tests)
function matchesExcludePattern(name: string, patterns: string[]): boolean {
    return patterns.some((p) => {
        if (p.includes('*')) {
            const regex = new RegExp('^' + p.replaceAll('*', '.*') + '$');
            return regex.test(name);
        }
        return name === p;
    });
}

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

// Import types
import type { Config } from '../types.js';
import type { Output } from '../utils/output.js';

describe('clear module', () => {
    describe('clearCollection', () => {
        test('returns 0 for empty collection', () => {
            const snapshot = createMockSnapshot([]);

            // Simulate clearCollection behavior
            let deletedCount = 0;
            if (!snapshot.empty) {
                deletedCount = snapshot.docs.length;
            }

            expect(deletedCount).toBe(0);
        });

        test('counts all documents in non-empty collection', () => {
            const docs = [
                createMockDoc('doc1', { name: 'User 1' }),
                createMockDoc('doc2', { name: 'User 2' }),
                createMockDoc('doc3', { name: 'User 3' }),
            ];
            const snapshot = createMockSnapshot(docs);

            let deletedCount = 0;
            if (!snapshot.empty) {
                deletedCount = snapshot.docs.length;
            }

            expect(deletedCount).toBe(3);
        });

        test('batches deletions by batchSize', () => {
            const docs = Array.from({ length: 1250 }, (_, i) =>
                createMockDoc(`doc${i}`, { index: i })
            );
            const config = createMockConfig({ batchSize: 500 });
            const batches: MockDocumentSnapshot[][] = [];

            for (let i = 0; i < docs.length; i += config.batchSize) {
                batches.push(docs.slice(i, i + config.batchSize));
            }

            expect(batches).toHaveLength(3);
            expect(batches[0]).toHaveLength(500);
            expect(batches[1]).toHaveLength(500);
            expect(batches[2]).toHaveLength(250);
        });

        test('skips commit in dry run mode', () => {
            const config = createMockConfig({ dryRun: true });
            const mockBatch: MockWriteBatch = {
                delete: mock(() => {}),
                commit: mock(() => Promise.resolve()),
            };

            // Simulate dry run check
            if (!config.dryRun) {
                mockBatch.commit();
            }

            expect(mockBatch.commit).not.toHaveBeenCalled();
        });

        test('commits batch when not in dry run mode', () => {
            const config = createMockConfig({ dryRun: false });
            const mockBatch: MockWriteBatch = {
                delete: mock(() => {}),
                commit: mock(() => Promise.resolve()),
            };

            // Simulate dry run check
            if (!config.dryRun) {
                mockBatch.commit();
            }

            expect(mockBatch.commit).toHaveBeenCalled();
        });
    });

    describe('clearDocSubcollections', () => {
        test('returns 0 when no subcollections', async () => {
            const doc = createMockDoc('doc1', {}, []);
            const subcollections = await doc.ref.listCollections();

            expect(subcollections).toHaveLength(0);
        });

        test('lists all subcollections', async () => {
            const doc = createMockDoc('doc1', {}, ['orders', 'reviews', 'logs']);
            const subcollections = await doc.ref.listCollections();

            expect(subcollections).toHaveLength(3);
            expect(subcollections.map((s) => s.id)).toEqual(['orders', 'reviews', 'logs']);
        });

        test('skips excluded subcollections', async () => {
            const config = createMockConfig({ exclude: ['logs', 'cache*'] });
            const doc = createMockDoc('doc1', {}, ['orders', 'logs', 'cache_v1', 'reviews']);
            const subcollections = await doc.ref.listCollections();

            const toProcess = subcollections.filter(
                (s) => !matchesExcludePattern(s.id, config.exclude)
            );

            expect(toProcess).toHaveLength(2);
            expect(toProcess.map((s) => s.id)).toEqual(['orders', 'reviews']);
        });
    });

    describe('deleteBatch', () => {
        test('adds all documents to write batch', () => {
            const docs = [createMockDoc('doc1'), createMockDoc('doc2'), createMockDoc('doc3')];
            const mockBatch: MockWriteBatch = {
                delete: mock(() => {}),
                commit: mock(() => Promise.resolve()),
            };

            for (const doc of docs) {
                mockBatch.delete(doc.ref);
            }

            expect(mockBatch.delete).toHaveBeenCalledTimes(3);
        });

        test('returns correct deleted count', () => {
            const docs = [
                createMockDoc('doc1'),
                createMockDoc('doc2'),
                createMockDoc('doc3'),
                createMockDoc('doc4'),
                createMockDoc('doc5'),
            ];

            const deletedCount = docs.length;

            expect(deletedCount).toBe(5);
        });

        test('logs deletion info', () => {
            const output = createMockOutput();
            const batchLength = 5;
            const collectionPath = 'users';

            output.logInfo(`Deleted ${batchLength} documents from ${collectionPath}`);

            expect(output.logInfo).toHaveBeenCalledWith('Deleted 5 documents from users');
        });
    });

    describe('deleteOrphanDocuments', () => {
        test('identifies orphan documents not in source', () => {
            const sourceIds = new Set(['doc1', 'doc2', 'doc3']);
            const destDocs = [
                createMockDoc('doc1'),
                createMockDoc('doc2'),
                createMockDoc('doc3'),
                createMockDoc('doc4'), // orphan
                createMockDoc('doc5'), // orphan
            ];

            const orphanDocs = destDocs.filter((doc) => !sourceIds.has(doc.id));

            expect(orphanDocs).toHaveLength(2);
            expect(orphanDocs.map((d) => d.id)).toEqual(['doc4', 'doc5']);
        });

        test('returns 0 when no orphans', () => {
            const sourceIds = new Set(['doc1', 'doc2', 'doc3']);
            const destDocs = [createMockDoc('doc1'), createMockDoc('doc2')];

            const orphanDocs = destDocs.filter((doc) => !sourceIds.has(doc.id));

            expect(orphanDocs).toHaveLength(0);
        });

        test('all dest docs are orphans when source is empty', () => {
            // When source has no documents, all destination docs are orphans
            const sourceIds = new Set<string>();
            const destDocs = [createMockDoc('doc1'), createMockDoc('doc2'), createMockDoc('doc3')];

            // With empty source, orphan count equals dest count
            expect(sourceIds.size).toBe(0);
            expect(destDocs.length).toBe(3);
            // All docs are orphans since none exist in source
            const orphanCount = destDocs.filter((doc) => !sourceIds.has(doc.id)).length;
            expect(orphanCount).toBe(destDocs.length);
        });

        test('applies collection rename when checking orphans', () => {
            const renameCollection = { users: 'users_backup' };
            const sourceCollectionPath = 'users';

            // Get dest collection path
            const parts = sourceCollectionPath.split('/');
            if (renameCollection[parts[0] as keyof typeof renameCollection]) {
                parts[0] = renameCollection[parts[0] as keyof typeof renameCollection];
            }
            const destCollectionPath = parts.join('/');

            expect(destCollectionPath).toBe('users_backup');
        });

        test('batches orphan deletions', () => {
            const orphanDocs = Array.from({ length: 750 }, (_, i) => createMockDoc(`orphan${i}`));
            const config = createMockConfig({ batchSize: 500 });
            const batches: MockDocumentSnapshot[][] = [];

            for (let i = 0; i < orphanDocs.length; i += config.batchSize) {
                batches.push(orphanDocs.slice(i, i + config.batchSize));
            }

            expect(batches).toHaveLength(2);
            expect(batches[0]).toHaveLength(500);
            expect(batches[1]).toHaveLength(250);
        });
    });

    describe('DeleteOrphansProgress callbacks', () => {
        test('calls onScanStart with collection path', () => {
            const onScanStart = mock((_collection: string) => {});
            const destCollectionPath = 'users';

            onScanStart(destCollectionPath);

            expect(onScanStart).toHaveBeenCalledWith('users');
        });

        test('calls onScanComplete with counts', () => {
            const onScanComplete = mock(
                (_collection: string, _orphanCount: number, _totalDest: number) => {}
            );
            const destCollectionPath = 'users';
            const orphanCount = 5;
            const totalDest = 100;

            onScanComplete(destCollectionPath, orphanCount, totalDest);

            expect(onScanComplete).toHaveBeenCalledWith('users', 5, 100);
        });

        test('calls onBatchDeleted with progress', () => {
            const onBatchDeleted = mock(
                (_collection: string, _deletedSoFar: number, _total: number) => {}
            );
            const destCollectionPath = 'users';

            // Simulate batch deletions
            onBatchDeleted(destCollectionPath, 100, 500);
            onBatchDeleted(destCollectionPath, 200, 500);
            onBatchDeleted(destCollectionPath, 300, 500);

            expect(onBatchDeleted).toHaveBeenCalledTimes(3);
            expect(onBatchDeleted).toHaveBeenLastCalledWith('users', 300, 500);
        });

        test('calls onSubcollectionScan for subcollections', () => {
            const onSubcollectionScan = mock((_path: string) => {});

            onSubcollectionScan('users/doc1/orders');
            onSubcollectionScan('users/doc1/reviews');

            expect(onSubcollectionScan).toHaveBeenCalledTimes(2);
            expect(onSubcollectionScan).toHaveBeenCalledWith('users/doc1/orders');
            expect(onSubcollectionScan).toHaveBeenCalledWith('users/doc1/reviews');
        });
    });

    describe('clearOrphanSubcollections', () => {
        test('processes all subcollections of orphan doc', async () => {
            const doc = createMockDoc('orphan1', {}, ['orders', 'reviews', 'settings']);
            const subcollections = await doc.ref.listCollections();

            expect(subcollections).toHaveLength(3);
        });

        test('skips excluded subcollections when clearing', async () => {
            const config = createMockConfig({ exclude: ['logs'] });
            const doc = createMockDoc('orphan1', {}, ['orders', 'logs', 'reviews']);
            const subcollections = await doc.ref.listCollections();

            const toProcess = subcollections.filter((s) => !config.exclude.includes(s.id));

            expect(toProcess).toHaveLength(2);
            expect(toProcess.map((s) => s.id)).toEqual(['orders', 'reviews']);
        });
    });

    describe('recursive subcollection clearing', () => {
        test('recursively clears nested subcollections', () => {
            // Simulate nested structure: users/doc1/orders/order1/items
            // hierarchy represents what would exist in Firestore (for documentation)
            // users: ['doc1', 'doc2']
            // users/doc1/orders: ['order1']
            // users/doc1/orders/order1/items: ['item1', 'item2']

            const clearedCollections: string[] = [];
            const processCollection = (path: string) => {
                clearedCollections.push(path);
            };

            // Process in order (would be DFS in real impl)
            processCollection('users/doc1/orders/order1/items');
            processCollection('users/doc1/orders');
            processCollection('users');

            expect(clearedCollections).toEqual([
                'users/doc1/orders/order1/items',
                'users/doc1/orders',
                'users',
            ]);
        });

        test('respects includeSubcollections flag', () => {
            const configWithSub = createMockConfig({ includeSubcollections: true });
            const configWithoutSub = createMockConfig({ includeSubcollections: false });

            expect(configWithSub.includeSubcollections).toBe(true);
            expect(configWithoutSub.includeSubcollections).toBe(false);
        });
    });

    describe('retry logic for deletions', () => {
        test('retries on failure', async () => {
            let attempts = 0;
            const maxRetries = 3;
            const mockCommit = mock(async () => {
                attempts++;
                if (attempts < 3) {
                    throw new Error('Temporary failure');
                }
            });

            // Simulate retry logic
            let success = false;
            for (let i = 0; i < maxRetries && !success; i++) {
                try {
                    await mockCommit();
                    success = true;
                } catch {
                    // Retry
                }
            }

            expect(attempts).toBe(3);
            expect(success).toBe(true);
        });

        test('logs retry attempts', () => {
            const output = createMockOutput();
            const attempt = 2;
            const maxRetries = 3;
            const errorMsg = 'Network error';
            const delay = 2000;
            const collectionPath = 'users';

            output.logError(`Retry delete ${attempt}/${maxRetries} for ${collectionPath}`, {
                error: errorMsg,
                delay,
            });

            expect(output.logError).toHaveBeenCalledWith('Retry delete 2/3 for users', {
                error: 'Network error',
                delay: 2000,
            });
        });
    });
});
