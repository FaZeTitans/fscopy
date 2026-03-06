/**
 * Add metadata fields to transferred documents.
 * Usage: fscopy -f config.ini -t ./examples/transforms/add-metadata.ts
 */
export function transform(
    doc: Record<string, unknown>,
    meta: { id: string; path: string }
): Record<string, unknown> {
    return {
        ...doc,
        _migratedAt: new Date().toISOString(),
        _sourceId: meta.id,
        _sourcePath: meta.path,
    };
}
