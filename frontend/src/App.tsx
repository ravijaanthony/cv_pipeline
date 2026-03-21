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

type StageState = "pending" | "active" | "done" | "error";

interface PipelineStage {
  id: string;
  label: string;
  caption: string;
  steps: string[];
  successSteps?: string[];
  failureSteps?: string[];
}

const POLL_INTERVAL_MS = 1000;

const PIPELINE_STAGES: PipelineStage[] = [
  {
    id: "intake",
    label: "Intake",
    caption: "File lands in the pipeline",
    steps: ["upload_queued", "upload_received", "file_received"],
    successSteps: ["file_received"],
  },
  {
    id: "extract",
    label: "Extract",
    caption: "Resume text and details parsed",
    steps: ["file_parsed", "cv_extracted"],
    successSteps: ["cv_extracted"],
  },
  {
    id: "drive",
    label: "Drive",
    caption: "Stored and shared in Google Drive",
    steps: [
      "drive_upload_started",
      "drive_uploaded",
      "drive_permissions_set",
      "drive_link_ready",
    ],
    successSteps: ["drive_link_ready"],
  },
  {
    id: "sheet",
    label: "Sheet",
    caption: "Spreadsheet row appended",
    steps: ["sheet_append_started", "sheet_append_success", "sheet_append_failed"],
    successSteps: ["sheet_append_success"],
    failureSteps: ["sheet_append_failed"],
  },
  {
    id: "email",
    label: "Email",
    caption: "Candidate follow-up sent",
    steps: ["email_send_started", "email_sent_success", "email_send_failed"],
    successSteps: ["email_sent_success"],
    failureSteps: ["email_send_failed"],
  },
];

function App() {
  const [messages, setMessages] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [liveProgress, setLiveProgress] = useState<UploadProgress | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);
  const lastSeenLogCountRef = useRef(0);
  const activeUploadIdRef = useRef<string | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

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

  const formatLogEntry = (entry: UploadLogEntry) => {
    const time = entry.timestamp
      ? new Date(entry.timestamp).toLocaleTimeString()
      : "";
    const level = entry.level ? entry.level.toUpperCase() : "INFO";
    const detailText = formatDetails(entry.details);
    const detailSuffix = detailText ? ` ${detailText}` : "";

    return `${time} [${level}] ${entry.step ?? "event"}${detailSuffix}`;
  };

  const humanizeText = (value?: string) => {
    if (!value) {
      return "Waiting to start";
    }

    return value
      .replace(/_/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase());
  };

  const formatFileSize = (fileSize?: number) => {
    if (!fileSize) {
      return "No file selected";
    }

    const units = ["B", "KB", "MB", "GB"];
    let size = fileSize;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }

    return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  };

  const getTone = (status?: string) => {
    const normalized = (status || "").toLowerCase();

    if (
      normalized.includes("success")
      || normalized.includes("sent")
      || normalized.includes("updated")
      || normalized.includes("completed")
      || normalized.includes("done")
    ) {
      return "success";
    }

    if (
      normalized.includes("fail")
      || normalized.includes("error")
      || normalized.includes("timeout")
    ) {
      return "danger";
    }

    if (
      normalized.includes("running")
      || normalized.includes("started")
      || normalized.includes("uploading")
      || normalized.includes("sending")
    ) {
      return "active";
    }

    return "muted";
  };

  const hasStageStep = (stage: PipelineStage, logSteps: Set<string>, currentStep?: string) =>
    stage.steps.some((step) => logSteps.has(step)) || Boolean(currentStep && stage.steps.includes(currentStep));

  const getStageState = (stage: PipelineStage, stageIndex: number, progress: UploadProgress | null): StageState => {
    if (!progress) {
      return "pending";
    }

    const currentStep = progress.currentStep;
    const logSteps = new Set(
      (progress.processingLog ?? [])
        .map((entry) => entry.step)
        .filter((step): step is string => Boolean(step))
    );

    const currentStageIndex = PIPELINE_STAGES.findIndex((pipelineStage) =>
      currentStep ? pipelineStage.steps.includes(currentStep) : false
    );
    const laterStageStarted = PIPELINE_STAGES.slice(stageIndex + 1).some((pipelineStage) =>
      hasStageStep(pipelineStage, logSteps, currentStep)
    );
    const stageHasStarted = hasStageStep(stage, logSteps, currentStep);
    const stageFailed = stage.failureSteps?.some((step) => logSteps.has(step))
      || (stage.id === "sheet" && Boolean(progress.status?.sheetAppend?.error))
      || (stage.id === "email" && progress.status?.email?.status === "failed");
    const stageSucceeded = stage.successSteps?.some((step) => logSteps.has(step))
      || (stage.id === "sheet" && Boolean(progress.status?.sheetAppend?.success))
      || (stage.id === "email" && ["sent", "skipped"].includes(progress.status?.email?.status || ""));

    if (stageFailed) {
      return "error";
    }

    if (stageSucceeded || laterStageStarted) {
      return "done";
    }

    if (stageHasStarted || currentStageIndex === stageIndex || (stageIndex === 0 && !progress.completed)) {
      return "active";
    }

    return "pending";
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
          recipient: "",
        },
      },
    });

    void pollUploadProgress(uploadId);
    pollTimerRef.current = window.setInterval(() => {
      void pollUploadProgress(uploadId);
    }, POLL_INTERVAL_MS);
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages]);

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
            "X-Upload-Id": uploadId,
          },
        }
      );

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
                || "",
            },
          },
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
      addMessage(
        `Error uploading ${file.name}: ${String(error)}, url: ${import.meta.env.VITE_REACT_APP_API_URL}/upload`
      );

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

  const currentStep = humanizeText(liveProgress?.currentStep);
  const emailProgress = liveProgress?.status?.email;
  const emailRecipient = emailProgress?.recipient || "Waiting for CV email extraction";
  const emailStatus = emailProgress?.status || "pending";
  const emailStatusNote = emailProgress?.sendAt
    ? `Sent at ${new Date(emailProgress.sendAt).toLocaleTimeString()}`
    : emailProgress?.error || "Will update when the backend reaches the email step";
  const sheetAppend = liveProgress?.status?.sheetAppend;
  const sheetStatus = sheetAppend?.success ? "updated" : sheetAppend?.error ? "failed" : "pending";
  const sheetStatusNote = sheetAppend?.updatedRange
    ? `Updated ${sheetAppend.updatedRange}`
    : sheetAppend?.error || "Waiting for sheet append";
  const uploadState = liveProgress?.status?.state || (isSubmitting ? "running" : "idle");
  const uploadStateNote = liveProgress?.error || "Live backend events stream into this dashboard";
  const latestMessage = messages[messages.length - 1] || "No backend activity yet";
  const stageItems = PIPELINE_STAGES.map((stage, index) => ({
    ...stage,
    state: getStageState(stage, index, liveProgress),
  }));
  const lastEventTime = liveProgress?.processingLog?.at(-1)?.timestamp
    ? new Date(liveProgress.processingLog.at(-1)!.timestamp!).toLocaleTimeString()
    : "Waiting for activity";

  return (
    <div className="app-shell">
      <div className="ambient-orb ambient-orb-left" />
      <div className="ambient-orb ambient-orb-right" />

      <main className="app-container">
        <section className="hero-panel">
          <div className="hero-copy-block">
            <p className="eyebrow">CV Pipeline</p>
            <h1>Review uploads with a dashboard that actually feels alive.</h1>
            <p className="hero-copy">
              Drop a resume, trigger the backend, and watch parsing, Drive sync,
              spreadsheet updates, and candidate email delivery unfold in one place.
            </p>
          </div>

          <div className="workspace-card">
            <div className="card-heading">
              <div>
                <p className="section-kicker">Upload Workspace</p>
                <h2>Start a new candidate run</h2>
              </div>
              <span className="mini-badge">PDF / DOC / DOCX</span>
            </div>

            <DragDropBox onFileSelected={handleFileSelected} />

            <div className="selection-card">
              <div className="selection-meta">
                <span className="selection-label">Selected file</span>
                <strong>{selectedFile?.name || "Nothing chosen yet"}</strong>
              </div>
              <div className="selection-meta">
                <span className="selection-label">Size</span>
                <strong>{formatFileSize(selectedFile?.size)}</strong>
              </div>
            </div>

            <div className="actions">
              <button
                className="submit-button"
                type="button"
                onClick={handleSubmit}
                disabled={!selectedFile || isSubmitting}
              >
                {isSubmitting ? "Submitting..." : "Submit CV"}
              </button>
              <p className="action-note">
                {selectedFile
                  ? "The frontend will start polling the backend as soon as you submit."
                  : "Choose a CV to unlock the live monitor."}
              </p>
            </div>
          </div>
        </section>

        <section className="monitor-panel">
          <div className="overview-card">
            <div className="card-heading">
              <div>
                <p className="section-kicker">Live Monitor</p>
                <h2>Backend progress</h2>
              </div>
              <span className={`status-pill tone-${getTone(uploadState)}`}>
                {humanizeText(uploadState)}
              </span>
            </div>

            <div className="metric-grid">
              <article className="metric-card">
                <span className="metric-label">Current step</span>
                <strong className="metric-value">{currentStep}</strong>
                <span className="metric-note">{latestMessage}</span>
              </article>

              <article className="metric-card">
                <span className="metric-label">Sheet status</span>
                <strong className="metric-value">
                  <span className={`status-pill tone-${getTone(sheetStatus)}`}>
                    {humanizeText(sheetStatus)}
                  </span>
                </strong>
                <span className="metric-note">{sheetStatusNote}</span>
              </article>

              <article className="metric-card">
                <span className="metric-label">Email status</span>
                <strong className="metric-value">
                  <span className={`status-pill tone-${getTone(emailStatus)}`}>
                    {humanizeText(emailStatus)}
                  </span>
                </strong>
                <span className="metric-note">{emailStatusNote}</span>
              </article>

              <article className="metric-card">
                <span className="metric-label">Email recipient</span>
                <strong className="metric-value metric-break">{emailRecipient}</strong>
                <span className="metric-note">
                  Extracted from the CV when parsing succeeds
                </span>
              </article>
            </div>

            <div className="info-strip">
              <div className="info-item">
                <span className="info-label">Upload ID</span>
                <span className="info-value info-mono">
                  {liveProgress?.uploadId ?? "Not started yet"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Last event</span>
                <span className="info-value">{lastEventTime}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Pipeline note</span>
                <span className="info-value">{uploadStateNote}</span>
              </div>
            </div>

            <div className="stage-tracker">
              {stageItems.map((stage, index) => (
                <div key={stage.id} className={`stage-card stage-${stage.state}`}>
                  <div className="stage-marker">{String(index + 1).padStart(2, "0")}</div>
                  <div>
                    <p className="stage-label">{stage.label}</p>
                    <p className="stage-caption">{stage.caption}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="activity-card">
            <div className="card-heading">
              <div>
                <p className="section-kicker">Activity Feed</p>
                <h2>Backend events</h2>
              </div>
              <span className="mini-badge">{messages.length} events</span>
            </div>

            <div className="latest-event-card">
              <span className="latest-event-label">Latest activity</span>
              <p>{latestMessage}</p>
            </div>

            <div ref={messageListRef} className="message-box">
              {messages.length > 0 ? (
                messages.map((message, index) => (
                  <div key={`${message}-${index}`} className="message-row">
                    <span className="message-index">{String(index + 1).padStart(2, "0")}</span>
                    <div className="message">{message}</div>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <p>No backend events yet.</p>
                  <span>Upload a file to start the live feed.</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
