import { supabase } from './supabase';
const check=e=>{if(e)throw new Error(e.message)};
const json=o=>o.body instanceof FormData?Object.fromEntries(o.body.entries()):JSON.parse(o.body||'{}');
const me=async()=>{const{data,error}=await supabase.auth.getUser();check(error);if(!data.user)throw Error('Authentication required');const r=await supabase.from('profiles').select('*').eq('id',data.user.id).single();check(r.error);return r.data};
export async function api(path,o={}){
 const method=(o.method||'GET').toUpperCase();
 if(path==='/auth/login'){const{email,password}=json(o);const r=await supabase.auth.signInWithPassword({email,password});check(r.error);return{token:r.data.session.access_token,user:await me()}}
 if(path==='/auth/me')return me(); const user=await me();
 if(path==='/dashboard'){const[d,e]=await Promise.all([supabase.from('donations').select('amount'),supabase.from('expenses').select('amount')]);check(d.error);check(e.error);const a=d.data.reduce((s,x)=>s+Number(x.amount),0),b=e.data.reduce((s,x)=>s+Number(x.amount),0);return{totalDonations:a,totalExpenses:b,balance:a-b,donationCount:d.data.length,expenseCount:e.data.length}}
 if(path==='/users'){if(method==='POST')throw Error('Create users in Supabase Authentication, then assign their role in profiles.');const r=await supabase.from('profiles').select('*').order('created_at',{ascending:false});check(r.error);return r.data}
 if(path.startsWith('/users/')){const r=await supabase.from('profiles').update(json(o)).eq('id',path.split('/')[2]);check(r.error);return{message:'User updated'}}
 if(path==='/donations'||path==='/expenses'){const table=path.slice(1),date=table==='donations'?'donation_date':'expense_date';if(method==='GET'){const r=await supabase.from(table).select('*').order(date,{ascending:false});check(r.error);return r.data}const v=json(o),id=path.split('/')[2];if(method==='POST'){v.created_by=user.id;const r=await supabase.from(table).insert(v).select().single();check(r.error);return r.data}if(method==='PUT'){v.updated_by=user.id;const r=await supabase.from(table).update(v).eq('id',id);check(r.error);return{message:'Record updated'}}const r=await supabase.from(table).delete().eq('id',id);check(r.error);return{message:'Record deleted'}}
 if(path==='/bills'&&method==='GET'){const r=await supabase.from('bills').select('*').order('uploaded_at',{ascending:false});check(r.error);return r.data}
 if(path==='/bills'&&method==='POST'){const v=json(o),file=v.file;if(!file||!!v.expense_id===!!v.donation_id)throw Error('Attach a file to exactly one record');const stored_name=`${crypto.randomUUID()}-${file.name}`,u=await supabase.storage.from('bills').upload(stored_name,file);check(u.error);const r=await supabase.from('bills').insert({expense_id:v.expense_id||null,donation_id:v.donation_id||null,file_name:file.name,stored_name,uploaded_by:user.id}).select().single();check(r.error);return r.data}
 if(path==='/audit-logs'){const r=await supabase.from('audit_logs').select('*').order('created_at',{ascending:false}).limit(500);check(r.error);return r.data}
 throw Error(`Unsupported path: ${path}`)
}
export const BASE='';export const token=()=>null;
