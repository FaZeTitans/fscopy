import { describe, test, expect } from 'bun:test';
import {
    validateConfig,
    validateFirestoreId,
    validateCollectionPath,
} from '../config/validator.js';
import type { Config } from '../types.js';

// Helper to create a valid base config
function createConfig(overrides: Partial<Config> = {}): Config {
    return {
        collections: ['users'],
        includeSubcollections: false,
        dryRun: true,
        batchSize: 500,
        limit: 0,
        sourceProject: 'source-project',
        destProject: 'dest-project',
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
        ...overrides,
    };
}

describe('validateConfig', () => {
    test('returns no errors for valid config', () => {
        const config = createConfig();
        const errors = validateConfig(config);
        expect(errors).toEqual([]);
    });

    test('returns error for missing source project', () => {
        const config = createConfig({ sourceProject: null });
        const errors = validateConfig(config);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('Source project');
    });

    test('returns error for empty source project', () => {
        const config = createConfig({ sourceProject: '' });
        const errors = validateConfig(config);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('Source project');
    });

    test('returns error for missing dest project', () => {
        const config = createConfig({ destProject: null });
        const errors = validateConfig(config);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('Destination project');
    });

    test('returns error for empty dest project', () => {
        const config = createConfig({ destProject: '' });
        const errors = validateConfig(config);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('Destination project');
    });

    test('returns error for same source and dest without rename or id modification', () => {
        const config = createConfig({
            sourceProject: 'same-project',
            destProject: 'same-project',
        });
        const errors = validateConfig(config);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('same');
    });

    test('allows same source and dest with renameCollection', () => {
        const config = createConfig({
            sourceProject: 'same-project',
            destProject: 'same-project',
            renameCollection: { users: 'users_backup' },
        });
        const errors = validateConfig(config);
        expect(errors).toEqual([]);
    });

    test('allows same source and dest with idPrefix', () => {
        const config = createConfig({
            sourceProject: 'same-project',
            destProject: 'same-project',
            idPrefix: 'backup_',
        });
        const errors = validateConfig(config);
        expect(errors).toEqual([]);
    });

    test('allows same source and dest with idSuffix', () => {
        const config = createConfig({
            sourceProject: 'same-project',
            destProject: 'same-project',
            idSuffix: '_v2',
        });
        const errors = validateConfig(config);
        expect(errors).toEqual([]);
    });

    test('returns error for empty collections', () => {
        const config = createConfig({ collections: [] });
        const errors = validateConfig(config);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('collection');
    });

    test('returns multiple errors', () => {
        const config = createConfig({
            sourceProject: null,
            destProject: null,
            collections: [],
        });
        const errors = validateConfig(config);
        expect(errors).toHaveLength(3);
    });

    test('validates with multiple collections', () => {
        const config = createConfig({
            collections: ['users', 'orders', 'products'],
        });
        const errors = validateConfig(config);
        expect(errors).toEqual([]);
    });

    test('returns error for collection with reserved pattern __name__', () => {
        const config = createConfig({ collections: ['__reserved__'] });
        const errors = validateConfig(config);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('reserved');
    });

    test('returns error for collection named .', () => {
        const config = createConfig({ collections: ['.'] });
        const errors = validateConfig(config);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('.');
    });

    test('returns error for collection named ..', () => {
        const config = createConfig({ collections: ['..'] });
        const errors = validateConfig(config);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('..');
    });

    test('validates nested collection path', () => {
        const config = createConfig({
            collections: ['users/123/orders'],
        });
        const errors = validateConfig(config);
        expect(errors).toEqual([]);
    });

    test('returns error for nested path with empty segment', () => {
        const config = createConfig({
            collections: ['users//orders'],
        });
        const errors = validateConfig(config);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('empty');
    });

    // Numeric bounds validation
    test('returns error for batch size below 1', () => {
        const config = createConfig({ batchSize: 0 });
        const errors = validateConfig(config);
        expect(errors.some((e) => e.includes('Batch size'))).toBe(true);
    });

    test('returns error for batch size above 500', () => {
        const config = createConfig({ batchSize: 501 });
        const errors = validateConfig(config);
        expect(errors.some((e) => e.includes('Batch size'))).toBe(true);
    });

    test('returns error for parallel below 1', () => {
        const config = createConfig({ parallel: 0 });
        const errors = validateConfig(config);
        expect(errors.some((e) => e.includes('Parallel'))).toBe(true);
    });

    test('returns error for parallel above 20', () => {
        const config = createConfig({ parallel: 21 });
        const errors = validateConfig(config);
        expect(errors.some((e) => e.includes('Parallel'))).toBe(true);
    });

    test('returns error for negative rate limit', () => {
        const config = createConfig({ rateLimit: -1 });
        const errors = validateConfig(config);
        expect(errors.some((e) => e.includes('Rate limit'))).toBe(true);
    });

    test('allows zero rate limit (unlimited)', () => {
        const config = createConfig({ rateLimit: 0 });
        const errors = validateConfig(config);
        expect(errors.some((e) => e.includes('Rate limit'))).toBe(false);
    });

    test('returns error for max depth above 100', () => {
        const config = createConfig({ maxDepth: 101 });
        const errors = validateConfig(config);
        expect(errors.some((e) => e.includes('Max depth'))).toBe(true);
    });

    test('returns error for negative max depth', () => {
        const config = createConfig({ maxDepth: -1 });
        const errors = validateConfig(config);
        expect(errors.some((e) => e.includes('Max depth'))).toBe(true);
    });

    test('returns error for retries above 10', () => {
        const config = createConfig({ retries: 11 });
        const errors = validateConfig(config);
        expect(errors.some((e) => e.includes('Retries'))).toBe(true);
    });

    test('returns error for negative retries', () => {
        const config = createConfig({ retries: -1 });
        const errors = validateConfig(config);
        expect(errors.some((e) => e.includes('Retries'))).toBe(true);
    });

    test('returns error for negative limit', () => {
        const config = createConfig({ limit: -1 });
        const errors = validateConfig(config);
        expect(errors.some((e) => e.includes('Document limit'))).toBe(true);
    });

    test('allows zero limit (no limit)', () => {
        const config = createConfig({ limit: 0 });
        const errors = validateConfig(config);
        expect(errors.some((e) => e.includes('Document limit'))).toBe(false);
    });
});

describe('validateFirestoreId', () => {
    test('returns null for valid ID', () => {
        expect(validateFirestoreId('users')).toBeNull();
        expect(validateFirestoreId('my-collection')).toBeNull();
        expect(validateFirestoreId('collection_123')).toBeNull();
    });

    test('returns error for empty ID', () => {
        expect(validateFirestoreId('')).toContain('empty');
    });

    test('returns error for single period', () => {
        expect(validateFirestoreId('.')).toContain('.');
    });

    test('returns error for double period', () => {
        expect(validateFirestoreId('..')).toContain('..');
    });

    test('returns error for reserved pattern __name__', () => {
        expect(validateFirestoreId('__reserved__')).toContain('reserved');
        expect(validateFirestoreId('__foo__')).toContain('reserved');
    });

    test('allows IDs starting or ending with underscores', () => {
        expect(validateFirestoreId('_name')).toBeNull();
        expect(validateFirestoreId('name_')).toBeNull();
        expect(validateFirestoreId('__name')).toBeNull();
        expect(validateFirestoreId('name__')).toBeNull();
    });

    test('allows IDs with special characters', () => {
        // Firestore allows most unicode chars in IDs
        expect(validateFirestoreId('用户')).toBeNull();
        expect(validateFirestoreId('users#123')).toBeNull();
        expect(validateFirestoreId('users$data')).toBeNull();
        expect(validateFirestoreId('users[0]')).toBeNull();
    });
});

describe('validateCollectionPath', () => {
    test('returns empty array for valid simple path', () => {
        expect(validateCollectionPath('users')).toEqual([]);
    });

    test('returns empty array for valid nested path', () => {
        expect(validateCollectionPath('users/123/orders')).toEqual([]);
    });

    test('returns error for empty segment in path', () => {
        const errors = validateCollectionPath('users//orders');
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('empty');
    });

    test('returns error for reserved collection in path', () => {
        const errors = validateCollectionPath('__reserved__/123/orders');
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('reserved');
    });

    test('returns multiple errors for multiple invalid segments', () => {
        const errors = validateCollectionPath('__a__/./orders');
        expect(errors.length).toBeGreaterThanOrEqual(2);
    });
});
