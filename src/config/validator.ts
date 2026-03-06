import type { Config, ValidatedConfig } from '../types.js';

/**
 * Validate a Firestore collection or document ID.
 * Returns an error message if invalid, null if valid.
 */
export function validateFirestoreId(
    id: string,
    type: 'collection' | 'document' = 'collection'
): string | null {
    // Cannot be empty
    if (!id || id.length === 0) {
        return `${type} name cannot be empty`;
    }

    // Cannot be a lone period or double period
    if (id === '.' || id === '..') {
        return `${type} name cannot be '.' or '..'`;
    }

    // Cannot match __.*__ pattern (reserved by Firestore)
    if (/^__.*__$/.test(id)) {
        return `${type} name cannot match pattern '__*__' (reserved by Firestore)`;
    }

    return null;
}

/**
 * Validate a collection path (may contain nested paths like users/123/orders).
 * Returns array of error messages, empty if valid.
 */
export function validateCollectionPath(path: string): string[] {
    const errors: string[] = [];
    const segments = path.split('/');

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const type = i % 2 === 0 ? 'collection' : 'document';
        const error = validateFirestoreId(segment, type);
        if (error) {
            errors.push(`Invalid ${type} in path "${path}": ${error}`);
        }
    }

    return errors;
}

export function validateConfig(config: Config): string[] {
    const errors: string[] = [];

    if (!config.sourceProject) {
        errors.push('Source project is required (--source-project or in config file)');
    }
    if (!config.destProject) {
        errors.push('Destination project is required (--dest-project or in config file)');
    }
    if (config.sourceProject && config.destProject && config.sourceProject === config.destProject) {
        // Same project is allowed only if we're renaming collections or modifying IDs
        const hasRenamedCollections = Object.keys(config.renameCollection).length > 0;
        const hasIdModification = config.idPrefix !== null || config.idSuffix !== null;

        if (!hasRenamedCollections && !hasIdModification) {
            errors.push(
                'Source and destination projects are the same. ' +
                    'Use --rename-collection or --id-prefix/--id-suffix to avoid overwriting data.'
            );
        }
    }
    if (!config.collections || config.collections.length === 0) {
        errors.push('At least one collection is required (-c or --collections)');
    }

    // Validate collection names
    for (const collection of config.collections) {
        const pathErrors = validateCollectionPath(collection);
        errors.push(...pathErrors);
    }

    // Validate numeric bounds
    if (config.batchSize < 1 || config.batchSize > 500) {
        errors.push('Batch size must be between 1 and 500 (Firestore limit)');
    }
    if (config.parallel < 1 || config.parallel > 20) {
        errors.push('Parallel must be between 1 and 20');
    }
    if (config.rateLimit < 0) {
        errors.push('Rate limit must be 0 (unlimited) or a positive number');
    }
    if (config.maxDepth < 0 || config.maxDepth > 100) {
        errors.push('Max depth must be between 0 (unlimited) and 100');
    }
    if (config.retries < 0 || config.retries > 10) {
        errors.push('Retries must be between 0 and 10');
    }
    if (config.limit < 0) {
        errors.push('Document limit must be 0 (no limit) or a positive number');
    }

    return errors;
}

/**
 * Type guard to check if a Config has been validated.
 * Returns true if sourceProject and destProject are non-null strings.
 */
export function isValidatedConfig(config: Config): config is ValidatedConfig {
    return (
        typeof config.sourceProject === 'string' &&
        typeof config.destProject === 'string' &&
        config.collections.length > 0
    );
}

/**
 * Validates config and returns ValidatedConfig if valid, throws otherwise.
 */
export function assertValidConfig(config: Config): ValidatedConfig {
    const errors = validateConfig(config);
    if (errors.length > 0) {
        throw new Error(`Invalid configuration: ${errors.join(', ')}`);
    }
    if (!isValidatedConfig(config)) {
        throw new Error('Configuration validation failed');
    }
    return config;
}
