# Ganesh Festival Fund Management System

Full-stack starter application using React + Vite, Node.js + Express, and MySQL.

## Features
- JWT login with ADMIN / VIEWER roles
- Admin-only user management
- Donations and expenses CRUD (admin writes; authenticated users read)
- Automatic audit logs with actor, action, record, timestamp, old/new values
- Expense bill upload (Multer; files stored in `backend/uploads`)
- Dashboard totals and recent activity
- Filterable audit log view

## Requirements
Node.js 18+, MySQL 8+

## Setup
### 1. Database
Create a MySQL database:
```sql
CREATE DATABASE ganesh_fund;
```
### 2. Backend
```bash
cd backend
copy .env.example .env (Windows PowerShell)
# Edit backend/.env: set DB_PASSWORD to your local MySQL password, a strong JWT_SECRET, and ADMIN_PASSWORD (12+ chars)
npm install
npm run seed
npm run dev
```
Backend: http://localhost:5000
The admin email/password are ADMIN_EMAIL and ADMIN_PASSWORD from backend/.env. The seed does not print your password. Keep backend/.env private.
### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```
Frontend: http://localhost:5173

## Troubleshooting
- If MySQL reports access denied for an empty user/password, confirm `backend/.env` exists (not `.env.txt`) and DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME are filled in.
- The schema avoids a MySQL CHECK constraint that conflicts with `ON DELETE SET NULL` foreign-key actions.
- Run `npm run seed` from the backend folder after configuring `.env`.

## Important security notes
- Never commit `.env` or uploaded bills.
- Configure HTTPS and a strong JWT secret before deployment.
- This starter uses local disk for uploads. For production, use private object storage and authenticated download routes.
- Audit logs are application-level and append-only through the UI; restrict direct database access.
- Review authorization, backups, and financial-record retention before using for real funds.
