alter table public.domains
  add column if not exists last_binding_change_at timestamptz;

create index if not exists domains_binding_change_idx
  on public.domains(user_id, last_binding_change_at desc);
