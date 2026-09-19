const BASE=import.meta.env.VITE_API_URL||'http://localhost:5000/api';
export function token(){return localStorage.getItem('token');}
export async function api(path,opts={}){
 const headers={...(opts.headers||{})};if(token())headers.Authorization=`Bearer ${token()}`;
 if(opts.body && !(opts.body instanceof FormData))headers['Content-Type']='application/json';
 const res=await fetch(`${BASE}${path}`,{...opts,headers});
 const data= res.status===204?null:await res.json().catch(()=>null);
 if(!res.ok)throw new Error(data?.message||'Request failed');
 return data;
}
export {BASE};
