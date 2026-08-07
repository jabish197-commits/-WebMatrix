-- WebMatrix database hardening
-- Run this entire file in Supabase > SQL Editor after schema.sql.
-- WebMatrix uses custom JWT sessions, so browsers must never query Supabase
-- tables directly. Only the server-only service_role key receives access.

begin;

do $$
declare
  table_name text;
  protected_tables text[] := array[
    'users', 'site_settings', 'roles', 'permissions', 'pages', 'banners',
    'contact_messages', 'notifications', 'refresh_tokens',
    'password_reset_tokens', 'audit_logs', 'categories', 'products',
    'addresses', 'orders', 'order_items'
  ];
begin
  foreach table_name in array protected_tables loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('alter table public.%I force row level security', table_name);
      execute format('revoke all privileges on table public.%I from anon, authenticated', table_name);
      execute format('grant all privileges on table public.%I to service_role', table_name);
    end if;
  end loop;
end $$;

-- Prevent accidental access to tables, sequences, or functions added later.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- checkout_order is deliberately callable only by the trusted WebMatrix API.
do $$
begin
  if to_regprocedure('public.checkout_order(uuid,jsonb,jsonb,text,text)') is not null then
    revoke all on function public.checkout_order(uuid,jsonb,jsonb,text,text) from public, anon, authenticated;
    grant execute on function public.checkout_order(uuid,jsonb,jsonb,text,text) to service_role;
  end if;
end $$;

commit;

-- Verification: every returned table should have both values set to true.
select
  namespace.nspname as schemaname,
  relation.relname as tablename,
  relation.relrowsecurity as rowsecurity,
  relation.relforcerowsecurity as forcerowsecurity
from pg_class as relation
join pg_namespace as namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relkind in ('r', 'p')
order by relation.relname;

-- Verification: this should return no direct table grants.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by grantee, table_name, privilege_type;
