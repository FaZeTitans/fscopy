/**
 * Anonymize PII fields during transfer.
 * Usage: fscopy -f config.ini -t ./examples/transforms/anonymize.ts
 */
export function transform(
    doc: Record<string, unknown>,
    meta: { id: string; path: string }
): Record<string, unknown> {
    return {
        ...doc,
        email: doc.email ? '***@***.com' : undefined,
        phone: doc.phone ? '***-***-****' : undefined,
        name: doc.name ? 'Anonymous' : undefined,
        // Preserve non-PII fields as-is
    };
}
