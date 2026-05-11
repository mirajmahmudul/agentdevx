import type { AgentDevXManifest, Endpoint } from './openapi-converter'

interface McpTool {
  name: string
  description?: string
  inputSchema?: {
    type?: string
    properties?: Record<string, any>
    required?: string[]
  }
}

/**
 * Connect to an MCP server via raw JSON‑RPC 2.0 over HTTP
 * and convert its tool list into an AgentDevX manifest.
 *
 * This module follows the official MCP specification without
 * relying on any third‑party SDK, making it future‑proof
 * and suitable for industrial deployments.
 */
export async function convertMcpToManifest(
  serverUrl: string,
  toolName?: string,
  toolVersion?: string
): Promise<AgentDevXManifest> {
  // 1. Initialize the MCP connection (MCP requires a handshake)
  const initResponse = await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agentdevx-ingestor', version: '1.0.0' }
      },
      id: 1
    })
  })

  if (!initResponse.ok) {
    throw new Error(`MCP server unreachable: ${initResponse.status}`)
  }

  // 2. Fetch the list of tools
  const toolsResponse = await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 2
    })
  })

  if (!toolsResponse.ok) {
    throw new Error(`MCP tools/list failed: ${toolsResponse.status}`)
  }

  const data: any = await toolsResponse.json()
  if (data.error) {
    throw new Error(`MCP error: ${data.error.message}`)
  }

  const tools: McpTool[] = data.result?.tools ?? []

  // 3. Convert each tool definition into an AgentDevX endpoint
  const endpoints: Endpoint[] = tools.map((tool) => {
    const inputSchema = tool.inputSchema ?? {}
    const props = inputSchema.properties ?? {}
    const required = inputSchema.required ?? []

    const params: Record<string, any> = {}
    for (const [key, value] of Object.entries(props)) {
      params[key] = {
        type: (value as any).type ?? 'string',
        description: (value as any).description ?? '',
        required: required.includes(key)
      }
    }

    return {
      id: tool.name,
      method: 'POST',                // MCP tool invocations are always POST‑like
      path: '/mcp/tools/call/' + tool.name,
      description: tool.description ?? '',
      request: {
        headers: { 'Content-Type': 'application/json' },
        body_schema: {
          type: 'object',
          properties: params,
          required
        }
      },
      response: {
        status_codes: [200],
        success_schema: { type: 'object' }
      }
    }
  })

  // 4. Assemble the full AgentDevX manifest
  return {
    agentdevx: '1.0',
    tool: {
      name: toolName ?? 'mcp-server',
      version: toolVersion ?? '0.0.0',
      description: `MCP server at ${serverUrl}`,
      base_url: serverUrl,
      endpoints,
      pricing: { model: 'free' }
    }
  }
}