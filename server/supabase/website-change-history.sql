create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  action text not null,
  resource text not null,
  resource_id text,
  metadata jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_resource_created_at_idx
  on public.audit_logs(resource, created_at desc);

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon, authenticated;
grant all on public.audit_logs to service_role;
