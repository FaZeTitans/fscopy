import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { input, checkbox, confirm, select, number } from '@inquirer/prompts';
import { SEPARATOR_LENGTH } from './constants.js';
import type { Config, WhereFilter } from './types.js';
import { parseWhereFilter, parseRenameMapping, parseStringList } from './config/parser.js';

// =============================================================================
// Types
// =============================================================================

export interface InteractiveResult {
    config: Config;
    action: 'execute' | 'save';
}

type AdvancedOption =
    | 'exclude' | 'where' | 'parallel' | 'batchSize' | 'limit'
    | 'maxDepth' | 'rateLimit' | 'clear' | 'deleteMissing' | 'transform'
    | 'renameCollection' | 'idPrefix' | 'idSuffix' | 'webhook'
    | 'skipOversized' | 'detectConflicts' | 'verify' | 'verifyIntegrity'
    | 'retries';

// =============================================================================
// Project prompts
// =============================================================================

async function promptForProject(
    currentValue: string | null | undefined,
    label: string,
    emoji: string
): Promise<string> {
    if (currentValue) {
        console.log(`${emoji} ${label}: ${currentValue}`);
        return currentValue;
    }
    return input({
        message: `${label}:`,
        validate: (value) => value.length > 0 || 'Project ID is required',
    });
}

async function promptForIdModification(
    currentPrefix: string | null,
    currentSuffix: string | null
): Promise<{ idPrefix: string | null; idSuffix: string | null }> {
    console.log('\nSource and destination are the same project.');
    console.log('   You need to rename collections or modify document IDs to avoid overwriting.\n');

    const modifyIds = await confirm({
        message: 'Add a prefix to document IDs?',
        default: true,
    });

    if (modifyIds) {
        const idPrefix = await input({
            message: 'Document ID prefix (e.g., "backup_"):',
            default: 'backup_',
            validate: (value) => value.length > 0 || 'Prefix is required',
        });
        return { idPrefix, idSuffix: currentSuffix };
    }

    const useSuffix = await confirm({
        message: 'Add a suffix to document IDs instead?',
        default: true,
    });

    if (useSuffix) {
        const idSuffix = await input({
            message: 'Document ID suffix (e.g., "_backup"):',
            default: '_backup',
            validate: (value) => value.length > 0 || 'Suffix is required',
        });
        return { idPrefix: currentPrefix, idSuffix };
    }

    console.log('\nCannot proceed: source and destination are the same without ID modification.');
    console.log('   This would overwrite your data. Use --rename-collection, --id-prefix, or --id-suffix.\n');
    process.exit(1);
}

// =============================================================================
// Collection discovery
// =============================================================================

interface CollectionInfo {
    id: string;
    count: number;
}

async function discoverCollections(
    sourceProject: string
): Promise<{ app: admin.app.App; db: Firestore; collections: CollectionInfo[] }> {
    console.log('\nConnecting to source project...');

    let tempSourceApp: admin.app.App;
    let sourceDb: Firestore;
    let rootCollections: FirebaseFirestore.CollectionReference[];

    try {
        tempSourceApp = admin.initializeApp(
            {
                credential: admin.credential.applicationDefault(),
                projectId: sourceProject,
            },
            'interactive-source'
        );
        sourceDb = tempSourceApp.firestore();
        rootCollections = await sourceDb.listCollections();
    } catch (error) {
        const err = error as Error & { code?: string };
        console.error('\nCannot connect to Firebase project:', err.message);

        if (err.message.includes('default credentials') || err.message.includes('credential')) {
            console.error('\n   Run this command to authenticate:');
            console.error('   gcloud auth application-default login\n');
        } else if (err.message.includes('not found') || err.message.includes('NOT_FOUND')) {
            console.error(`\n   Project "${sourceProject}" not found. Check the project ID.\n`);
        } else if (err.message.includes('permission') || err.message.includes('PERMISSION_DENIED')) {
            console.error('\n   You don\'t have permission to access this project\'s Firestore.\n');
        }

        process.exit(1);
    }

    const collectionIds = rootCollections.map((col) => col.id);

    if (collectionIds.length === 0) {
        console.log('\nNo collections found in source project');
        await tempSourceApp.delete();
        process.exit(0);
    }

    console.log('\nAvailable collections:');
    const collectionInfo: CollectionInfo[] = [];
    for (const id of collectionIds) {
        const snapshot = await sourceDb.collection(id).count().get();
        const count = snapshot.data().count;
        collectionInfo.push({ id, count });
        console.log(`   - ${id} (${count} documents)`);
    }

    return { app: tempSourceApp, db: sourceDb, collections: collectionInfo };
}

// =============================================================================
// Advanced options
// =============================================================================

const advancedOptionChoices: Array<{ name: string; value: AdvancedOption }> = [
    { name: 'Exclude subcollection patterns', value: 'exclude' },
    { name: 'Where filters (filter source documents)', value: 'where' },
    { name: 'Parallel transfers', value: 'parallel' },
    { name: 'Batch size', value: 'batchSize' },
    { name: 'Document limit per collection', value: 'limit' },
    { name: 'Max subcollection depth', value: 'maxDepth' },
    { name: 'Rate limit (docs/sec)', value: 'rateLimit' },
    { name: 'Clear destination before transfer', value: 'clear' },
    { name: 'Delete missing docs in destination (sync mode)', value: 'deleteMissing' },
    { name: 'Transform file (JS/TS)', value: 'transform' },
    { name: 'Rename collections in destination', value: 'renameCollection' },
    { name: 'ID prefix', value: 'idPrefix' },
    { name: 'ID suffix', value: 'idSuffix' },
    { name: 'Webhook URL (Slack, Discord, custom)', value: 'webhook' },
    { name: 'Skip oversized documents (>1MB)', value: 'skipOversized' },
    { name: 'Detect conflicts during transfer', value: 'detectConflicts' },
    { name: 'Verify counts after transfer', value: 'verify' },
    { name: 'Verify integrity (hash comparison)', value: 'verifyIntegrity' },
    { name: 'Retries on error', value: 'retries' },
];

async function promptAdvancedOptions(config: Config): Promise<Partial<Config>> {
    const wantAdvanced = await confirm({
        message: 'Configure additional options?',
        default: false,
    });

    if (!wantAdvanced) return {};

    console.log('');
    const selected = new Set(
        await checkbox<AdvancedOption>({
            message: 'Select options to configure:',
            choices: advancedOptionChoices,
        })
    );

    if (selected.size === 0) return {};

    console.log('');
    const updates: Partial<Config> = {};

    if (selected.has('exclude')) {
        const val = await input({
            message: 'Exclude patterns (comma-separated, e.g. "logs, cache*, temp"):',
            default: config.exclude.length > 0 ? config.exclude.join(', ') : undefined,
        });
        updates.exclude = parseStringList(val);
    }

    if (selected.has('where')) {
        const filters: WhereFilter[] = [];
        let addMore = true;
        while (addMore) {
            const filterStr = await input({
                message: `Where filter${filters.length > 0 ? ' (leave empty to stop)' : ''} (e.g. "status == active"):`,
            });
            if (!filterStr.trim()) break;
            const parsed = parseWhereFilter(filterStr);
            if (parsed) {
                filters.push(parsed);
                console.log(`   Added: ${parsed.field} ${parsed.operator} ${parsed.value}`);
            }
            if (filters.length > 0) {
                addMore = await confirm({ message: 'Add another filter?', default: false });
            }
        }
        if (filters.length > 0) {
            updates.where = filters;
        }
    }

    if (selected.has('parallel')) {
        const val = await number({
            message: 'Number of parallel collection transfers:',
            default: config.parallel,
            min: 1,
            max: 20,
            step: 1,
        });
        if (val !== undefined) updates.parallel = val;
    }

    if (selected.has('batchSize')) {
        const val = await number({
            message: 'Batch size (documents per write):',
            default: config.batchSize,
            min: 1,
            max: 500,
            step: 1,
        });
        if (val !== undefined) updates.batchSize = val;
    }

    if (selected.has('limit')) {
        const val = await number({
            message: 'Document limit per collection (0 = no limit):',
            default: config.limit,
            min: 0,
            step: 1,
        });
        if (val !== undefined) updates.limit = val;
    }

    if (selected.has('maxDepth')) {
        const val = await number({
            message: 'Max subcollection depth (0 = unlimited):',
            default: config.maxDepth,
            min: 0,
            step: 1,
        });
        if (val !== undefined) updates.maxDepth = val;
    }

    if (selected.has('rateLimit')) {
        const val = await number({
            message: 'Rate limit in docs/sec (0 = unlimited):',
            default: config.rateLimit,
            min: 0,
            step: 1,
        });
        if (val !== undefined) updates.rateLimit = val;
    }

    if (selected.has('clear')) {
        updates.clear = await confirm({
            message: 'Clear destination collections before transfer? (DESTRUCTIVE)',
            default: config.clear,
        });
    }

    if (selected.has('deleteMissing')) {
        updates.deleteMissing = await confirm({
            message: 'Delete docs in destination not present in source? (sync mode)',
            default: config.deleteMissing,
        });
    }

    if (selected.has('transform')) {
        const val = await input({
            message: 'Path to transform file (JS/TS):',
            default: config.transform ?? undefined,
            validate: (value) => {
                if (!value.trim()) return 'Path is required';
                return true;
            },
        });
        updates.transform = val.trim();
    }

    if (selected.has('renameCollection')) {
        const val = await input({
            message: 'Rename mappings (e.g. "users:users_backup, orders:orders_v2"):',
            default: Object.entries(config.renameCollection).map(([s, d]) => `${s}:${d}`).join(', ') || undefined,
        });
        updates.renameCollection = parseRenameMapping(parseStringList(val));
    }

    if (selected.has('idPrefix')) {
        const val = await input({
            message: 'Document ID prefix:',
            default: config.idPrefix ?? undefined,
        });
        updates.idPrefix = val.trim() || null;
    }

    if (selected.has('idSuffix')) {
        const val = await input({
            message: 'Document ID suffix:',
            default: config.idSuffix ?? undefined,
        });
        updates.idSuffix = val.trim() || null;
    }

    if (selected.has('webhook')) {
        const val = await input({
            message: 'Webhook URL:',
            default: config.webhook ?? undefined,
        });
        updates.webhook = val.trim() || null;
    }

    if (selected.has('skipOversized')) {
        updates.skipOversized = await confirm({
            message: 'Skip documents exceeding 1MB instead of failing?',
            default: config.skipOversized,
        });
    }

    if (selected.has('detectConflicts')) {
        updates.detectConflicts = await confirm({
            message: 'Detect destination modifications during transfer?',
            default: config.detectConflicts,
        });
    }

    if (selected.has('verify')) {
        updates.verify = await confirm({
            message: 'Verify document counts after transfer?',
            default: config.verify,
        });
    }

    if (selected.has('verifyIntegrity')) {
        updates.verifyIntegrity = await confirm({
            message: 'Verify document integrity with hash after transfer?',
            default: config.verifyIntegrity,
        });
    }

    if (selected.has('retries')) {
        const val = await number({
            message: 'Number of retries on error:',
            default: config.retries,
            min: 0,
            max: 10,
            step: 1,
        });
        if (val !== undefined) updates.retries = val;
    }

    return updates;
}

// =============================================================================
// Final action
// =============================================================================

async function promptFinalAction(): Promise<'execute' | 'save-ini' | 'save-json'> {
    console.log('');
    return select({
        message: 'What would you like to do?',
        choices: [
            { name: 'Execute transfer', value: 'execute' as const },
            { name: 'Save as INI config file', value: 'save-ini' as const },
            { name: 'Save as JSON config file', value: 'save-json' as const },
        ],
    });
}

// =============================================================================
// Config serialization
// =============================================================================

function serializeWhereFilters(filters: WhereFilter[]): string[] {
    return filters.map((f) => `${f.field} ${f.operator} ${f.value}`);
}

function serializeRenameMapping(mapping: Record<string, string>): string {
    return Object.entries(mapping)
        .map(([src, dest]) => `${src}:${dest}`)
        .join(', ');
}

function configToJson(config: Config): string {
    const output: Record<string, unknown> = {
        sourceProject: config.sourceProject,
        destProject: config.destProject,
        collections: config.collections,
        includeSubcollections: config.includeSubcollections,
        dryRun: config.dryRun,
        batchSize: config.batchSize,
        limit: config.limit,
        where: serializeWhereFilters(config.where),
        exclude: config.exclude,
        merge: config.merge,
        parallel: config.parallel,
        clear: config.clear,
        deleteMissing: config.deleteMissing,
    };

    // Include optional fields only if set
    if (config.transform) output.transform = config.transform;
    if (Object.keys(config.renameCollection).length > 0) output.renameCollection = config.renameCollection;
    if (config.idPrefix) output.idPrefix = config.idPrefix;
    if (config.idSuffix) output.idSuffix = config.idSuffix;
    if (config.webhook) output.webhook = config.webhook;
    if (config.rateLimit > 0) output.rateLimit = config.rateLimit;
    if (config.skipOversized) output.skipOversized = config.skipOversized;
    if (config.detectConflicts) output.detectConflicts = config.detectConflicts;
    if (config.maxDepth > 0) output.maxDepth = config.maxDepth;
    if (config.verify) output.verify = config.verify;
    if (config.verifyIntegrity) output.verifyIntegrity = config.verifyIntegrity;
    if (config.retries !== 3) output.retries = config.retries;

    return JSON.stringify(output, null, 4);
}

function iniLine(key: string, value: string | number | boolean): string {
    return `${key} = ${value}\n`;
}

function iniComment(key: string, value: string | number | boolean): string {
    return `; ${key} = ${value}\n`;
}

function configToIni(config: Config): string {
    let ini = '; fscopy configuration file\n';
    ini += '; Generated by interactive mode\n\n';

    // [projects]
    ini += '[projects]\n';
    ini += iniLine('source', config.sourceProject ?? '');
    ini += iniLine('dest', config.destProject ?? '');
    ini += '\n';

    // [transfer]
    ini += '[transfer]\n';
    ini += iniLine('collections', config.collections.join(', '));
    ini += iniLine('includeSubcollections', config.includeSubcollections);
    ini += iniLine('dryRun', config.dryRun);
    ini += iniLine('batchSize', config.batchSize);
    ini += iniLine('limit', config.limit);
    ini += '\n';

    // [options]
    ini += '[options]\n';

    if (config.where.length > 0) {
        ini += iniLine('where', serializeWhereFilters(config.where).join(', '));
    } else {
        ini += iniComment('where', 'status == active');
    }

    if (config.exclude.length > 0) {
        ini += iniLine('exclude', config.exclude.join(', '));
    } else {
        ini += iniComment('exclude', 'logs, temp/*, cache');
    }

    ini += iniLine('merge', config.merge);
    ini += iniLine('parallel', config.parallel);
    ini += iniLine('clear', config.clear);
    ini += iniLine('deleteMissing', config.deleteMissing);

    if (config.transform) {
        ini += iniLine('transform', config.transform);
    } else {
        ini += iniComment('transform', './transforms/anonymize.ts');
    }

    if (Object.keys(config.renameCollection).length > 0) {
        ini += iniLine('renameCollection', serializeRenameMapping(config.renameCollection));
    } else {
        ini += iniComment('renameCollection', 'users:users_backup, orders:orders_2024');
    }

    if (config.idPrefix) {
        ini += iniLine('idPrefix', config.idPrefix);
    } else {
        ini += iniComment('idPrefix', 'backup_');
    }

    if (config.idSuffix) {
        ini += iniLine('idSuffix', config.idSuffix);
    } else {
        ini += iniComment('idSuffix', '_v2');
    }

    if (config.webhook) {
        ini += iniLine('webhook', config.webhook);
    } else {
        ini += iniComment('webhook', 'https://hooks.slack.com/services/...');
    }

    return ini;
}

async function saveConfig(config: Config, format: 'ini' | 'json'): Promise<string> {
    const defaultName = format === 'json' ? 'fscopy-config.json' : 'fscopy-config.ini';

    const filePath = await input({
        message: `Save path:`,
        default: defaultName,
    });

    const resolvedPath = path.resolve(filePath);

    if (fs.existsSync(resolvedPath)) {
        const overwrite = await confirm({
            message: `File "${filePath}" already exists. Overwrite?`,
            default: false,
        });
        if (!overwrite) {
            console.log('\nSave cancelled.\n');
            process.exit(0);
        }
    }

    const content = format === 'json' ? configToJson(config) : configToIni(config);
    fs.writeFileSync(resolvedPath, content, 'utf-8');

    console.log(`\nConfig saved: ${resolvedPath}`);
    console.log(`\n   Run with:  fscopy -f ${filePath}\n`);

    return resolvedPath;
}

// =============================================================================
// Main interactive flow
// =============================================================================

export async function runInteractiveMode(config: Config): Promise<InteractiveResult> {
    console.log('\n' + '='.repeat(SEPARATOR_LENGTH));
    console.log('FSCOPY - INTERACTIVE MODE');
    console.log('='.repeat(SEPARATOR_LENGTH) + '\n');

    // 1. Projects
    const sourceProject = await promptForProject(config.sourceProject, 'Source Firebase project ID', '>>');
    const destProject = await promptForProject(config.destProject, 'Destination Firebase project ID', '>>');

    let idPrefix = config.idPrefix;
    let idSuffix = config.idSuffix;

    if (sourceProject === destProject) {
        const mods = await promptForIdModification(idPrefix, idSuffix);
        idPrefix = mods.idPrefix;
        idSuffix = mods.idSuffix;
    }

    // 2. Discover collections
    const { app: tempSourceApp, collections: collectionInfo } = await discoverCollections(sourceProject);

    // 3. Select collections
    console.log('');
    const selectedCollections = await checkbox({
        message: 'Select collections to transfer:',
        choices: collectionInfo.map((col) => ({
            name: `${col.id} (${col.count} docs)`,
            value: col.id,
            checked: config.collections.includes(col.id),
        })),
        validate: (value) => value.length > 0 || 'Select at least one collection',
    });

    // 4. Basic options
    console.log('');
    const includeSubcollections = await confirm({
        message: 'Include subcollections?',
        default: config.includeSubcollections,
    });

    const dryRun = await confirm({
        message: 'Dry run mode (preview without writing)?',
        default: config.dryRun,
    });

    const merge = await confirm({
        message: 'Merge mode (update instead of overwrite)?',
        default: config.merge,
    });

    // Build config so far
    let finalConfig: Config = {
        ...config,
        sourceProject,
        destProject,
        collections: selectedCollections,
        includeSubcollections,
        dryRun,
        merge,
        idPrefix,
        idSuffix,
    };

    // 5. Advanced options
    console.log('');
    const advancedUpdates = await promptAdvancedOptions(finalConfig);
    finalConfig = { ...finalConfig, ...advancedUpdates };

    // Clean up temporary Firebase app
    await tempSourceApp.delete();

    // 6. Final action
    const action = await promptFinalAction();

    if (action === 'save-ini' || action === 'save-json') {
        const format = action === 'save-json' ? 'json' : 'ini';
        await saveConfig(finalConfig, format);
        return { config: finalConfig, action: 'save' };
    }

    return { config: finalConfig, action: 'execute' };
}
