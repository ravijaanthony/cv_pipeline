import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import multer from "multer";
import path from "path";
import pdfParse from "pdf-parse/lib/pdf-parse.js"; // Import from internal file
import mammoth from "mammoth";

const app = express();
const PORT = 5000;

app.use(cors());
app.use(bodyParser.json());

// Use memory storage to access file buffer directly
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post("/upload", upload.single("file"), async (req, res) => {
    console.log("req.file:", req.file);
    console.log("Buffer exists?", req.file.buffer instanceof Buffer);

    if (!req.file) {
        return res.status(400).send("No files were uploaded.");
    }

    try {
        const fileExtension = path.extname(req.file.originalname).toLowerCase();
        let fileData;

        if (fileExtension === ".docx") {
            const result = await mammoth.extractRawText({ buffer: req.file.buffer });
            fileData = result.value;
        } else if (fileExtension === ".pdf") {
            const pdfResult = await pdfParse(req.file.buffer);
            fileData = pdfResult.text;
        } else {
            return res.status(400).send("Unsupported file format");
        }

        console.log("Full extracted text:", fileData);

        const extractedData = extractCVData(fileData);
        // console.log("Extracted data:", extractedData);

        res.json({ message: "File processed successfully", extractedData });
    } catch (error) {
        console.error("Error processing file:", error);
        res.status(500).send("Error processing file.");
    }
});

const extractCVData = (text) => {
    const data = {};
    const lines = text.split('\n').map(line => line.trim());

    lines.forEach(line => {
        const nameMatch = line.match(/^Name:\s*(.+)$/i);
        if (nameMatch) { data.name = nameMatch[1].trim(); }

        const emailMatch = line.match(/^Email:\s*(.+)$/i);
        if (emailMatch) { data.email = emailMatch[1].trim(); }

        const phoneMatch = line.match(/^Phone:\s*(.+)$/i);
        if (phoneMatch) { data.phone = phoneMatch[1].trim(); }

        const educationMatch = line.match(/^Education:\s*(.+)$/i);
        if (educationMatch) { data.education = educationMatch[1].trim(); }

        const qualificationMatch = line.match(/^Qualification:\s*(.+)$/i);
        if (qualificationMatch) { data.qualification = qualificationMatch[1].trim(); }

        const projectsMatch = line.match(/^Projects?:\s*(.+)$/i);
        if (projectsMatch) { data.projects = projectsMatch[1].trim(); }
    });

    return data;
};

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
