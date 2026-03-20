import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import multer from "multer";
import path from "path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import axios from "axios";
import { google } from "googleapis";
import stream from "stream";
import fs from "fs";
import nodemailer from "nodemailer";
import schedule from "node-schedule";
import { Storage } from '@google-cloud/storage';
import dotenv from "dotenv";

dotenv.config();

const requiredEnv = (name) => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing ${name} environment variable`);
    }
    return value;
};

const loadGoogleCredentials = () => {
    const base64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
    if (base64) {
        return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
    }

    const keyFilePath = process.env.GOOGLE_API_KEY_FILE;
    if (keyFilePath) {
        return JSON.parse(fs.readFileSync(keyFilePath, "utf8"));
    }

    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_BASE64 or GOOGLE_API_KEY_FILE environment variable");
};

const googleCredentials = loadGoogleCredentials();

const driveFolderId = requiredEnv("GOOGLE_DRIVE_FOLDER_ID");
const spreadsheetId = requiredEnv("SPREADSHEET_ID");
// const externalApiUrl = requiredEnv("EXTERNAL_API_URL");
const externalApiCandidateEmail = requiredEnv("EXTERNAL_API_CANDIDATE_EMAIL");
const emailService = requiredEnv("EMAIL_SERVICE");
const emailUser = requiredEnv("EMAIL_USER");
const emailPass = requiredEnv("EMAIL_PASS");
const emailDelayMinutes = Number.isFinite(Number(process.env.EMAIL_SEND_DELAY_MINUTES))
    ? Number(process.env.EMAIL_SEND_DELAY_MINUTES)
    : 0;

const storageKey = new Storage({
    projectId: googleCredentials.project_id,
    credentials: googleCredentials
});

const app = express();
app.use(cors());
app.use(bodyParser.json());
const PORT = process.env.PORT || 5001;

// app.use(cors({
//     // origin: 'https://cv-pipeline-frontend-8a53s4vkk-ravijaanthonys-projects.vercel.app'
//     // origin: 'http://localhost:5000'
// }));


// Use memory storage so that we can work directly with the file buffer
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Google Drive authentication using service account
const SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets"
];
const auth = new google.auth.GoogleAuth({
    credentials: googleCredentials,
    scopes: SCOPES
});

const drive = google.drive({ version: "v3", auth });
const sheets = google.sheets({ version: "v4", auth });

/**
 * Extracts CV data by splitting text into lines and grouping by section labels.
 * Assumes that personal info appears before the first label.
 */
const extractCVData = (text) => {
    try {
        const data = {};

        // Define the list of known labels (all in lowercase)
        // You can add synonyms or variations here as needed.
        const labelList = [
            "summary",
            "projects",
            "techinal skills",
            "technical skills",
            "experience",
            "soft skills",
            "education",
            "achievements",
            "participation",
            "references"
        ];

        // Split text into non-empty, trimmed lines
        const lines = text.split("\n").map(line => line.trim()).filter(line => line);

        // Find the index of the first occurrence of any label.
        let firstLabelIndex = lines.findIndex(line =>
            labelList.some(label => line.toLowerCase().startsWith(label))
        );

        // Use the lines before the first label as personal info.
        const personalInfoLines =
            firstLabelIndex > 0 ? lines.slice(0, firstLabelIndex) : [];

        // Assume the first line of personal info is the candidate's name.
        if (personalInfoLines.length > 0) {
            data.name = personalInfoLines[0];
        }
        // (Optional) You could store the remaining personal info in a separate field.
        data.personal_info =
            personalInfoLines.length > 1
                ? personalInfoLines.slice(1).join("\n")
                : "";

        // Extract email and phone using regex on the full text.
        const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
        const phonePattern = /\+?\d[\d\s\-]+/;
        const emailMatch = text.match(emailPattern);
        data.email = emailMatch ? emailMatch[0] : "";
        const phoneMatch = text.match(phonePattern);
        data.phone = phoneMatch ? phoneMatch[0] : "";

        // Process the lines starting from the first label.
        let currentLabel = "";
        for (let i = firstLabelIndex; i < lines.length; i++) {
            const line = lines[i];
            // Check if the line starts with any known label.
            const foundLabel = labelList.find(label =>
                line.toLowerCase().startsWith(label)
            );
            if (foundLabel) {
                // New section found. Set the current label.
                currentLabel = foundLabel;
                // Remove the label text from the line (and any following punctuation or spaces)
                const content = line.substring(foundLabel.length).replace(/^[:\-\s]+/, "");
                // Start this section’s content.
                data[currentLabel] = content;
            } else if (currentLabel) {
                // Append subsequent lines to the current section.
                data[currentLabel] += "\n" + line;
            }
        }

        // Trim whitespace from each extracted field.
        Object.keys(data).forEach((key) => {
            if (typeof data[key] === "string") {
                data[key] = data[key].trim();
            }
        });

        return data;
    } catch (error) {
        console.error("Error extracting CV data:", error);
        return { error: "Error extracting CV data", details: error.message };
    }
};
let fileName;

app.post("/upload", upload.single("file"), async (req, res) => {
    const processingLog = [];
    const logStep = (step, details = {}, level = "info") => {
        const entry = {
            step,
            level,
            timestamp: new Date().toISOString(),
            details
        };
        processingLog.push(entry);
        const logFn = level === "error" ? console.error : console.log;
        if (Object.keys(details).length > 0) {
            logFn(`[${entry.timestamp}] ${step}`, details);
        } else {
            logFn(`[${entry.timestamp}] ${step}`);
        }
    };

    try {
        logStep("upload_received");
        if (!req.file) {
            logStep("upload_missing_file", {}, "error");
            return res.status(400).json({ message: "No files were uploaded.", processingLog });
        }

        fileName = req.file.originalname;
        logStep("file_received", { filename: req.file.originalname, size: req.file.size });

        const fileExtension = path.extname(req.file.originalname).toLowerCase();
        let fileData;

        if (fileExtension === ".docx") {
            const result = await mammoth.extractRawText({ buffer: req.file.buffer });
            fileData = result.value;
        } else if (fileExtension === ".pdf") {
            const pdfResult = await pdfParse(req.file.buffer);
            fileData = pdfResult.text;
        } else {
            logStep("unsupported_file_format", { extension: fileExtension }, "error");
            return res.status(400).json({ message: "Unsupported file format", processingLog });
        }

        logStep("file_parsed", { extension: fileExtension });
        const extractedData = extractCVData(fileData);
        logStep("cv_extracted");

        // Convert the file buffer to a readable stream for Drive upload.
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);

        const fileMetadata = {
            name: req.file.originalname,
            parents: [driveFolderId]
        };

        logStep("drive_upload_started");
        const driveResponse = await drive.files.create({
            resource: fileMetadata,
            media: {
                mimeType: req.file.mimetype,
                body: bufferStream
            },
            fields: "id"
        });

        const driveFileId = driveResponse.data.id;
        logStep("drive_uploaded", { fileId: driveFileId });

        await drive.permissions.create({
            fileId: driveFileId,
            resource: {
                role: 'reader',
                type: 'anyone'
            }
        });
        logStep("drive_permissions_set");

        const fileInfo = await drive.files.get({
            fileId: driveFileId,
            fields: 'id, webViewLink, webContentLink'
        });

        const downloadablePublicLink = fileInfo.data.webViewLink;
        logStep("drive_link_ready");

        const orderedFields = [
            "name",
            "email",
            "phone",
            "summary",
            "projects",
            "experience",
            "education",
            "achievements",
            "references"
        ];

        const values = [orderedFields.map(field => extractedData[field] || "")];
        const resource = { values };

        logStep("sheet_append_started");
        const sheetResponse = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: "Sheet1!A1",
            valueInputOption: "RAW",
            insertDataOption: "INSERT_ROWS",
            resource
        });
        logStep("sheet_append_success", {
            updatedRange: sheetResponse.data?.updates?.updatedRange
        });

        const candidateEmail = extractedData.email || "";
        let emailStatus = { status: "skipped", reason: "no_candidate_email" };
        if (candidateEmail) {
            const transporter = nodemailer.createTransport({
                service: emailService,
                auth: {
                    user: emailUser,
                    pass: emailPass
                }
            });

            const mailOptions = {
                from: emailUser,
                to: candidateEmail,
                subject: "Your CV is Under Review",
                text: `Dear ${extractedData.name || "Applicant"},
    
                Thank you for submitting your CV. We wanted to let you know that your CV is currently under review. We will get back to you soon with more information.
    
                Best regards,
                Company`
            };

            const delayMs = emailDelayMinutes > 0 ? emailDelayMinutes * 60 * 1000 : 0;
            if (delayMs > 0) {
                const sendDate = new Date(Date.now() + delayMs);
                logStep("email_scheduled", { sendAt: sendDate.toISOString(), delayMinutes: emailDelayMinutes });

                schedule.scheduleJob(sendDate, async function () {
                    console.log(`[${new Date().toISOString()}] email_send_started`);
                    try {
                        let info = await transporter.sendMail(mailOptions);
                        console.log(`[${new Date().toISOString()}] email_sent_success`, info.response);
                    } catch (error) {
                        console.error(`[${new Date().toISOString()}] email_send_failed`, error);
                    }
                });

                emailStatus = { status: "scheduled", sendAt: sendDate.toISOString() };
            } else {
                logStep("email_send_started");
                try {
                    let info = await transporter.sendMail(mailOptions);
                    emailStatus = { status: "sent", response: info.response };
                    logStep("email_sent_success");
                } catch (error) {
                    emailStatus = { status: "failed", error: error.message };
                    logStep("email_send_failed", { error: error.message }, "error");
                }
            }
        } else {
            logStep("email_skipped", { reason: "no_candidate_email" });
        }

        res.json({
            message: "File processed successfully",
            fileId: driveFileId,
            extractedData,
            sheetResponse: sheetResponse.data,
            downloadablePublicLink,
            processingLog,
            status: {
                sheetAppend: { success: true },
                email: emailStatus
            }
        });
    } catch (error) {
        logStep("upload_failed", { error: error.message }, "error");
        res.status(500).json({ message: "Upload failed", error: error.message, processingLog });
    }
});

app.get("/cv", async (req, res) => {
    try {
        // Replace the file path with the location of your PDF file if needed.
        const dataBuffer = fs.readFileSync(fileName);
        const data = await pdfParse(dataBuffer);
        const cvData = extractCVData(data.text);
        res.json(cvData);
    } catch (error) {
        res.status(500).json({ error: error.toString() });
    }
});

app.get("/", (req, res) => {
    res.send({ "server": "running" });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

export default app;
