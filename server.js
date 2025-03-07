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
const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/spreadsheets'];
const auth = new google.auth.GoogleAuth({
    keyFile: './cv-pipeline-01-92372bcf22b4.json', // Update with your credentials file path
    scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

// Create a Google Sheets client
const sheets = google.sheets({ version: 'v4', auth });
// Replace with your target spreadsheet ID
const spreadsheetId = '1c9CHuGUShXbJOumteOmA5L7ZLlVvLi6BenomVbNevN8';


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
                    "X-Candidate-Email": "ravijaanthony@gmail.com"
                }
            }
            );

            console.log("External API response:", externalResponse.data);
            externalResult = externalResponse.data;

        } catch (error) {
            console.error("Error sending payload to external endpoint:", error);
            externalResult = { error: "External API call failed", details: externalError.message };
        }


        const values = [
            [
                extractedData.name || "",
                extractedData.email || "",
                extractedData.phone || "",
                extractedData.education || "",
                extractedData.qualification || "",
                extractedData.projects || "",
            ]
        ];

        const resource = { values };

        const sheetResponse = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: "Sheet1!A1", // Change as needed
            valueInputOption: "RAW",
            insertDataOption: "INSERT_ROWS",
            resource,
        });

        console.log("Sheet update response:", sheetResponse.data);

        res.json({
            message: "File processed successfully",
            fileId: driveFileId,
            extractedData,
            externalResult,
            sheetResponse: sheetResponse.data,
        });

    } catch (error) {
        console.error("Error processing file:", error);
        if (!res.headersSent) {
            res.status(500).send("Error processing file.");
        }
    }
});

// const extractCVData = (text) => {
//     const data = {};
//     const lines = text.split('\n').map(line => line.trim());

//     lines.forEach(line => {
//         const nameMatch = line.match(/^Name:\s*(.+)$/i);
//         if (nameMatch) { data.name = nameMatch[1].trim(); }

//         const emailMatch = line.match(/^Email:\s*(.+)$/i);
//         if (emailMatch) { data.email = emailMatch[1].trim(); }

//         const phoneMatch = line.match(/^Phone:\s*(.+)$/i);
//         if (phoneMatch) { data.phone = phoneMatch[1].trim(); }

//         const educationMatch = line.match(/^Education:\s*(.+)$/i);
//         if (educationMatch) { data.education = educationMatch[1].trim(); }

//         const qualificationMatch = line.match(/^Qualification:\s*(.+)$/i);
//         if (qualificationMatch) { data.qualification = qualificationMatch[1].trim(); }

//         const projectsMatch = line.match(/^Projects?:\s*(.+)$/i);
//         if (projectsMatch) { data.projects = projectsMatch[1].trim(); }
//     });

//     return data;
// };

const extractCVData = (text) => {
    const data = {};

    // Regular expression patterns
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    const phonePattern = /\b(?:\+?\d{1,3})?[-.\s]?(?:\(?\d{1,4}?\)?[-.\s]?)?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}\b/;
    const linkedinPattern = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/i;
    const githubPattern = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+/i;

    // Extract email
    const emailMatch = text.match(emailPattern);
    if (emailMatch) {
        data.email = emailMatch[0];
    }

    // Extract phone number
    const phoneMatch = text.match(phonePattern);
    if (phoneMatch) {
        data.phone = phoneMatch[0];
    }

    // Extract LinkedIn profile
    const linkedinMatch = text.match(linkedinPattern);
    if (linkedinMatch) {
        data.linkedin = linkedinMatch[0];
    }

    // Extract GitHub profile
    const githubMatch = text.match(githubPattern);
    if (githubMatch) {
        data.github = githubMatch[0];
    }

    // Attempt to extract name (heuristic approach)
    // const lines = text.split('\n').map(line => line.trim()).filter(line => line);
    // if (lines.length > 0) {
    //     data.name = lines[0]; // Assuming the first non-empty line is the name
    // }

    const sectionPatterns = {
        education: /(?:education|academic background|educational qualifications):?\s*([\s\S]*?)(?=\n\s*(?:qualifications|skills|projects|experience|summary|about me|description|$))/i,
        qualifications: /(?:qualifications|certifications|skills):?\s*([\s\S]*?)(?=\n\s*(?:education|skills|projects|experience|summary|about me|description|$))/i,
        summary: /(?:summary|about me|description):?\s*([\s\S]*?)(?=\n\s*(?:education|qualifications|skills|projects|experience|$))/i,
        projects: /(?:projects|work samples|portfolio):?\s*([\s\S]*?)(?=\n\s*(?:education|qualifications|skills|experience|summary|about me|description|$))/i,

    };
    const sectionHeaders = ['summary', 'about me', 'description', 'education', 'qualifications', 'projects', 'achievements', 'references', 'skills', 'experience', 'work experience', 'professional experience', 'certifications', 'courses', 'training', 'languages', 'interests', 'hobbies', 'volunteer', 'extracurricular', 'publications', 'patents', 'awards', 'honors', 'activities', 'organizations', 'memberships', 'affiliations', 'personal details', 'contact', 'contact details', 'profile', 'objective'];

    // Create a regex pattern to identify section headers
    const headerPattern = new RegExp(`^(${sectionHeaders.join('|')})[:\\s]*$`, 'i');

    // Split text into lines and initialize variables
    const lines = text.split('\n').map(line => line.trim()).filter(line => line);
    let currentSection = '';
    let sectionContent = {};

    // Iterate through lines to categorize content
    lines.forEach(line => {
        const headerMatch = line.toLowerCase().match(headerPattern);
        if (headerMatch) {
            currentSection = headerMatch[1].toLowerCase();
            sectionContent[currentSection] = [];
        } else if (currentSection) {
            sectionContent[currentSection].push(line);
        }
    });

    // Assign extracted content to data object
    Object.keys(sectionContent).forEach(section => {
        data[section] = sectionContent[section].join(' ');
    });

    // Attempt to extract name (heuristic approach)
    if (lines.length > 0) {
        data.name = lines[0]; // Assuming the first non-empty line is the name
    }

    // Object.keys(sectionPatterns).forEach(section => {
    //     const match = text.match(sectionPatterns[section]);
    //     if (match) {
    //         data[section] = match[1].trim();
    //     }
    // });

    return data;
};


app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

export default app;