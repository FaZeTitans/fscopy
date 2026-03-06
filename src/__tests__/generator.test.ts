import { describe, test, expect, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateConfigFile } from '../config/generator.js';

describe('generateConfigFile', () => {
    const tmpDir = os.tmpdir();
    const createdFiles: string[] = [];

    afterEach(() => {
        for (const file of createdFiles) {
            try {
                fs.unlinkSync(file);
            } catch {
                // ignore
            }
        }
        createdFiles.length = 0;
    });

    test('generates INI config file', () => {
        const filePath = path.join(tmpDir, `fscopy-test-${Date.now()}.ini`);
        createdFiles.push(filePath);

        const result = generateConfigFile(filePath);
        expect(result).toBe(true);
        expect(fs.existsSync(filePath)).toBe(true);

        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('[projects]');
        expect(content).toContain('[transfer]');
        expect(content).toContain('source');
        expect(content).toContain('dest');
    });

    test('generates JSON config file', () => {
        const filePath = path.join(tmpDir, `fscopy-test-${Date.now()}.json`);
        createdFiles.push(filePath);

        const result = generateConfigFile(filePath);
        expect(result).toBe(true);
        expect(fs.existsSync(filePath)).toBe(true);

        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        expect(parsed).toHaveProperty('sourceProject');
        expect(parsed).toHaveProperty('destProject');
        expect(parsed).toHaveProperty('collections');
    });

    test('returns false if file already exists', () => {
        const filePath = path.join(tmpDir, `fscopy-test-existing-${Date.now()}.ini`);
        fs.writeFileSync(filePath, 'existing content');
        createdFiles.push(filePath);

        const result = generateConfigFile(filePath);
        expect(result).toBe(false);

        // Reset exitCode set by generateConfigFile to avoid polluting the test runner
        process.exitCode = 0;

        // Original content should be preserved
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toBe('existing content');
    });

    test('defaults to INI format for non-json extensions', () => {
        const filePath = path.join(tmpDir, `fscopy-test-${Date.now()}.cfg`);
        createdFiles.push(filePath);

        const result = generateConfigFile(filePath);
        expect(result).toBe(true);

        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('[projects]');
    });
});
