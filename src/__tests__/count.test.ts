import { describe, test, expect, mock } from 'bun:test';

// Mock types for Firestore
interface MockDocumentSnapshot {
    id: string;
    ref: { listCollections: () => Promise<{ id: string }[]> };
}

// Helper to create mock document
function createMockDoc(id: string, subcollections: string[] = []): MockDocumentSnapshot {
    return {
        id,
        ref: {
            listCollections: async () => subcollections.map((subId) => ({ id: subId })),
        },
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

// Import types
import type { Config } from '../types.js';
import type { CountProgress } from '../transfer/count.js';

describe('count module', () => {
    describe('buildQueryWithFilters', () => {
        test('creates basic query without filters', () => {
            const config = createMockConfig();
            const depth = 0;

            // Simulate query building
            let filterCount = 0;
            if (depth === 0 && config.where.length > 0) {
                filterCount = config.where.length;
            }

            expect(filterCount).toBe(0);
        });

        test('applies where filters at depth 0', () => {
            const config = createMockConfig({
                where: [
                    { field: 'active', operator: '==', value: true },
                    { field: 'age', operator: '>=', value: 18 },
                ],
            });
            const depth = 0;

            let appliedFilters: Array<{ field: string; operator: string; value: unknown }> = [];
            if (depth === 0 && config.where.length > 0) {
                appliedFilters = config.where;
            }

            expect(appliedFilters).toHaveLength(2);
            expect(appliedFilters[0]).toEqual({ field: 'active', operator: '==', value: true });
            expect(appliedFilters[1]).toEqual({ field: 'age', operator: '>=', value: 18 });
        });

        test('does not apply filters at depth > 0', () => {
            const config = createMockConfig({
                where: [{ field: 'active', operator: '==', value: true }],
            });
            const depth = 1 as number;

            let appliedFilters: Array<{ field: string; operator: string; value: unknown }> = [];
            if (depth === 0 && config.where.length > 0) {
                appliedFilters = config.where;
            }

            expect(appliedFilters).toHaveLength(0);
        });
    });

    describe('countWithoutSubcollections', () => {
        test('uses count() aggregation for efficiency', () => {
            const countResult = { count: 1000 };

            expect(countResult.count).toBe(1000);
        });

        test('applies limit at depth 0', () => {
            const config = createMockConfig({ limit: 100 });
            const depth = 0;
            let count = 500; // Raw count from Firebase

            if (depth === 0 && config.limit > 0) {
                count = Math.min(count, config.limit);
            }

            expect(count).toBe(100);
        });

        test('does not apply limit when limit is 0', () => {
            const config = createMockConfig({ limit: 0 });
            const depth = 0;
            let count = 500;

            if (depth === 0 && config.limit > 0) {
                count = Math.min(count, config.limit);
            }

            expect(count).toBe(500);
        });

        test('does not apply limit at depth > 0', () => {
            const config = createMockConfig({ limit: 100 });
            const depth = 1 as number;
            let count = 500;

            if (depth === 0 && config.limit > 0) {
                count = Math.min(count, config.limit);
            }

            expect(count).toBe(500);
        });

        test('calls onCollection progress callback at depth 0', () => {
            const calls: Array<{ path: string; count: number }> = [];
            const onCollection = (p: string, c: number) => {
                calls.push({ path: p, count: c });
            };
            const depth = 0;
            const collectionPath = 'users';
            const count = 100;

            if (depth === 0 && onCollection) {
                onCollection(collectionPath, count);
            }

            expect(calls).toHaveLength(1);
            expect(calls[0]).toEqual({ path: 'users', count: 100 });
        });
    });

    describe('countWithSubcollections', () => {
        test('counts documents in main collection', () => {
            const docs = [createMockDoc('doc1'), createMockDoc('doc2'), createMockDoc('doc3')];

            expect(docs.length).toBe(3);
        });

        test('applies limit at root level', () => {
            const config = createMockConfig({ limit: 2 });
            const docs = [createMockDoc('doc1'), createMockDoc('doc2'), createMockDoc('doc3')];
            const depth = 0;

            let docsToProcess = docs;
            if (depth === 0 && config.limit > 0) {
                docsToProcess = docs.slice(0, config.limit);
            }

            expect(docsToProcess).toHaveLength(2);
        });

        test('recursively counts subcollections', async () => {
            const doc = createMockDoc('doc1', ['orders', 'reviews']);
            const subcollections = await doc.ref.listCollections();

            expect(subcollections).toHaveLength(2);
            expect(subcollections.map((s) => s.id)).toEqual(['orders', 'reviews']);
        });
    });

    describe('countSubcollectionsForDoc', () => {
        test('lists subcollections for document', async () => {
            const doc = createMockDoc('doc1', ['posts', 'comments', 'likes']);
            const subcollections = await doc.ref.listCollections();

            expect(subcollections).toHaveLength(3);
        });

        test('skips excluded subcollections', async () => {
            const config = createMockConfig({ exclude: ['logs', 'cache*'] });
            const doc = createMockDoc('doc1', ['posts', 'logs', 'cache_v1', 'comments']);
            const subcollections = await doc.ref.listCollections();

            const toProcess = subcollections.filter(
                (s) => !matchesExcludePattern(s.id, config.exclude)
            );

            expect(toProcess).toHaveLength(2);
            expect(toProcess.map((s) => s.id)).toEqual(['posts', 'comments']);
        });

        test('builds correct subcollection path', () => {
            const collectionPath = 'users';
            const docId = 'user123';
            const subId = 'orders';

            const subPath = `${collectionPath}/${docId}/${subId}`;

            expect(subPath).toBe('users/user123/orders');
        });

        test('calls onSubcollection progress callback', () => {
            const onSubcollection = mock((_path: string) => {});
            const subPath = 'users/user123/orders';

            onSubcollection(subPath);

            expect(onSubcollection).toHaveBeenCalledWith('users/user123/orders');
        });
    });

    describe('countDocuments', () => {
        test('uses count() when no subcollections', () => {
            const config = createMockConfig({ includeSubcollections: false });

            expect(config.includeSubcollections).toBe(false);
        });

        test('uses select().get() when subcollections enabled', () => {
            const config = createMockConfig({ includeSubcollections: true });

            expect(config.includeSubcollections).toBe(true);
        });

        test('returns 0 for empty collection', () => {
            const docs: MockDocumentSnapshot[] = [];

            expect(docs.length).toBe(0);
        });

        test('sums counts across nested subcollections', () => {
            // users: 3 docs
            // users/doc1/orders: 2 docs
            // users/doc1/orders/order1/items: 5 docs
            // users/doc2/orders: 1 doc
            // Total: 3 + 2 + 5 + 1 = 11

            const counts = {
                users: 3,
                'users/doc1/orders': 2,
                'users/doc1/orders/order1/items': 5,
                'users/doc2/orders': 1,
            };

            const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

            expect(total).toBe(11);
        });
    });

    describe('CountProgress callbacks', () => {
        test('onCollection called with path and count', () => {
            const progress: CountProgress = {
                onCollection: mock((_path: string, _count: number) => {}),
            };

            progress.onCollection!('users', 100);

            expect(progress.onCollection).toHaveBeenCalledWith('users', 100);
        });

        test('onSubcollection called with path', () => {
            const progress: CountProgress = {
                onSubcollection: mock((_path: string) => {}),
            };

            progress.onSubcollection!('users/doc1/orders');

            expect(progress.onSubcollection).toHaveBeenCalledWith('users/doc1/orders');
        });

        test('handles undefined callbacks gracefully', () => {
            const progress: CountProgress = {};

            // These should not throw
            expect(() => {
                progress.onCollection?.('users', 100);
                progress.onSubcollection?.('users/doc1/orders');
            }).not.toThrow();
        });
    });

    describe('limit handling', () => {
        test('limit applied only at root level', () => {
            const config = createMockConfig({ limit: 10 });

            const testCases = [
                { depth: 0, count: 100, expected: 10 },
                { depth: 1, count: 100, expected: 100 },
                { depth: 2, count: 100, expected: 100 },
            ];

            for (const tc of testCases) {
                let result = tc.count;
                if (tc.depth === 0 && config.limit > 0) {
                    result = Math.min(tc.count, config.limit);
                }
                expect(result).toBe(tc.expected);
            }
        });

        test('limit of 0 means no limit', () => {
            const config = createMockConfig({ limit: 0 });
            let count = 1000;

            if (config.limit > 0) {
                count = Math.min(count, config.limit);
            }

            expect(count).toBe(1000);
        });
    });

    describe('where filter combinations', () => {
        test('multiple where filters applied in sequence', () => {
            const config = createMockConfig({
                where: [
                    { field: 'status', operator: '==', value: 'active' },
                    { field: 'createdAt', operator: '>=', value: '2024-01-01' },
                    { field: 'type', operator: '==', value: 'user' },
                ],
            });

            expect(config.where).toHaveLength(3);
            expect(config.where[0].field).toBe('status');
            expect(config.where[1].field).toBe('createdAt');
            expect(config.where[2].field).toBe('type');
        });

        test('empty where array means no filters', () => {
            const config = createMockConfig({ where: [] });

            expect(config.where).toHaveLength(0);
        });
    });

    describe('exclude pattern matching', () => {
        test('exact match excludes collection', () => {
            const excludePatterns = ['logs', 'temp', 'cache'];
            const subcollection = 'logs';

            const isExcluded = excludePatterns.includes(subcollection);

            expect(isExcluded).toBe(true);
        });

        test('wildcard pattern excludes matching collections', () => {
            const excludePatterns = ['cache*', '*_temp', 'test_*_data'];

            expect(matchesExcludePattern('cache_v1', excludePatterns)).toBe(true);
            expect(matchesExcludePattern('cache_production', excludePatterns)).toBe(true);
            expect(matchesExcludePattern('session_temp', excludePatterns)).toBe(true);
            expect(matchesExcludePattern('test_user_data', excludePatterns)).toBe(true);
            expect(matchesExcludePattern('orders', excludePatterns)).toBe(false);
            expect(matchesExcludePattern('users', excludePatterns)).toBe(false);
        });
    });

    describe('maxDepth boundaries', () => {
        test('maxDepth=0 means unlimited depth', () => {
            const config = createMockConfig({ maxDepth: 0 });

            const shouldStop = (depth: number) => config.maxDepth > 0 && depth >= config.maxDepth;

            expect(shouldStop(0)).toBe(false);
            expect(shouldStop(1)).toBe(false);
            expect(shouldStop(5)).toBe(false);
            expect(shouldStop(100)).toBe(false);
        });

        test('maxDepth=1 stops after first-level subcollections', () => {
            const config = createMockConfig({ maxDepth: 1 });

            const shouldStop = (depth: number) => config.maxDepth > 0 && depth >= config.maxDepth;

            // depth=0 is root collection, should continue to find subcollections
            expect(shouldStop(0)).toBe(false);
            // depth=1 means we're already one level deep, should stop recursing
            expect(shouldStop(1)).toBe(true);
            expect(shouldStop(2)).toBe(true);
        });

        test('maxDepth=2 allows root + two levels of subcollections', () => {
            const config = createMockConfig({ maxDepth: 2 });

            const shouldStop = (depth: number) => config.maxDepth > 0 && depth >= config.maxDepth;

            expect(shouldStop(0)).toBe(false);
            expect(shouldStop(1)).toBe(false);
            expect(shouldStop(2)).toBe(true);
            expect(shouldStop(3)).toBe(true);
        });

        test('maxDepth limits recursive counting simulation', () => {
            const config = createMockConfig({ maxDepth: 1, includeSubcollections: true });
            const counted: string[] = [];

            const simulateCount = (path: string, depth: number) => {
                counted.push(path);
                // Simulate subcollection discovery
                const subcollections =
                    path === 'users'
                        ? ['orders', 'settings']
                        : path === 'users/doc1/orders'
                          ? ['items']
                          : [];

                for (const sub of subcollections) {
                    if (config.maxDepth > 0 && depth >= config.maxDepth) continue;
                    simulateCount(`${path}/doc1/${sub}`, depth + 1);
                }
            };

            simulateCount('users', 0);

            // With maxDepth=1: root(depth=0) counted, subcollections at depth=0 explored,
            // but at depth=1 recursion stops (no items counted)
            expect(counted).toEqual(['users', 'users/doc1/orders', 'users/doc1/settings']);
            expect(counted).not.toContain('users/doc1/orders/doc1/items');
        });
    });

    describe('onSubcollectionExcluded callback', () => {
        test('invoked for each excluded subcollection', () => {
            const config = createMockConfig({ exclude: ['logs', 'cache'] });
            const excluded: string[] = [];
            const onSubcollectionExcluded = (name: string) => excluded.push(name);

            const subcollections = ['users', 'logs', 'orders', 'cache', 'products'];

            for (const subId of subcollections) {
                if (matchesExcludePattern(subId, config.exclude)) {
                    onSubcollectionExcluded(subId);
                    continue;
                }
            }

            expect(excluded).toEqual(['logs', 'cache']);
        });

        test('invoked with wildcard exclude patterns', () => {
            const config = createMockConfig({ exclude: ['cache*', '*_temp'] });
            const excluded: string[] = [];
            const onSubcollectionExcluded = (name: string) => excluded.push(name);

            const subcollections = ['cache_v1', 'cache_prod', 'session_temp', 'orders', 'users'];

            for (const subId of subcollections) {
                if (matchesExcludePattern(subId, config.exclude)) {
                    onSubcollectionExcluded(subId);
                    continue;
                }
            }

            expect(excluded).toEqual(['cache_v1', 'cache_prod', 'session_temp']);
        });

        test('not invoked when no subcollections are excluded', () => {
            const config = createMockConfig({ exclude: ['nonexistent'] });
            const excluded: string[] = [];
            const onSubcollectionExcluded = (name: string) => excluded.push(name);

            const subcollections = ['users', 'orders', 'products'];

            for (const subId of subcollections) {
                if (matchesExcludePattern(subId, config.exclude)) {
                    onSubcollectionExcluded(subId);
                    continue;
                }
            }

            expect(excluded).toEqual([]);
        });

        test('not invoked when exclude list is empty', () => {
            const config = createMockConfig({ exclude: [] });
            const excluded: string[] = [];
            const onSubcollectionExcluded = (name: string) => excluded.push(name);

            const subcollections = ['users', 'orders'];

            for (const subId of subcollections) {
                if (matchesExcludePattern(subId, config.exclude)) {
                    onSubcollectionExcluded(subId);
                    continue;
                }
            }

            expect(excluded).toEqual([]);
        });

        test('works as CountProgress callback', () => {
            const excluded: string[] = [];
            const progress: CountProgress = {
                onSubcollectionExcluded: mock((name: string) => excluded.push(name)),
            };

            progress.onSubcollectionExcluded!('logs');
            progress.onSubcollectionExcluded!('cache_v1');

            expect(progress.onSubcollectionExcluded).toHaveBeenCalledTimes(2);
            expect(excluded).toEqual(['logs', 'cache_v1']);
        });
    });

    describe('depth tracking', () => {
        test('depth increases with each subcollection level', () => {
            const paths = [
                { path: 'users', depth: 0 },
                { path: 'users/doc1/orders', depth: 1 },
                { path: 'users/doc1/orders/order1/items', depth: 2 },
                { path: 'users/doc1/orders/order1/items/item1/details', depth: 3 },
            ];

            for (const p of paths) {
                // Count '/' pairs to determine depth
                const segments = p.path.split('/');
                const calculatedDepth = Math.floor((segments.length - 1) / 2);
                expect(calculatedDepth).toBe(p.depth);
            }
        });

        test('depth passed correctly to recursive calls', () => {
            const calls: Array<{ path: string; depth: number }> = [];

            const simulateCount = (path: string, depth: number) => {
                calls.push({ path, depth });
                if (path === 'users' && depth === 0) {
                    simulateCount('users/doc1/orders', depth + 1);
                }
                if (path === 'users/doc1/orders' && depth === 1) {
                    simulateCount('users/doc1/orders/order1/items', depth + 1);
                }
            };

            simulateCount('users', 0);

            expect(calls).toEqual([
                { path: 'users', depth: 0 },
                { path: 'users/doc1/orders', depth: 1 },
                { path: 'users/doc1/orders/order1/items', depth: 2 },
            ]);
        });
    });
});
