import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });
for (const key of ['DB_HOST', 'DB_USER', 'DB_NAME']) {
  if (!process.env[key]) throw new Error(`Missing ${key} in backend/.env`);
}

export const pool = mysql.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, waitForConnections: true,
  connectionLimit: 10, decimalNumbers: true
});

export async function initDb() {
  // A fresh local MySQL installation may not have the application database yet.
  // Create it before opening tables so the first run has no manual SQL step.
  const bootstrap = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });
  try {
    await bootstrap.query('CREATE DATABASE IF NOT EXISTS ??', [process.env.DB_NAME]);
  } finally {
    await bootstrap.end();
  }
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('ADMIN','VIEWER') NOT NULL DEFAULT 'VIEWER',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS donations (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      donor_name VARCHAR(150) NOT NULL, amount DECIMAL(12,2) NOT NULL,
      donation_date DATE NOT NULL, payment_method VARCHAR(30),
      transaction_id VARCHAR(120), receipt_number VARCHAR(80) UNIQUE,
      notes TEXT, created_by BIGINT UNSIGNED NULL, updated_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS expenses (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(160) NOT NULL, category VARCHAR(100), amount DECIMAL(12,2) NOT NULL,
      expense_date DATE NOT NULL, paid_to VARCHAR(150), payment_method VARCHAR(30),
      bill_number VARCHAR(80), description TEXT, created_by BIGINT UNSIGNED NULL,
      updated_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS bills (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      expense_id BIGINT UNSIGNED NULL, donation_id BIGINT UNSIGNED NULL,
      file_name VARCHAR(255) NOT NULL, stored_name VARCHAR(255) NOT NULL,
      uploaded_by BIGINT UNSIGNED NULL, uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL,
      FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE SET NULL,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NULL, user_name VARCHAR(120), user_email VARCHAR(190),
      action VARCHAR(40) NOT NULL, module VARCHAR(40) NOT NULL,
      record_id BIGINT UNSIGNED NULL, description TEXT,
      old_values JSON NULL, new_values JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_created (created_at), INDEX idx_audit_module (module),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`
  ];
  for (const sql of statements) await pool.query(sql);
}
