/** Error with optional Firebase/gRPC error code */
export interface FirebaseError extends Error {
    code?: string;
}

export interface FirebaseErrorInfo {
    message: string;
    suggestion?: string;
}

const errorMap: Record<string, FirebaseErrorInfo> = {
    // Authentication errors
    'auth/invalid-credential': {
        message: 'Invalid credentials',
        suggestion: 'Run "gcloud auth application-default login" to authenticate',
    },
    'app/invalid-credential': {
        message: 'Invalid application credentials',
        suggestion: 'Run "gcloud auth application-default login" to authenticate',
    },

    // Permission errors
    'permission-denied': {
        message: 'Permission denied',
        suggestion: 'Ensure you have Firestore read/write access on this project',
    },
    PERMISSION_DENIED: {
        message: 'Permission denied',
        suggestion: 'Ensure you have Firestore read/write access on this project',
    },

    // Network errors
    unavailable: {
        message: 'Service unavailable',
        suggestion: 'Check your internet connection and try again',
    },
    UNAVAILABLE: {
        message: 'Service unavailable',
        suggestion: 'Check your internet connection and try again',
    },

    // Not found errors
    'not-found': {
        message: 'Resource not found',
        suggestion: 'Verify the project ID and collection path are correct',
    },
    NOT_FOUND: {
        message: 'Resource not found',
        suggestion: 'Verify the project ID and collection path are correct',
    },

    // Quota errors
    'resource-exhausted': {
        message: 'Quota exceeded',
        suggestion: 'Try reducing --batch-size or --parallel, or wait and retry later',
    },
    RESOURCE_EXHAUSTED: {
        message: 'Quota exceeded',
        suggestion: 'Try reducing --batch-size or --parallel, or wait and retry later',
    },

    // Invalid argument errors
    'invalid-argument': {
        message: 'Invalid argument',
        suggestion: 'Check your query filters and document data',
    },
    INVALID_ARGUMENT: {
        message: 'Invalid argument',
        suggestion: 'Check your query filters and document data',
    },

    // Deadline exceeded
    'deadline-exceeded': {
        message: 'Request timeout',
        suggestion: 'Try reducing --batch-size or check your network connection',
    },
    DEADLINE_EXCEEDED: {
        message: 'Request timeout',
        suggestion: 'Try reducing --batch-size or check your network connection',
    },

    // Already exists
    'already-exists': {
        message: 'Document already exists',
        suggestion: 'Use --merge option to update existing documents',
    },
    ALREADY_EXISTS: {
        message: 'Document already exists',
        suggestion: 'Use --merge option to update existing documents',
    },

    // Aborted
    aborted: {
        message: 'Operation aborted',
        suggestion: 'A concurrent operation conflicted. Retry the transfer',
    },
    ABORTED: {
        message: 'Operation aborted',
        suggestion: 'A concurrent operation conflicted. Retry the transfer',
    },
};

export function formatFirebaseError(error: FirebaseError): FirebaseErrorInfo {
    // Check by error code first
    if (error.code) {
        const mapped = errorMap[error.code];
        if (mapped) {
            return mapped;
        }
    }

    // Check by error message keywords
    const message = error.message.toLowerCase();

    if (message.includes('credential') || message.includes('authentication')) {
        return errorMap['app/invalid-credential'];
    }
    if (message.includes('permission') || message.includes('denied')) {
        return errorMap['permission-denied'];
    }
    if (message.includes('unavailable') || message.includes('network')) {
        return errorMap['unavailable'];
    }
    if (message.includes('not found') || message.includes('not_found')) {
        return errorMap['not-found'];
    }
    if (message.includes('quota') || message.includes('exhausted') || message.includes('rate')) {
        return errorMap['resource-exhausted'];
    }
    if (message.includes('timeout') || message.includes('deadline')) {
        return errorMap['deadline-exceeded'];
    }

    // Default: return original message
    return {
        message: error.message,
    };
}

export function logFirebaseError(
    error: FirebaseError,
    context: string,
    logger?: { error: (msg: string, data?: Record<string, unknown>) => void }
): void {
    const info = formatFirebaseError(error);

    console.error(`\n❌ ${context}: ${info.message}`);
    if (info.suggestion) {
        console.error(`   Hint: ${info.suggestion}`);
    }
    if (error.code) {
        console.error(`   Code: ${error.code}`);
    }

    if (logger) {
        logger.error(`${context}: ${info.message}`, {
            code: error.code,
            originalMessage: error.message,
            suggestion: info.suggestion,
        });
    }
}
