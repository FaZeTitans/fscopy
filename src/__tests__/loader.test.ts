import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTransformFunction } from '../transform/loader.js';

describe('Transform Loader', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fscopy-loader-test-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('loadTransformFunction', () => {
        test('throws error for non-existent file', async () => {
            const nonExistentPath = path.join(tempDir, 'does-not-exist.ts');

            try {
                await loadTransformFunction(nonExistentPath);
                expect.unreachable('Should have thrown');
            } catch (error) {
                expect((error as Error).message).toContain('Transform file not found');
            }
        });

        test('throws error for unsupported file extension', async () => {
            const transformPath = path.join(tempDir, 'transform.json');
            fs.writeFileSync(transformPath, '{}');

            try {
                await loadTransformFunction(transformPath);
                expect.unreachable('Should have thrown');
            } catch (error) {
                expect((error as Error).message).toContain(
                    'must be a JavaScript or TypeScript file'
                );
            }
        });

        test('throws error for file without extension', async () => {
            const transformPath = path.join(tempDir, 'transform');
            fs.writeFileSync(transformPath, 'export default (doc) => doc;');

            try {
                await loadTransformFunction(transformPath);
                expect.unreachable('Should have thrown');
            } catch (error) {
                expect((error as Error).message).toContain('no extension');
            }
        });

        test('loads default export function', async () => {
            const transformPath = path.join(tempDir, 'transform-default.ts');
            fs.writeFileSync(
                transformPath,
                `export default function transform(doc: any) { return { ...doc, modified: true }; }`
            );

            const fn = await loadTransformFunction(transformPath);

            expect(typeof fn).toBe('function');
            const result = fn({ name: 'test' }, { id: 'doc1', path: 'users/doc1' });
            expect(result).toEqual({ name: 'test', modified: true });
        });

        test('loads named transform export', async () => {
            const transformPath = path.join(tempDir, 'transform-named.ts');
            fs.writeFileSync(
                transformPath,
                `export function transform(doc: any) { return { ...doc, processed: true }; }`
            );

            const fn = await loadTransformFunction(transformPath);

            expect(typeof fn).toBe('function');
            const result = fn({ value: 42 }, { id: 'doc1', path: 'items/doc1' });
            expect(result).toEqual({ value: 42, processed: true });
        });

        test('loads default.transform export', async () => {
            const transformPath = path.join(tempDir, 'transform-obj.ts');
            fs.writeFileSync(
                transformPath,
                `export default { transform: (doc: any) => ({ ...doc, fromObj: true }) };`
            );

            const fn = await loadTransformFunction(transformPath);

            expect(typeof fn).toBe('function');
            const result = fn({ x: 1 }, { id: 'doc1', path: 'data/doc1' });
            expect(result).toEqual({ x: 1, fromObj: true });
        });

        test('throws error when no transform function exported', async () => {
            const transformPath = path.join(tempDir, 'no-transform.ts');
            fs.writeFileSync(transformPath, `export const value = 42;`);

            try {
                await loadTransformFunction(transformPath);
                expect.unreachable('Should have thrown');
            } catch (error) {
                expect((error as Error).message).toContain("must export a 'transform' function");
            }
        });

        test('throws error for invalid transform type', async () => {
            const transformPath = path.join(tempDir, 'invalid-type.ts');
            fs.writeFileSync(transformPath, `export const transform = 'not a function';`);

            try {
                await loadTransformFunction(transformPath);
                expect.unreachable('Should have thrown');
            } catch (error) {
                expect((error as Error).message).toContain("must export a 'transform' function");
            }
        });

        test('throws error for syntax error in transform file', async () => {
            const transformPath = path.join(tempDir, 'syntax-error.ts');
            fs.writeFileSync(transformPath, `export function transform( { return; }`);

            try {
                await loadTransformFunction(transformPath);
                expect.unreachable('Should have thrown');
            } catch (error) {
                expect((error as Error).message).toContain('Failed to load transform file');
            }
        });

        test('transform can return null to skip document', async () => {
            const transformPath = path.join(tempDir, 'skip-transform.ts');
            fs.writeFileSync(
                transformPath,
                `export function transform(doc: any) {
                    if (doc.skip) return null;
                    return doc;
                }`
            );

            const fn = await loadTransformFunction(transformPath);

            expect(fn({ skip: true }, { id: 'doc1', path: 'test/doc1' })).toBeNull();
            expect(fn({ skip: false }, { id: 'doc2', path: 'test/doc2' })).toEqual({ skip: false });
        });

        test('transform receives meta information', async () => {
            const transformPath = path.join(tempDir, 'meta-transform.ts');
            fs.writeFileSync(
                transformPath,
                `export function transform(doc: any, meta: { id: string; path: string }) {
                    return { ...doc, docId: meta.id, docPath: meta.path };
                }`
            );

            const fn = await loadTransformFunction(transformPath);
            const result = fn({ data: 'test' }, { id: 'myDoc', path: 'users/myDoc' });

            expect(result).toEqual({
                data: 'test',
                docId: 'myDoc',
                docPath: 'users/myDoc',
            });
        });

        test('loads JavaScript file', async () => {
            const transformPath = path.join(tempDir, 'transform.js');
            fs.writeFileSync(
                transformPath,
                `module.exports.transform = function(doc) { return { ...doc, js: true }; };`
            );

            const fn = await loadTransformFunction(transformPath);

            expect(typeof fn).toBe('function');
            const result = fn({ name: 'test' }, { id: 'doc1', path: 'items/doc1' });
            expect(result).toEqual({ name: 'test', js: true });
        });

        test('resolves relative path', async () => {
            const transformPath = path.join(tempDir, 'relative-transform.ts');
            fs.writeFileSync(transformPath, `export function transform(doc: any) { return doc; }`);

            // Use relative path from current directory
            const relativePath = path.relative(process.cwd(), transformPath);
            const fn = await loadTransformFunction(relativePath);

            expect(typeof fn).toBe('function');
        });
    });
});
