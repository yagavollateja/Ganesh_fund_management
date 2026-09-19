-- Run this in Supabase Dashboard > SQL Editor after schema.sql.
-- Audit entries are created automatically for browser changes made by signed-in users.
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
