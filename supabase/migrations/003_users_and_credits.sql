-- Migration 003: Users and Credits System
-- This migration creates user management and credit tracking tables
-- Run this in Supabase SQL Editor after migrations 001 and 002

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT 'usr_' || encode(gen_random_bytes(12), 'hex'),
  email TEXT NOT NULL UNIQUE,
  api_key TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create credits table
CREATE TABLE IF NOT EXISTS credits (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 75000,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index on credits.user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_credits_user_id ON credits(user_id);

-- Seed admin user with fixed API key
INSERT INTO users (email, api_key) 
VALUES ('admin@agentdevx.dev', 'admin-secret-key-1234567890abcdef')
ON CONFLICT (email) DO NOTHING;

-- Give admin user initial credits
INSERT INTO credits (user_id, balance)
SELECT id, 1000000 FROM users WHERE email = 'admin@agentdevx.dev'
ON CONFLICT (user_id) DO UPDATE SET balance = GREATEST(credits.balance, 1000000);

-- Enable RLS on users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Enable RLS on credits table
ALTER TABLE credits ENABLE ROW LEVEL SECURITY;

-- Users can only see their own row
CREATE POLICY users_self_policy ON users
  FOR SELECT
  USING (
    auth.uid()::text = id OR 
    current_setting('app.user_id', true)::text = id
  );

-- Users can only see their own credits
CREATE POLICY credits_self_policy ON credits
  FOR SELECT
  USING (
    auth.uid()::text = user_id OR 
    current_setting('app.user_id', true)::text = user_id
  );

-- Admin can see all users (check for admin role in JWT or app.admin claim)
CREATE POLICY users_admin_policy ON users
  FOR SELECT
  USING (
    current_setting('app.admin_role', true)::text = 'true'
  );

-- Admin can see all credits
CREATE POLICY credits_admin_policy ON credits
  FOR SELECT
  USING (
    current_setting('app.admin_role', true)::text = 'true'
  );

-- Users can update their own credits (for deductions)
CREATE POLICY credits_update_self_policy ON credits
  FOR UPDATE
  USING (
    auth.uid()::text = user_id OR 
    current_setting('app.user_id', true)::text = user_id
  );

-- Admin can update any credits
CREATE POLICY credits_update_admin_policy ON credits
  FOR UPDATE
  USING (
    current_setting('app.admin_role', true)::text = 'true'
  );

-- Add trigger to update updated_at on credits
CREATE OR REPLACE FUNCTION update_credits_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_credits_timestamp_trigger
  BEFORE UPDATE ON credits
  FOR EACH ROW
  EXECUTE FUNCTION update_credits_timestamp();
