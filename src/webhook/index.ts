import type { Stats } from '../types.js';
import type { Output } from '../utils/output.js';

export interface WebhookPayload {
    source: string;
    destination: string;
    collections: string[];
    stats: Stats;
    duration: number;
    dryRun: boolean;
    success: boolean;
    error?: string;
}

export function detectWebhookType(url: string): 'slack' | 'discord' | 'custom' {
    if (url.includes('hooks.slack.com')) {
        return 'slack';
    }
    if (url.includes('discord.com/api/webhooks')) {
        return 'discord';
    }
    return 'custom';
}

export function validateWebhookUrl(url: string): { valid: boolean; warning?: string } {
    try {
        const parsed = new URL(url);
        const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

        if (parsed.protocol !== 'https:' && !isLocalhost) {
            return {
                valid: true,
                warning: `Webhook URL uses HTTP instead of HTTPS. Data will be sent unencrypted.`,
            };
        }

        return { valid: true };
    } catch {
        return { valid: false, warning: `Invalid webhook URL: ${url}` };
    }
}

export function formatSlackPayload(payload: WebhookPayload): Record<string, unknown> {
    const status = payload.success ? ':white_check_mark: Success' : ':x: Failed';
    const mode = payload.dryRun ? ' (DRY RUN)' : '';

    const fields = [
        { title: 'Source', value: payload.source, short: true },
        { title: 'Destination', value: payload.destination, short: true },
        { title: 'Collections', value: payload.collections.join(', '), short: false },
        { title: 'Transferred', value: String(payload.stats.documentsTransferred), short: true },
        { title: 'Deleted', value: String(payload.stats.documentsDeleted), short: true },
        { title: 'Errors', value: String(payload.stats.errors), short: true },
        { title: 'Duration', value: `${payload.duration}s`, short: true },
    ];

    if (payload.error) {
        fields.push({ title: 'Error', value: payload.error, short: false });
    }

    return {
        attachments: [
            {
                color: payload.success ? '#36a64f' : '#ff0000',
                title: `fscopy Transfer${mode}`,
                text: status,
                fields,
                footer: 'fscopy',
                ts: Math.floor(Date.now() / 1000),
            },
        ],
    };
}

export function formatDiscordPayload(payload: WebhookPayload): Record<string, unknown> {
    const status = payload.success ? '✅ Success' : '❌ Failed';
    const mode = payload.dryRun ? ' (DRY RUN)' : '';
    const color = payload.success ? 0x36a64f : 0xff0000;

    const fields = [
        { name: 'Source', value: payload.source, inline: true },
        { name: 'Destination', value: payload.destination, inline: true },
        { name: 'Collections', value: payload.collections.join(', '), inline: false },
        { name: 'Transferred', value: String(payload.stats.documentsTransferred), inline: true },
        { name: 'Deleted', value: String(payload.stats.documentsDeleted), inline: true },
        { name: 'Errors', value: String(payload.stats.errors), inline: true },
        { name: 'Duration', value: `${payload.duration}s`, inline: true },
    ];

    if (payload.error) {
        fields.push({ name: 'Error', value: payload.error, inline: false });
    }

    return {
        embeds: [
            {
                title: `fscopy Transfer${mode}`,
                description: status,
                color,
                fields,
                footer: { text: 'fscopy' },
                timestamp: new Date().toISOString(),
            },
        ],
    };
}

export async function sendWebhook(
    webhookUrl: string,
    payload: WebhookPayload,
    output: Output
): Promise<boolean> {
    const webhookType = detectWebhookType(webhookUrl);

    let body: Record<string, unknown>;
    switch (webhookType) {
        case 'slack':
            body = formatSlackPayload(payload);
            break;
        case 'discord':
            body = formatDiscordPayload(payload);
            break;
        default:
            body = payload as unknown as Record<string, unknown>;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text();
            const statusCode = response.status;

            if (statusCode >= 400 && statusCode < 500) {
                // Client error - likely bad URL or payload format
                output.logError(`Webhook client error (${statusCode})`, {
                    url: webhookUrl,
                    status: statusCode,
                    error: errorText,
                });
                output.warn(
                    `⚠️  Webhook failed (HTTP ${statusCode}): Check webhook URL or payload format`
                );
            } else if (statusCode >= 500) {
                // Server error - retry might help
                output.logError(`Webhook server error (${statusCode})`, {
                    url: webhookUrl,
                    status: statusCode,
                    error: errorText,
                });
                output.warn(
                    `⚠️  Webhook server error (HTTP ${statusCode}): The webhook service may be temporarily unavailable`
                );
            }
            return false;
        }

        output.logInfo(`Webhook sent successfully (${webhookType})`, { url: webhookUrl });
        output.info(`📤 Webhook notification sent (${webhookType})`);
        return true;
    } catch (error) {
        const err = error as Error;

        if (err.name === 'AbortError') {
            output.logError('Webhook timeout after 30s', { url: webhookUrl });
            output.warn('⚠️  Webhook request timed out after 30 seconds');
        } else if (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND')) {
            output.logError(`Webhook connection failed: ${err.message}`, { url: webhookUrl });
            output.warn(
                `⚠️  Webhook connection failed: Unable to reach ${new URL(webhookUrl).hostname}`
            );
        } else {
            output.logError(`Failed to send webhook: ${err.message}`, { url: webhookUrl });
            output.warn(`⚠️  Failed to send webhook: ${err.message}`);
        }
        return false;
    }
}
