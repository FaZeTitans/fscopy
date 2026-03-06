/**
 * Application-wide constants.
 * Centralizes magic numbers for better maintainability.
 */

// =============================================================================
// Display Constants
// =============================================================================

/** Width for separator lines and progress line clearing */
export const SEPARATOR_LENGTH = 60;

// =============================================================================
// Timing Constants
// =============================================================================

/** Interval for logging subcollection/progress updates during scanning (ms) */
export const PROGRESS_LOG_INTERVAL_MS = 2000;

/** Interval for updating speed display in progress bar (ms) */
export const SPEED_UPDATE_INTERVAL_MS = 500;

/** Interval for flushing batched progress bar increments (ms) */
export const PROGRESS_FLUSH_INTERVAL_MS = 50;

/** Default interval for auto-saving transfer state (ms) */
export const STATE_SAVE_INTERVAL_MS = 5000;

/** Default number of batches between state saves */
export const STATE_SAVE_BATCH_INTERVAL = 10;

// =============================================================================
// Validation Limits
// =============================================================================

/** Maximum Firestore batch size */
export const MAX_BATCH_SIZE = 500;

/** Maximum parallel transfers */
export const MAX_PARALLEL = 20;

/** Maximum subcollection recursion depth */
export const MAX_DEPTH = 100;

/** Maximum retry attempts */
export const MAX_RETRIES = 10;

// =============================================================================
// Webhook Constants
// =============================================================================

/** Webhook request timeout in milliseconds */
export const WEBHOOK_TIMEOUT_MS = 30_000;

/** Maximum webhook payload size in bytes (Discord limit) */
export const WEBHOOK_MAX_PAYLOAD_BYTES = 2_000_000;

/** Maximum webhook retry attempts */
export const WEBHOOK_MAX_RETRIES = 2;

/** Webhook retry base delay in milliseconds */
export const WEBHOOK_RETRY_DELAY_MS = 1_000;

// =============================================================================
// Clear Collection Constants
// =============================================================================

/** Page size for paginated collection clearing */
export const CLEAR_PAGE_SIZE = 500;
