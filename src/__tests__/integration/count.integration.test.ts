import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import {
    getTestFirestore,
    clearEmulatorData,
    cleanupApps,
    seedCollection,
    createTestConfig,
} from './helpers.js';
import { countDocuments } from '../../transfer/count.js';

const db = getTestFirestore();

beforeEach(async () => {
    await clearEmulatorData();
});

afterAll(async () => {
    await cleanupApps();
});

describe('Count Integration', () => {
    test('counts documents in a collection', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { val: 1 },
            doc2: { val: 2 },
            doc3: { val: 3 },
        });

        const config = createTestConfig();
        const count = await countDocuments(db, 'source_col', config, 0);

        expect(count).toBe(3);
    });

    test('counts with subcollections', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { val: 1 },
            doc2: { val: 2 },
        });
        await seedCollection(db, 'source_col/doc1/sub', {
            subdoc1: { val: 10 },
            subdoc2: { val: 20 },
        });
        await seedCollection(db, 'source_col/doc2/sub', {
            subdoc3: { val: 30 },
        });

        const config = createTestConfig({ includeSubcollections: true });
        const count = await countDocuments(db, 'source_col', config, 0);

        // 2 root + 3 subcollection docs
        expect(count).toBe(5);
    });

    test('counts with where filter', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { status: 'active' },
            doc2: { status: 'inactive' },
            doc3: { status: 'active' },
            doc4: { status: 'deleted' },
        });

        const config = createTestConfig({
            where: [{ field: 'status', operator: '==', value: 'active' }],
        });
        const count = await countDocuments(db, 'source_col', config, 0);

        expect(count).toBe(2);
    });

    test('counts empty collection as 0', async () => {
        const config = createTestConfig();
        const count = await countDocuments(db, 'nonexistent_col', config, 0);

        expect(count).toBe(0);
    });
});
