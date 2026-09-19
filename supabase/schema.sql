-- Run this once in Supabase Dashboard > SQL Editor.
-- This creates the replacement Postgres schema, RLS rules, and private bill storage.
create extension if not exists pgcrypto;

do $$
begin
  create type public.user_role as enum ('ADMIN', 'VIEWER');
exception
  when duplicate_object then null;
end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Festival User',
  email text not null unique,
  role public.user_role not null default 'VIEWER',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.donations (
  id bigint generated always as identity primary key, donor_name text not null,
  amount numeric(12,2) not null check (amount > 0), donation_date date not null,
  payment_method text, transaction_id text, receipt_number text unique, notes text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.expenses (
  id bigint generated always as identity primary key, title text not null, category text,
  amount numeric(12,2) not null check (amount > 0), expense_date date not null,
  paid_to text, payment_method text, bill_number text, description text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.bills (
  id bigint generated always as identity primary key,
  expense_id bigint references public.expenses(id) on delete set null,
  donation_id bigint references public.donations(id) on delete set null,
  file_name text not null, stored_name text not null unique,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  constraint bill_has_one_parent check ((expense_id is null) <> (donation_id is null))
);
create table public.audit_logs (
  id bigint generated always as identity primary key, user_id uuid references public.profiles(id) on delete set null,
  user_name text, user_email text, action text not null, module text not null,
  record_id bigint, description text, old_values jsonb, new_values jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'ADMIN' and active);
$$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', 'Festival User'), new.email);
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.donations enable row level security;
alter table public.expenses enable row level security;
alter table public.bills enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles readable by authenticated users" on public.profiles for select to authenticated using (true);
create policy "admins manage profiles" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));
create policy "read donations" on public.donations for select to authenticated using (true);
create policy "admins manage donations" on public.donations for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read expenses" on public.expenses for select to authenticated using (true);
create policy "admins manage expenses" on public.expenses for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read bills" on public.bills for select to authenticated using (true);
create policy "admins manage bills" on public.bills for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins read audit logs" on public.audit_logs for select to authenticated using (public.is_admin());

grant select on public.profiles, public.donations, public.expenses, public.bills to authenticated;
grant insert, update, delete on public.profiles, public.donations, public.expenses, public.bills to authenticated;
grant select on public.audit_logs to authenticated;

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  row_id bigint;
  audit_module text;
  old_row jsonb;
  new_row jsonb;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  select * into actor from public.profiles where id = auth.uid();
  audit_module := case tg_table_name
    when 'donations' then 'DONATION'
    when 'expenses' then 'EXPENSE'
    when 'bills' then 'BILL'
    when 'profiles' then 'USER'
  end;
  old_row := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_row := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  if tg_table_name <> 'profiles' then
    row_id := coalesce((new_row ->> 'id')::bigint, (old_row ->> 'id')::bigint);
  end if;

  insert into public.audit_logs (user_id, user_name, user_email, action, module, record_id, description, old_values, new_values)
  values (
    auth.uid(), actor.name, actor.email, tg_op, audit_module, row_id,
    lower(tg_op) || ' ' || lower(audit_module), old_row, new_row
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_donations on public.donations;
drop trigger if exists audit_expenses on public.expenses;
drop trigger if exists audit_bills on public.bills;
drop trigger if exists audit_profiles on public.profiles;
create trigger audit_donations after insert or update or delete on public.donations for each row execute function public.write_audit_log();
create trigger audit_expenses after insert or update or delete on public.expenses for each row execute function public.write_audit_log();
create trigger audit_bills after insert or update or delete on public.bills for each row execute function public.write_audit_log();
create trigger audit_profiles after update on public.profiles for each row execute function public.write_audit_log();

grant usage, select on all sequences in schema public to authenticated;

insert into storage.buckets (id, name, public) values ('bills', 'bills', false) on conflict (id) do nothing;
create policy "authenticated users read bills" on storage.objects for select to authenticated using (bucket_id = 'bills');
create policy "admins upload bills" on storage.objects for insert to authenticated with check (bucket_id = 'bills' and public.is_admin());
create policy "admins remove bills" on storage.objects for delete to authenticated using (bucket_id = 'bills' and public.is_admin());

-- After creating your first Supabase Auth user, promote it to the initial administrator:
-- update public.profiles set role = 'ADMIN' where email = 'your-admin-email@example.com';
