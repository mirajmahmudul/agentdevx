import { parse as parseYaml } from 'yaml'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
export interface AgentDevXManifest {
  agentdevx: '1.0'
  tool: {
    name: string
    version: string
    description: string
    base_url: string
    auth?: {
      type: 'none' | 'api_key' | 'oauth2' | 'mtls'
      scopes?: string[]
      token_endpoint?: string
      client_credential_flow?: boolean
      instructions?: string
    }
    endpoints: Endpoint[]
    fallback?: { tool: string; version: string }
    pricing?: {
      model: 'free' | 'per_request' | 'subscription' | 'usage_based'
      unit_price_usd?: number
      currency?: string
      details?: string
    }
  }
}

export interface Endpoint {
  id: string
  method: string
  path: string
  description?: string
  request: {
    headers: Record<string, string>
    body_schema?: Record<string, any>
    query_params?: Record<string, { type: string; description?: string; required?: boolean }>
  }
  response?: {
    status_codes?: number[]
    success_schema?: Record<string, any>
    error_schema?: Record<string, any>
  }
  rate_limit?: { requests_per_minute?: number; burst?: number }
  side_effects?: string[]
  deprecated?: boolean
  examples?: { request: any; response: any }[]
}

// ──────────────────────────────────────────────
// Helper: fetch and parse OpenAPI spec
// ──────────────────────────────────────────────
async function fetchSpec(specUrl: string): Promise<any> {
  const response = await fetch(specUrl)
  if (!response.ok) throw new Error(`Failed to fetch spec: ${response.status}`)
  const text = await response.text()

  if (
    specUrl.endsWith('.yaml') ||
    specUrl.endsWith('.yml') ||
    text.trim().startsWith('openapi:')
  ) {
    return parseYaml(text)
  }
  return JSON.parse(text)
}

// ──────────────────────────────────────────────
// Main converter
// ──────────────────────────────────────────────
export async function convertOpenApiToManifest(
  specUrl: string,
  toolName?: string,
  toolVersion?: string
): Promise<AgentDevXManifest> {
  const spec = await fetchSpec(specUrl)

  if (!spec.openapi || !spec.info) {
    throw new Error('Invalid OpenAPI spec – missing "openapi" or "info"')
  }

  // Base details
  const baseUrl: string = spec.servers?.[0]?.url ?? ''
  const description: string = spec.info.description ?? spec.info.title ?? ''
  const name: string =
    toolName ??
    spec.info.title?.toLowerCase().replace(/\s+/g, '-') ??
    'openapi-tool'
  const version: string = toolVersion ?? spec.info.version ?? '0.0.0'

  // Endpoints
  const endpoints: Endpoint[] = []
  const paths = spec.paths ?? {}

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue

    // Methods to check
    const methods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const

    for (const method of methods) {
      const operation = (pathItem as any)[method]
      if (!operation) continue

      // Build endpoint
      const endpoint: Endpoint = {
        id:
          operation.operationId ??
          `${method}-${path.replace(/\//g, '-').replace(/^-/, '')}`,
        method: method.toUpperCase(),
        path,
        description: operation.summary ?? operation.description ?? '',
        request: {
          headers: { 'Content-Type': 'application/json' },
        },
        deprecated: operation.deprecated ?? false,
      }

      // Request body
      const requestBody = operation.requestBody?.content?.['application/json']?.schema
      if (requestBody) {
        endpoint.request.body_schema = requestBody
      }

      // Query parameters (operation-level + path-level)
      const allParams = [
        ...(pathItem as any).parameters ?? [],
        ...(operation.parameters ?? [])
      ]
      const queryParams = allParams.filter((p: any) => p.in === 'query')
      if (queryParams.length > 0) {
        endpoint.request.query_params = {}
        for (const p of queryParams) {
          endpoint.request.query_params[p.name] = {
            type: p.schema?.type ?? 'string',
            description: p.description,
            required: p.required ?? false,
          }
        }
      }

      // Responses
      const responses = operation.responses ?? {}
      const successCodes = Object.keys(responses).filter(code => code.startsWith('2'))
      if (successCodes.length > 0) {
        const firstCode = successCodes[0] as string
        endpoint.response = {
          status_codes: successCodes.map(Number),
          success_schema: responses[firstCode]?.content?.['application/json']?.schema,
          error_schema: responses['400']?.content?.['application/json']?.schema,
        }
      }

      endpoints.push(endpoint)
    }
  }

  // Debug: log endpoint count (comment out in production)
  console.log(`Converted ${endpoints.length} endpoints from ${Object.keys(paths).length} paths`)

  // Auth
  let auth: AgentDevXManifest['tool']['auth'] | undefined
  const securitySchemes = spec.components?.securitySchemes
  if (securitySchemes) {
    for (const [key, scheme] of Object.entries(securitySchemes)) {
      if (scheme && typeof scheme === 'object' && 'type' in scheme) {
        const typedScheme = scheme as {
          type: string
          scopes?: Record<string, any>
          flows?: {
            clientCredentials?: { tokenUrl?: string }
            authorizationCode?: { tokenUrl?: string }
          }
          name?: string
          scheme?: string
        }

        if (typedScheme.type === 'oauth2' || typedScheme.type === 'openIdConnect') {
          auth = {
            type: 'oauth2',
            scopes: typedScheme.scopes ? Object.keys(typedScheme.scopes) : undefined,
            token_endpoint:
              typedScheme.flows?.clientCredentials?.tokenUrl ??
              typedScheme.flows?.authorizationCode?.tokenUrl,
            client_credential_flow: !!typedScheme.flows?.clientCredentials,
            instructions: `OAuth2 via ${typedScheme.type}`,
          }
        } else if (typedScheme.type === 'apiKey') {
          auth = {
            type: 'api_key',
            instructions: `Include header "${typedScheme.name}" with API key`,
          }
        } else if (typedScheme.type === 'http' && typedScheme.scheme === 'bearer') {
          auth = { type: 'none', instructions: 'Bearer token required' }
        }
      }
      break
    }
  }

  // Assemble final manifest (ALWAYS with agentdevx key)
  return {
    agentdevx: '1.0',
    tool: {
      name,
      version,
      description,
      base_url: baseUrl,
      endpoints,
      auth,
      pricing: { model: 'free' },
    },
  }
}