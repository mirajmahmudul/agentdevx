-- Migration 001: Enable Row Level Security (RLS) with multi-tenant isolation policies
-- Run this in Supabase SQL Editor after all tables are created
-- This ensures proper security isolation between different owners/tenants

-- ============================================================================
-- IMPORTANT: Run this migration AFTER creating all tables from schema.sql
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE IF EXISTS tool_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tool_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS subscriptions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TOOL PROVIDERS POLICIES
-- Owners can only read/write their own provider rows
-- ============================================================================

DROP POLICY IF EXISTS provider_owner_select ON tool_providers;
CREATE POLICY provider_owner_select ON tool_providers
  FOR SELECT
  USING (owner_id = current_setting('app.owner_id', true));

DROP POLICY IF EXISTS provider_owner_insert ON tool_providers;
CREATE POLICY provider_owner_insert ON tool_providers
  FOR INSERT
  WITH CHECK (owner_id = current_setting('app.owner_id', true));

DROP POLICY IF EXISTS provider_owner_update ON tool_providers;
CREATE POLICY provider_owner_update ON tool_providers
  FOR UPDATE
  USING (owner_id = current_setting('app.owner_id', true));

DROP POLICY IF EXISTS provider_owner_delete ON tool_providers;
CREATE POLICY provider_owner_delete ON tool_providers
  FOR DELETE
  USING (owner_id = current_setting('app.owner_id', true));

-- ============================================================================
-- AGENTS POLICIES
-- Owners can only read/write their own agents
-- Agents can only read their own row (used by proxy for validation)
-- ============================================================================

DROP POLICY IF EXISTS agent_owner_select ON agents;
CREATE POLICY agent_owner_select ON agents
  FOR SELECT
  USING (owner_id = current_setting('app.owner_id', true));

DROP POLICY IF EXISTS agent_owner_insert ON agents;
CREATE POLICY agent_owner_insert ON agents
  FOR INSERT
  WITH CHECK (owner_id = current_setting('app.owner_id', true));

DROP POLICY IF EXISTS agent_owner_update ON agents;
CREATE POLICY agent_owner_update ON agents
  FOR UPDATE
  USING (owner_id = current_setting('app.owner_id', true));

DROP POLICY IF EXISTS agent_owner_delete ON agents;
CREATE POLICY agent_owner_delete ON agents
  FOR DELETE
  USING (owner_id = current_setting('app.owner_id', true));

-- Agent self-read policy (for proxy validation)
DROP POLICY IF EXISTS agent_self_select ON agents;
CREATE POLICY agent_self_select ON agents
  FOR SELECT
  USING (id = current_setting('app.agent_id', true));

-- ============================================================================
-- TOOL MANIFESTS POLICIES
-- Public can read published tools
-- Owners can write their own drafts/published tools
-- ============================================================================

DROP POLICY IF EXISTS manifests_public_select ON tool_manifests;
CREATE POLICY manifests_public_select ON tool_manifests
  FOR SELECT
  USING (status = 'published');

DROP POLICY IF EXISTS manifests_owner_select ON tool_manifests;
CREATE POLICY manifests_owner_select ON tool_manifests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tool_providers 
      WHERE tool_providers.id = tool_manifests.provider_id 
      AND tool_providers.owner_id = current_setting('app.owner_id', true)
    )
  );

DROP POLICY IF EXISTS manifests_owner_insert ON tool_manifests;
CREATE POLICY manifests_owner_insert ON tool_manifests
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tool_providers 
      WHERE tool_providers.id = provider_id 
      AND tool_providers.owner_id = current_setting('app.owner_id', true)
    )
  );

DROP POLICY IF EXISTS manifests_owner_update ON tool_manifests;
CREATE POLICY manifests_owner_update ON tool_manifests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tool_providers 
      WHERE tool_providers.id = tool_manifests.provider_id 
      AND tool_providers.owner_id = current_setting('app.owner_id', true)
    )
  );

DROP POLICY IF EXISTS manifests_owner_delete ON tool_manifests;
CREATE POLICY manifests_owner_delete ON tool_manifests
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM tool_providers 
      WHERE tool_providers.id = tool_manifests.provider_id 
      AND tool_providers.owner_id = current_setting('app.owner_id', true)
    )
  );

-- ============================================================================
-- AUDIT LOG POLICIES
-- Agents can only read their own audit entries
-- System can insert audit entries (via service role)
-- ============================================================================

DROP POLICY IF EXISTS audit_agent_select ON audit_log;
CREATE POLICY audit_agent_select ON audit_log
  FOR SELECT
  USING (agent_id = current_setting('app.agent_id', true));

-- Allow inserts via service role (no policy needed for service_role key)
-- This policy allows the proxy to insert audit logs
DROP POLICY IF EXISTS audit_system_insert ON audit_log;
CREATE POLICY audit_system_insert ON audit_log
  FOR INSERT
  WITH CHECK (true);

-- ============================================================================
-- CREDENTIALS POLICIES
-- Only provider owners can read/write credentials
-- ============================================================================

DROP POLICY IF EXISTS credential_owner_select ON credentials;
CREATE POLICY credential_owner_select ON credentials
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tool_providers 
      WHERE tool_providers.id = credentials.provider_id 
      AND tool_providers.owner_id = current_setting('app.owner_id', true)
    )
  );

DROP POLICY IF EXISTS credential_owner_insert ON credentials;
CREATE POLICY credential_owner_insert ON credentials
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tool_providers 
      WHERE tool_providers.id = provider_id 
      AND tool_providers.owner_id = current_setting('app.owner_id', true)
    )
  );

DROP POLICY IF EXISTS credential_owner_update ON credentials;
CREATE POLICY credential_owner_update ON credentials
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tool_providers 
      WHERE tool_providers.id = credentials.provider_id 
      AND tool_providers.owner_id = current_setting('app.owner_id', true)
    )
  );

DROP POLICY IF EXISTS credential_owner_delete ON credentials;
CREATE POLICY credential_owner_delete ON credentials
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM tool_providers 
      WHERE tool_providers.id = credentials.provider_id 
      AND tool_providers.owner_id = current_setting('app.owner_id', true)
    )
  );

-- ============================================================================
-- POLICIES (OPA Rego) POLICIES
-- Only owners can manage their own policies
-- ============================================================================

DROP POLICY IF EXISTS policy_owner_select ON policies;
CREATE POLICY policy_owner_select ON policies
  FOR SELECT
  USING (owner_id = current_setting('app.owner_id', true));

DROP POLICY IF EXISTS policy_owner_insert ON policies;
CREATE POLICY policy_owner_insert ON policies
  FOR INSERT
  WITH CHECK (owner_id = current_setting('app.owner_id', true));

DROP POLICY IF EXISTS policy_owner_update ON policies;
CREATE POLICY policy_owner_update ON policies
  FOR UPDATE
  USING (owner_id = current_setting('app.owner_id', true));

DROP POLICY IF EXISTS policy_owner_delete ON policies;
CREATE POLICY policy_owner_delete ON policies
  FOR DELETE
  USING (owner_id = current_setting('app.owner_id', true));

-- ============================================================================
-- SUBSCRIPTIONS POLICIES
-- Agents can only read their own subscription
-- ============================================================================

DROP POLICY IF EXISTS subscription_agent_select ON subscriptions;
CREATE POLICY subscription_agent_select ON subscriptions
  FOR SELECT
  USING (agent_id = current_setting('app.agent_id', true));

-- Allow inserts/updates via service role or billing system
DROP POLICY IF EXISTS subscription_system_insert ON subscriptions;
CREATE POLICY subscription_system_insert ON subscriptions
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS subscription_system_update ON subscriptions;
CREATE POLICY subscription_system_update ON subscriptions
  FOR UPDATE
  USING (true);

-- ============================================================================
-- VERIFICATION QUERIES
-- Run these to verify RLS is working correctly:
-- ============================================================================
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
-- FROM pg_policies 
-- WHERE schemaname = 'public';
