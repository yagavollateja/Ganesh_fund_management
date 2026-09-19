-- Run once in Supabase SQL Editor after schema.sql.
-- Removes a recursive profile-policy lookup that can block profile updates.
create or replace function public.current_profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid() and role = public.current_profile_role());
