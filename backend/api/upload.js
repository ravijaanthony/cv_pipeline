import formidable from "formidable";
import { google } from "googleapis";
import nodemailer from "nodemailer";
import schedule from "node-schedule";
import path from "path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import stream from "stream";
import fs from "fs";
import axios from "axios";
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
const externalApiUrl = requiredEnv("EXTERNAL_API_URL");
const externalApiCandidateEmail = requiredEnv("EXTERNAL_API_CANDIDATE_EMAIL");
const emailService = requiredEnv("EMAIL_SERVICE");
const emailUser = requiredEnv("EMAIL_USER");
const emailPass = requiredEnv("EMAIL_PASS");

const storageKey = new Storage({
    projectId: googleCredentials.project_id,
    credentials: googleCredentials
});

// Example function for extracting data from the CV text
function extractCVData(text) {
    try {
        const data = {};

        // Define the list of known labels (all in lowercase)
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

        const lines = text.split("\n").map(line => line.trim()).filter(line => line);

        let firstLabelIndex = lines.findIndex(line =>
            labelList.some(label => line.toLowerCase().startsWith(label))
        );

        let personalInfoLines = firstLabelIndex > 0 ? lines.slice(0, firstLabelIndex) : [];

        if (personalInfoLines.length > 0) {
            data.name = personalInfoLines[0];
        }

        data.personal_info = personalInfoLines.length > 1
            ? personalInfoLines.slice(1).join("\n")
            : "";

        const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
        const phonePattern = /\+?\d[\d\s\-]+/;
        const emailMatch = text.match(emailPattern);
        data.email = emailMatch ? emailMatch[0] : "";
        const phoneMatch = text.match(phonePattern);
        data.phone = phoneMatch ? phoneMatch[0] : "";

        let currentLabel = "";
        for (let i = firstLabelIndex; i < lines.length; i++) {
            const line = lines[i];
            const foundLabel = labelList.find(label => line.toLowerCase().startsWith(label));
            if (foundLabel) {
                currentLabel = foundLabel;
                const content = line.substring(foundLabel.length).replace(/^[:\-\s]+/, "");
                data[currentLabel] = content;
            } else if (currentLabel) {
                data[currentLabel] += "\n" + line;
            }
        }

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

export const config = {
    api: {
        bodyParser: false
    }
};

export default async function handler(req, res) {
    // CORS setup
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or set a specific domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, multipart/form-data');

    // Handle pre-flight requests
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ message: "Method Not Allowed" });
    }

    try {
        const form = new formidable.IncomingForm();
        form.parse(req, async (err, fields, files) => {
            if (err) {
                console.error("Error parsing file:", err);
                return res.status(500).send("Error parsing file");
            }

            const uploadedFile = files.file;
            if (!uploadedFile) {
                return res.status(400).send("No files were uploaded.");
            }

            const filePath = uploadedFile.filepath;
            const fileData = fs.readFileSync(filePath);

            const ext = path.extname(uploadedFile.originalFilename || "").toLowerCase();
            let text;
            if (ext === ".docx") {
                const result = await mammoth.extractRawText({ buffer: fileData });
                text = result.value;
            } else if (ext === ".pdf") {
                const pdfResult = await pdfParse(fileData);
                text = pdfResult.text;
            } else {
                return res.status(400).send("Unsupported file format");
            }

            const extractedData = extractCVData(text);

            const bufferStream = new stream.PassThrough();
            bufferStream.end(fileData);

            const fileMetadata = {
                name: uploadedFile.originalFilename,
                parents: [driveFolderId]
            };
            const driveResponse = await drive.files.create({
                resource: fileMetadata,
                media: { mimeType: uploadedFile.mimetype, body: bufferStream },
                fields: "id"
            });
            const driveFileId = driveResponse.data.id;
            console.log("Google Drive File Id:", driveFileId);

            await drive.permissions.create({
                fileId: driveFileId,
                resource: {
                    role: 'reader',
                    type: 'anyone'
                }
            });

            const fileInfo = await drive.files.get({
                fileId: driveFileId,
                fields: 'id, webViewLink, webContentLink'
            });

            const downloadablePublicLink = fileInfo.data.webViewLink;
            console.log("Public link:", downloadablePublicLink);

            const payload = {
                "cv_data": {
                    "personal_info": {
                        name: extractedData.name || "",
                        email: extractedData.email || "",
                        phone: extractedData.phone || ""
                    },
                    "education": extractedData.education ? [extractedData.education] : [],
                    "qualifications": extractedData.qualifications
                        ? (Array.isArray(extractedData.qualifications)
                            ? extractedData.qualifications
                            : [extractedData.qualifications])
                        : [],
                    "projects": extractedData.projects ? [extractedData.projects] : [],
                    "cv_public_link": downloadablePublicLink
                },
                "metadata": {
                    "applicant_name": extractedData.name || "",
                    "email": extractedData.email || "",
                    "status": "prod",
                    "cv_processed": true,
                    "processed_timestamp": new Date().toISOString()
                }
            };

            let externalResult;

            try {
                const externalResponse = await axios.post(
                    externalApiUrl,
                    payload,
                    {
                        headers: {
                            "Content-Type": "application/json",
                            "X-Candidate-Email": externalApiCandidateEmail
                        }
                    }
                );
                externalResult = externalResponse.data;
                console.log("External API response:", externalResponse.data);

            } catch (error) {
                console.error("Error sending payload to external endpoint:", error);
                externalResult = { error: "External API call failed", details: error.message };
            }

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

            const sheetResponse = await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: "Sheet1!A1",
                valueInputOption: "RAW",
                insertDataOption: "INSERT_ROWS",
                resource
            });

            console.log("Sheet update response:", sheetResponse.data);

            const candidateEmail = extractedData.email || "";
            if (candidateEmail) {
                console.log("Scheduling email to be sent to:", candidateEmail);

                const sendDate = new Date(2025, 2, 8, 14, 45, 0);

                if (sendDate > new Date()) {
                    const transporter = nodemailer.createTransport({
                        service: emailService,
                        auth: {
                            user: emailUser,
                            pass: emailPass
                        }
                    });

                    console.log("Transporter set");

                    schedule.scheduleJob(sendDate, async function () {
                        console.log("Scheduler triggered at:", new Date());

                        const mailOptions = {
                            from: emailUser,
                            to: candidateEmail,
                            subject: "Your CV is Under Review",
                            text: `Dear ${extractedData.name || "Applicant"},
    
                            Thank you for submitting your CV. We wanted to let you know that your CV is currently under review. We will get back to you soon with more information.
    
                            Best regards,
                            Company`
                        };

                        console.log("Mail options set");

                        try {
                            let info = await transporter.sendMail(mailOptions);
                            console.log("Email sent successfully:", info.response);
                        } catch (error) {
                            console.error("Error sending email:", error);
                        }
                    });

                    console.log("Job scheduled for:", sendDate);
                } else {
                    console.error("Scheduled date is in the past. Please choose a future date.");
                }
            } else {
                console.error("No candidate email found. Skipping email scheduling.");

                return res.json({
                    message: "File processed successfully",
                    fileId: driveFileId,
                    extractedData,
                    externalResult,
                    sheetResponse: sheetResponse.data,
                    downloadablePublicLink
                });
            }
        });
    } catch (error) {
        console.error("Error in upload handler:", error);
        res.status(500).send(error.message);
    }
}
