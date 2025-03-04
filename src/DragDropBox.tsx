import React, { useCallback } from "react";
import { useDropzone } from "react-dropzone";

interface DragDropBoxProps {
    sendToBackend: (file: File) => void; // Function to send dropped file to backend
}

const DragDropBox: React.FC<DragDropBoxProps> = ({ sendToBackend }) => {
    const [isDragActive, setIsDragActive] = React.useState(false);

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragActive(true);
    };

    const handleDragLeave = () => {
        setIsDragActive(false);
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragActive(false);

        const file = event.dataTransfer.files[0]; // Get the first file dropped
        if (file) {
            sendToBackend(file); // Send the file to the backend
        }
    };

    // const onDrop = useCallback((acceptedFiles: File[]) => {
    //     console.log("Files dropped:", acceptedFiles);
    //     // Handle the files (upload, preview, etc.)
    // }, []);

    // const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

    return (

        <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
                width: "300px",
                height: "200px",
                border: "2px dashed #ccc",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                borderRadius: "5px",
                padding: "20px",
                textAlign: "center",
                color: isDragActive ? "black" : "inherit",
                backgroundColor: isDragActive ? "#eee" : "inherit",
            }}
        >
            {isDragActive ? <p>Drop the file here...</p> : <p>Drag 'n' drop a file here, or click to select a file</p>}
        </div>
    );
};

export default DragDropBox;
