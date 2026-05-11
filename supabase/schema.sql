-- supabase/schema.sql
create extension if not exists "pgcrypto";

create table tool_providers (
  id text primary key default 'prv_' || encode(gen_random_bytes(12), 'hex'),
  name text not null,
  owner_id text not null,
  created_at timestamptz default now()
);

create table tool_manifests (
  id text primary key default 'mnf_' || encode(gen_random_bytes(12), 'hex'),
  provider_id text references tool_providers(id),
  tool_name text not null,
  version text not null,
  manifest jsonb not null,
  status text default 'published' check (status in ('draft','published','deprecated')),
  published_at timestamptz default now(),
  unique (tool_name, version)
);

create index idx_tool_manifests_name on tool_manifests(tool_name);