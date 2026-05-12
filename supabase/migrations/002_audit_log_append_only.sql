-- Migration 002: Make audit_log append-only for EU AI Act compliance
-- Run this in Supabase SQL Editor after the RLS migration (001_enable_rls.sql)
-- 
-- EU AI Act Compliance Requirement:
-- Article 17(1) requires that high-risk AI systems maintain technical documentation
-- that includes "the logging of automatically generated records" (Annex IV, Section 2).
-- Article 19 requires providers to ensure effective human oversight, which necessitates
-- tamper-proof audit trails.
--
-- This migration ensures the audit_log table is truly append-only by:
-- 1. Revoking UPDATE and DELETE privileges from all roles (including authenticated users)
-- 2. Setting critical fields to NOT NULL to prevent partial updates
-- 3. Adding a chain_hash column for tamper detection (future enhancement)
--
-- Only the service_role key can bypass these restrictions, ensuring the system can
-- still write audit logs while preventing any modification or deletion of existing entries.

-- ============================================================================
-- REVOKE UPDATE AND DELETE PRIVILEGES
-- This applies to PUBLIC, authenticated, and anon roles
-- ============================================================================

-- Revoke UPDATE on audit_log from all non-service roles
REVOKE UPDATE ON audit_log FROM PUBLIC;
REVOKE UPDATE ON audit_log FROM authenticated;
REVOKE UPDATE ON audit_log FROM anon;

-- Revoke DELETE on audit_log from all non-service roles
REVOKE DELETE ON audit_log FROM PUBLIC;
REVOKE DELETE ON audit_log FROM authenticated;
REVOKE DELETE ON audit_log FROM anon;

-- ============================================================================
-- ENSURE CRITICAL FIELDS ARE NOT NULL
-- This prevents partial updates even if somehow executed
-- ============================================================================

ALTER TABLE audit_log 
  ALTER COLUMN agent_id SET NOT NULL,
  ALTER COLUMN tool_name SET NOT NULL,
  ALTER COLUMN action SET NOT NULL,
  ALTER COLUMN outcome SET NOT NULL,
  ALTER COLUMN timestamp SET NOT NULL;

-- Ensure outcome is one of the valid values
ALTER TABLE audit_log 
  DROP CONSTRAINT IF EXISTS audit_log_outcome_check;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_outcome_check 
  CHECK (outcome IN ('ALLOW', 'DENY', 'ERROR'));

-- ============================================================================
-- ADD CHAIN HASH COLUMN FOR TAMPER DETECTION (OPTIONAL ENHANCEMENT)
-- This allows cryptographic verification that logs haven't been modified
-- Each row's chain_hash = SHA256(previous_chain_hash + current_row_data)
-- ============================================================================

-- Add chain_hash column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'audit_log' AND column_name = 'chain_hash'
  ) THEN
    ALTER TABLE audit_log ADD COLUMN chain_hash TEXT;
  END IF;
END
$$;

-- Add comment explaining the chain_hash purpose
COMMENT ON COLUMN audit_log.chain_hash IS 
  'Cryptographic hash linking this entry to the previous one for tamper detection. 
   Part of EU AI Act compliance requirements for immutable audit trails.';

-- ============================================================================
-- VERIFICATION QUERIES
-- Run these to verify the append-only restriction is in place:
-- ============================================================================

-- Check that UPDATE/DELETE are revoked:
-- SELECT grantee, privilege_type 
-- FROM information_schema.role_table_grants 
-- WHERE table_name = 'audit_log' 
-- AND privilege_type IN ('UPDATE', 'DELETE');
-- (Should return no rows for PUBLIC, authenticated, anon)

-- Check table constraints:
-- SELECT conname, contype, conkey 
-- FROM pg_constraint 
-- WHERE conrelid = 'audit_log'::regclass;

-- ============================================================================
-- IMPORTANT NOTES FOR OPERATORS
-- ============================================================================
-- 1. The service_role key can still modify audit_log (required for system operations)
-- 2. To truly prevent ALL modifications, consider using PostgreSQL's immutable tables
--    extension or application-level encryption of log entries
-- 3. Regular backups should be taken to preserve audit history
-- 4. Consider enabling point-in-time recovery (PITR) in Supabase dashboard
-- 5. Monitor audit_log size and set up log rotation/archival policies
