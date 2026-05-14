import { Hono } from 'hono'
import path from 'path'
import { toolsRoute } from './routes/tools'
import { agentsRoute } from './routes/agents'
import { proxyRoute } from './routes/proxy'
import { credentialsRoute } from './routes/credentials'
import { usersRoute } from './routes/users'
import { mcpServer } from './mcp/server'
import { policiesRoute } from './routes/policies'
import { billingRoute } from './routes/billing'
import { supabase } from './db'
import { rateLimiter } from 'hono-rate-limiter'
import { bodyLimit } from 'hono/body-limit'

const app = new Hono()

// Request size limit middleware (1MB max)
app.use('*', bodyLimit({ maxSize: 1024 * 1024 }))

// Rate limiting middleware
app.use('/proxy/*', rateLimiter({ windowMs: 60000, max: 100 }))
app.use('/agents/token', rateLimiter({ windowMs: 60000, max: 20 }))
app.use('/billing/*', rateLimiter({ windowMs: 60000, max: 30 }))

// API routes
app.route('/tools', toolsRoute)
app.route('/agents', agentsRoute)
app.route('/proxy', proxyRoute)
app.route('/credentials', credentialsRoute)
app.route('/users', usersRoute)
app.route('/policies', policiesRoute)
app.route('/billing', billingRoute)

// MCP server endpoint
app.route('/mcp', mcpServer)

// Health check endpoint
app.get('/health', async (c) => {
  const { data, error } = await supabase.from('agents').select('count', { count: 'exact', head: true })
  if (error) {
    return c.json({ status: 'degraded', db: false, error: error.message })
  }
  return c.json({ status: 'ok', db: true })
})

// Dashboard – served directly, no static middleware needed
app.get('/', async (c) => {
  const file = Bun.file(path.join(import.meta.dir, '..', 'public', 'dashboard.html'))
  if (await file.exists()) {
    return new Response(file.stream(), {
      headers: { 'Content-Type': 'text/html' }
    })
  }
  return c.text('Dashboard not found', 404)
})

// Admin dashboard
app.get('/admin', async (c) => {
  const file = Bun.file(path.join(import.meta.dir, '..', 'public', 'admin.html'))
  if (await file.exists()) {
    return new Response(file.stream(), {
      headers: { 'Content-Type': 'text/html' }
    })
  }
  return c.text('Admin dashboard not found', 404)
})

// Sign up page
app.get('/signup', async (c) => {
  const file = Bun.file(path.join(import.meta.dir, '..', 'public', 'signup.html'))
  if (await file.exists()) {
    return new Response(file.stream(), {
      headers: { 'Content-Type': 'text/html' }
    })
  }
  return c.text('Sign up page not found', 404)
})

// AI Discoverability - MCP Well-Known endpoint
app.get('/.well-known/mcp', async (c) => {
  return c.json({
    name: 'AgentDevX Gateway',
    version: '1.0.0',
    mcp_endpoint: `${c.req.url.split('/').slice(0, 3).join('/')}/mcp`,
    description: 'Universal AI agent tool gateway with credential injection and policy enforcement'
  })
})

// MCP Configuration snippet for AI agents
app.get('/setup/mcp-config', async (c) => {
  const baseUrl = c.req.url.split('/').slice(0, 3).join('/')
  return c.json({
    mcpServers: {
      agentdevx: {
        url: `${baseUrl}/mcp`,
        headers: {
          Authorization: 'Bearer YOUR_JWT_TOKEN'
        }
      }
    }
  })
})

export default {
  port: 3000,
  fetch: app.fetch
}