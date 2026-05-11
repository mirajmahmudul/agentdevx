import { Hono } from 'hono'
import path from 'path'
import { toolsRoute } from './routes/tools'
import { agentsRoute } from './routes/agents'
import { proxyRoute } from './routes/proxy'

const app = new Hono()

// API routes
app.route('/tools', toolsRoute)
app.route('/agents', agentsRoute)
app.route('/proxy', proxyRoute)

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