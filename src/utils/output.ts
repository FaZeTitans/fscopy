import fs from 'node:fs';
import path from 'node:path';
import { SEPARATOR_LENGTH } from '../constants.js';
import type { Stats, LogEntry } from '../types.js';
import { rotateFileIfNeeded } from './file-rotation.js';

/**
 * Parse a size string like "10MB" or "1GB" into bytes.
 * Supports: B, KB, MB, GB (case insensitive)
 * Returns 0 for invalid or "0" input.
 */
export function parseSize(sizeStr: string | undefined): number {
    if (!sizeStr || sizeStr === '0') return 0;

    const sizeRegex = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i;
    const match = sizeRegex.exec(sizeStr.trim());
    if (!match) return 0;

    const value = Number.parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();

    const multipliers: Record<string, number> = {
        B: 1,
        KB: 1024,
        MB: 1024 * 1024,
        GB: 1024 * 1024 * 1024,
    };

    return Math.floor(value * (multipliers[unit] || 1));
}

export interface OutputOptions {
    quiet: boolean;
    json: boolean;
    logFile?: string;
    maxLogSize?: number; // Max log file size in bytes (0 = unlimited)
    maxLogFiles?: number; // Max number of rotated log files to keep
}

/**
 * Unified output manager for console and file logging.
 * Handles quiet mode (--quiet) and JSON mode (--json).
 */
export class Output {
    private readonly options: OutputOptions;
    private readonly entries: LogEntry[] = [];
    private readonly startTime: Date;

    constructor(options: Partial<OutputOptions> = {}) {
        this.options = {
            quiet: options.quiet ?? false,
            json: options.json ?? false,
            logFile: options.logFile,
            maxLogSize: options.maxLogSize ?? 0,
            maxLogFiles: options.maxLogFiles ?? 5,
        };
        this.startTime = new Date();
    }

    // ==========================================================================
    // Initialization
    // ==========================================================================

    init(): void {
        if (this.options.logFile) {
            // Ensure parent directory exists
            const dir = path.dirname(this.options.logFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            this.rotateLogIfNeeded();
            const header = `# fscopy transfer log\n# Started: ${this.startTime.toISOString()}\n\n`;
            fs.writeFileSync(this.options.logFile, header);
        }
    }

    /**
     * Rotate log file if it exceeds maxLogSize.
     * Creates numbered backups: log.1.ext, log.2.ext, etc.
     */
    private rotateLogIfNeeded(): void {
        if (this.options.logFile) {
            rotateFileIfNeeded(
                this.options.logFile,
                this.options.maxLogSize ?? 0,
                this.options.maxLogFiles ?? 5
            );
        }
    }

    // ==========================================================================
    // Console Output (respects quiet mode, skipped in JSON mode)
    // ==========================================================================

    /** Print info message to console */
    print(message: string): void {
        if (!this.options.json) {
            console.log(message);
        }
    }

    /** Print message (skipped in quiet mode) */
    private printIfNotQuiet(message: string): void {
        if (!this.options.quiet && !this.options.json) {
            console.log(message);
        }
    }

    /** Print info message (skipped in quiet mode) */
    info(message: string): void {
        this.printIfNotQuiet(message);
    }

    /** Print success message (skipped in quiet mode) */
    success(message: string): void {
        this.printIfNotQuiet(message);
    }

    /** Print warning message (always shown, except in JSON mode) */
    warn(message: string): void {
        if (!this.options.json) {
            console.warn(message);
        }
    }

    /** Print error message (always shown, except in JSON mode) */
    error(message: string): void {
        if (!this.options.json) {
            console.error(message);
        }
    }

    /** Print a blank line */
    blank(): void {
        if (!this.options.quiet && !this.options.json) {
            console.log('');
        }
    }

    /** Print a separator line */
    separator(char: string = '=', length: number = SEPARATOR_LENGTH): void {
        if (!this.options.quiet && !this.options.json) {
            console.log(char.repeat(length));
        }
    }

    /** Print a header with separators */
    header(title: string): void {
        if (!this.options.quiet && !this.options.json) {
            console.log('='.repeat(SEPARATOR_LENGTH));
            console.log(title);
            console.log('='.repeat(SEPARATOR_LENGTH));
        }
    }

    // ==========================================================================
    // File Logging (always writes if logFile is set)
    // ==========================================================================

    /** Log entry to file only */
    log(level: string, message: string, data: Record<string, unknown> = {}): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...data,
        };
        this.entries.push(entry);

        if (this.options.logFile) {
            const line =
                `[${entry.timestamp}] [${level}] ${message}` +
                (Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '') +
                '\n';
            fs.appendFileSync(this.options.logFile, line);
        }
    }

    /** Log info to file */
    logInfo(message: string, data?: Record<string, unknown>): void {
        this.log('INFO', message, data);
    }

    /** Log error to file */
    logError(message: string, data?: Record<string, unknown>): void {
        this.log('ERROR', message, data);
    }

    /** Log success to file */
    logSuccess(message: string, data?: Record<string, unknown>): void {
        this.log('SUCCESS', message, data);
    }

    /** Write summary to log file */
    logSummary(stats: Stats, duration: string): void {
        if (this.options.logFile) {
            let summary = `\n# Summary\n# Collections: ${stats.collectionsProcessed}\n`;
            if (stats.documentsDeleted > 0) {
                summary += `# Deleted: ${stats.documentsDeleted}\n`;
            }
            summary += `# Transferred: ${stats.documentsTransferred}\n`;
            if (stats.conflicts > 0) {
                summary += `# Conflicts: ${stats.conflicts}\n`;
            }
            summary += `# Errors: ${stats.errors}\n# Duration: ${duration}s\n`;
            fs.appendFileSync(this.options.logFile, summary);
        }
    }

    // ==========================================================================
    // JSON Output
    // ==========================================================================

    /** Print JSON output (only in JSON mode) */
    json(data: unknown): void {
        if (this.options.json) {
            console.log(JSON.stringify(data, null, 2));
        }
    }

    // ==========================================================================
    // Helpers
    // ==========================================================================

    get isQuiet(): boolean {
        return this.options.quiet;
    }

    get isJson(): boolean {
        return this.options.json;
    }

    get logFile(): string | undefined {
        return this.options.logFile;
    }
}

// Default singleton instance (can be replaced)
let defaultOutput: Output = new Output();

export function setDefaultOutput(output: Output): void {
    defaultOutput = output;
}

export function getDefaultOutput(): Output {
    return defaultOutput;
}
