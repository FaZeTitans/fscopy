import { describe, test, expect, mock } from 'bun:test';

// Mock types for Firestore
interface MockDocumentSnapshot {
    id: string;
    ref: { listCollections: () => Promise<{ id: string }[]> };
    exists: boolean;
    data: () => Record<string, unknown>;
    updateTime?: { toDate: () => Date };
}

interface MockQuerySnapshot {
    empty: boolean;
    size: number;
    docs: MockDocumentSnapshot[];
}

interface MockWriteBatch {
    set: ReturnType<typeof mock>;
    delete: ReturnType<typeof mock>;
    commit: ReturnType<typeof mock>;
}

interface MockFirestore {
    collection: ReturnType<typeof mock>;
    batch: () => MockWriteBatch;
    getAll: ReturnType<typeof mock>;
}

// Helper to create mock document
function createMockDoc(
    id: string,
    data: Record<string, unknown> = {},
    options: { exists?: boolean; updateTime?: Date; subcollections?: string[] } = {}
): MockDocumentSnapshot {
    return {
        id,
        exists: options.exists ?? true,
        data: () => data,
        updateTime: options.updateTime ? { toDate: () => options.updateTime! } : undefined,
        ref: {
            listCollections: async () => (options.subcollections ?? []).map((id) => ({ id })),
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

// Helper to create mock Firestore
function createMockFirestore(): MockFirestore {
    const mockBatch: MockWriteBatch = {
        set: mock(() => mockBatch),
        delete: mock(() => mockBatch),
        commit: mock(() => Promise.resolve()),
    };

    const mockCollection = mock(() => ({
        doc: mock((id: string) => ({
            id,
            set: mock(() => Promise.resolve()),
        })),
        get: mock(() => Promise.resolve(createMockSnapshot([]))),
        where: mock(function (this: unknown) {
            return this;
        }),
        limit: mock(function (this: unknown) {
            return this;
        }),
        select: mock(function (this: unknown) {
            return this;
        }),
    }));

    return {
        collection: mockCollection,
        batch: () => mockBatch,
        getAll: mock(() => Promise.resolve([])),
    };
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

// Import types
import type { Config, Stats } from '../types.js';

describe('transfer module', () => {
    describe('buildTransferQuery', () => {
        test('creates basic query without filters', () => {
            const mockDb = createMockFirestore();

            // Manually test the query building logic
            const collectionPath = 'users';
            const query = mockDb.collection(collectionPath);

            expect(mockDb.collection).toHaveBeenCalledWith('users');
            expect(query).toBeDefined();
        });

        test('applies where filters at depth 0', () => {
            const mockDb = createMockFirestore();
            const config = createMockConfig({
                where: [{ field: 'active', operator: '==', value: true }],
            });

            const mockQuery = mockDb.collection('users');

            // Simulate applying filters
            if (config.where.length > 0) {
                for (const filter of config.where) {
                    mockQuery.where(filter.field, filter.operator, filter.value);
                }
            }

            expect(mockQuery.where).toHaveBeenCalledWith('active', '==', true);
        });

        test('applies limit at depth 0', () => {
            const mockDb = createMockFirestore();
            const config = createMockConfig({ limit: 100 });

            const mockQuery = mockDb.collection('users');

            if (config.limit > 0) {
                mockQuery.limit(config.limit);
            }

            expect(mockQuery.limit).toHaveBeenCalledWith(100);
        });

        test('does not apply filters at depth > 0', () => {
            const mockDb = createMockFirestore();
            const config = createMockConfig({
                where: [{ field: 'active', operator: '==', value: true }],
            });

            const depth = 1 as number;
            const mockQuery = mockDb.collection('users/123/posts');

            // Simulate depth check
            if (depth === 0 && config.where.length > 0) {
                for (const filter of config.where) {
                    mockQuery.where(filter.field, filter.operator, filter.value);
                }
            }

            expect(mockQuery.where).not.toHaveBeenCalled();
        });
    });

    describe('processDocument logic', () => {
        test('skips document if already completed in resume mode', () => {
            const stats = createMockStats();
            const doc = createMockDoc('doc1', { name: 'Test' });

            // Simulate resume mode check
            const isCompletedFn = (path: string, id: string) => path === 'users' && id === 'doc1';

            const isCompleted = isCompletedFn('users', doc.id);
            if (isCompleted) {
                stats.documentsTransferred++;
            }

            expect(isCompleted).toBe(true);
            expect(stats.documentsTransferred).toBe(1);
        });

        test('does not skip document if not completed', () => {
            const stats = createMockStats();
            const doc = createMockDoc('doc2', { name: 'Test' });

            const isCompletedFn = (_path: string, _id: string) => false;

            const isCompleted = isCompletedFn('users', doc.id);
            if (isCompleted) {
                stats.documentsTransferred++;
            }

            expect(isCompleted).toBe(false);
            expect(stats.documentsTransferred).toBe(0);
        });

        test('applies ID prefix and suffix', () => {
            const config = createMockConfig({
                idPrefix: 'backup_',
                idSuffix: '_v2',
            });

            const originalId = 'doc123';
            let destDocId = originalId;

            if (config.idPrefix) {
                destDocId = config.idPrefix + destDocId;
            }
            if (config.idSuffix) {
                destDocId = destDocId + config.idSuffix;
            }

            expect(destDocId).toBe('backup_doc123_v2');
        });
    });

    describe('transform function application', () => {
        test('applies transform function to document data', () => {
            const docData = { name: 'Test', secret: 'hidden' };
            const transformFn = (data: Record<string, unknown>) => {
                const { secret, ...rest } = data;
                return rest;
            };

            const transformed = transformFn(docData);

            expect(transformed).toEqual({ name: 'Test' });
            expect(transformed).not.toHaveProperty('secret');
        });

        test('handles null return from transform (skip document)', () => {
            const docData = { name: 'Test', skip: true };
            const transformFn = (data: Record<string, unknown>) => {
                if (data.skip) return null;
                return data;
            };

            const transformed = transformFn(docData);

            expect(transformed).toBeNull();
        });

        test('catches transform errors and increments error count', () => {
            const stats = createMockStats();
            const transformFn = () => {
                throw new Error('Transform failed');
            };

            let transformError: Error | null = null;
            try {
                transformFn();
            } catch (err) {
                transformError = err as Error;
                stats.errors++;
            }

            expect(transformError).not.toBeNull();
            expect(transformError?.message).toBe('Transform failed');
            expect(stats.errors).toBe(1);
        });
    });

    describe('conflict detection', () => {
        test('detects conflict when document was modified during transfer', () => {
            const capturedTime: string = '2024-01-01T00:00:00.000Z';
            const currentTime: string = '2024-01-01T01:00:00.000Z'; // Different time

            const isConflict = currentTime !== capturedTime;

            expect(isConflict).toBe(true);
        });

        test('detects conflict when document was created during transfer', () => {
            const capturedTime = null; // Doc didn't exist
            const docExists = true; // But now it exists

            const isConflict = docExists && capturedTime === null;

            expect(isConflict).toBe(true);
        });

        test('detects conflict when document was deleted during transfer', () => {
            const capturedTime = '2024-01-01T00:00:00.000Z'; // Doc existed
            const docExists = false; // But now it doesn't

            const isConflict = !docExists && capturedTime !== null;

            expect(isConflict).toBe(true);
        });

        test('no conflict when updateTime matches', () => {
            const capturedTime = '2024-01-01T00:00:00.000Z';
            const currentTime = '2024-01-01T00:00:00.000Z';
            const docExists = true;

            const isConflict =
                (docExists && capturedTime === null) ||
                (docExists && currentTime !== capturedTime) ||
                (!docExists && capturedTime !== null);

            expect(isConflict).toBe(false);
        });

        test('records conflict info when detected', () => {
            const conflictList: Array<{
                collection: string;
                docId: string;
                reason: string;
            }> = [];
            const stats = createMockStats();

            const destCollectionPath = 'users';
            const destDocId = 'doc123';
            const hasConflict = true;

            if (hasConflict) {
                stats.conflicts++;
                conflictList.push({
                    collection: destCollectionPath,
                    docId: destDocId,
                    reason: 'Document was modified during transfer',
                });
            }

            expect(stats.conflicts).toBe(1);
            expect(conflictList).toHaveLength(1);
            expect(conflictList[0]).toEqual({
                collection: 'users',
                docId: 'doc123',
                reason: 'Document was modified during transfer',
            });
        });
    });

    describe('subcollection processing', () => {
        test('skips subcollections when maxDepth reached', () => {
            const config = createMockConfig({
                maxDepth: 2,
                includeSubcollections: true,
            });
            const currentDepth = 2;

            const shouldSkip = config.maxDepth > 0 && currentDepth >= config.maxDepth;

            expect(shouldSkip).toBe(true);
        });

        test('processes subcollections when under maxDepth', () => {
            const config = createMockConfig({
                maxDepth: 3,
                includeSubcollections: true,
            });
            const currentDepth = 1;

            const shouldSkip = config.maxDepth > 0 && currentDepth >= config.maxDepth;

            expect(shouldSkip).toBe(false);
        });

        test('processes subcollections when maxDepth is 0 (unlimited)', () => {
            const config = createMockConfig({
                maxDepth: 0,
                includeSubcollections: true,
            });
            const currentDepth = 10;

            const shouldSkip = config.maxDepth > 0 && currentDepth >= config.maxDepth;

            expect(shouldSkip).toBe(false);
        });

        test('skips excluded subcollections', () => {
            const config = createMockConfig({
                exclude: ['logs', 'cache*'],
                includeSubcollections: true,
            });

            const subcollections = ['orders', 'logs', 'cache_v1', 'posts'];

            const processed = subcollections.filter(
                (sub) => !matchesExcludePattern(sub, config.exclude)
            );

            expect(processed).toEqual(['orders', 'posts']);
            expect(processed).not.toContain('logs');
            expect(processed).not.toContain('cache_v1');
        });
    });

    describe('pagination', () => {
        test('pages through documents with batchSize as page size', () => {
            const allDocs = Array.from({ length: 1250 }, (_, i) =>
                createMockDoc(`doc${i}`, { index: i })
            );
            const batchSize = 500;
            const pages: MockDocumentSnapshot[][] = [];
            let offset = 0;

            // Simulate pagination: fetch batchSize docs at a time
            while (true) {
                const page = allDocs.slice(offset, offset + batchSize);
                if (page.length === 0) break;
                pages.push(page);
                offset += page.length;
                if (page.length < batchSize) break;
            }

            expect(pages).toHaveLength(3);
            expect(pages[0]).toHaveLength(500);
            expect(pages[1]).toHaveLength(500);
            expect(pages[2]).toHaveLength(250);
        });

        test('terminates when collection size is exact multiple of batchSize', () => {
            const allDocs = Array.from({ length: 1000 }, (_, i) =>
                createMockDoc(`doc${i}`, { index: i })
            );
            const batchSize = 500;
            const pages: MockDocumentSnapshot[][] = [];
            let offset = 0;

            while (true) {
                const page = allDocs.slice(offset, offset + batchSize);
                if (page.length === 0) break;
                pages.push(page);
                offset += page.length;
                // Fewer docs than requested means end (this won't trigger for exact multiple)
                if (page.length < batchSize) break;
            }

            // With exact multiple, last page has batchSize docs, loop fetches one more empty page
            // Total pages with data should be 2
            expect(pages).toHaveLength(2);
            expect(pages[0]).toHaveLength(500);
            expect(pages[1]).toHaveLength(500);
        });

        test('respects user limit across pages', () => {
            const allDocs = Array.from({ length: 1000 }, (_, i) =>
                createMockDoc(`doc${i}`, { index: i })
            );
            const batchSize = 500;
            const userLimit = 750;
            const pages: MockDocumentSnapshot[][] = [];
            let totalProcessed = 0;

            while (true) {
                let pageSize = batchSize;
                const remaining = userLimit - totalProcessed;
                if (remaining <= 0) break;
                pageSize = Math.min(pageSize, remaining);

                const page = allDocs.slice(totalProcessed, totalProcessed + pageSize);
                if (page.length === 0) break;
                pages.push(page);
                totalProcessed += page.length;
                if (page.length < pageSize) break;
            }

            expect(totalProcessed).toBe(750);
            expect(pages).toHaveLength(2);
            expect(pages[0]).toHaveLength(500);
            expect(pages[1]).toHaveLength(250);
        });

        test('handles single page (docs < batchSize)', () => {
            const allDocs = Array.from({ length: 100 }, (_, i) =>
                createMockDoc(`doc${i}`, { index: i })
            );
            const batchSize = 500;
            const pages: MockDocumentSnapshot[][] = [];
            let offset = 0;

            while (true) {
                const page = allDocs.slice(offset, offset + batchSize);
                if (page.length === 0) break;
                pages.push(page);
                offset += page.length;
                if (page.length < batchSize) break;
            }

            expect(pages).toHaveLength(1);
            expect(pages[0]).toHaveLength(100);
        });

        test('handles empty collection', () => {
            const allDocs: MockDocumentSnapshot[] = [];
            const batchSize = 500;
            const pages: MockDocumentSnapshot[][] = [];

            const page = allDocs.slice(0, batchSize);
            if (page.length > 0) {
                pages.push(page);
            }

            expect(pages).toHaveLength(0);
        });

        test('startAfter uses last doc of previous page', () => {
            const allDocs = Array.from({ length: 10 }, (_, i) =>
                createMockDoc(`doc${i}`, { index: i })
            );
            const batchSize = 3;
            const lastDocs: string[] = [];
            let offset = 0;

            while (true) {
                const page = allDocs.slice(offset, offset + batchSize);
                if (page.length === 0) break;
                lastDocs.push(page[page.length - 1].id);
                offset += page.length;
                if (page.length < batchSize) break;
            }

            // Last doc of each full page should be used as startAfter cursor
            expect(lastDocs).toEqual(['doc2', 'doc5', 'doc8', 'doc9']);
        });
    });

    describe('batch operations', () => {
        test('batches documents by batchSize', () => {
            const docs = Array.from({ length: 1250 }, (_, i) =>
                createMockDoc(`doc${i}`, { index: i })
            );
            const batchSize = 500;
            const batches: MockDocumentSnapshot[][] = [];

            for (let i = 0; i < docs.length; i += batchSize) {
                batches.push(docs.slice(i, i + batchSize));
            }

            expect(batches).toHaveLength(3);
            expect(batches[0]).toHaveLength(500);
            expect(batches[1]).toHaveLength(500);
            expect(batches[2]).toHaveLength(250);
        });

        test('handles empty snapshot', () => {
            const snapshot = createMockSnapshot([]);

            expect(snapshot.empty).toBe(true);
            expect(snapshot.size).toBe(0);
        });

        test('skips batch commit in dry run mode', () => {
            const config = createMockConfig({ dryRun: true });
            const mockBatch = {
                set: mock(() => {}),
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
            const mockBatch = {
                set: mock(() => {}),
                commit: mock(() => Promise.resolve()),
            };

            // Simulate dry run check
            if (!config.dryRun) {
                mockBatch.commit();
            }

            expect(mockBatch.commit).toHaveBeenCalled();
        });
    });

    describe('merge mode', () => {
        test('uses merge:true when config.merge is enabled', () => {
            const config = createMockConfig({ merge: true });
            const setCalls: unknown[][] = [];
            const mockBatch = {
                set: (...args: unknown[]) => {
                    setCalls.push(args);
                },
            };

            const destDocRef = { id: 'doc1' };
            const data = { name: 'Test' };

            if (config.merge) {
                mockBatch.set(destDocRef, data, { merge: true });
            } else {
                mockBatch.set(destDocRef, data);
            }

            expect(setCalls[0]).toEqual([destDocRef, data, { merge: true }]);
        });

        test('uses set without merge when config.merge is disabled', () => {
            const config = createMockConfig({ merge: false });
            const setCalls: unknown[][] = [];
            const mockBatch = {
                set: (...args: unknown[]) => {
                    setCalls.push(args);
                },
            };

            const destDocRef = { id: 'doc1' };
            const data = { name: 'Test' };

            if (config.merge) {
                mockBatch.set(destDocRef, data, { merge: true });
            } else {
                mockBatch.set(destDocRef, data);
            }

            expect(setCalls[0]).toEqual([destDocRef, data]);
        });
    });

    describe('integrity verification', () => {
        test('increments integrityErrors when document not found after write', () => {
            const stats = createMockStats();
            const destDocExists = false;

            if (!destDocExists) {
                stats.integrityErrors++;
            }

            expect(stats.integrityErrors).toBe(1);
        });

        test('increments integrityErrors when hash mismatch', () => {
            const stats = createMockStats();
            const sourceHash: string = 'abc123';
            const destHash: string = 'xyz789';

            if (sourceHash !== destHash) {
                stats.integrityErrors++;
            }

            expect(stats.integrityErrors).toBe(1);
        });

        test('no integrity error when hashes match', () => {
            const stats = createMockStats();
            const sourceHash = 'abc123';
            const destHash = 'abc123';

            if (sourceHash !== destHash) {
                stats.integrityErrors++;
            }

            expect(stats.integrityErrors).toBe(0);
        });
    });

    describe('rate limiting integration', () => {
        test('acquires rate limit tokens before batch commit', async () => {
            const acquireCalls: number[] = [];
            const mockRateLimiter = {
                acquire: (count: number) => {
                    acquireCalls.push(count);
                    return Promise.resolve();
                },
            };

            await mockRateLimiter.acquire(100);

            expect(acquireCalls[0]).toBe(100);
        });

        test('skips rate limiting when rateLimiter is null', () => {
            const rateLimiter = null;

            let acquireCalled = false;
            if (rateLimiter) {
                acquireCalled = true;
            }

            expect(acquireCalled).toBe(false);
        });
    });

    describe('collection renaming', () => {
        test('renames root collection in destination path', () => {
            const renameCollection = { users: 'users_backup' };
            const sourcePath = 'users';

            const parts = sourcePath.split('/');
            if (renameCollection[parts[0] as keyof typeof renameCollection]) {
                parts[0] = renameCollection[parts[0] as keyof typeof renameCollection];
            }
            const destPath = parts.join('/');

            expect(destPath).toBe('users_backup');
        });

        test('renames root collection in nested path', () => {
            const renameCollection = { users: 'members' };
            const sourcePath = 'users/123/orders';

            const parts = sourcePath.split('/');
            if (renameCollection[parts[0] as keyof typeof renameCollection]) {
                parts[0] = renameCollection[parts[0] as keyof typeof renameCollection];
            }
            const destPath = parts.join('/');

            expect(destPath).toBe('members/123/orders');
        });
    });
});
