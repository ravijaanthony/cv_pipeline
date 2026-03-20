import { useState } from "react";
import axios from "axios";
import DragDropBox from "./DragDropBox";
import "./App.css";


function App() {
  const [messages, setMessages] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addMessage = (message: string) => {
    setMessages((prevMessages) => [...prevMessages, message]);
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

  // Function to send the dropped/selected file to the backend
  const sendToBackend = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      addMessage(`Uploading ${file.name}...`);
      const response = await axios.post(
        `${import.meta.env.VITE_REACT_APP_API_URL}/upload`,
        
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });
      console.log("File sent:", file);

      addMessage(`File ${file.name} uploaded successfully`);

      const processingLog = response.data?.processingLog;
      if (Array.isArray(processingLog)) {
        processingLog.forEach((entry) => {
          addMessage(formatLogEntry(entry));
        });
      }

      const status = response.data?.status;
      if (status?.externalApi) {
        addMessage(
          status.externalApi.success
            ? "External API: success"
            : `External API: failed ${status.externalApi.error ? `(${status.externalApi.error})` : ""}`
        );
      }
      if (status?.sheetAppend) {
        addMessage(
          status.sheetAppend.success
            ? "Google Sheet: updated"
            : `Google Sheet: failed ${status.sheetAppend.error ? `(${status.sheetAppend.error})` : ""}`
        );
      }
      if (status?.email) {
        if (status.email.status === "scheduled") {
          addMessage(`Email scheduled for ${status.email.sendAt}`);
        } else if (status.email.status === "sent") {
          addMessage("Email sent successfully");
        } else if (status.email.status === "skipped") {
          addMessage(`Email not scheduled: ${status.email.reason}`);
        } else if (status.email.status === "failed") {
          addMessage(`Email failed: ${status.email.error ?? "unknown error"}`);
        }
      }
    } catch (error) {
      console.error("Error sending file:", error);
      addMessage(`Error uploading ${file.name}: ${String(error)}, url: ${import.meta.env.VITE_REACT_APP_API_URL}/upload`);
      if (axios.isAxiosError(error)) {
        const processingLog = error.response?.data?.processingLog;
        if (Array.isArray(processingLog)) {
          processingLog.forEach((entry) => {
            addMessage(formatLogEntry(entry));
          });
        }
        const status = error.response?.data?.status;
        if (status?.externalApi) {
          addMessage(
            status.externalApi.success
              ? "External API: success"
              : `External API: failed ${status.externalApi.error ? `(${status.externalApi.error})` : ""}`
          );
        }
        if (status?.sheetAppend) {
          addMessage(
            status.sheetAppend.success
              ? "Google Sheet: updated"
              : `Google Sheet: failed ${status.sheetAppend.error ? `(${status.sheetAppend.error})` : ""}`
          );
        }
        if (status?.email) {
          if (status.email.status === "scheduled") {
            addMessage(`Email scheduled for ${status.email.sendAt}`);
          } else if (status.email.status === "sent") {
            addMessage("Email sent successfully");
          } else if (status.email.status === "skipped") {
            addMessage(`Email not scheduled: ${status.email.reason}`);
          } else if (status.email.status === "failed") {
            addMessage(`Email failed: ${status.email.error ?? "unknown error"}`);
          }
        }
      }
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
    await sendToBackend(selectedFile);
    setIsSubmitting(false);
  };

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
