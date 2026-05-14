#!/bin/bash
set -e

echo "🚀 AgentDevX Gateway Installer"
echo "=============================="

# Check if Bun is installed
if ! command -v bun &> /dev/null; then
    echo "📦 Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

echo "✅ Bun installed: $(bun --version)"

# Clone or update repository
if [ -d "agentdevx" ]; then
    echo "📁 Updating existing installation..."
    cd agentdevx
    git pull
else
    echo "📥 Cloning AgentDevX repository..."
    git clone https://github.com/mirajmahmudul/agentdevx.git
    cd agentdevx
fi

# Install dependencies
echo "📦 Installing dependencies..."
bun install

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚙️  Creating .env file..."
    cp .env.example .env
    echo ""
    echo "🔑 Please edit .env and configure:"
    echo "   - SUPABASE_URL"
    echo "   - SUPABASE_SERVICE_ROLE_KEY"
    echo "   - SUPABASE_ANON_KEY"
    echo "   - JWT_SECRET"
    echo "   - VAULT_SECRET"
    echo ""
    read -p "Press Enter after configuring .env..."
fi

# Run database migrations
echo "🗄️  Running database migrations..."
echo "   Please run the following SQL files in Supabase SQL Editor:"
echo "   1. supabase/migrations/001_enable_rls.sql"
echo "   2. supabase/migrations/002_audit_log_append_only.sql"
echo "   3. supabase/migrations/003_users_and_credits.sql"
echo ""
read -p "Press Enter after running migrations..."

# Start the server
echo "🚀 Starting AgentDevX Gateway..."
echo ""
echo "✅ Installation complete!"
echo ""
echo "📊 Dashboard: http://localhost:3000"
echo "🛡️  Admin Panel: http://localhost:3000/admin"
echo "✍️  Sign Up: http://localhost:3000/signup"
echo "🔌 MCP Endpoint: http://localhost:3000/mcp"
echo ""
echo "To start the server manually:"
echo "  bun run src/index.ts"
echo ""

# Auto-start (optional)
if [ "$1" == "--start" ]; then
    bun run src/index.ts
fi
