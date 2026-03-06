import { describe, test, expect } from 'bun:test';
import { defaults } from '../config/defaults.js';
import { mergeConfig } from '../config/parser.js';
import type { Config, CliArgs, Stats, ConflictInfo } from '../types.js';

// Helper to create base config
function createBaseConfig(overrides: Partial<Config> = {}): Config {
    return {
        collections: ['users'],
        includeSubcollections: false,
        dryRun: true,
        batchSize: 500,
        limit: 0,
        sourceProject: 'source',
        destProject: 'dest',
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

describe('Conflict Detection', () => {
    describe('defaults', () => {
        test('detectConflicts defaults to false', () => {
            expect(defaults.detectConflicts).toBe(false);
        });
    });

    describe('Config type', () => {
        test('Config includes detectConflicts field', () => {
            const config = createBaseConfig();
            expect(config.detectConflicts).toBeDefined();
            expect(typeof config.detectConflicts).toBe('boolean');
        });

        test('Config with detectConflicts enabled', () => {
            const config = createBaseConfig({ detectConflicts: true });
            expect(config.detectConflicts).toBe(true);
        });
    });

    describe('mergeConfig', () => {
        test('CLI arg overrides default', () => {
            const cliArgs: CliArgs = {
                yes: false,
                retries: 3,
                quiet: false,
                detectConflicts: true,
            };

            const merged = mergeConfig(defaults, {}, cliArgs);
            expect(merged.detectConflicts).toBe(true);
        });

        test('defaults to false when not specified', () => {
            const cliArgs: CliArgs = {
                yes: false,
                retries: 3,
                quiet: false,
            };

            const merged = mergeConfig(defaults, {}, cliArgs);
            expect(merged.detectConflicts).toBe(false);
        });
    });

    describe('Stats type', () => {
        test('Stats includes conflicts field', () => {
            const stats: Stats = {
                collectionsProcessed: 0,
                documentsTransferred: 0,
                documentsDeleted: 0,
                errors: 0,
                conflicts: 0,
                integrityErrors: 0,
            };
            expect(stats.conflicts).toBeDefined();
            expect(typeof stats.conflicts).toBe('number');
        });

        test('conflicts can be incremented', () => {
            const stats: Stats = {
                collectionsProcessed: 0,
                documentsTransferred: 0,
                documentsDeleted: 0,
                errors: 0,
                conflicts: 0,
                integrityErrors: 0,
            };
            stats.conflicts++;
            expect(stats.conflicts).toBe(1);
        });
    });

    describe('ConflictInfo type', () => {
        test('ConflictInfo has required fields', () => {
            const conflict: ConflictInfo = {
                collection: 'users',
                docId: 'doc123',
                reason: 'Document was modified during transfer',
            };
            expect(conflict.collection).toBe('users');
            expect(conflict.docId).toBe('doc123');
            expect(conflict.reason).toBeDefined();
        });

        test('can create array of conflicts', () => {
            const conflicts: ConflictInfo[] = [
                {
                    collection: 'users',
                    docId: 'doc1',
                    reason: 'modified',
                },
                {
                    collection: 'orders',
                    docId: 'order1',
                    reason: 'deleted',
                },
            ];
            expect(conflicts).toHaveLength(2);
        });
    });
});
