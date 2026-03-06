import { describe, test, expect, mock, beforeEach, spyOn } from 'bun:test';
import type { Config } from '../types.js';

// Mock @inquirer/prompts
const mockInput = mock<() => Promise<string>>(() => Promise.resolve(''));
const mockCheckbox = mock<() => Promise<string[]>>(() => Promise.resolve([]));
const mockConfirm = mock<() => Promise<boolean>>(() => Promise.resolve(true));
const mockSelect = mock<() => Promise<string>>(() => Promise.resolve('execute'));
const mockNumber = mock<() => Promise<number | undefined>>(() => Promise.resolve(undefined));

mock.module('@inquirer/prompts', () => ({
    input: mockInput,
    checkbox: mockCheckbox,
    confirm: mockConfirm,
    select: mockSelect,
    number: mockNumber,
}));

// Mock firebase-admin
const mockDelete = mock(() => Promise.resolve());
const mockCountGet = mock(() => Promise.resolve({ data: () => ({ count: 10 }) }));
const mockCount = mock(() => ({ get: mockCountGet }));
const mockCollection = mock(() => ({ count: mockCount }));
const mockListCollections = mock(() =>
    Promise.resolve([{ id: 'users' }, { id: 'orders' }, { id: 'products' }])
);
const mockFirestore = mock(() => ({
    collection: mockCollection,
    listCollections: mockListCollections,
}));
const mockApp = {
    firestore: mockFirestore,
    delete: mockDelete,
};
const mockInitializeApp = mock(() => mockApp);
const mockApplicationDefault = mock(() => ({}));

mock.module('firebase-admin', () => ({
    default: {
        initializeApp: mockInitializeApp,
        credential: {
            applicationDefault: mockApplicationDefault,
        },
    },
}));

// Import after mocking
const { runInteractiveMode } = await import('../interactive.js');

// Helper to create base config
function createBaseConfig(overrides: Partial<Config> = {}): Config {
    return {
        collections: [],
        includeSubcollections: false,
        dryRun: true,
        batchSize: 500,
        limit: 0,
        sourceProject: null,
        destProject: null,
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
        resume: false,
        stateFile: '.fscopy-state.json',
        verify: false,
        rateLimit: 0,
        skipOversized: false,
        json: false,
        transformSamples: 3,
        detectConflicts: false,
        maxDepth: 0,
        verifyIntegrity: false,
        allowHttpWebhook: false,
        ...overrides,
    };
}

describe('Interactive Mode', () => {
    beforeEach(() => {
        // Reset all mocks
        mockInput.mockReset();
        mockCheckbox.mockReset();
        mockConfirm.mockReset();
        mockSelect.mockReset();
        mockNumber.mockReset();
        mockInitializeApp.mockReset();
        mockListCollections.mockReset();
        mockCountGet.mockReset();
        mockDelete.mockReset();

        // Set default implementations
        mockInput.mockImplementation(() => Promise.resolve('test-project'));
        mockCheckbox.mockImplementation(() => Promise.resolve(['users']));
        // Default confirm sequence: subcollections=true, dryRun=true, merge=true, advancedOptions=false
        const defaultConfirmResponses = [true, true, true, false];
        mockConfirm.mockImplementation(() => {
            const next = defaultConfirmResponses.shift();
            return Promise.resolve(next ?? false);
        });
        mockSelect.mockImplementation(() => Promise.resolve('execute'));
        mockNumber.mockImplementation(() => Promise.resolve(undefined));
        mockInitializeApp.mockImplementation(() => mockApp);
        mockListCollections.mockImplementation(() =>
            Promise.resolve([{ id: 'users' }, { id: 'orders' }])
        );
        mockCountGet.mockImplementation(() => Promise.resolve({ data: () => ({ count: 10 }) }));

        // Suppress console output during tests
        spyOn(console, 'log').mockImplementation(() => {});
        spyOn(console, 'error').mockImplementation(() => {});
    });

    describe('promptForProject', () => {
        test('uses existing source project if provided', async () => {
            // Confirm sequence: subcollections, dryRun, merge, advancedOptions=false
            let confirmCall = 0;
            mockConfirm.mockImplementation(() => {
                confirmCall++;
                // 4th confirm is "Configure additional options?" -> false
                return Promise.resolve(confirmCall !== 4);
            });

            const config = createBaseConfig({
                sourceProject: 'existing-source',
                destProject: 'existing-dest',
            });

            const result = await runInteractiveMode(config);

            expect(result.config.sourceProject).toBe('existing-source');
            expect(result.config.destProject).toBe('existing-dest');
        });

        test('prompts for source project if not provided', async () => {
            mockInput.mockImplementationOnce(() => Promise.resolve('prompted-source'));
            mockInput.mockImplementationOnce(() => Promise.resolve('prompted-dest'));

            let confirmCall = 0;
            mockConfirm.mockImplementation(() => {
                confirmCall++;
                return Promise.resolve(confirmCall !== 4);
            });

            const config = createBaseConfig();
            const result = await runInteractiveMode(config);

            expect(mockInput).toHaveBeenCalled();
            expect(result.config.sourceProject).toBe('prompted-source');
        });
    });

    describe('collection selection', () => {
        test('lists collections from source project', async () => {
            mockListCollections.mockImplementation(() =>
                Promise.resolve([{ id: 'users' }, { id: 'orders' }, { id: 'products' }])
            );
            mockCheckbox.mockImplementation(() => Promise.resolve(['users', 'orders']));

            let confirmCall = 0;
            mockConfirm.mockImplementation(() => {
                confirmCall++;
                return Promise.resolve(confirmCall !== 4);
            });

            const config = createBaseConfig({
                sourceProject: 'test-source',
                destProject: 'test-dest',
            });

            const result = await runInteractiveMode(config);

            expect(mockListCollections).toHaveBeenCalled();
            expect(result.config.collections).toEqual(['users', 'orders']);
        });

        test('pre-selects collections from config', async () => {
            mockCheckbox.mockImplementation(() => Promise.resolve(['users']));

            let confirmCall = 0;
            mockConfirm.mockImplementation(() => {
                confirmCall++;
                return Promise.resolve(confirmCall !== 4);
            });

            const config = createBaseConfig({
                sourceProject: 'test-source',
                destProject: 'test-dest',
                collections: ['users'],
            });

            const result = await runInteractiveMode(config);
            expect(result.config.collections).toContain('users');
        });
    });

    describe('same project handling', () => {
        test('prompts for ID prefix when source equals dest', async () => {
            let confirmCall = 0;
            mockConfirm.mockImplementation(() => {
                confirmCall++;
                // 1st confirm: "Add a prefix to document IDs?" -> yes
                if (confirmCall === 1) return Promise.resolve(true);
                // subcollections, dryRun, merge -> true
                // advancedOptions -> false (5th confirm)
                if (confirmCall === 5) return Promise.resolve(false);
                return Promise.resolve(true);
            });
            // Input calls: prefix value
            mockInput.mockImplementationOnce(() => Promise.resolve('backup_'));

            const config = createBaseConfig({
                sourceProject: 'same-project',
                destProject: 'same-project',
            });

            const result = await runInteractiveMode(config);

            expect(result.config.idPrefix).toBe('backup_');
        });

        test('prompts for ID suffix when prefix declined', async () => {
            let confirmCall = 0;
            mockConfirm.mockImplementation(() => {
                confirmCall++;
                // 1st: "Add a prefix?" -> no
                if (confirmCall === 1) return Promise.resolve(false);
                // 2nd: "Add a suffix?" -> yes
                if (confirmCall === 2) return Promise.resolve(true);
                // subcollections, dryRun, merge -> false
                // advancedOptions (6th) -> false
                if (confirmCall === 6) return Promise.resolve(false);
                return Promise.resolve(false);
            });
            // Input: suffix value
            mockInput.mockImplementationOnce(() => Promise.resolve('_v2'));

            const config = createBaseConfig({
                sourceProject: 'same-project',
                destProject: 'same-project',
            });

            const result = await runInteractiveMode(config);

            expect(result.config.idSuffix).toBe('_v2');
        });
    });

    describe('options', () => {
        test('returns updated config with selected options', async () => {
            let confirmCall = 0;
            mockConfirm.mockImplementation(() => {
                confirmCall++;
                // 1st: includeSubcollections -> true
                if (confirmCall === 1) return Promise.resolve(true);
                // 2nd: dryRun -> false
                if (confirmCall === 2) return Promise.resolve(false);
                // 3rd: merge -> true
                if (confirmCall === 3) return Promise.resolve(true);
                // 4th: advancedOptions -> false
                return Promise.resolve(false);
            });

            mockCheckbox.mockImplementation(() => Promise.resolve(['users', 'orders']));

            const config = createBaseConfig({
                sourceProject: 'source',
                destProject: 'dest',
            });

            const result = await runInteractiveMode(config);

            expect(result.config.includeSubcollections).toBe(true);
            expect(result.config.dryRun).toBe(false);
            expect(result.config.merge).toBe(true);
            expect(result.config.collections).toEqual(['users', 'orders']);
        });

        test('preserves non-interactive config values', async () => {
            let confirmCall = 0;
            mockConfirm.mockImplementation(() => {
                confirmCall++;
                // advancedOptions (4th) -> false
                if (confirmCall === 4) return Promise.resolve(false);
                return Promise.resolve(true);
            });

            const config = createBaseConfig({
                sourceProject: 'source',
                destProject: 'dest',
                batchSize: 100,
                limit: 50,
                retries: 5,
                webhook: 'https://example.com/hook',
            });

            const result = await runInteractiveMode(config);

            expect(result.config.batchSize).toBe(100);
            expect(result.config.limit).toBe(50);
            expect(result.config.retries).toBe(5);
            expect(result.config.webhook).toBe('https://example.com/hook');
        });
    });

    describe('return type', () => {
        test('returns execute action by default', async () => {
            let confirmCall = 0;
            mockConfirm.mockImplementation(() => {
                confirmCall++;
                if (confirmCall === 4) return Promise.resolve(false);
                return Promise.resolve(true);
            });
            mockSelect.mockImplementation(() => Promise.resolve('execute'));

            const config = createBaseConfig({
                sourceProject: 'source',
                destProject: 'dest',
            });

            const result = await runInteractiveMode(config);

            expect(result.action).toBe('execute');
            expect(result.config).toBeDefined();
        });
    });

    describe('Firebase connection', () => {
        test('initializes Firebase with source project', async () => {
            let confirmCall = 0;
            mockConfirm.mockImplementation(() => {
                confirmCall++;
                if (confirmCall === 4) return Promise.resolve(false);
                return Promise.resolve(true);
            });

            const config = createBaseConfig({
                sourceProject: 'my-source-project',
                destProject: 'my-dest-project',
            });

            await runInteractiveMode(config);

            expect(mockInitializeApp).toHaveBeenCalledWith(
                expect.objectContaining({
                    projectId: 'my-source-project',
                }),
                'interactive-source'
            );
        });

        test('cleans up Firebase app after completion', async () => {
            let confirmCall = 0;
            mockConfirm.mockImplementation(() => {
                confirmCall++;
                if (confirmCall === 4) return Promise.resolve(false);
                return Promise.resolve(true);
            });

            const config = createBaseConfig({
                sourceProject: 'source',
                destProject: 'dest',
            });

            await runInteractiveMode(config);

            expect(mockDelete).toHaveBeenCalled();
        });

        test('counts documents in each collection', async () => {
            mockListCollections.mockImplementation(() =>
                Promise.resolve([{ id: 'users' }, { id: 'orders' }])
            );

            let confirmCall = 0;
            mockConfirm.mockImplementation(() => {
                confirmCall++;
                if (confirmCall === 4) return Promise.resolve(false);
                return Promise.resolve(true);
            });

            const config = createBaseConfig({
                sourceProject: 'source',
                destProject: 'dest',
            });

            await runInteractiveMode(config);

            // collection() should be called for each collection to count
            expect(mockCollection).toHaveBeenCalledWith('users');
            expect(mockCollection).toHaveBeenCalledWith('orders');
        });
    });
});
