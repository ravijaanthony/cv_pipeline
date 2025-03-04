// import { useState } from "react";
import axios from "axios";
import DragDropBox from "./DragDropBox";

function App() {


  // Funcition to dropped data to backend
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
    }
    catch (error) {
      console.error("Error sending file:", error);
    }
  };

  return (
    <>

      <div style={{ padding: "20px" }}>
        <DragDropBox sendToBackend={sendToBackend} />
      </div>

    </>

  );
}

export default App;
