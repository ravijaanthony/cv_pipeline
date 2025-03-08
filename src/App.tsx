import React from "react";
import axios from "axios";
import DragDropBox from "./DragDropBox";
import "./App.css";

function App() {
  // Function to send the dropped/selected file to the backend
  const sendToBackend = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      await axios.post("http://localhost:5000/upload", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      console.log("File sent:", file);
    } catch (error) {
      console.error("Error sending file:", error);
    }
  };

  return (
    <div className="app-container">
      <DragDropBox sendToBackend={sendToBackend} />
    </div>
  );
}

export default App;
