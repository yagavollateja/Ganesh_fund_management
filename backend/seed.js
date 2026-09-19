import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { initDb, pool } from './db.js';

dotenv.config();
try {
  await initDb();
  const [rows] = await pool.execute("SELECT id FROM users WHERE role='ADMIN' LIMIT 1");
  if (rows.length) {
    console.log('An ADMIN already exists. Seed skipped.');
  } else {
    const name = process.env.ADMIN_NAME || 'Festival Admin';
    const email = (process.env.ADMIN_EMAIL || 'admin@ganesh.local').toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!password || password.length < 12) {
      throw new Error('Set ADMIN_PASSWORD (at least 12 characters) in backend/.env before seeding.');
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.execute(
      "INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'ADMIN')",
      [name, email, hash]
    );
    console.log(`Admin created: ${email}`);
  }
} finally {
  await pool.end();
}
