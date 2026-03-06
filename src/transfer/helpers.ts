import type { DocumentReference, Firestore, Query } from 'firebase-admin/firestore';
import type { Config } from '../types.js';
import { matchesExcludePattern } from '../utils/patterns.js';

export async function getSubcollections(docRef: DocumentReference): Promise<string[]> {
    const collections = await docRef.listCollections();
    return collections.map((col) => col.id);
}

export function getDestCollectionPath(
    sourcePath: string,
    renameMapping: Record<string, string>
): string {
    // Get the root collection name from the source path
    const rootCollection = sourcePath.split('/')[0];

    // Check if this root collection should be renamed
    if (renameMapping[rootCollection]) {
        // Replace the root collection name with the destination name
        return renameMapping[rootCollection] + sourcePath.slice(rootCollection.length);
    }

    return sourcePath;
}

export function getDestDocId(
    sourceId: string,
    prefix: string | null,
    suffix: string | null
): string {
    let destId = sourceId;
    if (prefix) {
        destId = prefix + destId;
    }
    if (suffix) {
        destId = destId + suffix;
    }
    return destId;
}

/**
 * Get non-excluded subcollection IDs for a document.
 * Filters out subcollections matching exclude patterns.
 */
export async function getFilteredSubcollections(
    docRef: DocumentReference,
    exclude: string[]
): Promise<string[]> {
    const subcollections = await getSubcollections(docRef);
    return subcollections.filter((id) => !matchesExcludePattern(id, exclude));
}

/**
 * Build a Firestore query with where filters applied.
 * Filters are only applied at root level (depth === 0).
 */
export function buildQueryWithFilters(
    sourceDb: Firestore,
    collectionPath: string,
    config: Config,
    depth: number
): Query {
    let query: Query = sourceDb.collection(collectionPath);

    if (depth === 0 && config.where.length > 0) {
        for (const filter of config.where) {
            query = query.where(filter.field, filter.operator, filter.value);
        }
    }

    return query;
}
