import fs from 'node:fs';
import path from 'node:path';
import type { TransformFunction } from '../types.js';

const ALLOWED_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.mts']);

export async function loadTransformFunction(transformPath: string): Promise<TransformFunction> {
    const absolutePath = path.resolve(transformPath);

    // Validate file extension
    const ext = path.extname(absolutePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new Error(
            `Transform file must be a JavaScript or TypeScript file (${[...ALLOWED_EXTENSIONS].join(', ')}). Got: "${ext || '(no extension)'}"`
        );
    }

    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Transform file not found: ${absolutePath}`);
    }

    try {
        const module = await import(absolutePath);

        // Look for 'transform' export (default or named)
        const transformFn = module.default?.transform ?? module.transform ?? module.default;

        if (typeof transformFn !== 'function') {
            throw new TypeError(
                `Transform file must export a 'transform' function. Got: ${typeof transformFn}`
            );
        }

        return transformFn as TransformFunction;
    } catch (error) {
        if ((error as Error).message.includes('Transform file')) {
            throw error;
        }
        throw new Error(`Failed to load transform file: ${(error as Error).message}`);
    }
}
