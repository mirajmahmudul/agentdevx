import { Hono } from 'hono'
import path from 'path'
import { toolsRoute } from './routes/tools'
import { agentsRoute } from './routes/agents'
import { proxyRoute } from './routes/proxy'
import { credentialsRoute } from './routes/credentials'
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

export default {
  port: 3000,
  fetch: app.fetch
}