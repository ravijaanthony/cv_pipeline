import React, { useRef, useState } from "react";

interface DragDropBoxProps {
  sendToBackend: (file: File) => void;
}

const DragDropBox: React.FC<DragDropBoxProps> = ({ sendToBackend }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  // Handle drag events
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = () => setIsDragActive(false);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      sendToBackend(file);
      event.dataTransfer.clearData();
    }
  };

  // Handle file selection via click
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      sendToBackend(event.target.files[0]);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="drag-drop-box">
      <div
        className={`drop-zone ${isDragActive ? "active" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <button className="file-select-button" type="button">
          <span className="upload-icon" />
          Select a file
        </button>
        <span className="drag-text">or <br/>Drag and drop a file here (.pdf .docx)</span>
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={handleFileSelect}
          accept=".pdf,.doc,.docx"
        />
      </div>
    </div>
  );
};

export default DragDropBox;
