import React, { useRef, useState } from "react";

interface DragDropBoxProps {
  onFileSelected: (file: File) => void;
}

const DragDropBox: React.FC<DragDropBoxProps> = ({ onFileSelected }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);

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
      onFileSelected(file);
      event.dataTransfer.clearData();
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      onFileSelected(event.target.files[0]);
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
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleClick();
          }
        }}
      >
        <div className="drop-zone-graphic">
          <span className="drop-zone-dot" />
          <span className="drop-zone-dot drop-zone-dot-small" />
        </div>

        <div className="drop-zone-copy">
          <p className="drop-zone-kicker">Drag and drop</p>
          <h3>Bring a CV into the pipeline</h3>
          <p className="drop-zone-text">
            Drop a resume here or browse your files to start the full backend run.
          </p>
        </div>

        <button className="file-select-button" type="button">
          Browse file
        </button>

        <div className="drop-zone-meta">
          <span>Accepted formats: PDF, DOC, DOCX</span>
          <span>Live backend status after submit</span>
        </div>

        <input
          type="file"
          ref={fileInputRef}
          className="visually-hidden-input"
          onChange={handleFileSelect}
          accept=".pdf,.doc,.docx"
        />
      </div>
    </div>
  );
};

export default DragDropBox;
