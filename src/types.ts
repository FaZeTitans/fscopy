// =============================================================================
// Shared Types
// =============================================================================

export interface WhereFilter {
    field: string;
    operator: FirebaseFirestore.WhereFilterOp;
    value: string | number | boolean | null;
}

export interface Config {
    collections: string[];
    includeSubcollections: boolean;
    dryRun: boolean;
    batchSize: number;
    limit: number;
    sourceProject: string | null;
    destProject: string | null;
    retries: number;
    where: WhereFilter[];
    exclude: string[];
    merge: boolean;
    parallel: number;
    clear: boolean;
    deleteMissing: boolean;
    transform: string | null;
    renameCollection: Record<string, string>;
    idPrefix: string | null;
    idSuffix: string | null;
    webhook: string | null;
    resume: boolean;
    stateFile: string;
    verify: boolean;
    rateLimit: number;
    skipOversized: boolean;
    json: boolean;
    transformSamples: number;
    detectConflicts: boolean;
    maxDepth: number;
    verifyIntegrity: boolean;
    allowHttpWebhook: boolean;
}

// Config after validation - required fields are guaranteed non-null
export interface ValidatedConfig extends Omit<Config, 'sourceProject' | 'destProject'> {
    sourceProject: string;
    destProject: string;
}

export interface ConflictInfo {
    collection: string;
    docId: string;
    reason: string;
}

export interface Stats {
    collectionsProcessed: number;
    documentsTransferred: number;
    documentsDeleted: number;
    errors: number;
    conflicts: number;
    integrityErrors: number;
}

export interface TransferState {
    version: number;
    sourceProject: string;
    destProject: string;
    collections: string[];
    startedAt: string;
    updatedAt: string;
    completedDocs: Record<string, string[]>; // collectionPath -> array of doc IDs
    stats: Stats;
}

export interface LogEntry {
    timestamp: string;
    level: string;
    message: string;
    [key: string]: unknown;
}

export type TransformFunction = (
    doc: Record<string, unknown>,
    meta: { id: string; path: string }
) => Record<string, unknown> | null;

export interface CliArgs {
    init?: string;
    config?: string;
    collections?: string[];
    includeSubcollections?: boolean;
    dryRun?: boolean;
    batchSize?: number;
    limit?: number;
    sourceProject?: string;
    destProject?: string;
    yes: boolean;
    log?: string;
    maxLogSize?: string;
    retries?: number;
    quiet: boolean;
    where?: string[];
    exclude?: string[];
    merge?: boolean;
    parallel?: number;
    clear?: boolean;
    deleteMissing?: boolean;
    interactive?: boolean;
    transform?: string;
    renameCollection?: string[];
    idPrefix?: string;
    idSuffix?: string;
    webhook?: string;
    resume?: boolean;
    stateFile?: string;
    verify?: boolean;
    rateLimit?: number;
    skipOversized?: boolean;
    json?: boolean;
    transformSamples?: number;
    detectConflicts?: boolean;
    maxDepth?: number;
    verifyIntegrity?: boolean;
    allowHttpWebhook?: boolean;
    validateOnly?: boolean;
}
