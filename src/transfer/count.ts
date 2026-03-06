import type { Firestore, Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { Config } from '../types.js';
import { matchesExcludePattern } from '../utils/patterns.js';
import { getSubcollections, buildQueryWithFilters } from './helpers.js';
import { CLEAR_PAGE_SIZE } from '../constants.js';

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
    const userLimit = depth === 0 && config.limit > 0 ? config.limit : 0;
    let rootCount = 0;
    let subCount = 0;
    let lastDoc: QueryDocumentSnapshot | undefined;

    while (true) {
        let pageSize = CLEAR_PAGE_SIZE;
        if (userLimit > 0) {
            const remaining = userLimit - rootCount;
            if (remaining <= 0) break;
            pageSize = Math.min(pageSize, remaining);
        }

        let pageQuery = query.select().limit(pageSize);
        if (lastDoc) {
            pageQuery = pageQuery.startAfter(lastDoc);
        }

        const snapshot = await pageQuery.get();
        if (snapshot.empty) break;

        rootCount += snapshot.size;

        if (depth === 0 && progress?.onCollection) {
            progress.onCollection(collectionPath, rootCount);
        }

        for (const doc of snapshot.docs) {
            subCount += await countSubcollectionsForDoc(
                sourceDb,
                doc,
                collectionPath,
                config,
                depth,
                progress
            );
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.size < pageSize) break;
    }

    if (rootCount === 0 && depth === 0 && progress?.onCollection) {
        progress.onCollection(collectionPath, 0);
    }

    return rootCount + subCount;
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
