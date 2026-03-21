# 📄 Automated CV Processing Pipeline

A full-stack application designed to automate the initial stages of the recruitment process. This pipeline allows users to upload CVs (PDF or Word documents), automatically extracts candidate information, uploads the raw files to Google Drive, logs the parsed data into Google Sheets, and sends an automated confirmation email to the candidate.

---

## 🛠 Tech Stack & Tools

### **Frontend**
* **Framework:** React 19 + Vite
* **Language:** TypeScript
* **HTTP Client:** Axios
* **Styling:** Vanilla CSS

### **Backend**
* **Runtime:** Node.js + Express
* **File Handling:** Multer (Memory Storage)
* **Document Parsing:** `pdf-parse` (PDFs) and `mammoth` (DOCX)
* **Google Integrations:** `googleapis` (Drive v3, Sheets v4)
* **Email & Cron:** `nodemailer` and `node-schedule`
* **Containerization:** Docker

---

## 📋 Prerequisites

Before running this project, ensure you have the following installed and configured:

1. **Node.js** (v18 or higher)
2. **Docker** (Optional for local development, required for Render deployment)
3. **A Google Cloud Console Account:** * You must create a **Service Account** with access to the Google Drive API and Google Sheets API.
   * You need the base64-encoded string of your downloaded Service Account JSON key.
4. **A Gmail Account with App Passwords:** Standard passwords will not work for Nodemailer. You must generate a 16-character App Password.
5. **A Target Google Sheet & Drive Folder:** Both must be shared with your Service Account email address as an "Editor".

---

## 🔐 Environment Variables

You will need to create a `.env` file in both the `frontend` and `backend` directories.

### **Backend (`backend/.env`)**

| Variable | Description |
| :--- | :--- |
| `GOOGLE_SERVICE_ACCOUNT_BASE64` | The base64-encoded string of your Google Service Account JSON key. |
| `GOOGLE_DRIVE_FOLDER_ID` | The ID extracted from your target Google Drive folder URL. |
| `SPREADSHEET_ID` | The ID extracted from your target Google Sheet URL. |
| `EMAIL_SERVICE` | The email provider (e.g., `gmail`). |
| `EMAIL_USER` | The email address sending the automated replies. |
| `EMAIL_PASS` | The 16-character Google App Password (no spaces). |
| `PORT` | (Optional) Defaults to 5000. |

### **Frontend (`frontend/.env`)**

| Variable | Description |
| :--- | :--- |
| `VITE_API_URL` | The URL of your backend server (e.g., `http://localhost:5000` or your live URL). Do not use quotation marks. |

---

## 🚀 Local Development Setup

Follow these steps to run the pipeline on your local machine. You will need two terminal windows open.

### **1. Start the Backend**
1. Navigate to the backend directory: `cd backend`
2. Install dependencies: `npm install`
3. Ensure your `.env` file is populated.
4. Start the Express server: `npm start`
*The server should report it is running on port 5000.*

### **2. Start the Frontend**
1. Open a new terminal and navigate to the frontend: `cd frontend`
2. Install dependencies: `npm install`
3. Ensure your `.env` file points to localhost.
4. Start the Vite development server: `npm run dev`
*The UI will be accessible at `http://localhost:5173`.*

---

## 🚢 Deployment Guide

This repository is structured to separate the frontend UI and the backend API for optimal hosting.

### **Backend Deployment (Render via Docker)**
1. Connect your GitHub repository to Render and create a new **Web Service**.
2. Set the **Root Directory** to `backend`.
3. Set the **Environment** to `Docker`. Render will automatically detect the `Dockerfile`.
4. Add all the backend Environment Variables from your local `.env` into the Render dashboard.
5. Deploy the service and copy the provided public URL.

### **Frontend Deployment (Vercel)**
1. Connect your GitHub repository to Vercel and create a new **Project**.
2. Set the **Root Directory** to `frontend`.
3. Vercel will automatically detect the Vite framework.
4. Go to **Environment Variables** and add `VITE_API_URL`, setting its value to your new Render backend URL.
5. Deploy the project.

---
