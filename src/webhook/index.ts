import type { Stats } from '../types.js';
import type { Output } from '../utils/output.js';
import {
    WEBHOOK_TIMEOUT_MS,
    WEBHOOK_MAX_PAYLOAD_BYTES,
    WEBHOOK_MAX_RETRIES,
    WEBHOOK_RETRY_DELAY_MS,
} from '../constants.js';

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

export function validateWebhookUrl(
    url: string,
    allowHttp: boolean = false
): { valid: boolean; warning?: string } {
    try {
        const parsed = new URL(url);
        const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

        if (parsed.protocol !== 'https:' && !isLocalhost) {
            if (!allowHttp) {
                return {
                    valid: false,
                    warning: `Webhook URL uses HTTP instead of HTTPS. Use --allow-http-webhook to allow unencrypted webhooks.`,
                };
            }
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

async function attemptWebhookSend(
    webhookUrl: string,
    bodyJson: string,
    output: Output
): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyJson,
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text();
            const statusCode = response.status;

            if (statusCode >= 400 && statusCode < 500) {
                output.logError(`Webhook client error (${statusCode})`, {
                    url: webhookUrl,
                    status: statusCode,
                    error: errorText,
                });
                output.warn(
                    `⚠️  Webhook failed (HTTP ${statusCode}): Check webhook URL or payload format`
                );
                // Client errors are not retryable
                return false;
            }

            if (statusCode >= 500) {
                output.logError(`Webhook server error (${statusCode})`, {
                    url: webhookUrl,
                    status: statusCode,
                    error: errorText,
                });
                throw new Error(`Server error (HTTP ${statusCode})`);
            }

            return false;
        }

        return true;
    } finally {
        clearTimeout(timeout);
    }
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
            body = { ...payload };
    }

    const bodyJson = JSON.stringify(body);

    // Validate payload size
    const payloadSize = new TextEncoder().encode(bodyJson).length;
    if (payloadSize > WEBHOOK_MAX_PAYLOAD_BYTES) {
        output.logError('Webhook payload too large', {
            url: webhookUrl,
            size: payloadSize,
            limit: WEBHOOK_MAX_PAYLOAD_BYTES,
        });
        output.warn(
            `⚠️  Webhook payload too large (${Math.round(payloadSize / 1024)}KB > ${Math.round(WEBHOOK_MAX_PAYLOAD_BYTES / 1024)}KB limit)`
        );
        return false;
    }

    // Retry loop for server errors and network failures
    for (let attempt = 0; attempt <= WEBHOOK_MAX_RETRIES; attempt++) {
        try {
            const success = await attemptWebhookSend(webhookUrl, bodyJson, output);
            if (success) {
                output.logInfo(`Webhook sent successfully (${webhookType})`, { url: webhookUrl });
                output.info(`📤 Webhook notification sent (${webhookType})`);
                return true;
            }
            // Client error (4xx) - don't retry
            return false;
        } catch (error) {
            const err = error as Error;
            const isLastAttempt = attempt === WEBHOOK_MAX_RETRIES;

            if (err.name === 'AbortError') {
                output.logError(`Webhook timeout after ${WEBHOOK_TIMEOUT_MS / 1000}s`, {
                    url: webhookUrl,
                    attempt: attempt + 1,
                });
                if (isLastAttempt) {
                    output.warn(
                        `⚠️  Webhook request timed out after ${WEBHOOK_TIMEOUT_MS / 1000} seconds`
                    );
                    return false;
                }
            } else if (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND')) {
                output.logError(`Webhook connection failed: ${err.message}`, {
                    url: webhookUrl,
                    attempt: attempt + 1,
                });
                if (isLastAttempt) {
                    output.warn(
                        `⚠️  Webhook connection failed: Unable to reach ${new URL(webhookUrl).hostname}`
                    );
                    return false;
                }
            } else {
                output.logError(`Failed to send webhook: ${err.message}`, {
                    url: webhookUrl,
                    attempt: attempt + 1,
                });
                if (isLastAttempt) {
                    output.warn(`⚠️  Failed to send webhook: ${err.message}`);
                    return false;
                }
            }

            // Wait before retrying
            const delay = WEBHOOK_RETRY_DELAY_MS * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
            output.logInfo(`Retrying webhook (attempt ${attempt + 2}/${WEBHOOK_MAX_RETRIES + 1})`, {
                url: webhookUrl,
            });
        }
    }

    return false;
}
