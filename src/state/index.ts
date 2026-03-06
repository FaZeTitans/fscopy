import fs from 'node:fs';
import { STATE_SAVE_INTERVAL_MS, STATE_SAVE_BATCH_INTERVAL } from '../constants.js';
import type { Config, ValidatedConfig, TransferState, Stats } from '../types.js';

export const STATE_VERSION = 1;

// =============================================================================
// CompletedDocsCache - O(1) lookup using Set instead of Array.includes()
// =============================================================================

/**
 * Cache for completed document IDs using Set for O(1) lookups.
 * Wraps the TransferState.completedDocs (which uses arrays for JSON serialization).
 */
export class CompletedDocsCache {
    private readonly cache: Map<string, Set<string>> = new Map();

    constructor(completedDocs: Record<string, string[]> = {}) {
        for (const [collection, docIds] of Object.entries(completedDocs)) {
            this.cache.set(collection, new Set(docIds));
        }
    }

    /**
     * Check if a document is completed. O(1) lookup.
     */
    has(collectionPath: string, docId: string): boolean {
        return this.cache.get(collectionPath)?.has(docId) ?? false;
    }

    /**
     * Mark a document as completed.
     */
    add(collectionPath: string, docId: string): void {
        let set = this.cache.get(collectionPath);
        if (!set) {
            set = new Set();
            this.cache.set(collectionPath, set);
        }
        set.add(docId);
    }

    /**
     * Mark multiple documents as completed.
     */
    addBatch(collectionPath: string, docIds: string[]): void {
        let set = this.cache.get(collectionPath);
        if (!set) {
            set = new Set();
            this.cache.set(collectionPath, set);
        }
        for (const docId of docIds) {
            set.add(docId);
        }
    }

    /**
     * Convert back to Record<string, string[]> for JSON serialization.
     */
    toRecord(): Record<string, string[]> {
        const result: Record<string, string[]> = {};
        for (const [collection, set] of this.cache) {
            result[collection] = Array.from(set);
        }
        return result;
    }

    /**
     * Get total count of completed documents.
     */
    get totalCount(): number {
        let count = 0;
        for (const set of this.cache.values()) {
            count += set.size;
        }
        return count;
    }
}

// =============================================================================
// StateSaver
// =============================================================================

export interface StateSaverOptions {
    /** Save every N batches (default: STATE_SAVE_BATCH_INTERVAL) */
    batchInterval?: number;
    /** Save every N milliseconds (default: STATE_SAVE_INTERVAL_MS) */
    timeInterval?: number;
}

/**
 * Throttled state saver with O(1) completed doc lookups.
 * Uses CompletedDocsCache for efficient lookups during transfer.
 * Saves state every N batches OR after X milliseconds, whichever comes first.
 */
export class StateSaver {
    private lastSaveTime: number = Date.now();
    private batchesSinceLastSave: number = 0;
    private readonly batchInterval: number;
    private readonly timeInterval: number;
    private dirty: boolean = false;
    private readonly cache: CompletedDocsCache;

    constructor(
        private readonly stateFile: string,
        private readonly state: TransferState,
        options: StateSaverOptions = {}
    ) {
        this.batchInterval = options.batchInterval ?? STATE_SAVE_BATCH_INTERVAL;
        this.timeInterval = options.timeInterval ?? STATE_SAVE_INTERVAL_MS;
        this.cache = new CompletedDocsCache(state.completedDocs);
    }

    /**
     * Check if a document is already completed. O(1) lookup.
     */
    isCompleted(collectionPath: string, docId: string): boolean {
        return this.cache.has(collectionPath, docId);
    }

    /**
     * Mark documents as completed and update stats.
     * Saves to disk if thresholds are met.
     */
    markBatchCompleted(collectionPath: string, docIds: string[], stats: Stats): void {
        this.cache.addBatch(collectionPath, docIds);
        this.state.stats = { ...stats };
        this.dirty = true;
        this.batchesSinceLastSave++;

        if (this.shouldSave()) {
            this.save();
        }
    }

    /**
     * Check if we should save based on batch count or time elapsed.
     */
    private shouldSave(): boolean {
        if (this.batchesSinceLastSave >= this.batchInterval) {
            return true;
        }

        const elapsed = Date.now() - this.lastSaveTime;
        if (elapsed >= this.timeInterval) {
            return true;
        }

        return false;
    }

    /**
     * Sync cache to state and save to disk.
     */
    private save(): void {
        this.state.completedDocs = this.cache.toRecord();
        saveTransferState(this.stateFile, this.state);
        this.lastSaveTime = Date.now();
        this.batchesSinceLastSave = 0;
        this.dirty = false;
    }

    /**
     * Force save if there are unsaved changes.
     * Call this before shutdown or on completion.
     */
    flush(): void {
        if (this.dirty) {
            this.save();
        }
    }

    /**
     * Get the underlying state object.
     * Note: completedDocs may be stale until flush() is called.
     */
    getState(): TransferState {
        return this.state;
    }

    /**
     * Get total count of completed documents.
     */
    get completedCount(): number {
        return this.cache.totalCount;
    }
}

export function loadTransferState(stateFile: string): TransferState | null {
    try {
        if (!fs.existsSync(stateFile)) {
            return null;
        }
        const content = fs.readFileSync(stateFile, 'utf-8');

        let state: TransferState;
        try {
            state = JSON.parse(content) as TransferState;
        } catch {
            console.error(`⚠️  State file is corrupted (invalid JSON): ${stateFile}`);
            console.error('   Delete the file and restart, or run without --resume.');
            return null;
        }

        if (!state.version) {
            console.error(`⚠️  State file is missing version field: ${stateFile}`);
            console.error('   The file may be corrupted. Delete it and restart.');
            return null;
        }

        if (state.version !== STATE_VERSION) {
            console.warn(
                `⚠️  State file version mismatch (expected ${STATE_VERSION}, got ${state.version})`
            );
            console.warn('   Delete the file and restart to use the current format.');
            return null;
        }

        return state;
    } catch (error) {
        console.error(`⚠️  Failed to read state file: ${(error as Error).message}`);
        return null;
    }
}

export function saveTransferState(stateFile: string, state: TransferState): void {
    state.updatedAt = new Date().toISOString();
    const content = JSON.stringify(state, null, 2);
    const tempFile = `${stateFile}.tmp`;

    try {
        // Write to temp file first (atomic write pattern)
        fs.writeFileSync(tempFile, content);
        // Rename is atomic on most filesystems
        fs.renameSync(tempFile, stateFile);
    } catch (error) {
        // Clean up temp file if it exists
        try {
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        } catch {
            // Ignore cleanup errors
        }
        // Log but don't throw - state save failure shouldn't stop the transfer
        console.error(`⚠️  Failed to save state file: ${(error as Error).message}`);
    }
}

export function deleteTransferState(stateFile: string): void {
    try {
        if (fs.existsSync(stateFile)) {
            fs.unlinkSync(stateFile);
        }
    } catch {
        // Ignore errors when deleting state file
    }
}

export function createInitialState(config: ValidatedConfig): TransferState {
    return {
        version: STATE_VERSION,
        sourceProject: config.sourceProject,
        destProject: config.destProject,
        collections: config.collections,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedDocs: {},
        stats: {
            collectionsProcessed: 0,
            documentsTransferred: 0,
            documentsDeleted: 0,
            errors: 0,
            conflicts: 0,
            integrityErrors: 0,
        },
    };
}

export function validateStateForResume(state: TransferState, config: Config): string[] {
    const errors: string[] = [];

    if (state.sourceProject !== config.sourceProject) {
        errors.push(
            `Source project mismatch: state has "${state.sourceProject}", config has "${config.sourceProject}"`
        );
    }
    if (state.destProject !== config.destProject) {
        errors.push(
            `Destination project mismatch: state has "${state.destProject}", config has "${config.destProject}"`
        );
    }

    // Check if collections are compatible (state collections should be subset of config)
    const configCollections = new Set(config.collections);
    for (const col of state.collections) {
        if (!configCollections.has(col)) {
            errors.push(`State contains collection "${col}" not in current config`);
        }
    }

    return errors;
}

export function isDocCompleted(
    state: TransferState,
    collectionPath: string,
    docId: string
): boolean {
    const completedInCollection = state.completedDocs[collectionPath];
    return completedInCollection ? completedInCollection.includes(docId) : false;
}

export function markDocCompleted(
    state: TransferState,
    collectionPath: string,
    docId: string
): void {
    if (!state.completedDocs[collectionPath]) {
        state.completedDocs[collectionPath] = [];
    }
    state.completedDocs[collectionPath].push(docId);
}
