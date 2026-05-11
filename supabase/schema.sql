create extension if not exists "pgcrypto";

create table if not exists tool_providers (
  id text primary key default 'prv_' || encode(gen_random_bytes(12), 'hex'),
  name text not null unique,
  owner_id text not null,
  created_at timestamptz default now()
);

create table if not exists tool_manifests (
  id text primary key default 'mnf_' || encode(gen_random_bytes(12), 'hex'),
  provider_id text references tool_providers(id),
  tool_name text not null,
  version text not null,
  manifest jsonb not null,
  status text default 'published' check (status in ('draft','published','deprecated')),
  published_at timestamptz default now(),
  unique (tool_name, version)
);

create table if not exists agents (
  id text primary key default 'agt_' || encode(gen_random_bytes(12), 'hex'),
  name text not null,
  public_key text not null,
  key_algorithm text default 'Ed25519',
  owner_id text not null,
  created_at timestamptz default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  agent_id text not null,
  tool_name text not null,
  action text not null,
  params jsonb,
  outcome text not null check (outcome in ('ALLOW','DENY','ERROR')),
  timestamp timestamptz default now()
);

create table if not exists credentials (
  id text primary key default 'cred_' || encode(gen_random_bytes(12), 'hex'),
  provider_id text references tool_providers(id),
  type text not null check (type in ('api_key','oauth2_client','bearer_token')),
  encrypted_value text not null,
  encrypted_iv text not null,
  created_at timestamptz default now(),
  expires_at timestamptz,
  metadata jsonb default '{}'
);

create index if not exists idx_tool_manifests_name on tool_manifests(tool_name);
create index if not exists idx_agents_owner on agents(owner_id);
create index if not exists idx_manifests_tool_name on tool_manifests(tool_name);
create index if not exists idx_manifests_status on tool_manifests(status);
create index if not exists idx_audit_agent on audit_log(agent_id);
create index if not exists idx_audit_timestamp on audit_log(timestamp);
create index if not exists idx_credentials_provider on credentials(provider_id);

-- Policies table for OPA Rego policies
create table if not exists policies (
  id text primary key default 'pol_' || encode(gen_random_bytes(12), 'hex'),
  name text not null unique,
  rego_code text not null,
  description text,
  status text default 'active' check (status in ('active','deprecated')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Subscriptions table for Stripe billing
create table if not exists subscriptions (
  id text primary key default 'sub_' || encode(gen_random_bytes(12), 'hex'),
  customer_id text not null,
  agent_id text,
  tier text not null default 'free' check (tier in ('free','pro','team','enterprise')),
  status text not null default 'active' check (status in ('active','cancelled','past_due')),
  stripe_session_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(customer_id)
);

create index if not exists idx_policies_status on policies(status);
create index if not exists idx_subscriptions_customer on subscriptions(customer_id);
create index if not exists idx_subscriptions_agent on subscriptions(agent_id);
create index if not exists idx_subscriptions_status on subscriptions(status);