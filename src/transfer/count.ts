import type { Firestore, Query } from 'firebase-admin/firestore';
import type { Config } from '../types.js';
import { matchesExcludePattern } from '../utils/patterns.js';
import { getSubcollections, buildQueryWithFilters } from './helpers.js';

export interface CountProgress {
    onCollection?: (path: string, count: number) => void;
    onSubcollection?: (path: string) => void;
    onSubcollectionExcluded?: (name: string) => void;
}

async function countWithSubcollections(
    sourceDb: Firestore,
    query: Query,
    collectionPath: string,
    config: Config,
    depth: number,
    progress?: CountProgress
): Promise<number> {
    // Apply limit at root level only
    if (depth === 0 && config.limit > 0) {
        query = query.limit(config.limit);
    }

    const snapshot = await query.select().get();
    let count = snapshot.size;

    if (depth === 0 && progress?.onCollection) {
        progress.onCollection(collectionPath, snapshot.size);
    }

    for (const doc of snapshot.docs) {
        count += await countSubcollectionsForDoc(
            sourceDb,
            doc,
            collectionPath,
            config,
            depth,
            progress
        );
    }

    return count;
}

async function countSubcollectionsForDoc(
    sourceDb: Firestore,
    doc: FirebaseFirestore.QueryDocumentSnapshot,
    collectionPath: string,
    config: Config,
    depth: number,
    progress?: CountProgress
): Promise<number> {
    // Respect maxDepth to match transfer behavior
    if (config.maxDepth > 0 && depth >= config.maxDepth) return 0;

    let count = 0;
    const subcollections = await getSubcollections(doc.ref);

    for (const subId of subcollections) {
        if (matchesExcludePattern(subId, config.exclude)) {
            if (progress?.onSubcollectionExcluded) {
                progress.onSubcollectionExcluded(subId);
            }
            continue;
        }

        const subPath = `${collectionPath}/${doc.id}/${subId}`;
        if (progress?.onSubcollection) {
            progress.onSubcollection(subPath);
        }

        count += await countDocuments(sourceDb, subPath, config, depth + 1, progress);
    }

    return count;
}

async function countWithoutSubcollections(
    query: Query,
    collectionPath: string,
    config: Config,
    depth: number,
    progress?: CountProgress
): Promise<number> {
    const countSnapshot = await query.count().get();
    let count = countSnapshot.data().count;

    // Apply limit at root level only
    if (depth === 0 && config.limit > 0) {
        count = Math.min(count, config.limit);
    }

    if (depth === 0 && progress?.onCollection) {
        progress.onCollection(collectionPath, count);
    }

    return count;
}

export async function countDocuments(
    sourceDb: Firestore,
    collectionPath: string,
    config: Config,
    depth: number = 0,
    progress?: CountProgress
): Promise<number> {
    const query = buildQueryWithFilters(sourceDb, collectionPath, config, depth);

    if (config.includeSubcollections) {
        return countWithSubcollections(sourceDb, query, collectionPath, config, depth, progress);
    }

    return countWithoutSubcollections(query, collectionPath, config, depth, progress);
}
