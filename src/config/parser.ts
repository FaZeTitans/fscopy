import fs from 'node:fs';
import path from 'node:path';
import ini from 'ini';
import type { Config, WhereFilter, CliArgs } from '../types.js';

export function getFileFormat(filePath: string): 'json' | 'ini' {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.json') return 'json';
    return 'ini';
}

export function parseBoolean(val: unknown): boolean {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
        return val.toLowerCase() === 'true';
    }
    return false;
}

export function parseWhereFilter(filterStr: string): WhereFilter | null {
    const operatorRegex = /(==|!=|<=|>=|<|>)/;
    const match = new RegExp(operatorRegex).exec(filterStr);

    if (!match) {
        console.warn(`⚠️  Invalid where filter: "${filterStr}" (missing operator)`);
        return null;
    }

    const operator = match[0] as FirebaseFirestore.WhereFilterOp;
    const [fieldPart, valuePart] = filterStr.split(operatorRegex).filter((_, i) => i !== 1);

    if (!fieldPart || !valuePart) {
        console.warn(`⚠️  Invalid where filter: "${filterStr}" (missing field or value)`);
        return null;
    }

    const field = fieldPart.trim();
    const rawValue = valuePart.trim();

    let value: string | number | boolean;
    if (rawValue === 'true') {
        value = true;
    } else if (rawValue === 'false') {
        value = false;
    } else if (rawValue === 'null') {
        value = null as unknown as string;
    } else if (!Number.isNaN(Number(rawValue)) && rawValue !== '') {
        value = Number(rawValue);
    } else {
        value = rawValue.replaceAll(/(?:^["'])|(?:["']$)/g, '');
    }

    return { field, operator, value };
}

export function parseWhereFilters(filters: string[] | undefined): WhereFilter[] {
    if (!filters || filters.length === 0) return [];
    return filters.map(parseWhereFilter).filter((f): f is WhereFilter => f !== null);
}

export function parseStringList(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

export function parseIntOption(value: string | undefined): number | undefined {
    if (value === undefined || value === '') return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
}

export function parseRenameMapping(
    mappings: string[] | string | undefined
): Record<string, string> {
    if (!mappings) return {};

    const result: Record<string, string> = {};
    const items = Array.isArray(mappings) ? mappings : parseStringList(mappings);

    for (const item of items) {
        const mapping = String(item).trim();
        const colonIndex = mapping.indexOf(':');
        if (colonIndex === -1) {
            console.warn(`⚠️  Invalid rename mapping: "${mapping}" (missing ':')`);
            continue;
        }
        const source = mapping.slice(0, colonIndex).trim();
        const dest = mapping.slice(colonIndex + 1).trim();
        if (!source || !dest) {
            console.warn(`⚠️  Invalid rename mapping: "${mapping}" (empty source or dest)`);
            continue;
        }
        result[source] = dest;
    }

    return result;
}

export function parseIniConfig(content: string): Partial<Config> {
    const parsed = ini.parse(content) as {
        projects?: { source?: string; dest?: string };
        transfer?: {
            collections?: string;
            includeSubcollections?: string | boolean;
            dryRun?: string | boolean;
            batchSize?: string;
            limit?: string;
        };
        options?: {
            where?: string;
            exclude?: string;
            merge?: string | boolean;
            parallel?: string;
            clear?: string | boolean;
            deleteMissing?: string | boolean;
            transform?: string;
            renameCollection?: string;
            idPrefix?: string;
            idSuffix?: string;
            webhook?: string;
            retries?: string;
            rateLimit?: string;
            skipOversized?: string | boolean;
            detectConflicts?: string | boolean;
            maxDepth?: string;
            verify?: string | boolean;
            verifyIntegrity?: string | boolean;
        };
    };

    let collections: string[] = [];
    if (parsed.transfer?.collections) {
        collections = parsed.transfer.collections
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c.length > 0);
    }

    const whereFilters = parsed.options?.where
        ? parseWhereFilters(parseStringList(parsed.options.where))
        : [];

    return {
        sourceProject: parsed.projects?.source ?? null,
        destProject: parsed.projects?.dest ?? null,
        collections,
        includeSubcollections: parseBoolean(parsed.transfer?.includeSubcollections),
        dryRun: parseBoolean(parsed.transfer?.dryRun ?? 'true'),
        batchSize: Number.parseInt(parsed.transfer?.batchSize ?? '', 10) || 500,
        limit: Number.parseInt(parsed.transfer?.limit ?? '', 10) || 0,
        where: whereFilters,
        exclude: parseStringList(parsed.options?.exclude),
        merge: parseBoolean(parsed.options?.merge),
        parallel: Number.parseInt(parsed.options?.parallel ?? '', 10) || 1,
        clear: parseBoolean(parsed.options?.clear),
        deleteMissing: parseBoolean(parsed.options?.deleteMissing),
        transform: parsed.options?.transform ?? null,
        renameCollection: parseRenameMapping(parsed.options?.renameCollection),
        idPrefix: parsed.options?.idPrefix ?? null,
        idSuffix: parsed.options?.idSuffix ?? null,
        webhook: parsed.options?.webhook ?? null,
        retries: parseIntOption(parsed.options?.retries),
        rateLimit: parseIntOption(parsed.options?.rateLimit),
        skipOversized: parsed.options?.skipOversized !== undefined ? parseBoolean(parsed.options.skipOversized) : undefined,
        detectConflicts: parsed.options?.detectConflicts !== undefined ? parseBoolean(parsed.options.detectConflicts) : undefined,
        maxDepth: parseIntOption(parsed.options?.maxDepth),
        verify: parsed.options?.verify !== undefined ? parseBoolean(parsed.options.verify) : undefined,
        verifyIntegrity: parsed.options?.verifyIntegrity !== undefined ? parseBoolean(parsed.options.verifyIntegrity) : undefined,
    };
}

export function parseJsonConfig(content: string): Partial<Config> {
    const config = JSON.parse(content) as {
        sourceProject?: string;
        destProject?: string;
        collections?: string[];
        includeSubcollections?: boolean;
        dryRun?: boolean;
        batchSize?: number;
        limit?: number;
        where?: string[];
        exclude?: string[];
        merge?: boolean;
        parallel?: number;
        clear?: boolean;
        deleteMissing?: boolean;
        transform?: string;
        renameCollection?: Record<string, string>;
        idPrefix?: string;
        idSuffix?: string;
        webhook?: string;
        retries?: number;
        rateLimit?: number;
        skipOversized?: boolean;
        detectConflicts?: boolean;
        maxDepth?: number;
        verify?: boolean;
        verifyIntegrity?: boolean;
    };

    return {
        sourceProject: config.sourceProject ?? null,
        destProject: config.destProject ?? null,
        collections: config.collections,
        includeSubcollections: config.includeSubcollections,
        dryRun: config.dryRun,
        batchSize: config.batchSize,
        limit: config.limit,
        where: parseWhereFilters(config.where),
        exclude: config.exclude,
        merge: config.merge,
        parallel: config.parallel,
        clear: config.clear,
        deleteMissing: config.deleteMissing,
        transform: config.transform ?? null,
        renameCollection: config.renameCollection ?? {},
        idPrefix: config.idPrefix ?? null,
        idSuffix: config.idSuffix ?? null,
        webhook: config.webhook ?? null,
        retries: config.retries,
        rateLimit: config.rateLimit,
        skipOversized: config.skipOversized,
        detectConflicts: config.detectConflicts,
        maxDepth: config.maxDepth,
        verify: config.verify,
        verifyIntegrity: config.verifyIntegrity,
    };
}

export function loadConfigFile(configPath?: string): Partial<Config> {
    if (!configPath) return {};

    const absolutePath = path.resolve(configPath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Config file not found: ${absolutePath}`);
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const format = getFileFormat(absolutePath);

    console.log(`📄 Loaded config from: ${absolutePath} (${format.toUpperCase()})\n`);

    return format === 'json' ? parseJsonConfig(content) : parseIniConfig(content);
}

export function mergeConfig(
    defaultConfig: Config,
    fileConfig: Partial<Config>,
    cliArgs: CliArgs
): Config {
    const cliWhereFilters = parseWhereFilters(cliArgs.where);
    const cliRenameCollection = parseRenameMapping(cliArgs.renameCollection);

    return {
        collections: cliArgs.collections ?? fileConfig.collections ?? defaultConfig.collections,
        includeSubcollections:
            cliArgs.includeSubcollections ??
            fileConfig.includeSubcollections ??
            defaultConfig.includeSubcollections,
        dryRun: cliArgs.dryRun ?? fileConfig.dryRun ?? defaultConfig.dryRun,
        batchSize: cliArgs.batchSize ?? fileConfig.batchSize ?? defaultConfig.batchSize,
        limit: cliArgs.limit ?? fileConfig.limit ?? defaultConfig.limit,
        sourceProject:
            cliArgs.sourceProject ?? fileConfig.sourceProject ?? defaultConfig.sourceProject,
        destProject: cliArgs.destProject ?? fileConfig.destProject ?? defaultConfig.destProject,
        where:
            cliWhereFilters.length > 0
                ? cliWhereFilters
                : (fileConfig.where ?? defaultConfig.where),
        exclude: cliArgs.exclude ?? fileConfig.exclude ?? defaultConfig.exclude,
        merge: cliArgs.merge ?? fileConfig.merge ?? defaultConfig.merge,
        parallel: cliArgs.parallel ?? fileConfig.parallel ?? defaultConfig.parallel,
        clear: cliArgs.clear ?? fileConfig.clear ?? defaultConfig.clear,
        deleteMissing:
            cliArgs.deleteMissing ?? fileConfig.deleteMissing ?? defaultConfig.deleteMissing,
        transform: cliArgs.transform ?? fileConfig.transform ?? defaultConfig.transform,
        renameCollection:
            Object.keys(cliRenameCollection).length > 0
                ? cliRenameCollection
                : (fileConfig.renameCollection ?? defaultConfig.renameCollection),
        idPrefix: cliArgs.idPrefix ?? fileConfig.idPrefix ?? defaultConfig.idPrefix,
        idSuffix: cliArgs.idSuffix ?? fileConfig.idSuffix ?? defaultConfig.idSuffix,
        webhook: cliArgs.webhook ?? fileConfig.webhook ?? defaultConfig.webhook,
        retries: cliArgs.retries ?? fileConfig.retries ?? defaultConfig.retries,
        resume: cliArgs.resume ?? defaultConfig.resume,
        stateFile: cliArgs.stateFile ?? defaultConfig.stateFile,
        verify: cliArgs.verify ?? fileConfig.verify ?? defaultConfig.verify,
        rateLimit: cliArgs.rateLimit ?? fileConfig.rateLimit ?? defaultConfig.rateLimit,
        skipOversized: cliArgs.skipOversized ?? fileConfig.skipOversized ?? defaultConfig.skipOversized,
        json: cliArgs.json ?? defaultConfig.json,
        transformSamples: cliArgs.transformSamples ?? defaultConfig.transformSamples,
        detectConflicts: cliArgs.detectConflicts ?? fileConfig.detectConflicts ?? defaultConfig.detectConflicts,
        maxDepth: cliArgs.maxDepth ?? fileConfig.maxDepth ?? defaultConfig.maxDepth,
        verifyIntegrity: cliArgs.verifyIntegrity ?? fileConfig.verifyIntegrity ?? defaultConfig.verifyIntegrity,
    };
}
