import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import {
    detectWebhookType,
    validateWebhookUrl,
    formatSlackPayload,
    formatDiscordPayload,
    sendWebhook,
    type WebhookPayload,
} from '../webhook/index.js';
import { Output } from '../utils/output.js';

// Helper to create a test payload
function createPayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
    return {
        source: 'source-project',
        destination: 'dest-project',
        collections: ['users', 'orders'],
        stats: {
            collectionsProcessed: 2,
            documentsTransferred: 100,
            documentsDeleted: 5,
            errors: 1,
            conflicts: 0,
            integrityErrors: 0,
        },
        duration: 12.34,
        dryRun: false,
        success: true,
        ...overrides,
    };
}

describe('validateWebhookUrl', () => {
    test('accepts valid HTTPS URLs', () => {
        const result = validateWebhookUrl('https://example.com/webhook');
        expect(result.valid).toBe(true);
        expect(result.warning).toBeUndefined();
    });

    test('accepts HTTPS Slack webhook', () => {
        const result = validateWebhookUrl('https://hooks.slack.com/services/T00/B00/xxx');
        expect(result.valid).toBe(true);
        expect(result.warning).toBeUndefined();
    });

    test('accepts HTTPS Discord webhook', () => {
        const result = validateWebhookUrl('https://discord.com/api/webhooks/123/abc');
        expect(result.valid).toBe(true);
        expect(result.warning).toBeUndefined();
    });

    test('rejects HTTP URLs by default', () => {
        const result = validateWebhookUrl('http://example.com/webhook');
        expect(result.valid).toBe(false);
        expect(result.warning).toContain('HTTP instead of HTTPS');
        expect(result.warning).toContain('--allow-http-webhook');
    });

    test('allows HTTP URLs when allowHttp is true', () => {
        const result = validateWebhookUrl('http://example.com/webhook', true);
        expect(result.valid).toBe(true);
        expect(result.warning).toContain('HTTP instead of HTTPS');
        expect(result.warning).toContain('unencrypted');
    });

    test('allows HTTP for localhost', () => {
        const result = validateWebhookUrl('http://localhost:3000/webhook');
        expect(result.valid).toBe(true);
        expect(result.warning).toBeUndefined();
    });

    test('allows HTTP for 127.0.0.1', () => {
        const result = validateWebhookUrl('http://127.0.0.1:8080/hook');
        expect(result.valid).toBe(true);
        expect(result.warning).toBeUndefined();
    });

    test('rejects invalid URLs', () => {
        const result = validateWebhookUrl('not-a-url');
        expect(result.valid).toBe(false);
        expect(result.warning).toContain('Invalid webhook URL');
    });

    test('rejects malformed URLs', () => {
        const result = validateWebhookUrl('http://');
        expect(result.valid).toBe(false);
        expect(result.warning).toContain('Invalid webhook URL');
    });
});

describe('detectWebhookType', () => {
    test('detects Slack webhook', () => {
        expect(detectWebhookType('https://hooks.slack.com/services/T00/B00/xxx')).toBe('slack');
    });

    test('detects Discord webhook', () => {
        expect(detectWebhookType('https://discord.com/api/webhooks/123/abc')).toBe('discord');
    });

    test('returns custom for other URLs', () => {
        expect(detectWebhookType('https://example.com/webhook')).toBe('custom');
        expect(detectWebhookType('https://my-api.com/notify')).toBe('custom');
    });
});

describe('formatSlackPayload', () => {
    test('formats success payload', () => {
        const payload = createPayload({ success: true });
        const result = formatSlackPayload(payload);

        expect(result.attachments).toBeDefined();
        const attachment = (result.attachments as Array<Record<string, unknown>>)[0];
        expect(attachment.color).toBe('#36a64f');
        expect(attachment.title).toBe('fscopy Transfer');
        expect(attachment.text).toContain('Success');
    });

    test('formats failure payload', () => {
        const payload = createPayload({ success: false, error: 'Something went wrong' });
        const result = formatSlackPayload(payload);

        const attachment = (result.attachments as Array<Record<string, unknown>>)[0];
        expect(attachment.color).toBe('#ff0000');
        expect(attachment.text).toContain('Failed');

        const fields = attachment.fields as Array<{ title: string; value: string }>;
        const errorField = fields.find((f) => f.title === 'Error');
        expect(errorField?.value).toBe('Something went wrong');
    });

    test('includes dry run indicator', () => {
        const payload = createPayload({ dryRun: true });
        const result = formatSlackPayload(payload);

        const attachment = (result.attachments as Array<Record<string, unknown>>)[0];
        expect(attachment.title).toContain('DRY RUN');
    });

    test('includes all stats fields', () => {
        const payload = createPayload();
        const result = formatSlackPayload(payload);

        const attachment = (result.attachments as Array<Record<string, unknown>>)[0];
        const fields = attachment.fields as Array<{ title: string; value: string }>;

        expect(fields.find((f) => f.title === 'Source')?.value).toBe('source-project');
        expect(fields.find((f) => f.title === 'Destination')?.value).toBe('dest-project');
        expect(fields.find((f) => f.title === 'Collections')?.value).toBe('users, orders');
        expect(fields.find((f) => f.title === 'Transferred')?.value).toBe('100');
        expect(fields.find((f) => f.title === 'Deleted')?.value).toBe('5');
        expect(fields.find((f) => f.title === 'Errors')?.value).toBe('1');
        expect(fields.find((f) => f.title === 'Duration')?.value).toBe('12.34s');
    });
});

describe('formatDiscordPayload', () => {
    test('formats success payload', () => {
        const payload = createPayload({ success: true });
        const result = formatDiscordPayload(payload);

        expect(result.embeds).toBeDefined();
        const embed = (result.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.color).toBe(0x36a64f);
        expect(embed.title).toBe('fscopy Transfer');
        expect(embed.description).toContain('Success');
    });

    test('formats failure payload', () => {
        const payload = createPayload({ success: false, error: 'Something went wrong' });
        const result = formatDiscordPayload(payload);

        const embed = (result.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.color).toBe(0xff0000);
        expect(embed.description).toContain('Failed');

        const fields = embed.fields as Array<{ name: string; value: string }>;
        const errorField = fields.find((f) => f.name === 'Error');
        expect(errorField?.value).toBe('Something went wrong');
    });

    test('includes dry run indicator', () => {
        const payload = createPayload({ dryRun: true });
        const result = formatDiscordPayload(payload);

        const embed = (result.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.title).toContain('DRY RUN');
    });

    test('includes timestamp', () => {
        const payload = createPayload();
        const result = formatDiscordPayload(payload);

        const embed = (result.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.timestamp).toBeDefined();
    });

    test('includes all stats fields', () => {
        const payload = createPayload();
        const result = formatDiscordPayload(payload);

        const embed = (result.embeds as Array<Record<string, unknown>>)[0];
        const fields = embed.fields as Array<{ name: string; value: string }>;

        expect(fields.find((f) => f.name === 'Source')?.value).toBe('source-project');
        expect(fields.find((f) => f.name === 'Destination')?.value).toBe('dest-project');
        expect(fields.find((f) => f.name === 'Collections')?.value).toBe('users, orders');
        expect(fields.find((f) => f.name === 'Transferred')?.value).toBe('100');
    });
});

describe('sendWebhook', () => {
    let originalFetch: typeof fetch;
    let mockFetch: ReturnType<typeof mock>;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        mockFetch = mock(() =>
            Promise.resolve({
                ok: true,
                text: () => Promise.resolve('OK'),
            } as Response)
        );
        globalThis.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test('sends POST request to webhook URL', async () => {
        const output = new Output();
        const payload = createPayload();

        await sendWebhook('https://example.com/webhook', payload, output);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toBe('https://example.com/webhook');
        expect(options.method).toBe('POST');
        expect(options.headers['Content-Type']).toBe('application/json');
    });

    test('uses Slack format for Slack URLs', async () => {
        const output = new Output();
        const payload = createPayload();

        await sendWebhook('https://hooks.slack.com/services/xxx', payload, output);

        const [, options] = mockFetch.mock.calls[0];
        const body = JSON.parse(options.body);
        expect(body.attachments).toBeDefined();
    });

    test('uses Discord format for Discord URLs', async () => {
        const output = new Output();
        const payload = createPayload();

        await sendWebhook('https://discord.com/api/webhooks/123/abc', payload, output);

        const [, options] = mockFetch.mock.calls[0];
        const body = JSON.parse(options.body);
        expect(body.embeds).toBeDefined();
    });

    test('uses raw payload for custom URLs', async () => {
        const output = new Output();
        const payload = createPayload();

        await sendWebhook('https://example.com/webhook', payload, output);

        const [, options] = mockFetch.mock.calls[0];
        const body = JSON.parse(options.body);
        expect(body.source).toBe('source-project');
        expect(body.stats).toBeDefined();
    });

    test('handles fetch errors gracefully', async () => {
        globalThis.fetch = mock(() =>
            Promise.reject(new Error('Network error'))
        ) as unknown as typeof fetch;
        const output = new Output();
        const payload = createPayload();

        // Should not throw
        await sendWebhook('https://example.com/webhook', payload, output);
    });

    test('handles non-ok response gracefully', async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve({
                ok: false,
                status: 500,
                text: () => Promise.resolve('Internal Server Error'),
            } as Response)
        ) as unknown as typeof fetch;
        const output = new Output();
        const payload = createPayload();

        // Should not throw
        await sendWebhook('https://example.com/webhook', payload, output);
    });
});
