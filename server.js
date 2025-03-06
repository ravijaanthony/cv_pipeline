import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import multer from "multer";
import path from "path";
import pdfParse from "pdf-parse/lib/pdf-parse.js"; // Import from internal file
import mammoth from "mammoth";
import axios from "axios"; // Import axios to send requests from server side
import { google } from "googleapis";
import stream from "stream";

const app = express();
const PORT = 5000;

app.use(cors());
app.use(bodyParser.json());


// Use memory storage to access file buffer directly
const storage = multer.memoryStorage();
const upload = multer({ storage });


// Google Drive authentication using service account
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const auth = new google.auth.GoogleAuth({
    keyFile: './cv-pipeline-01-92372bcf22b4.json', // Update with your credentials file path
    scopes: SCOPES,
});
const drive = google.drive({ version: 'v3', auth });


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
        console.log("Extracted data:", extractedData);

        // res.json({ message: "File processed successfully", extractedData });

        // Convert the file buffer to a readable stream
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);

        // Define file metadata for Drive
        const fileMetadata = {
            name: req.file.originalname,
            parents: ['1SyBij1koqegqOFZzG-sIJ4ZMLWkH-q9l'], // Google Drive folder ID
        };

        //Upload the file to Google Drive
        const driveResponse = await drive.files.create({
            resource: fileMetadata,
            media: {
                mimeType: req.file.mimetype,
                body: bufferStream,
            },
            fields: 'id',
        });

        const driveFileId = driveResponse.data.id;
        console.log("Google Drive File Id:", driveFileId);



        const payload = {
            cv_data: {
                personal_info: {
                    name: extractedData.name || "",
                    email: extractedData.email || "",
                    phone: extractedData.phone || ""
                },
                education: extractedData.education ? [extractedData.education] : [],
                qualifications: extractedData.qualification ? (Array.isArray(extractedData.qualification)
                    ? extractedData.qualification
                    : [extractedData.qualification])
                    : [],
                projects: extractedData.projects ? [extractedData.projects] : [],
                cv_public_link: "https://www.example.com/cv.pdf"
            },
            metadata: {
                applicant_name: extractedData.name || "",
                email: extractedData.email || "",
                status: "prod",
                cv_processed: true,
                processed_timestamp: new Date().toISOString()
            }

        };
        let externalResult;
        try {
            const externalResponse = await axios.post(
                "https://rnd-assignment.automations-3d6.workers.dev/",
                payload, {
                headers: {
                    "Content-Type": "application/json",
                    "X-Candidate-Email": "ravijaanthonye@gmail.com"
                }
            }
            );

            console.log("External API response:", externalResponse.data);
            externalResult = externalResponse.data;



        } catch (error) {
            console.error("Error sending payload to external endpoint:", error);
            externalResult = { error: "External API call failed", details: externalError.message };
        }

        res.json({
            message: "File processed successfully",
            fileId: driveFileId,
            extractedData,
            externalResult,
        });

    } catch (error) {
        console.error("Error processing file:", error);
        if (!res.headersSent) {
            res.status(500).send("Error processing file.");
        }
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
