import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import {
    getTestFirestore,
    clearEmulatorData,
    cleanupApps,
    seedCollection,
    getAllDocs,
    getDocCount,
    createTestConfig,
    createTestContext,
    createEmptyStats,
} from './helpers.js';
import { transferCollection } from '../../transfer/transfer.js';
import { RateLimiter } from '../../utils/rate-limiter.js';
import type { TransformFunction } from '../../types.js';

const db = getTestFirestore();

beforeEach(async () => {
    await clearEmulatorData();
});

afterAll(async () => {
    await cleanupApps();
});

describe('Transfer Integration', () => {
    test('transfers documents from source to dest collection', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { name: 'Alice', age: 30 },
            doc2: { name: 'Bob', age: 25 },
            doc3: { name: 'Charlie', age: 35 },
        });

        const config = createTestConfig();
        const ctx = createTestContext(db, db, config);

        await transferCollection(ctx, 'source_col');

        const destDocs = await getAllDocs(db, 'dest_col');
        expect(Object.keys(destDocs)).toHaveLength(3);
        expect(destDocs.doc1.name).toBe('Alice');
        expect(destDocs.doc2.name).toBe('Bob');
        expect(destDocs.doc3.name).toBe('Charlie');
        expect(ctx.stats.documentsTransferred).toBe(3);
        expect(ctx.stats.collectionsProcessed).toBe(1);
    });

    test('transfers with subcollections', async () => {
        await seedCollection(db, 'source_col', {
            user1: { name: 'Alice' },
        });
        await seedCollection(db, 'source_col/user1/orders', {
            order1: { total: 100 },
            order2: { total: 200 },
        });

        const config = createTestConfig({ includeSubcollections: true });
        const ctx = createTestContext(db, db, config);

        await transferCollection(ctx, 'source_col');

        const destDocs = await getAllDocs(db, 'dest_col');
        expect(Object.keys(destDocs)).toHaveLength(1);

        const subDocs = await getAllDocs(db, 'dest_col/user1/orders');
        expect(Object.keys(subDocs)).toHaveLength(2);
        expect(subDocs.order1.total).toBe(100);
    });

    test('respects --limit at root level only', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { val: 1 },
            doc2: { val: 2 },
            doc3: { val: 3 },
            doc4: { val: 4 },
            doc5: { val: 5 },
        });

        const config = createTestConfig({ limit: 2, batchSize: 10 });
        const ctx = createTestContext(db, db, config);

        await transferCollection(ctx, 'source_col');

        const count = await getDocCount(db, 'dest_col');
        expect(count).toBe(2);
    });

    test('applies --where filters', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { status: 'active', name: 'Alice' },
            doc2: { status: 'inactive', name: 'Bob' },
            doc3: { status: 'active', name: 'Charlie' },
        });

        const config = createTestConfig({
            where: [{ field: 'status', operator: '==', value: 'active' }],
        });
        const ctx = createTestContext(db, db, config);

        await transferCollection(ctx, 'source_col');

        const destDocs = await getAllDocs(db, 'dest_col');
        expect(Object.keys(destDocs)).toHaveLength(2);
        expect(destDocs.doc1.name).toBe('Alice');
        expect(destDocs.doc3.name).toBe('Charlie');
    });

    test('handles --merge mode', async () => {
        // Pre-populate dest with existing data
        await seedCollection(db, 'dest_col', {
            doc1: { name: 'OldAlice', extra: 'keep-me' },
        });

        await seedCollection(db, 'source_col', {
            doc1: { name: 'NewAlice', age: 30 },
        });

        const config = createTestConfig({ merge: true });
        const ctx = createTestContext(db, db, config);

        await transferCollection(ctx, 'source_col');

        const destDocs = await getAllDocs(db, 'dest_col');
        expect(destDocs.doc1.name).toBe('NewAlice');
        expect(destDocs.doc1.age).toBe(30);
        expect(destDocs.doc1.extra).toBe('keep-me'); // Merged, not overwritten
    });

    test('handles --rename-collection', async () => {
        await seedCollection(db, 'users', {
            u1: { name: 'Alice' },
        });

        const config = createTestConfig({
            collections: ['users'],
            renameCollection: { users: 'users_backup' },
        });
        const ctx = createTestContext(db, db, config);

        await transferCollection(ctx, 'users');

        const destDocs = await getAllDocs(db, 'users_backup');
        expect(Object.keys(destDocs)).toHaveLength(1);
        expect(destDocs.u1.name).toBe('Alice');
    });

    test('handles --id-prefix and --id-suffix', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { val: 1 },
        });

        const config = createTestConfig({ idPrefix: 'bk_', idSuffix: '_v2' });
        const ctx = createTestContext(db, db, config);

        await transferCollection(ctx, 'source_col');

        const destDocs = await getAllDocs(db, 'dest_col');
        expect(destDocs['bk_doc1_v2']).toBeDefined();
        expect(destDocs['bk_doc1_v2'].val).toBe(1);
    });

    test('applies transform function', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { name: 'Alice', secret: 'password123' },
            doc2: { name: 'Bob', secret: 'hidden' },
        });

        const transformFn: TransformFunction = (doc) => {
            const { secret: _, ...rest } = doc;
            return { ...rest, transformed: true };
        };

        const config = createTestConfig();
        const ctx = createTestContext(db, db, config);
        ctx.transformFn = transformFn;

        await transferCollection(ctx, 'source_col');

        const destDocs = await getAllDocs(db, 'dest_col');
        expect(destDocs.doc1.name).toBe('Alice');
        expect(destDocs.doc1.secret).toBeUndefined();
        expect(destDocs.doc1.transformed).toBe(true);
    });

    test('transform returning null skips document', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { name: 'Alice', keep: true },
            doc2: { name: 'Bob', keep: false },
            doc3: { name: 'Charlie', keep: true },
        });

        const transformFn: TransformFunction = (doc) => {
            return doc.keep ? doc : null;
        };

        const config = createTestConfig();
        const ctx = createTestContext(db, db, config);
        ctx.transformFn = transformFn;

        await transferCollection(ctx, 'source_col');

        const destDocs = await getAllDocs(db, 'dest_col');
        expect(Object.keys(destDocs)).toHaveLength(2);
        expect(destDocs.doc1).toBeDefined();
        expect(destDocs.doc3).toBeDefined();
    });

    test('handles empty collection gracefully', async () => {
        // source_col doesn't exist / is empty
        const config = createTestConfig();
        const ctx = createTestContext(db, db, config);

        await transferCollection(ctx, 'source_col');

        expect(ctx.stats.documentsTransferred).toBe(0);
        expect(ctx.stats.collectionsProcessed).toBe(0);
    });

    test('handles max-depth for subcollections', async () => {
        // Create: source_col/doc1 -> sub1/doc2 -> sub2/doc3
        await seedCollection(db, 'source_col', { doc1: { level: 0 } });
        await seedCollection(db, 'source_col/doc1/sub1', { doc2: { level: 1 } });
        await seedCollection(db, 'source_col/doc1/sub1/doc2/sub2', { doc3: { level: 2 } });

        const config = createTestConfig({
            includeSubcollections: true,
            maxDepth: 1, // Only go 1 level deep
        });
        const ctx = createTestContext(db, db, config);

        await transferCollection(ctx, 'source_col');

        // Root doc should be transferred
        const rootDocs = await getAllDocs(db, 'dest_col');
        expect(Object.keys(rootDocs)).toHaveLength(1);

        // Level 1 subcollection should be transferred
        const sub1Docs = await getAllDocs(db, 'dest_col/doc1/sub1');
        expect(Object.keys(sub1Docs)).toHaveLength(1);

        // Level 2 subcollection should NOT be transferred (maxDepth=1)
        const sub2Docs = await getAllDocs(db, 'dest_col/doc1/sub1/doc2/sub2');
        expect(Object.keys(sub2Docs)).toHaveLength(0);
    });

    test('verifies integrity with --verify-integrity', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { name: 'Alice', age: 30 },
            doc2: { name: 'Bob', age: 25 },
        });

        const config = createTestConfig({ verifyIntegrity: true });
        const ctx = createTestContext(db, db, config);

        await transferCollection(ctx, 'source_col');

        expect(ctx.stats.integrityErrors).toBe(0);
        expect(ctx.stats.documentsTransferred).toBe(2);
    });

    test('handles pagination with small batch size', async () => {
        // Create more docs than batch size
        const docs: Record<string, Record<string, unknown>> = {};
        for (let i = 0; i < 15; i++) {
            docs[`doc${String(i).padStart(3, '0')}`] = { index: i };
        }
        await seedCollection(db, 'source_col', docs);

        const config = createTestConfig({ batchSize: 5 });
        const ctx = createTestContext(db, db, config);

        await transferCollection(ctx, 'source_col');

        const destCount = await getDocCount(db, 'dest_col');
        expect(destCount).toBe(15);
        expect(ctx.stats.documentsTransferred).toBe(15);
    });

    test('dry run does not write', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { name: 'Alice' },
        });

        const config = createTestConfig({ dryRun: true });
        const ctx = createTestContext(db, db, config);

        await transferCollection(ctx, 'source_col');

        const destCount = await getDocCount(db, 'dest_col');
        expect(destCount).toBe(0);
        // Stats still count (dry run simulates)
        expect(ctx.stats.documentsTransferred).toBe(1);
    });

    test('rate limiter integration', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { val: 1 },
            doc2: { val: 2 },
            doc3: { val: 3 },
        });

        const config = createTestConfig({ rateLimit: 100 });
        const ctx = createTestContext(db, db, config);
        ctx.rateLimiter = new RateLimiter(100);

        await transferCollection(ctx, 'source_col');

        const destDocs = await getAllDocs(db, 'dest_col');
        expect(Object.keys(destDocs)).toHaveLength(3);
    });
});
