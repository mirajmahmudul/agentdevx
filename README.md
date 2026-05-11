# AgentDevX — Unified AI Agent Gateway

AgentDevX is a Bun + Hono API server backed by Supabase PostgreSQL. It implements a three‑pillar unified gateway for AI agents:

1. **Tool Registry & Discovery** — Publish, search, and auto-ingest tools from OpenAPI specs or MCP servers.
2. **Semantic Documentation Pipeline** — Convert OpenAPI/MCP specs into machine-executable manifests.
3. **Identity & Access Proxy** — Agents prove identity via Ed25519 challenge‑response; the proxy forwards requests while logging every action to an append‑only audit trail.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Agent     │────▶│  AgentDevX   │────▶│  Upstream    │
│ (Ed25519)   │     │   Gateway    │     │  Tool APIs   │
└─────────────┘     └──────────────┘     └──────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   Supabase   │
                    │  (PostgreSQL)│
                    └──────────────┘
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

### 3. Set up database

Run the SQL schema in `supabase/schema.sql` in your Supabase SQL Editor:

```sql
-- Copy contents of supabase/schema.sql and run in Supabase
```

Then disable Row Level Security (or create proper policies):

```sql
ALTER TABLE agents DISABLE ROW LEVEL SECURITY;
ALTER TABLE tool_manifests DISABLE ROW LEVEL SECURITY;
ALTER TABLE tool_providers DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY;
```

### 4. Start the server

```bash
bun run src/index.ts
```

Server runs on http://localhost:3000

### 5. Run the gateway test

```bash
bun run test-gateway.ts
```

## API Endpoints

### Agents

- `POST /agents/register` — Register an agent with Ed25519 public key
- `POST /agents/token` — Get HS256 JWT via challenge-response

### Tools

- `POST /tools/publish` — Manually publish a tool manifest
- `GET /tools` — Search tools by name or capability
- `GET /tools/:name/:version/manifest` — Get specific manifest
- `POST /tools/ingest` — Auto-ingest from OpenAPI spec
- `POST /tools/ingest-mcp` — Auto-ingest from MCP server

### Proxy

- `POST /proxy/call` — Call a tool action (requires Bearer JWT)

## Testing

- `test-gateway.ts` — End-to-end gateway integration test
- `test-mcp-server.ts` — Mock MCP server for testing ingestion
- `test-proxy.ts` — Proxy-specific tests

## Roadmap

- [ ] Phase 3.4: Credential Injection (AES-256-GCM vault)
- [ ] Phase 3.5: MCP Server Interface
- [ ] Phase 4: Production Hardening (RLS, rate limiting, health checks)
- [ ] Phase 5: OPA Rego Policy Enforcement
- [ ] Phase 6: Deployment (Docker, Railway)
- [ ] Phase 7: Monetisation (Stripe integration)

## License

MIT
