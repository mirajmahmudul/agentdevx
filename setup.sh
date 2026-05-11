#!/bin/bash
# setup.sh – one‑command project setup for AgentDevX

echo "Installing dependencies..."
bun install

echo "Generating a secure JWT_SECRET..."
JWT_SECRET=$(bun -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32)).buffer).toString('hex'))")

cat > .env <<EOL
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key
JWT_SECRET=${JWT_SECRET}
EOL

echo "Done! Edit .env with your Supabase keys, then start with:"
echo "  bun run src/index.ts"