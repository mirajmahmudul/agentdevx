# AgentDevX — Unified AI Agent Gateway

AgentDevX is a Bun + Hono API server backed by Supabase PostgreSQL. It implements a three-pillar unified gateway for AI agents:

1. **Tool Registry & Discovery** — Publish, search, and auto-ingest tools from OpenAPI specs or MCP servers.
2. **Semantic Documentation Pipeline** — Convert OpenAPI/MCP specs into machine-executable manifests.
3. **Identity & Access Proxy** — Agents prove identity via Ed25519 challenge-response; the proxy forwards requests while logging every action to an append-only audit trail.

## Architecture

```
┌────────────┐     ┌───────────────┐     ┌───────────────┐
│   Agent    │────▶│  AgentDevX    │────▶│  Upstream     │
│ (Ed25519)  │     │   Gateway     │     │  Tool APIs    │
└────────────┘     └───────────────┘     └───────────────┘
                           │
                           ▼
                    ┌───────────────┐
                    │   Supabase    │
                    │  (PostgreSQL) │
                    └───────────────┘
```

## Quick Start

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Required variables:
- `SUPABASE_URL` — Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (for server-side operations)
- `SUPABASE_ANON_KEY` — Anon key (for dashboard)
- `JWT_SECRET` — 64-character hex string for HS256 JWT signing
- `VAULT_SECRET` — 64-character hex string for credential encryption

### 3. Set up database

Run the SQL migrations in order in your Supabase SQL Editor:

```sql
-- 1. Enable RLS with multi-tenant isolation
-- Run: supabase/migrations/001_enable_rls.sql

-- 2. Make audit_log append-only (EU AI Act compliance)
-- Run: supabase/migrations/002_audit_log_append_only.sql

-- 3. Create users and credits tables
-- Run: supabase/migrations/003_users_and_credits.sql
```

### 4. Start the server

```bash
bun run src/index.ts
```

Server runs on http://localhost:3000

## Features

### Core Gateway
- **Agent Registration**: Ed25519 key-based identity
- **JWT Issuance**: HS256 tokens with 5-minute expiry
- **Tool Registry**: Publish, search, and ingest tools
- **Secure Proxy**: Credential injection and policy enforcement
- **Audit Logging**: Append-only trail of all actions

### Credit System
- **Free Tier**: 75,000 credits on signup
- **Pay-per-use**: 1 credit per proxy call
- **Usage Limits**: 402 Payment Required when exhausted
- **Admin Top-up**: Manual credit addition via dashboard

### MCP Integration
- **Native MCP Server**: Connect via `/mcp` endpoint
- **Auto-Discovery**: `/.well-known/mcp` for AI agents
- **Config Snippet**: `/setup/mcp-config` for instant setup

### Security
- **Row Level Security**: Multi-tenant isolation
- **Rate Limiting**: 100 req/min on proxy, 20 req/min on auth
- **Body Limits**: 1MB max request size
- **OPA Policies**: Fine-grained access control

## API Endpoints

### User Management
- `POST /users/register` — Create account (75k free credits)
- `POST /users/login` — Get JWT token
- `GET /users/me` — Get profile and credit balance

### Agent Management
- `POST /agents/register` — Register agent with public key
- `POST /agents/token` — Challenge-response auth → JWT

### Tool Registry
- `POST /tools/publish` — Publish tool manifest
- `GET /tools` — Search tools
- `POST /tools/ingest` — Import from OpenAPI
- `POST /tools/ingest-mcp` — Import from MCP server

### Proxy
- `POST /proxy/call` — Execute tool action (requires JWT)

### Credentials
- `POST /credentials` — Store encrypted API key
- `GET /credentials/:provider_id` — List credential types

### Admin
- `GET /admin/stats/*` — System statistics
- `POST /admin/credits/topup` — Add credits to user
- `GET /admin/users` — List all users
- `GET /admin/audit/recent` — Recent audit log entries

### AI Discoverability
- `GET /.well-known/mcp` — MCP server discovery
- `GET /setup/mcp-config` — MCP configuration snippet

### Health
- `GET /health` — Server health check

## Web Interfaces

- **Dashboard**: http://localhost:3000 — Tool registry viewer
- **Sign Up**: http://localhost:3000/signup — User registration
- **Admin Panel**: http://localhost:3000/admin — User management

Default admin credentials:
- Email: `admin@agentdevx.dev`
- API Key: `admin-secret-key`

## Testing

```bash
# Run end-to-end gateway test
bun run test-gateway.ts

# Test MCP server
bun run test-mcp-server.ts
```

## Project Structure

```
agentdevx/
├── src/
│   ├── index.ts                 # Main server entry
│   ├── db.ts                    # Supabase client
│   ├── auth/jwt.ts              # JWT sign/verify
│   ├── routes/
│   │   ├── tools.ts             # Tool registry
│   │   ├── agents.ts            # Agent management
│   │   ├── proxy.ts             # Secure call proxy
│   │   ├── credentials.ts       # Credential vault
│   │   ├── users.ts             # User management
│   │   ├── policies.ts          # OPA policies
│   │   └── billing.ts           # Stripe integration
│   ├── services/
│   │   └── credential-vault.ts  # AES-256-GCM encryption
│   ├── policy/
│   │   └── engine.ts            # OPA WASM engine
│   ├── ingestion/
│   │   ├── openapi-converter.ts
│   │   └── mcp-converter.ts
│   └── mcp/
│       └── server.ts            # MCP JSON-RPC server
├── public/
│   ├── dashboard.html           # Tool dashboard
│   ├── admin.html               # Admin panel
│   └── signup.html              # Sign-up page
├── supabase/migrations/
│   ├── 001_enable_rls.sql
│   ├── 002_audit_log_append_only.sql
│   └── 003_users_and_credits.sql
├── registry/
│   └── agentdevx.json           # MCP Registry listing
├── scripts/
│   └── install.sh               # One-line installer
├── Dockerfile
├── package.json
└── README.md
```

## Database Migrations

All migrations are in `supabase/migrations/` and must be run in order:

1. **001_enable_rls.sql** — Row Level Security policies for multi-tenant isolation
2. **002_audit_log_append_only.sql** — Revoke UPDATE/DELETE on audit_log (EU AI Act)
3. **003_users_and_credits.sql** — Users table with credit balances and admin seeding

## Deployment

### Docker

```bash
docker build -t agentdevx .
docker run -p 3000:3000 --env-file .env agentdevx
```

### Railway

1. Connect GitHub repository
2. Set environment variables from `.env.example`
3. Deploy automatically on push to main

### One-Line Installer

```bash
curl -sSf https://raw.githubusercontent.com/mirajmahmudul/agentdevx/main/scripts/install.sh | bash
```

## Environment Variables

See `.env.example` for all required variables:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key
JWT_SECRET=64-char-hex-string
VAULT_SECRET=64-char-hex-string
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Testing Checklist

- [ ] `bun run src/index.ts` starts without errors
- [ ] `bun run test-gateway.ts` passes
- [ ] User registration works at `/signup`
- [ ] Admin login works at `/admin`
- [ ] Credit deduction occurs on proxy calls
- [ ] MCP endpoint responds at `/mcp`
- [ ] Health check returns OK at `/health`

## Roadmap

- [x] Phase 3.4: Credential Injection (AES-256-GCM vault)
- [x] Phase 3.5: MCP Server Interface
- [x] Phase 4: Production Hardening (RLS, rate limiting, health checks)
- [x] Phase 5: OPA Rego Policy Enforcement
- [x] Phase 6: Deployment (Docker, Railway)
- [x] Phase 7: Monetisation (Stripe integration)
- [x] Credit System & User Management
- [ ] Marketplace Integration (Q3 2026)
- [ ] Multi-region Deployment (Q4 2026)

## License

MIT
