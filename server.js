import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import multer from "multer";


const app = express();
const PORT = 5000;

app.use(cors());
app.use(bodyParser.json());

// Set up multer for file upload
const upload = multer({ dest: "uploads/" });

app.post("/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).send("No files were uploaded.");
    }
    console.log("Received:", req.file);
    res.send({ message: "File uploaded successfully!", file: req.file });

});


// app.post("/send-text", (req, res) => {
//     console.log("Received:", req.body.text);
//     res.json({ message: "Text received!" });
// });

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
