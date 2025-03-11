# Job Application Processing Pipeline

## 📌 Overview
This project automates the processing of job applications by handling CV uploads, extracting data, verifying information, and storing applicant details in **Google Sheets**. It also saves CVs to **Google Drive** and notifies applicants via email.

## 🛠️ Tech Stack
- **Frontend:** React + TypeScript 
- **Backend:** Node.js + Express (Hosted on DigitalOcean Droplet)
- **Database:** Google Sheets API (for structured applicant data storage)
- **File Storage:** Google Drive API (for CV storage)

## 🔄 How It Works
1. **Applicant submits a CV** via the frontend.
2. **Backend (Express) extracts data** (name, email, phone number, etc.).
3. **Data is verified** (e.g., checking valid email format).
4. **Structured data is saved** to Google Sheets.
5. **Uploaded CV will be saved** on Google Drive.
6. **An email notification is sent** to the applicant about their application status.

## 🚀 Deployment
- **Frontend (DigitalOcean App Platform)**
- **Backend (DigitalOcean Droplet)**




