import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { Config, ValidatedConfig } from '../types.js';
import type { Output } from '../utils/output.js';

// Mock firebase-admin
const mockFirestore = {
    listCollections: mock(() => Promise.resolve([])),
};

const mockApp = {
    firestore: () => mockFirestore,
    delete: mock(() => Promise.resolve()),
};

const mockAdmin = {
    initializeApp: mock(() => mockApp),
    credential: {
        applicationDefault: mock(() => ({})),
    },
    apps: [] as unknown[],
};

// We need to mock before importing the module
mock.module('firebase-admin', () => ({
    default: mockAdmin,
}));

// Import after mocking
const { initializeFirebase, checkDatabaseConnectivity, cleanupFirebase } =
    await import('../firebase/index.js');

function createMockConfig(overrides: Partial<Config> = {}): ValidatedConfig {
    return {
        sourceProject: 'source-project',
        destProject: 'dest-project',
        collections: ['users'],
        includeSubcollections: false,
        dryRun: true,
        batchSize: 500,
        limit: 0,
        retries: 3,
        quiet: false,
        json: false,
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
        resume: false,
        stateFile: '.fscopy-state.json',
        verify: false,
        rateLimit: 0,
        skipOversized: false,
        detectConflicts: false,
        maxDepth: 0,
        transformSamples: 3,
        verifyIntegrity: false,
        allowHttpWebhook: false,
        ...overrides,
    } as ValidatedConfig;
}

function createMockOutput(): Output {
    return {
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
        success: mock(() => {}),
        print: mock(() => {}),
        blank: mock(() => {}),
        header: mock(() => {}),
        separator: mock(() => {}),
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

describe('Firebase Module', () => {
    beforeEach(async () => {
        await cleanupFirebase();
        mockAdmin.initializeApp.mockClear();
        mockApp.delete.mockClear();
        mockFirestore.listCollections.mockClear();
    });

    describe('initializeFirebase', () => {
        test('initializes source and destination apps', () => {
            const config = createMockConfig();

            const result = initializeFirebase(config);

            expect(mockAdmin.initializeApp).toHaveBeenCalledTimes(2);
            expect(result.sourceDb).toBeDefined();
            expect(result.destDb).toBeDefined();
        });

        test('uses correct project IDs', () => {
            const config = createMockConfig({
                sourceProject: 'my-source',
                destProject: 'my-dest',
            });

            initializeFirebase(config);

            // Verify source app initialization
            expect(mockAdmin.initializeApp).toHaveBeenCalledWith(
                expect.objectContaining({ projectId: 'my-source' }),
                'source'
            );

            // Verify dest app initialization
            expect(mockAdmin.initializeApp).toHaveBeenCalledWith(
                expect.objectContaining({ projectId: 'my-dest' }),
                'dest'
            );
        });

        test('uses applicationDefault credentials', () => {
            const config = createMockConfig();

            initializeFirebase(config);

            expect(mockAdmin.credential.applicationDefault).toHaveBeenCalled();
        });
    });

    describe('checkDatabaseConnectivity', () => {
        test('checks source and destination connectivity', async () => {
            const config = createMockConfig();
            const output = createMockOutput();
            const sourceDb = mockFirestore as unknown as FirebaseFirestore.Firestore;
            const destDb = mockFirestore as unknown as FirebaseFirestore.Firestore;

            await checkDatabaseConnectivity(sourceDb, destDb, config, output);

            expect(mockFirestore.listCollections).toHaveBeenCalledTimes(2);
            expect(output.info).toHaveBeenCalledWith('🔌 Checking database connectivity...');
        });

        test('skips destination check when same as source', async () => {
            const config = createMockConfig({
                sourceProject: 'same-project',
                destProject: 'same-project',
            });
            const output = createMockOutput();
            const sourceDb = mockFirestore as unknown as FirebaseFirestore.Firestore;
            const destDb = mockFirestore as unknown as FirebaseFirestore.Firestore;

            await checkDatabaseConnectivity(sourceDb, destDb, config, output);

            // Only source is checked when projects are the same
            expect(mockFirestore.listCollections).toHaveBeenCalledTimes(1);
            expect(output.info).toHaveBeenCalledWith(
                '   ✓ Destination (same as source) - connected'
            );
        });

        test('throws error when source connection fails', async () => {
            const config = createMockConfig();
            const output = createMockOutput();

            const errorDb = {
                listCollections: mock(() => Promise.reject(new Error('Connection refused'))),
            } as unknown as FirebaseFirestore.Firestore;
            const destDb = mockFirestore as unknown as FirebaseFirestore.Firestore;

            try {
                await checkDatabaseConnectivity(errorDb, destDb, config, output);
                expect.unreachable('Should have thrown');
            } catch (error) {
                expect((error as Error).message).toContain('Cannot connect to source database');
                expect((error as Error).message).toContain('source-project');
            }
        });

        test('throws error when destination connection fails', async () => {
            const config = createMockConfig();
            const output = createMockOutput();

            const sourceDb = mockFirestore as unknown as FirebaseFirestore.Firestore;
            const errorDb = {
                listCollections: mock(() => Promise.reject(new Error('Permission denied'))),
            } as unknown as FirebaseFirestore.Firestore;

            try {
                await checkDatabaseConnectivity(sourceDb, errorDb, config, output);
                expect.unreachable('Should have thrown');
            } catch (error) {
                expect((error as Error).message).toContain(
                    'Cannot connect to destination database'
                );
                expect((error as Error).message).toContain('dest-project');
            }
        });

        test('formats Firebase errors with suggestions', async () => {
            const config = createMockConfig();
            const output = createMockOutput();

            const errorDb = {
                listCollections: mock(() => {
                    const error = new Error('PERMISSION_DENIED') as Error & { code?: string };
                    error.code = 'permission-denied';
                    return Promise.reject(error);
                }),
            } as unknown as FirebaseFirestore.Firestore;
            const destDb = mockFirestore as unknown as FirebaseFirestore.Firestore;

            try {
                await checkDatabaseConnectivity(errorDb, destDb, config, output);
                expect.unreachable('Should have thrown');
            } catch (error) {
                expect((error as Error).message).toContain('Cannot connect to source database');
            }
        });
    });

    describe('cleanupFirebase', () => {
        test('deletes apps when they exist', async () => {
            // Initialize apps first
            initializeFirebase(createMockConfig());

            await cleanupFirebase();

            // delete is called for both apps
            expect(mockApp.delete).toHaveBeenCalled();
        });
    });
});

describe('Firebase Error Handling', () => {
    test('handles network errors gracefully', async () => {
        const config = createMockConfig();
        const output = createMockOutput();

        const errorDb = {
            listCollections: mock(() => {
                const error = new Error('Network error') as Error & { code?: string };
                error.code = 'unavailable';
                return Promise.reject(error);
            }),
        } as unknown as FirebaseFirestore.Firestore;
        const destDb = mockFirestore as unknown as FirebaseFirestore.Firestore;

        try {
            await checkDatabaseConnectivity(errorDb, destDb, config, output);
            expect.unreachable('Should have thrown');
        } catch (error) {
            expect((error as Error).message).toContain('Cannot connect to source database');
        }
    });

    test('handles authentication errors', async () => {
        const config = createMockConfig();
        const output = createMockOutput();

        const errorDb = {
            listCollections: mock(() => {
                const error = new Error('Unauthenticated') as Error & { code?: string };
                error.code = 'unauthenticated';
                return Promise.reject(error);
            }),
        } as unknown as FirebaseFirestore.Firestore;
        const destDb = mockFirestore as unknown as FirebaseFirestore.Firestore;

        try {
            await checkDatabaseConnectivity(errorDb, destDb, config, output);
            expect.unreachable('Should have thrown');
        } catch (error) {
            expect((error as Error).message).toContain('Cannot connect to source database');
        }
    });
});
