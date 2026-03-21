const uploads = new Map();
const UPLOAD_TTL_MS = 1000 * 60 * 30;

const clone = (value) => structuredClone(value);

const pruneExpiredUploads = () => {
    const cutoff = Date.now() - UPLOAD_TTL_MS;
    for (const [uploadId, snapshot] of uploads.entries()) {
        if (snapshot.updatedAt < cutoff) {
            uploads.delete(uploadId);
        }
    }
};

const createSnapshot = (uploadId) => {
    const now = Date.now();
    return {
        uploadId,
        createdAt: now,
        updatedAt: now,
        completed: false,
        currentStep: "queued",
        processingLog: [],
        status: {
            state: "running",
            sheetAppend: null,
            email: {
                status: "pending",
                recipient: ""
            }
        },
        error: null
    };
};

const getMutableSnapshot = (uploadId) => {
    let snapshot = uploads.get(uploadId);
    if (!snapshot) {
        snapshot = createSnapshot(uploadId);
        uploads.set(uploadId, snapshot);
    }
    return snapshot;
};

export const initUploadProgress = (uploadId) => {
    pruneExpiredUploads();
    const snapshot = createSnapshot(uploadId);
    uploads.set(uploadId, snapshot);
    return clone(snapshot);
};

export const addUploadLog = (uploadId, entry) => {
    const snapshot = getMutableSnapshot(uploadId);
    const logEntry = {
        id: snapshot.processingLog.length + 1,
        ...entry
    };
    snapshot.processingLog.push(logEntry);
    snapshot.currentStep = entry.step;
    snapshot.updatedAt = Date.now();
    return clone(logEntry);
};

export const updateUploadProgress = (uploadId, patch) => {
    const snapshot = getMutableSnapshot(uploadId);

    if (patch.currentStep) {
        snapshot.currentStep = patch.currentStep;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "completed")) {
        snapshot.completed = patch.completed;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "error")) {
        snapshot.error = patch.error;
    }

    if (patch.status) {
        snapshot.status = {
            ...snapshot.status,
            ...patch.status,
            sheetAppend: patch.status.sheetAppend ?? snapshot.status.sheetAppend,
            email: patch.status.email
                ? {
                    ...snapshot.status.email,
                    ...patch.status.email
                }
                : snapshot.status.email
        };
    }

    snapshot.updatedAt = Date.now();
    return clone(snapshot);
};

export const completeUploadProgress = (uploadId, patch = {}) => updateUploadProgress(uploadId, {
    ...patch,
    completed: true,
    status: {
        ...(patch.status || {}),
        state: patch.status?.state || "completed"
    }
});

export const failUploadProgress = (uploadId, errorMessage) => updateUploadProgress(uploadId, {
    completed: true,
    error: errorMessage,
    status: {
        state: "failed"
    }
});

export const getUploadProgress = (uploadId) => {
    pruneExpiredUploads();
    const snapshot = uploads.get(uploadId);
    return snapshot ? clone(snapshot) : null;
};
