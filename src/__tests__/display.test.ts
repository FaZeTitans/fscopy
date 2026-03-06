import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { Config, Stats } from '../types.js';
import { displayConfig, printSummary, formatJsonOutput } from '../output/display.js';

// Helper to create a valid base config
function createConfig(overrides: Partial<Config> = {}): Config {
    return {
        collections: ['users', 'orders'],
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
        allowHttpWebhook: false,
        ...overrides,
    };
}

function createStats(overrides: Partial<Stats> = {}): Stats {
    return {
        collectionsProcessed: 2,
        documentsTransferred: 100,
        documentsDeleted: 0,
        errors: 0,
        conflicts: 0,
        integrityErrors: 0,
        ...overrides,
    };
}

describe('displayConfig', () => {
    let logOutput: string[];
    const originalLog = console.log;

    beforeEach(() => {
        logOutput = [];
        console.log = (...args: unknown[]) => {
            logOutput.push(args.map(String).join(' '));
        };
    });

    afterEach(() => {
        console.log = originalLog;
    });

    test('displays source and destination projects', () => {
        displayConfig(createConfig());
        const output = logOutput.join('\n');
        expect(output).toContain('source-project');
        expect(output).toContain('dest-project');
    });

    test('displays collections', () => {
        displayConfig(createConfig());
        const output = logOutput.join('\n');
        expect(output).toContain('users, orders');
    });

    test('displays dry run mode', () => {
        displayConfig(createConfig({ dryRun: true }));
        const output = logOutput.join('\n');
        expect(output).toContain('DRY RUN');
    });

    test('displays live mode', () => {
        displayConfig(createConfig({ dryRun: false }));
        const output = logOutput.join('\n');
        expect(output).toContain('LIVE');
    });

    test('displays merge mode when enabled', () => {
        displayConfig(createConfig({ merge: true }));
        const output = logOutput.join('\n');
        expect(output).toContain('Merge mode');
    });

    test('displays parallel transfers when > 1', () => {
        displayConfig(createConfig({ parallel: 3 }));
        const output = logOutput.join('\n');
        expect(output).toContain('Parallel');
        expect(output).toContain('3');
    });

    test('displays where filters', () => {
        displayConfig(
            createConfig({
                where: [{ field: 'status', operator: '==', value: 'active' }],
            })
        );
        const output = logOutput.join('\n');
        expect(output).toContain('status');
        expect(output).toContain('active');
    });

    test('displays rename collections', () => {
        displayConfig(createConfig({ renameCollection: { users: 'users_backup' } }));
        const output = logOutput.join('\n');
        expect(output).toContain('users');
        expect(output).toContain('users_backup');
    });

    test('displays ID modification', () => {
        displayConfig(createConfig({ idPrefix: 'backup_' }));
        const output = logOutput.join('\n');
        expect(output).toContain('backup_');
    });

    test('displays rate limit when set', () => {
        displayConfig(createConfig({ rateLimit: 100 }));
        const output = logOutput.join('\n');
        expect(output).toContain('100');
    });

    test('displays (not set) for missing project', () => {
        displayConfig(createConfig({ sourceProject: null }));
        const output = logOutput.join('\n');
        expect(output).toContain('(not set)');
    });
});

describe('printSummary', () => {
    let logOutput: string[];
    const originalLog = console.log;

    beforeEach(() => {
        logOutput = [];
        console.log = (...args: unknown[]) => {
            logOutput.push(args.map(String).join(' '));
        };
    });

    afterEach(() => {
        console.log = originalLog;
    });

    test('displays transfer summary', () => {
        printSummary(createStats(), '5.00');
        const output = logOutput.join('\n');
        expect(output).toContain('TRANSFER SUMMARY');
        expect(output).toContain('100');
        expect(output).toContain('5.00s');
    });

    test('displays deleted count when > 0', () => {
        printSummary(createStats({ documentsDeleted: 10 }), '5.00');
        const output = logOutput.join('\n');
        expect(output).toContain('Documents deleted');
        expect(output).toContain('10');
    });

    test('hides deleted count when 0', () => {
        printSummary(createStats({ documentsDeleted: 0 }), '5.00');
        const output = logOutput.join('\n');
        expect(output).not.toContain('Documents deleted');
    });

    test('displays conflict count when > 0', () => {
        printSummary(createStats({ conflicts: 3 }), '5.00');
        const output = logOutput.join('\n');
        expect(output).toContain('Conflicts');
        expect(output).toContain('3');
    });

    test('displays dry run warning', () => {
        printSummary(createStats(), '5.00', undefined, true);
        const output = logOutput.join('\n');
        expect(output).toContain('DRY RUN');
    });

    test('displays success message for live run', () => {
        printSummary(createStats(), '5.00', undefined, false);
        const output = logOutput.join('\n');
        expect(output).toContain('completed successfully');
    });

    test('displays log file path', () => {
        printSummary(createStats(), '5.00', '/tmp/transfer.log');
        const output = logOutput.join('\n');
        expect(output).toContain('/tmp/transfer.log');
    });

    test('displays integrity verification results', () => {
        printSummary(createStats({ integrityErrors: 0 }), '5.00', undefined, false, true);
        const output = logOutput.join('\n');
        expect(output).toContain('Integrity verified');
    });

    test('displays integrity errors', () => {
        printSummary(createStats({ integrityErrors: 2 }), '5.00', undefined, false, true);
        const output = logOutput.join('\n');
        expect(output).toContain('Integrity errors');
        expect(output).toContain('2');
    });
});

describe('formatJsonOutput', () => {
    test('formats successful transfer output', () => {
        const config = createConfig();
        const stats = createStats();
        const result = JSON.parse(formatJsonOutput(true, config, stats, 5.0));

        expect(result.success).toBe(true);
        expect(result.dryRun).toBe(true);
        expect(result.source).toBe('source-project');
        expect(result.destination).toBe('dest-project');
        expect(result.collections).toEqual(['users', 'orders']);
        expect(result.stats.documentsTransferred).toBe(100);
        expect(result.duration).toBe(5.0);
    });

    test('includes error in failed transfer output', () => {
        const config = createConfig();
        const stats = createStats({ errors: 1 });
        const result = JSON.parse(formatJsonOutput(false, config, stats, 2.0, 'Connection lost'));

        expect(result.success).toBe(false);
        expect(result.error).toBe('Connection lost');
    });

    test('includes verify result when provided', () => {
        const config = createConfig();
        const stats = createStats();
        const verifyResult = {
            users: { source: 50, dest: 50, match: true },
            orders: { source: 50, dest: 48, match: false },
        };
        const result = JSON.parse(
            formatJsonOutput(true, config, stats, 5.0, undefined, verifyResult)
        );

        expect(result.verify).toBeDefined();
        expect(result.verify.users.match).toBe(true);
        expect(result.verify.orders.match).toBe(false);
    });

    test('excludes verify when null', () => {
        const config = createConfig();
        const stats = createStats();
        const result = JSON.parse(formatJsonOutput(true, config, stats, 5.0, undefined, null));

        expect(result.verify).toBeUndefined();
    });
});
