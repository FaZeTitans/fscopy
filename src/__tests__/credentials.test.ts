import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkCredentialsExist } from '../utils/credentials.js';

describe('checkCredentialsExist', () => {
    const originalEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        } else {
            process.env.GOOGLE_APPLICATION_CREDENTIALS = originalEnv;
        }
    });

    test('returns true when GOOGLE_APPLICATION_CREDENTIALS points to existing file', () => {
        const tmpFile = path.join(os.tmpdir(), `fscopy-test-creds-${Date.now()}.json`);
        fs.writeFileSync(tmpFile, '{}');
        process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpFile;

        const result = checkCredentialsExist();
        expect(result.exists).toBe(true);
        expect(result.path).toBe(tmpFile);

        fs.unlinkSync(tmpFile);
    });

    test('returns false when GOOGLE_APPLICATION_CREDENTIALS points to missing file', () => {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/nonexistent-creds-file.json';

        const result = checkCredentialsExist();
        expect(result.exists).toBe(false);
        expect(result.path).toBe('/tmp/nonexistent-creds-file.json');
    });

    test('falls back to ADC path when GOOGLE_APPLICATION_CREDENTIALS is empty', () => {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = '';

        const result = checkCredentialsExist();
        const expectedPath = path.join(
            os.homedir(),
            '.config',
            'gcloud',
            'application_default_credentials.json'
        );
        expect(result.path).toBe(expectedPath);
    });

    test('falls back to ADC path when GOOGLE_APPLICATION_CREDENTIALS is not set', () => {
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

        const result = checkCredentialsExist();
        const expectedPath = path.join(
            os.homedir(),
            '.config',
            'gcloud',
            'application_default_credentials.json'
        );
        expect(result.path).toBe(expectedPath);
    });
});
