// src/mcp/server.ts — MCP JSON-RPC 2.0 server implementation

import { Hono } from 'hono'
import { supabase } from '../db'
import { verifyToken } from '../auth/jwt'
import { decryptSecret } from '../services/credential-vault'

interface McpRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, any>
}

interface McpResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: any
  error?: { code: number; message: string; data?: any }
}

interface McpSession {
  agentId: string
  initialized: boolean
}

const sessions = new Map<string, McpSession>()

const mcpServer = new Hono()

/**
 * Handle MCP JSON-RPC requests
 */
mcpServer.post('/', async (c) => {
  try {
    const body: McpRequest = await c.req.json()
    const { jsonrpc, id, method, params } = body

    if (jsonrpc !== '2.0') {
      return c.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request: jsonrpc version must be 2.0' }
      })
    }

    // Extract Authorization header for session management
    const authHeader = c.req.header('Authorization')
    let sessionId = c.req.header('X-MCP-Session-ID') || `session_${Date.now()}_${Math.random().toString(36).slice(2)}`

    // Handle initialize method
    if (method === 'initialize') {
      // Verify JWT if provided
      let agentId = 'anonymous'
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7)
        const payload = await verifyToken(token)
        if (payload) {
          agentId = payload.sub as string
        }
      }

      // Create session
      sessions.set(sessionId, { agentId, initialized: true })

      const response: McpResponse = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {
              listChanged: true
            }
          },
          serverInfo: {
            name: 'AgentDevX Gateway',
            version: '1.0.0'
          }
        }
      }

      c.header('X-MCP-Session-ID', sessionId)
      return c.json(response)
    }

    // For all other methods, check session
    const session = sessions.get(sessionId)
    if (!session || !session.initialized) {
      return c.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: 'Not initialized. Call initialize first.' }
      })
    }

    // Handle tools/list method
    if (method === 'tools/list') {
      const { data, error } = await supabase
        .from('tool_manifests')
        .select('tool_name, version, manifest')
        .eq('status', 'published')
        .order('published_at', { ascending: false })

      if (error) {
        return c.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: 'Failed to fetch tools', data: error.message }
        })
      }

      // Convert to MCP tool format
      const tools = (data || []).map((row: any) => {
        const toolDef = row.manifest.tool
        const endpoints = toolDef.endpoints || []
        
        // Create one MCP tool per endpoint
        return endpoints.map((ep: any) => ({
          name: `${toolDef.name}.${ep.id}`,
          description: ep.description || `Call ${ep.id} on ${toolDef.name}`,
          inputSchema: ep.request?.body_schema || {
            type: 'object',
            properties: {},
            required: []
          }
        }))
      }).flat()

      return c.json({
        jsonrpc: '2.0',
        id,
        result: { tools }
      })
    }

    // Handle tools/call method
    if (method === 'tools/call') {
      const { name, arguments: args } = params || {}
      
      if (!name) {
        return c.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Missing tool name in parameters' }
        })
      }

      // Parse tool name: "toolName.actionId"
      const [toolName, actionId] = name.split('.')
      if (!toolName || !actionId) {
        return c.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Invalid tool name format. Use: toolName.actionId' }
        })
      }

      // Look up the tool manifest
      const { data: manifest, error: manifestError } = await supabase
        .from('tool_manifests')
        .select('manifest, provider_id')
        .eq('tool_name', toolName)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(1)
        .single()

      if (manifestError || !manifest) {
        return c.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: `Tool '${toolName}' not found` }
        })
      }

      const toolDef = manifest.manifest.tool
      const providerId = manifest.provider_id

      // Find the endpoint
      const endpoint = toolDef.endpoints?.find((ep: any) => ep.id === actionId)
      if (!endpoint) {
        return c.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: `Action '${actionId}' not found in tool '${toolName}'` }
        })
      }

      // Build target URL
      let baseUrl = toolDef.base_url
      if (baseUrl.startsWith('/')) {
        if (toolDef.name.includes('petstore') || toolDef.name.includes('PetStore')) {
          baseUrl = 'https://petstore3.swagger.io/api/v3'
        } else {
          baseUrl = 'https://api.example.com' + baseUrl
        }
      }

      const targetUrl = (baseUrl + endpoint.path).replace(/\{(\w+)\}/g, (_: string, p: string) => (args || {})[p] ?? `{${p}}`)

      // Prepare fetch options
      const fetchOptions: RequestInit = {
        method: endpoint.method || 'GET',
        headers: { 'Content-Type': 'application/json' }
      }

      if (endpoint.method !== 'GET' && endpoint.method !== 'HEAD') {
        fetchOptions.body = JSON.stringify(args)
      }

      // Credential injection (same logic as proxy)
      const authConfig = endpoint.auth || toolDef.auth
      if (authConfig && providerId) {
        const authType = authConfig.type

        if (authType === 'api_key') {
          const { data: cred } = await supabase
            .from('credentials')
            .select('encrypted_value, encrypted_iv')
            .eq('provider_id', providerId)
            .eq('type', 'api_key')
            .single()

          if (cred) {
            const apiKey = await decryptSecret(cred.encrypted_value, cred.encrypted_iv)
            const headerName = authConfig.header_name || 'X-API-Key'
            ;(fetchOptions.headers as Record<string, string>)[headerName] = apiKey
          }
        }

        if (authType === 'bearer_token') {
          const { data: cred } = await supabase
            .from('credentials')
            .select('encrypted_value, encrypted_iv')
            .eq('provider_id', providerId)
            .eq('type', 'bearer_token')
            .single()

          if (cred) {
            const bearerToken = await decryptSecret(cred.encrypted_value, cred.encrypted_iv)
            ;(fetchOptions.headers as Record<string, string>)['Authorization'] = `Bearer ${bearerToken}`
          }
        }

        if (authType === 'oauth2') {
          const { data: cred } = await supabase
            .from('credentials')
            .select('encrypted_value, encrypted_iv, metadata')
            .eq('provider_id', providerId)
            .eq('type', 'oauth2_client')
            .single()

          if (cred) {
            const clientSecret = await decryptSecret(cred.encrypted_value, cred.encrypted_iv)
            const clientId = (cred.metadata as any)?.client_id
            const tokenUrl = authConfig.token_url

            if (clientId && tokenUrl) {
              const tokenResponse = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  grant_type: 'client_credentials',
                  client_id: clientId,
                  client_secret: clientSecret,
                  scope: authConfig.scope || ''
                })
              })

              if (tokenResponse.ok) {
                const tokenData = await tokenResponse.json()
                ;(fetchOptions.headers as Record<string, string>)['Authorization'] = `Bearer ${tokenData.access_token}`
              }
            }
          }
        }
      }

      // Execute the call
      try {
        const toolResponse = await fetch(targetUrl, fetchOptions)
        const responseBody = await toolResponse.text()

        // Log to audit
        await supabase.from('audit_log').insert({
          agent_id: session.agentId,
          tool_name: toolName,
          action: actionId,
          params: args,
          outcome: 'ALLOW',
          timestamp: new Date().toISOString()
        })

        return c.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: responseBody
              }
            ]
          }
        })
      } catch (err: any) {
        await supabase.from('audit_log').insert({
          agent_id: session.agentId,
          tool_name: toolName,
          action: actionId,
          params: args,
          outcome: 'ERROR',
          timestamp: new Date().toISOString()
        })

        return c.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: 'Tool execution failed', data: err.message }
        })
      }
    }

    // Unknown method
    return c.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method '${method}' not found` }
    })
  } catch (err: any) {
    return c.json({
      jsonrpc: '2.0',
      id: 'error',
      error: { code: -32700, message: 'Parse error', data: err.message }
    })
  }
})

export { mcpServer }
