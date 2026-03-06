import cliProgress from 'cli-progress';
import { SPEED_UPDATE_INTERVAL_MS, PROGRESS_FLUSH_INTERVAL_MS } from '../constants.js';
import type { Stats } from '../types.js';

export interface ProgressBarOptions {
    format?: string;
    barCompleteChar?: string;
    barIncompleteChar?: string;
    hideCursor?: boolean;
}

const DEFAULT_OPTIONS: ProgressBarOptions = {
    format: '📦 Progress |{bar}| {percentage}% | {value}/{total} docs | {speed} docs/s | ETA: {eta}s',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
};

/**
 * Wrapper around cli-progress that handles speed calculation and cleanup.
 * Thread-safe for parallel mode: uses batched updates to prevent UI flickering.
 */
export class ProgressBarWrapper {
    private bar: cliProgress.SingleBar | null = null;
    private speedInterval: NodeJS.Timeout | null = null;
    private flushInterval: NodeJS.Timeout | null = null;
    private lastDocsTransferred = 0;
    private lastTime = Date.now();

    // Batched increment counter for parallel-safe updates
    private pendingIncrements = 0;

    constructor(private readonly options: ProgressBarOptions = {}) {}

    /**
     * Start the progress bar with the given total and stats reference.
     * The stats object is used to read documentsTransferred for speed calculation.
     */
    start(total: number, stats: Stats): void {
        if (total <= 0) return;

        const mergedOptions = { ...DEFAULT_OPTIONS, ...this.options };
        this.bar = new cliProgress.SingleBar({
            format: mergedOptions.format,
            barCompleteChar: mergedOptions.barCompleteChar,
            barIncompleteChar: mergedOptions.barIncompleteChar,
            hideCursor: mergedOptions.hideCursor,
        });

        this.bar.start(total, 0, { speed: '0' });
        this.lastDocsTransferred = 0;
        this.lastTime = Date.now();
        this.pendingIncrements = 0;

        // Speed update interval
        this.speedInterval = setInterval(() => {
            this.updateSpeed(stats);
        }, SPEED_UPDATE_INTERVAL_MS);

        // Batched increment flush interval (for parallel mode)
        this.flushInterval = setInterval(() => {
            this.flushIncrements();
        }, PROGRESS_FLUSH_INTERVAL_MS);
    }

    /**
     * Increment the progress bar by 1.
     * Thread-safe: increments are batched and flushed periodically.
     */
    increment(): void {
        if (this.bar) {
            this.pendingIncrements++;
        }
    }

    /**
     * Increment the progress bar by a specific amount.
     * Thread-safe: increments are batched and flushed periodically.
     */
    incrementBy(count: number): void {
        if (this.bar && count > 0) {
            this.pendingIncrements += count;
        }
    }

    /**
     * Flush pending increments to the progress bar.
     */
    private flushIncrements(): void {
        if (!this.bar || this.pendingIncrements === 0) return;

        const toFlush = this.pendingIncrements;
        this.pendingIncrements = 0;
        this.bar.increment(toFlush);
    }

    /**
     * Update the speed display based on current stats.
     */
    private updateSpeed(stats: Stats): void {
        if (!this.bar) return;

        const now = Date.now();
        const timeDiff = (now - this.lastTime) / 1000;
        const currentDocs = stats.documentsTransferred;

        if (timeDiff > 0) {
            const docsDiff = currentDocs - this.lastDocsTransferred;
            const speed = Math.round(docsDiff / timeDiff);
            this.lastDocsTransferred = currentDocs;
            this.lastTime = now;
            this.bar.update({ speed: String(speed) });
        }
    }

    /**
     * Stop the progress bar and clean up intervals.
     * Flushes any pending increments before stopping.
     */
    stop(): void {
        // Flush remaining increments
        this.flushIncrements();

        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
        if (this.speedInterval) {
            clearInterval(this.speedInterval);
            this.speedInterval = null;
        }
        if (this.bar) {
            this.bar.stop();
            this.bar = null;
        }
    }

    /**
     * Increase the progress bar total by the given amount.
     * Used for dynamically discovered work (e.g., subcollections).
     */
    addToTotal(count: number): void {
        if (this.bar && count > 0) {
            this.bar.setTotal(this.bar.getTotal() + count);
        }
    }

    /**
     * Check if the progress bar is active.
     */
    get isActive(): boolean {
        return this.bar !== null;
    }
}
