import { useEffect, useRef, useState } from "react";
import axios from "axios";
import DragDropBox from "./DragDropBox";
import "./App.css";

interface UploadLogEntry {
  id?: number;
  step?: string;
  level?: string;
  timestamp?: string;
  details?: Record<string, unknown>;
}

interface EmailProgress {
  status?: string;
  recipient?: string;
  sendAt?: string;
  error?: string;
}

interface UploadProgress {
  uploadId: string;
  currentStep?: string;
  completed?: boolean;
  processingLog?: UploadLogEntry[];
  error?: string | null;
  status?: {
    state?: string;
    sheetAppend?: {
      success?: boolean;
      updatedRange?: string;
      error?: string;
    } | null;
    email?: EmailProgress | null;
  };
}

interface UploadResponse {
  message: string;
  uploadId: string;
  uploadProgress?: UploadProgress;
  extractedData?: {
    email?: string;
  };
  status?: {
    email?: EmailProgress;
    sheetAppend?: {
      success?: boolean;
      updatedRange?: string;
      error?: string;
    };
  };
}

const POLL_INTERVAL_MS = 1000;

function App() {
  const [messages, setMessages] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [liveProgress, setLiveProgress] = useState<UploadProgress | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);
  const lastSeenLogCountRef = useRef(0);
  const activeUploadIdRef = useRef<string | null>(null);

  const addMessage = (message: string) => {
    setMessages((prevMessages) => [...prevMessages, message]);
  };

  const stopPolling = () => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollInFlightRef.current = false;
  };

  const formatDetails = (details?: Record<string, unknown>) => {
    if (!details) {
      return "";
    }
    const entries = Object.entries(details);
    if (entries.length === 0) {
      return "";
    }
    return entries.map(([key, value]) => `${key}=${String(value)}`).join(" ");
  };

  const formatLogEntry = (entry: {
    step?: string;
    level?: string;
    timestamp?: string;
    details?: Record<string, unknown>;
  }) => {
    const time = entry.timestamp
      ? new Date(entry.timestamp).toLocaleTimeString()
      : "";
    const level = entry.level ? entry.level.toUpperCase() : "INFO";
    const detailText = formatDetails(entry.details);
    const detailSuffix = detailText ? ` ${detailText}` : "";
    return `${time} [${level}] ${entry.step ?? "event"}${detailSuffix}`;
  };

  const humanizeStep = (step?: string) => {
    if (!step) {
      return "Waiting to start";
    }
    return step.replace(/_/g, " ");
  };

  const applyUploadProgress = (progress: UploadProgress) => {
    if (activeUploadIdRef.current && progress.uploadId !== activeUploadIdRef.current) {
      return;
    }

    setLiveProgress(progress);

    const processingLog = progress.processingLog ?? [];
    const newEntries = processingLog.slice(lastSeenLogCountRef.current);
    newEntries.forEach((entry) => {
      addMessage(formatLogEntry(entry));
    });
    lastSeenLogCountRef.current = processingLog.length;

    if (progress.completed) {
      stopPolling();
    }
  };

  const pollUploadProgress = async (uploadId: string) => {
    if (pollInFlightRef.current) {
      return;
    }

    pollInFlightRef.current = true;
    try {
      const response = await axios.get<UploadProgress>(
        `${import.meta.env.VITE_REACT_APP_API_URL}/upload-status/${uploadId}`
      );
      applyUploadProgress(response.data);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status !== 404) {
        console.error("Error polling upload progress:", error);
      }
    } finally {
      pollInFlightRef.current = false;
    }
  };

  const startPolling = (uploadId: string) => {
    stopPolling();
    activeUploadIdRef.current = uploadId;
    lastSeenLogCountRef.current = 0;
    setLiveProgress({
      uploadId,
      currentStep: "upload_queued",
      completed: false,
      processingLog: [],
      status: {
        state: "running",
        sheetAppend: null,
        email: {
          status: "pending",
          recipient: ""
        }
      }
    });

    void pollUploadProgress(uploadId);
    pollTimerRef.current = window.setInterval(() => {
      void pollUploadProgress(uploadId);
    }, POLL_INTERVAL_MS);
  };

  useEffect(() => stopPolling, []);

  // Function to send the dropped/selected file to the backend
  const sendToBackend = async (file: File, uploadId: string) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("uploadId", uploadId);
    try {
      addMessage(`Uploading ${file.name}...`);
      const response = await axios.post<UploadResponse>(
        `${import.meta.env.VITE_REACT_APP_API_URL}/upload`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
            "X-Upload-Id": uploadId
          },
        }
      );
      console.log("File sent:", file);

      if (response.data.uploadId && response.data.uploadId !== uploadId) {
        activeUploadIdRef.current = response.data.uploadId;
        await pollUploadProgress(response.data.uploadId);
      }

      if (!response.data.uploadProgress) {
        setLiveProgress((previous) => previous ? {
          ...previous,
          completed: true,
          currentStep: "upload_completed",
          status: {
            ...previous.status,
            state: "completed",
            sheetAppend: response.data.status?.sheetAppend || previous.status?.sheetAppend || null,
            email: {
              ...(previous.status?.email || {}),
              ...(response.data.status?.email || {}),
              recipient: response.data.status?.email?.recipient
                || response.data.extractedData?.email
                || previous.status?.email?.recipient
                || ""
            }
          }
        } : previous);
      }

      addMessage(`File ${file.name} uploaded successfully`);
      if (response.data.uploadProgress) {
        applyUploadProgress(response.data.uploadProgress);
      } else {
        await pollUploadProgress(uploadId);
      }
    } catch (error) {
      console.error("Error sending file:", error);
      addMessage(`Error uploading ${file.name}: ${String(error)}, url: ${import.meta.env.VITE_REACT_APP_API_URL}/upload`);
      if (axios.isAxiosError(error)) {
        const uploadProgress = error.response?.data?.uploadProgress as UploadProgress | undefined;
        if (uploadProgress) {
          applyUploadProgress(uploadProgress);
        }
      }
    } finally {
      await pollUploadProgress(uploadId);
    }
  };

  const handleFileSelected = (file: File) => {
    setSelectedFile(file);
    addMessage(`Selected ${file.name}`);
  };

  const handleSubmit = async () => {
    if (!selectedFile || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    const uploadId = crypto.randomUUID();
    setMessages([`Selected ${selectedFile.name}`]);
    startPolling(uploadId);
    await sendToBackend(selectedFile, uploadId);
    setIsSubmitting(false);
  };

  const currentStep = humanizeStep(liveProgress?.currentStep);
  const emailRecipient = liveProgress?.status?.email?.recipient || "Waiting for CV email extraction";
  const emailStatus = liveProgress?.status?.email?.status || "pending";
  const sheetStatus = liveProgress?.status?.sheetAppend?.success
    ? "updated"
    : liveProgress?.status?.sheetAppend?.error
      ? `failed: ${liveProgress.status.sheetAppend.error}`
      : "pending";
  const uploadState = liveProgress?.status?.state || (isSubmitting ? "running" : "idle");

  return (
    <>
      <div className="app-container">
        <DragDropBox onFileSelected={handleFileSelected} />
        <div className="actions">
          <div className="selected-file">
            {selectedFile ? `Selected: ${selectedFile.name}` : "No file selected"}
          </div>
          <button
            className="submit-button"
            type="button"
            onClick={handleSubmit}
            disabled={!selectedFile || isSubmitting}
          >
            {isSubmitting ? "Submitting..." : "Submit"}
          </button>
        </div>

        <div className="status-card">
          <div className="status-row">
            <span className="status-label">Upload ID</span>
            <span className="status-value">{liveProgress?.uploadId ?? "Not started yet"}</span>
          </div>
          <div className="status-row">
            <span className="status-label">Current Step</span>
            <span className="status-value">{currentStep}</span>
          </div>
          <div className="status-row">
            <span className="status-label">Upload State</span>
            <span className="status-value">{uploadState}</span>
          </div>
          <div className="status-row">
            <span className="status-label">Sheet</span>
            <span className="status-value">{sheetStatus}</span>
          </div>
          <div className="status-row">
            <span className="status-label">Email To</span>
            <span className="status-value">{emailRecipient}</span>
          </div>
          <div className="status-row">
            <span className="status-label">Email Status</span>
            <span className="status-value">
              {emailStatus}
              {liveProgress?.status?.email?.sendAt ? ` at ${new Date(liveProgress.status.email.sendAt).toLocaleTimeString()}` : ""}
              {liveProgress?.status?.email?.error ? ` (${liveProgress.status.email.error})` : ""}
            </span>
          </div>
        </div>

        <div className="message-box">
          {messages.length > 0 ? (
            messages.map((message, index) => (
              <div key={index} className="message">
                {message}
              </div>
            ))
          ) : (
            <p>No messages to display</p>
          )}
        </div>
      </div>
    </>

  );
}

export default App;
