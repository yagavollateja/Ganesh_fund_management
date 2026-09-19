import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = request.headers.get('Authorization') || '';
    const userClient = createClient(url, serviceKey, { global: { headers: { Authorization: auth } } });
    const adminClient = createClient(url, serviceKey);
    const { data: { user }, error: authError } = await userClient.auth.getUser(auth.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Authentication required');
    const { data: actor } = await adminClient.from('profiles').select('role,active').eq('id', user.id).single();
    if (actor?.role !== 'ADMIN' || !actor.active) throw new Error('Admin access required');
    const { name, email, password, role = 'VIEWER' } = await request.json();
    if (!name || !email || !password || password.length < 8 || !['ADMIN', 'VIEWER'].includes(role)) throw new Error('Provide name, email, role, and an 8+ character password');
    const { data, error } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
    if (error) throw error;
    const { error: profileError } = await adminClient.from('profiles').update({ name, role }).eq('id', data.user.id);
    if (profileError) throw profileError;
    return Response.json({ id: data.user.id, name, email, role, active: true }, { headers: cors, status: 201 });
  } catch (error) { return Response.json({ message: error.message || 'Unable to create user' }, { headers: cors, status: 400 }); }
});
