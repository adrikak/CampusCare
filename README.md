# CampusCare 🏫

A responsive campus infrastructure complaint reporting and resolution management system.

**Live demo:** [campus-care-neon.vercel.app](https://campus-care-neon.vercel.app/) (fictional demo accounts; the demo password is shared with evaluators separately)

## 📌 Overview

CampusCare aims to simplify how students and faculty report campus infrastructure issues and how administrators and maintenance staff manage their resolution. It provides a centralized workflow for submitting complaints, tracking progress, assigning staff, and recording resolution feedback.

## 🎯 Problem Statement

Campus infrastructure complaints may be communicated through fragmented channels, making it difficult to track their status, assign responsibility, and monitor resolution. CampusCare proposes a centralized platform to improve transparency and accountability.

## ✨ Planned Features

- Role-based interfaces for Students/Faculty, Administrators, and Maintenance Staff
- Complaint submission with category, location, description, and evidence
- Support for JPG, JPEG, PNG, and PDF attachments
- Complaint tracking and status history
- Administrative review, priority setting, and staff assignment
- Maintenance status updates and resolution evidence
- Resolution feedback
- Responsive interface for desktop and mobile devices
- AI-assisted complaint categorization and priority suggestions as a potential enhancement

## 🛠️ Technology Stack

- **Frontend:** React, TypeScript, Vite
- **Styling:** Tailwind CSS
- **Backend and Database:** Supabase (PostgreSQL, Auth, Storage)
- **Version Control:** Git and GitHub

## 🚧 Project Status

| Area | Status |
|---|---|
| Sign-in with Supabase Auth (demo accounts; role comes from the database) | Working |
| Role-based views for students/faculty, admin and maintenance | Working |
| Submitting complaints and every lifecycle step (review, assign, visit scheduling, work, resolution, confirm, reopen, close, reject) | Working, saved in the database |
| Evidence photos and PDFs (photos shrunk in the browser to 500 KB or less; PDFs up to 2 MB; private storage with temporary links) | Working |
| Field validation with limits matching the database (room 20, description 2000, reasons/notes 1000 characters) | Working |
| Row-level security, storage rules and server-side lifecycle rules | Working |
| Deployment | Live on Vercel (free plan) at https://campus-care-neon.vercel.app, connected to Supabase |
| Email/push notifications | Planned |

All people and complaints in the demo database are fictional.

## 🔐 How data is protected

- The browser uses only the Supabase **publishable/anon** key. The secret key is never used by the app or stored in this repository.
- Row-level security lets each user read only what they should: students and faculty see their own complaints, maintenance staff see their assignments, administrators see everything.
- The app cannot write to tables directly. Every change goes through two database functions (`submit_complaint`, `perform_action`) that check the user's role, the complaint's status and visit clashes before saving.

## ▶️ Running Locally

Requirements: Node.js 18+ and a Supabase project set up with [`supabase/SETUP.md`](supabase/SETUP.md).

1. Clone and install:

   ```bash
   git clone https://github.com/adrikak/CampusCare.git
   cd CampusCare
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in your Project URL and publishable key. `.env.local` is ignored by git.

3. Start the development server:

   ```bash
   npm run dev
   ```

Open the local URL printed in the terminal and sign in with one of the demo accounts created during setup.

## 📁 Repository layout

- `src/`: the web app (`App.tsx`, plus `lib/` for the Supabase connection, data access and file uploads)
- `supabase/schema.sql`: tables, lifecycle rules, row-level security and storage rules
- `supabase/seed.sql`: nine fictional sample complaints for the demo accounts
- `supabase/SETUP.md`: step-by-step database setup
- `scripts/create-demo-users.mjs`: optional script to create the demo logins (run locally; reads the secret key from an environment variable, never from a file)

## ✅ Testing

- Lifecycle and role tests, upload tests and security tests run against a test copy of the database.
- 19 test cases (Assignment 9) and 46 field-by-field tests covering every input: all pass.

## 🧭 Next Steps

1. Email/push notifications on status changes.
2. Suggest booking a visit for high-priority or room-access issues.
3. Reports for campus management (recurring issues by building and category).

## 👩‍💻 Project

Developed as an academic Design Thinking project.

**Note:** This repository represents a work in progress. Features will be updated as implementation proceeds.
