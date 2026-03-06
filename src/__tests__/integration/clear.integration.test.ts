import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import {
    getTestFirestore,
    clearEmulatorData,
    cleanupApps,
    seedCollection,
    getAllDocs,
    getDocCount,
    createTestConfig,
} from './helpers.js';
import { clearCollection, deleteOrphanDocuments } from '../../transfer/clear.js';
import { Output } from '../../utils/output.js';

const db = getTestFirestore();
const output = new Output({ quiet: true, json: false });

beforeEach(async () => {
    await clearEmulatorData();
});

afterAll(async () => {
    await cleanupApps();
});

describe('Clear Integration', () => {
    test('clears all documents in a collection', async () => {
        await seedCollection(db, 'dest_col', {
            doc1: { name: 'Alice' },
            doc2: { name: 'Bob' },
            doc3: { name: 'Charlie' },
        });

        const config = createTestConfig();
        const deleted = await clearCollection(db, 'dest_col', config, output, false);

        expect(deleted).toBe(3);
        const remaining = await getDocCount(db, 'dest_col');
        expect(remaining).toBe(0);
    });

    test('clears subcollections recursively', async () => {
        await seedCollection(db, 'dest_col', {
            doc1: { name: 'Alice' },
        });
        await seedCollection(db, 'dest_col/doc1/orders', {
            order1: { total: 100 },
            order2: { total: 200 },
        });

        const config = createTestConfig();
        const deleted = await clearCollection(db, 'dest_col', config, output, true);

        expect(deleted).toBeGreaterThanOrEqual(3);
        const rootRemaining = await getDocCount(db, 'dest_col');
        expect(rootRemaining).toBe(0);
        const subRemaining = await getDocCount(db, 'dest_col/doc1/orders');
        expect(subRemaining).toBe(0);
    });

    test('deletes orphan documents (--delete-missing)', async () => {
        // Source has doc1 and doc2
        await seedCollection(db, 'source_col', {
            doc1: { name: 'Alice' },
            doc2: { name: 'Bob' },
        });
        // Dest has doc1, doc2, and orphan doc3
        await seedCollection(db, 'dest_col', {
            doc1: { name: 'Alice' },
            doc2: { name: 'Bob' },
            doc3: { name: 'Orphan' },
        });

        const config = createTestConfig();
        const deleted = await deleteOrphanDocuments(db, db, 'source_col', config, output);

        expect(deleted).toBe(1);
        const destDocs = await getAllDocs(db, 'dest_col');
        expect(Object.keys(destDocs)).toHaveLength(2);
        expect(destDocs.doc3).toBeUndefined();
    });

    test('delete-missing with no orphans', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { name: 'Alice' },
        });
        await seedCollection(db, 'dest_col', {
            doc1: { name: 'Alice' },
        });

        const config = createTestConfig();
        const deleted = await deleteOrphanDocuments(db, db, 'source_col', config, output);

        expect(deleted).toBe(0);
    });

    test('handles clearing empty collection', async () => {
        const config = createTestConfig();
        const deleted = await clearCollection(db, 'nonexistent_col', config, output, false);

        expect(deleted).toBe(0);
    });
});
