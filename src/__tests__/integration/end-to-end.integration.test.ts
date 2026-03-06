import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import fs from 'node:fs';
import {
    getTestFirestore,
    clearEmulatorData,
    cleanupApps,
    seedCollection,
    getAllDocs,
    getDocCount,
    createTestConfig,
} from './helpers.js';
import { runTransfer } from '../../orchestrator.js';
import { Output } from '../../utils/output.js';
import type { CliArgs } from '../../types.js';

const db = getTestFirestore();

const defaultCliArgs: CliArgs = {
    yes: true,
    quiet: true,
    json: false,
};

beforeEach(async () => {
    await clearEmulatorData();
    // Clean up state files
    try {
        fs.unlinkSync('.fscopy-test-state.json');
    } catch {
        // ignore
    }
});

afterAll(async () => {
    await cleanupApps();
    try {
        fs.unlinkSync('.fscopy-test-state.json');
    } catch {
        // ignore
    }
});

describe('End-to-End Integration', () => {
    test('full transfer pipeline: count, transfer, verify', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { name: 'Alice', age: 30 },
            doc2: { name: 'Bob', age: 25 },
            doc3: { name: 'Charlie', age: 35 },
        });

        const config = createTestConfig({ verify: true });
        const output = new Output({ quiet: true, json: false });
        output.init();

        const result = await runTransfer(config, defaultCliArgs, output);

        expect(result.success).toBe(true);
        expect(result.stats.documentsTransferred).toBe(3);
        expect(result.stats.collectionsProcessed).toBe(1);
        expect(result.stats.errors).toBe(0);

        // Verify destination has all docs
        const destDocs = await getAllDocs(db, 'dest_col');
        expect(Object.keys(destDocs)).toHaveLength(3);
    });

    test('full transfer with parallel collections', async () => {
        await seedCollection(db, 'col_a', {
            doc1: { val: 'a1' },
            doc2: { val: 'a2' },
        });
        await seedCollection(db, 'col_b', {
            doc1: { val: 'b1' },
            doc2: { val: 'b2' },
            doc3: { val: 'b3' },
        });

        const config = createTestConfig({
            collections: ['col_a', 'col_b'],
            renameCollection: { col_a: 'dest_a', col_b: 'dest_b' },
            parallel: 2,
        });
        const output = new Output({ quiet: true, json: false });
        output.init();

        const result = await runTransfer(config, defaultCliArgs, output);

        expect(result.success).toBe(true);
        expect(result.stats.documentsTransferred).toBe(5);

        const destA = await getDocCount(db, 'dest_a');
        const destB = await getDocCount(db, 'dest_b');
        expect(destA).toBe(2);
        expect(destB).toBe(3);
    });

    test('dry run produces no writes', async () => {
        await seedCollection(db, 'source_col', {
            doc1: { name: 'Alice' },
            doc2: { name: 'Bob' },
        });

        const config = createTestConfig({ dryRun: true });
        const output = new Output({ quiet: true, json: false });
        output.init();

        const result = await runTransfer(config, defaultCliArgs, output);

        expect(result.success).toBe(true);
        expect(result.stats.documentsTransferred).toBe(2); // Counted but not written

        const destCount = await getDocCount(db, 'dest_col');
        expect(destCount).toBe(0); // Nothing actually written
    });
});
