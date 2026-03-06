import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import type { ValidatedConfig, Stats, ConflictInfo } from '../../types.js';
import { Output } from '../../utils/output.js';
import { ProgressBarWrapper } from '../../utils/progress.js';
import type { TransferContext } from '../../transfer/transfer.js';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const TEST_PROJECT = 'fscopy-test';

// Track created apps for cleanup
const createdApps: admin.app.App[] = [];
let appCounter = 0;

/**
 * Create a Firestore instance connected to the emulator.
 * Each call creates a new Firebase Admin app to avoid conflicts.
 */
export function getTestFirestore(projectId: string = TEST_PROJECT): Firestore {
    const app = admin.initializeApp({ projectId }, `test-${appCounter++}`);
    createdApps.push(app);
    return app.firestore();
}

/**
 * Clean up all created Firebase apps.
 */
export async function cleanupApps(): Promise<void> {
    for (const app of createdApps) {
        await app.delete().catch(() => {});
    }
    createdApps.length = 0;
}

/**
 * Clear all data in the emulator using the REST API.
 */
export async function clearEmulatorData(): Promise<void> {
    const url = `http://${EMULATOR_HOST}/emulator/v1/projects/${TEST_PROJECT}/databases/(default)/documents`;
    await fetch(url, { method: 'DELETE' });
}

/**
 * Seed a collection with documents.
 */
export async function seedCollection(
    db: Firestore,
    collectionPath: string,
    docs: Record<string, Record<string, unknown>>
): Promise<void> {
    const batch = db.batch();
    for (const [docId, data] of Object.entries(docs)) {
        batch.set(db.collection(collectionPath).doc(docId), data);
    }
    await batch.commit();
}

/**
 * Get all documents from a collection as a map of id -> data.
 */
export async function getAllDocs(
    db: Firestore,
    collectionPath: string
): Promise<Record<string, Record<string, unknown>>> {
    const snapshot = await db.collection(collectionPath).get();
    const result: Record<string, Record<string, unknown>> = {};
    for (const doc of snapshot.docs) {
        result[doc.id] = doc.data() as Record<string, unknown>;
    }
    return result;
}

/**
 * Get document count for a collection.
 */
export async function getDocCount(db: Firestore, collectionPath: string): Promise<number> {
    const snapshot = await db.collection(collectionPath).count().get();
    return snapshot.data().count;
}

/**
 * Create a ValidatedConfig for integration tests with sensible defaults.
 */
export function createTestConfig(overrides: Partial<ValidatedConfig> = {}): ValidatedConfig {
    return {
        sourceProject: TEST_PROJECT,
        destProject: TEST_PROJECT,
        collections: ['source_col'],
        includeSubcollections: false,
        dryRun: false,
        batchSize: 10,
        limit: 0,
        retries: 1,
        where: [],
        exclude: [],
        merge: false,
        parallel: 1,
        clear: false,
        deleteMissing: false,
        transform: null,
        renameCollection: { source_col: 'dest_col' },
        idPrefix: null,
        idSuffix: null,
        webhook: null,
        resume: false,
        stateFile: '.fscopy-test-state.json',
        verify: false,
        rateLimit: 0,
        skipOversized: false,
        json: false,
        transformSamples: 0,
        detectConflicts: false,
        maxDepth: 0,
        verifyIntegrity: false,
        allowHttpWebhook: false,
        ...overrides,
    };
}

/**
 * Create a TransferContext for integration tests.
 */
export function createTestContext(
    sourceDb: Firestore,
    destDb: Firestore,
    config: ValidatedConfig,
    stats?: Stats
): TransferContext {
    const testStats: Stats = stats ?? {
        collectionsProcessed: 0,
        documentsTransferred: 0,
        documentsDeleted: 0,
        errors: 0,
        conflicts: 0,
        integrityErrors: 0,
    };

    const output = new Output({ quiet: true, json: false });
    const progressBar = new ProgressBarWrapper();
    const conflictList: ConflictInfo[] = [];

    return {
        sourceDb,
        destDb,
        config,
        stats: testStats,
        output,
        progressBar,
        transformFn: null,
        stateSaver: null,
        rateLimiter: null,
        conflictList,
        maxDepthWarningsShown: new Set<string>(),
    };
}

/**
 * Create empty stats object.
 */
export function createEmptyStats(): Stats {
    return {
        collectionsProcessed: 0,
        documentsTransferred: 0,
        documentsDeleted: 0,
        errors: 0,
        conflicts: 0,
        integrityErrors: 0,
    };
}
