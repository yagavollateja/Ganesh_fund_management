import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool, initDb } from './db.js';
import { auth, adminOnly } from './middleware.js';
import { audit } from './audit.js';

dotenv.config();
if (!process.env.JWT_SECRET) {
  throw new Error('Missing JWT_SECRET in backend/.env');
}
const app=express();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
app.use(cors({origin:process.env.CLIENT_URL || 'http://localhost:5173'}));
app.use(express.json({limit:'1mb'})); app.use(morgan('dev'));
app.use('/api/auth',rateLimit({windowMs:15*60*1000,max:30}));
const uploadDir=path.join(__dirname,'uploads'); fs.mkdirSync(uploadDir,{recursive:true});
const storage=multer.diskStorage({
 destination:(_,__,cb)=>cb(null,uploadDir),
 filename:(_,file,cb)=>cb(null,`${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase()}`)
});
const upload=multer({storage,limits:{fileSize:8*1024*1024},fileFilter:(_,file,cb)=>{
 const ok=['application/pdf','image/jpeg','image/png'].includes(file.mimetype);
 cb(ok?null:new Error('Only PDF, JPG, and PNG files are allowed'),ok);
}});
const asyncHandler=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);

app.get('/api/health',(_,res)=>res.json({status:'ok'}));
app.post('/api/auth/login',asyncHandler(async(req,res)=>{
 const {email,password}=req.body;
 if(!email||!password) return res.status(400).json({message:'Email and password required'});
 const [rows]=await pool.execute('SELECT * FROM users WHERE email=? AND active=1',[email.toLowerCase()]);
 const user=rows[0];
 if(!user || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({message:'Invalid credentials'});
 const token=jwt.sign({id:user.id,name:user.name,email:user.email,role:user.role},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'8h'});
 const conn=await pool.getConnection();
 try { await audit(conn,{id:user.id,name:user.name,email:user.email},'LOGIN','AUTH',user.id,'Successful login'); }
 finally {conn.release();}
 res.json({token,user:{id:user.id,name:user.name,email:user.email,role:user.role}});
}));
app.get('/api/auth/me',auth,asyncHandler(async(req,res)=>{
 const [r]=await pool.execute('SELECT id,name,email,role,active FROM users WHERE id=?',[req.user.id]);
 if(!r[0]||!r[0].active) return res.status(401).json({message:'Account inactive'});
 res.json(r[0]);
}));

// Admin user management
app.get('/api/users',auth,adminOnly,asyncHandler(async(req,res)=>{
 const [rows]=await pool.query('SELECT id,name,email,role,active,created_at,updated_at FROM users ORDER BY created_at DESC'); res.json(rows);
}));
app.post('/api/users',auth,adminOnly,asyncHandler(async(req,res)=>{
 const {name,email,role='VIEWER',password}=req.body;
 if(!name||!email||!password||password.length<8||!['ADMIN','VIEWER'].includes(role)) return res.status(400).json({message:'Provide name, valid role, email and password (8+ chars)'});
 const hash=await bcrypt.hash(password,12); const conn=await pool.getConnection();
 try { await conn.beginTransaction();
  const [r]=await conn.execute('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)',[name,email.toLowerCase(),hash,role]);
  await audit(conn,req.user,'CREATE','USER',r.insertId,`Created ${role} user ${email}`,null,{name,email,role});
  await conn.commit(); res.status(201).json({id:r.insertId,name,email,role,active:1});
 } catch(e){await conn.rollback(); if(e.code==='ER_DUP_ENTRY')return res.status(409).json({message:'Email already exists'}); throw e;} finally{conn.release();}
}));
app.put('/api/users/:id',auth,adminOnly,asyncHandler(async(req,res)=>{
 const id=req.params.id,{name,email,role,active}=req.body;
 if(!name||!email||!['ADMIN','VIEWER'].includes(role))return res.status(400).json({message:'Invalid user details'});
 if(Number(id)===Number(req.user.id)&&role!=='ADMIN')return res.status(400).json({message:'You cannot remove your own admin role'});
 const conn=await pool.getConnection();
 try{await conn.beginTransaction();const [old]=await conn.execute('SELECT id,name,email,role,active FROM users WHERE id=?',[id]);
 if(!old[0]){await conn.rollback();return res.status(404).json({message:'User not found'});}
 await conn.execute('UPDATE users SET name=?,email=?,role=?,active=? WHERE id=?',[name,email.toLowerCase(),role,active?1:0,id]);
 await audit(conn,req.user,'UPDATE','USER',id,`Updated user ${email}`,old[0],{name,email,role,active:!!active});
 await conn.commit();res.json({message:'User updated'});}catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')return res.status(409).json({message:'Email already exists'});throw e;}finally{conn.release();}
}));

function clean(obj,fields){const out={};for(const f of fields)if(obj[f]!==undefined)out[f]=obj[f];return out;}
const donationFields=['donor_name','amount','donation_date','payment_method','transaction_id','receipt_number','notes'];
app.get('/api/donations',auth,asyncHandler(async(req,res)=>{
 const [r]=await pool.query(`SELECT d.*,u.name created_by_name,uu.name updated_by_name FROM donations d LEFT JOIN users u ON d.created_by=u.id LEFT JOIN users uu ON d.updated_by=uu.id ORDER BY donation_date DESC,d.id DESC`);res.json(r);
}));
app.post('/api/donations',auth,adminOnly,asyncHandler(async(req,res)=>{
 const d=clean(req.body,donationFields);if(!d.donor_name||Number(d.amount)<=0||!d.donation_date)return res.status(400).json({message:'Donor, positive amount and date required'});
 const conn=await pool.getConnection();try{await conn.beginTransaction();
 const [r]=await conn.execute(`INSERT INTO donations(${Object.keys(d).join(',')},created_by) VALUES(${Object.keys(d).map(()=>'?').join(',')},?)`,[...Object.values(d),req.user.id]);
 await audit(conn,req.user,'CREATE','DONATION',r.insertId,'Added donation',null,d);await conn.commit();res.status(201).json({id:r.insertId,...d});}
 catch(e){await conn.rollback();throw e;}finally{conn.release();}
}));
app.put('/api/donations/:id',auth,adminOnly,asyncHandler(async(req,res)=>{
 const id=req.params.id,d=clean(req.body,donationFields),conn=await pool.getConnection();
 try{await conn.beginTransaction();const [old]=await conn.execute('SELECT * FROM donations WHERE id=?',[id]);if(!old[0]){await conn.rollback();return res.status(404).json({message:'Donation not found'});}
 const keys=Object.keys(d);if(!keys.length){await conn.rollback();return res.status(400).json({message:'No fields supplied'});}
 await conn.execute(`UPDATE donations SET ${keys.map(k=>`${k}=?`).join(',')},updated_by=? WHERE id=?`,[...Object.values(d),req.user.id,id]);
 await audit(conn,req.user,'UPDATE','DONATION',id,'Updated donation',old[0],d);await conn.commit();res.json({message:'Donation updated'});}
 catch(e){await conn.rollback();throw e;}finally{conn.release();}
}));
app.delete('/api/donations/:id',auth,adminOnly,asyncHandler(async(req,res)=>{
 const conn=await pool.getConnection();try{await conn.beginTransaction();const [old]=await conn.execute('SELECT * FROM donations WHERE id=?',[req.params.id]);if(!old[0]){await conn.rollback();return res.status(404).json({message:'Donation not found'});}
 await audit(conn,req.user,'DELETE','DONATION',req.params.id,'Deleted donation',old[0],null);await conn.execute('DELETE FROM donations WHERE id=?',[req.params.id]);await conn.commit();res.json({message:'Donation deleted'});}
 catch(e){await conn.rollback();throw e;}finally{conn.release();}
}));

const expenseFields=['title','category','amount','expense_date','paid_to','payment_method','bill_number','description'];
app.get('/api/expenses',auth,asyncHandler(async(req,res)=>{
 const [r]=await pool.query(`SELECT e.*,u.name created_by_name,uu.name updated_by_name FROM expenses e LEFT JOIN users u ON e.created_by=u.id LEFT JOIN users uu ON e.updated_by=uu.id ORDER BY expense_date DESC,e.id DESC`);res.json(r);
}));
app.post('/api/expenses',auth,adminOnly,asyncHandler(async(req,res)=>{
 const d=clean(req.body,expenseFields);if(!d.title||Number(d.amount)<=0||!d.expense_date)return res.status(400).json({message:'Title, positive amount and date required'});
 const conn=await pool.getConnection();try{await conn.beginTransaction();const [r]=await conn.execute(`INSERT INTO expenses(${Object.keys(d).join(',')},created_by) VALUES(${Object.keys(d).map(()=>'?').join(',')},?)`,[...Object.values(d),req.user.id]);
 await audit(conn,req.user,'CREATE','EXPENSE',r.insertId,'Added expense',null,d);await conn.commit();res.status(201).json({id:r.insertId,...d});}
 catch(e){await conn.rollback();throw e;}finally{conn.release();}
}));
app.put('/api/expenses/:id',auth,adminOnly,asyncHandler(async(req,res)=>{
 const id=req.params.id,d=clean(req.body,expenseFields),conn=await pool.getConnection();
 try{await conn.beginTransaction();const [old]=await conn.execute('SELECT * FROM expenses WHERE id=?',[id]);if(!old[0]){await conn.rollback();return res.status(404).json({message:'Expense not found'});}
 const keys=Object.keys(d);if(!keys.length){await conn.rollback();return res.status(400).json({message:'No fields supplied'});}
 await conn.execute(`UPDATE expenses SET ${keys.map(k=>`${k}=?`).join(',')},updated_by=? WHERE id=?`,[...Object.values(d),req.user.id,id]);
 await audit(conn,req.user,'UPDATE','EXPENSE',id,'Updated expense',old[0],d);await conn.commit();res.json({message:'Expense updated'});}
 catch(e){await conn.rollback();throw e;}finally{conn.release();}
}));
app.delete('/api/expenses/:id',auth,adminOnly,asyncHandler(async(req,res)=>{
 const conn=await pool.getConnection();try{await conn.beginTransaction();const [old]=await conn.execute('SELECT * FROM expenses WHERE id=?',[req.params.id]);if(!old[0]){await conn.rollback();return res.status(404).json({message:'Expense not found'});}
 await audit(conn,req.user,'DELETE','EXPENSE',req.params.id,'Deleted expense',old[0],null);await conn.execute('DELETE FROM expenses WHERE id=?',[req.params.id]);await conn.commit();res.json({message:'Expense deleted'});}
 catch(e){await conn.rollback();throw e;}finally{conn.release();}
}));

app.get('/api/dashboard',auth,asyncHandler(async(req,res)=>{
 const [[d]]=await pool.query('SELECT COALESCE(SUM(amount),0) total FROM donations');
 const [[e]]=await pool.query('SELECT COALESCE(SUM(amount),0) total FROM expenses');
 const [[dc]]=await pool.query('SELECT COUNT(*) total FROM donations');
 const [[ec]]=await pool.query('SELECT COUNT(*) total FROM expenses');
 res.json({totalDonations:d.total,totalExpenses:e.total,balance:Number(d.total)-Number(e.total),donationCount:dc.total,expenseCount:ec.total});
}));
app.get('/api/audit-logs',auth,adminOnly,asyncHandler(async(req,res)=>{
 const {module,userId,from,to}=req.query;let sql='SELECT * FROM audit_logs WHERE 1=1',p=[];
 if(module){sql+=' AND module=?';p.push(module);}if(userId){sql+=' AND user_id=?';p.push(userId);}
 if(from){sql+=' AND created_at>=?';p.push(from+' 00:00:00');}if(to){sql+=' AND created_at<=?';p.push(to+' 23:59:59');}
 sql+=' ORDER BY created_at DESC LIMIT 500';const [r]=await pool.execute(sql,p);res.json(r);
}));

app.post('/api/bills',auth,adminOnly,upload.single('file'),asyncHandler(async(req,res)=>{
 const {expense_id,donation_id}=req.body;if(!req.file)return res.status(400).json({message:'File required'});
 if((!!expense_id)===(!!donation_id)){fs.unlinkSync(req.file.path);return res.status(400).json({message:'Attach bill to one expense or donation'});}
 const table=expense_id?'expenses':'donations',id=expense_id||donation_id;
 const [exists]=await pool.execute(`SELECT id FROM ${table} WHERE id=?`,[id]);if(!exists[0]){fs.unlinkSync(req.file.path);return res.status(404).json({message:'Linked record not found'});}
 const conn=await pool.getConnection();try{await conn.beginTransaction();const [r]=await conn.execute('INSERT INTO bills(expense_id,donation_id,file_name,stored_name,uploaded_by) VALUES(?,?,?,?,?)',[expense_id||null,donation_id||null,req.file.originalname,req.file.filename,req.user.id]);
 await audit(conn,req.user,'UPLOAD','BILL',r.insertId,`Uploaded bill ${req.file.originalname}`,null,{expense_id,donation_id,file_name:req.file.originalname});await conn.commit();res.status(201).json({id:r.insertId,message:'Bill uploaded'});}
 catch(e){await conn.rollback();throw e;}finally{conn.release();}
}));
app.get('/api/bills',auth,asyncHandler(async(req,res)=>{
 const [r]=await pool.query(`SELECT b.id,b.expense_id,b.donation_id,b.file_name,b.uploaded_at,u.name uploaded_by_name FROM bills b LEFT JOIN users u ON b.uploaded_by=u.id ORDER BY b.uploaded_at DESC`);res.json(r);
}));
app.get('/api/bills/:id/download',auth,asyncHandler(async(req,res)=>{
 const [r]=await pool.execute('SELECT * FROM bills WHERE id=?',[req.params.id]);if(!r[0])return res.status(404).json({message:'Bill not found'});
 const file=path.join(uploadDir,r[0].stored_name);if(!fs.existsSync(file))return res.status(404).json({message:'File missing'});
 res.download(file,r[0].file_name);
}));

app.use((err,req,res,next)=>{console.error(err);res.status(err.status||500).json({message:err.message||'Server error'});});
const port=process.env.PORT||5000;
initDb().then(()=>{
 const server=app.listen(port,()=>console.log(`API running on ${port}`));
 server.on('error',error=>{
  if(error.code==='EADDRINUSE') console.error(`Cannot start API: port ${port} is already in use. Stop the existing server or set a different PORT in backend/.env.`);
  else console.error('API startup failed',error);
  process.exit(1);
 });
}).catch(e=>{console.error('Database initialization failed',e);process.exit(1);});
