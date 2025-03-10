import { useState } from "react";
import axios from "axios";
import DragDropBox from "./DragDropBox";
import "./App.css";


function App() {
  const [messages, setMessages] = useState<string[]>([]);

  // Function to send the dropped/selected file to the backend
  const sendToBackend = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      await axios.post( process.env.REACT_APP_API_URL as string, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      console.log("File sent:", file);

      setMessages((prevMessages) => [
        ...prevMessages,
        `File ${file.name} uploaded successfully`
      ]);
    } catch (error) {
      console.error("Error sending file:", error);
      setMessages((prevMessages) => [
        ...prevMessages,
        `Error uploading ${file.name}: ${error}`
      ]);
    }
  };

  return (
    <>
      <div className="app-container">
        <DragDropBox sendToBackend={sendToBackend} />

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
