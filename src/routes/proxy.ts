import { Hono } from 'hono'
import { verifyToken } from '../auth/jwt'
import { supabase } from '../db'

const proxyRoute = new Hono()

proxyRoute.post('/call', async (c) => {
  // Extract Bearer token
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }
  const token = authHeader.slice(7)

  // Verify JWT (signature, expiry, issuer)
  const payload = await verifyToken(token)
  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  const agentId = payload.sub as string

  // Verify agent still exists
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('id')
    .eq('id', agentId)
    .single()

  if (agentError || !agent) {
    return c.json({ error: 'Agent not found' }, 403)
  }

  // Parse request body: { tool_name, action, params }
  const { tool_name, action, params } = await c.req.json()
  if (!tool_name) {
    return c.json({ error: 'tool_name is required' }, 400)
  }

  // Look up the latest published version of the tool
  const { data: manifest, error: manifestError } = await supabase
    .from('tool_manifests')
    .select('manifest')
    .eq('tool_name', tool_name)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1)
    .single()

  if (manifestError || !manifest) {
    return c.json({ error: 'Tool not found or not published' }, 404)
  }

  const toolDef = manifest.manifest.tool
  const baseUrl = toolDef.base_url

  // Find the specific endpoint from the manifest
  const endpoint = toolDef.endpoints?.find((ep: any) => ep.id === action || ep.id === action)
  if (!endpoint) {
    return c.json({ error: `Action '${action}' not found in tool manifest` }, 400)
  }

  // For now, just proxy without injecting credentials (later we'll add token exchange)
  const targetUrl = (baseUrl + endpoint.path).replace(/\{(\w+)\}/g, (_: string, p: string) => (params || {})[p] ?? `{${p}}`)

  try {
    const fetchOptions: RequestInit = {
      method: endpoint.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
    }

    if (endpoint.method !== 'GET' && endpoint.method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(params)
    }

    const toolResponse = await fetch(targetUrl, fetchOptions)
    const responseBody = await toolResponse.text()

    // Log to audit
    await supabase.from('audit_log').insert({
      agent_id: agentId,
      tool_name,
      action: action || 'unknown',
      params,
      outcome: 'ALLOW',
      timestamp: new Date().toISOString()
    })

    return c.json({
      status: toolResponse.status,
      body: responseBody,
    })
  } catch (err: any) {
    // Log error attempt
    await supabase.from('audit_log').insert({
      agent_id: agentId,
      tool_name,
      action: action || 'unknown',
      params,
      outcome: 'ERROR',
      timestamp: new Date().toISOString()
    })
    return c.json({ error: err.message }, 502)
  }
})

export { proxyRoute }