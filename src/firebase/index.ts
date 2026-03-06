import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import type { Config } from '../types.js';
import type { Output } from '../utils/output.js';
import { formatFirebaseError } from '../utils/errors.js';

let sourceApp: admin.app.App | null = null;
let destApp: admin.app.App | null = null;

export interface FirebaseConnections {
    sourceDb: Firestore;
    destDb: Firestore;
}

function getAppOptions(projectId: string): admin.AppOptions {
    const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
    return {
        projectId,
        ...(isEmulator ? {} : { credential: admin.credential.applicationDefault() }),
    };
}

export function initializeFirebase(config: Config): FirebaseConnections {
    sourceApp = admin.initializeApp(getAppOptions(config.sourceProject!), 'source');
    destApp = admin.initializeApp(getAppOptions(config.destProject!), 'dest');

    return {
        sourceDb: sourceApp.firestore(),
        destDb: destApp.firestore(),
    };
}

export async function checkDatabaseConnectivity(
    sourceDb: Firestore,
    destDb: Firestore,
    config: Config,
    output: Output
): Promise<void> {
    output.info('🔌 Checking database connectivity...');

    // Check source database
    try {
        await sourceDb.listCollections();
        output.info(`   ✓ Source (${config.sourceProject}) - connected`);
    } catch (error) {
        const err = error as Error & { code?: string };
        const errorInfo = formatFirebaseError(err);
        const hint = errorInfo.suggestion ? `\n   Hint: ${errorInfo.suggestion}` : '';
        throw new Error(
            `Cannot connect to source database (${config.sourceProject}): ${errorInfo.message}${hint}`
        );
    }

    // Check destination database (only if different from source)
    if (config.sourceProject !== config.destProject) {
        try {
            await destDb.listCollections();
            output.info(`   ✓ Destination (${config.destProject}) - connected`);
        } catch (error) {
            const err = error as Error & { code?: string };
            const errorInfo = formatFirebaseError(err);
            const hint = errorInfo.suggestion ? `\n   Hint: ${errorInfo.suggestion}` : '';
            throw new Error(
                `Cannot connect to destination database (${config.destProject}): ${errorInfo.message}${hint}`
            );
        }
    } else {
        output.info(`   ✓ Destination (same as source) - connected`);
    }

    output.blank();
}

export async function cleanupFirebase(): Promise<void> {
    if (sourceApp) await sourceApp.delete();
    if (destApp) await destApp.delete();
}
