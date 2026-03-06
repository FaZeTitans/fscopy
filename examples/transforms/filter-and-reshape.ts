/**
 * Filter documents and reshape data during transfer.
 * Returns null to skip documents that don't match criteria.
 * Usage: fscopy -f config.ini -t ./examples/transforms/filter-and-reshape.ts
 */
export function transform(
    doc: Record<string, unknown>,
    meta: { id: string; path: string }
): Record<string, unknown> | null {
    // Skip inactive documents
    if (doc.status === 'deleted' || doc.active === false) {
        return null;
    }

    // Reshape: flatten nested address
    const address = doc.address as Record<string, unknown> | undefined;

    return {
        name: doc.name,
        email: doc.email,
        city: address?.city,
        country: address?.country,
        createdAt: doc.createdAt,
    };
}
