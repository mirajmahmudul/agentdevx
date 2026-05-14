import { Hono } from 'hono'
import { verifyToken } from '../auth/jwt'
import { supabase } from '../db'
import { decryptSecret } from '../services/credential-vault'
import { policyEngine } from '../policy/engine'

const proxyRoute = new Hono()

/**
 * Get agent's usage count for the last 30 days
 */
async function getAgentUsage(agentId: string): Promise<number> {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { count, error } = await supabase
    .from('audit_log')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .gte('timestamp', thirtyDaysAgo.toISOString())

  if (error) {
    console.error('Error fetching agent usage:', error)
    return 0
  }

  return count || 0
}

/**
 * Check if agent has exceeded their tier limit
 * Returns true if limit exceeded, false otherwise
 */
async function checkTierLimit(agentId: string): Promise<{ exceeded: boolean; tier: string; limit: number; usage: number }> {
  // Get subscription tier
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('tier, status')
    .eq('agent_id', agentId)
    .single()

  const currentTier = subscription?.status === 'active' ? (subscription.tier || 'free') : 'free'
  
  const tierLimits: Record<string, number> = {
    free: 1000,
    pro: 50000,
    team: 500000,
    enterprise: -1 // unlimited
  }

  const limit = tierLimits[currentTier] || 1000
  
  // Enterprise tier has no limit
  if (limit === -1) {
    return { exceeded: false, tier: currentTier, limit: Infinity, usage: 0 }
  }

  const usage = await getAgentUsage(agentId)
  const exceeded = usage >= limit

  return { exceeded, tier: currentTier, limit, usage }
}

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
    .select('id, owner_id')
    .eq('id', agentId)
    .single()

  if (agentError || !agent) {
    return c.json({ error: 'Agent not found' }, 403)
  }

  // CREDIT CHECK: Get the user's credit balance and deduct if sufficient
  const ownerId = agent.owner_id;
  
  // Query credits for this user
  const { data: credits, error: creditsError } = await supabase
    .from('credits')
    .select('balance')
    .eq('user_id', ownerId)
    .single();

  if (creditsError || !credits) {
    // No credits found - could be an old agent without a user
    // For backward compatibility, allow the request but log a warning
    console.warn(`No credits found for user ${ownerId}, allowing request for backward compatibility`);
  } else if (credits.balance <= 0) {
    // Insufficient credits
    await supabase.from('audit_log').insert({
      agent_id: agentId,
      tool_name: 'system',
      action: 'insufficient_credits',
      params: { balance: credits.balance, owner_id: ownerId },
      outcome: 'DENY',
      timestamp: new Date().toISOString()
    });

    return c.json({ 
      error: 'Insufficient credits',
      reason: 'Your credit balance is 0. Please contact your administrator to add more credits.',
      balance: 0
    }, 402);
  } else {
    // Deduct 1 credit atomically
    const { error: deductionError } = await supabase
      .from('credits')
      .update({ balance: supabase.raw('balance - 1') })
      .eq('user_id', ownerId)
      .gt('balance', 0); // Ensure balance is still positive

    if (deductionError) {
      console.error('Credit deduction error:', deductionError);
    } else {
      // Log credit deduction to audit
      await supabase.from('audit_log').insert({
        agent_id: agentId,
        tool_name: 'system',
        action: 'credit_deduction',
        params: { previous_balance: credits.balance, owner_id: ownerId },
        outcome: 'ALLOW',
        timestamp: new Date().toISOString()
      });
    }
  }

  // TIER ENFORCEMENT: Check if agent has exceeded their usage limit
  const tierCheck = await checkTierLimit(agentId)
  if (tierCheck.exceeded) {
    // Log tier violation to audit
    await supabase.from('audit_log').insert({
      agent_id: agentId,
      tool_name: 'system',
      action: 'tier_limit_exceeded',
      params: { tier: tierCheck.tier, limit: tierCheck.limit, usage: tierCheck.usage },
      outcome: 'DENY',
      timestamp: new Date().toISOString()
    })

    return c.json({ 
      error: 'Payment Required',
      reason: `You have exceeded your ${tierCheck.tier} tier limit of ${tierCheck.limit.toLocaleString()} calls per 30 days. Current usage: ${tierCheck.usage.toLocaleString()}. Please upgrade your plan.`,
      tier: tierCheck.tier,
      limit: tierCheck.limit,
      usage: tierCheck.usage
    }, 402)
  }

  // Parse request body: { tool_name, action, params }
  const { tool_name, action, params } = await c.req.json()
  if (!tool_name) {
    return c.json({ error: 'tool_name is required' }, 400)
  }

  // OPA POLICY ENFORCEMENT: Evaluate policies before proceeding
  const policyResult = await policyEngine.evaluate({
    agent_id: agentId,
    tool_name,
    action: action || 'unknown',
    params
  })

  if (!policyResult.allow) {
    // Log denial to audit
    await supabase.from('audit_log').insert({
      agent_id: agentId,
      tool_name,
      action: action || 'unknown',
      params,
      outcome: 'DENY',
      timestamp: new Date().toISOString()
    })

    return c.json({ 
      error: 'Access denied by policy',
      reason: policyResult.reason 
    }, 403)
  }

  // Look up the latest published version of the tool
  const { data: manifest, error: manifestError } = await supabase
    .from('tool_manifests')
    .select('manifest, provider_id')
    .eq('tool_name', tool_name)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1)
    .single()

  if (manifestError || !manifest) {
    return c.json({ error: 'Tool not found or not published' }, 404)
  }

  const toolDef = manifest.manifest.tool
  let baseUrl = toolDef.base_url
  const providerId = manifest.provider_id

  // Handle relative base URLs - Petstore uses /api/v3 which should be https://petstore3.swagger.io/api/v3
  if (baseUrl.startsWith('/')) {
    // This is a relative URL from OpenAPI ingestion, use the original server URL
    // For petstore-api specifically, map to the live demo server
    if (toolDef.name.includes('petstore') || toolDef.name.includes('PetStore')) {
      baseUrl = 'https://petstore3.swagger.io/api/v3'
    } else {
      // Default fallback for other relative URLs
      baseUrl = 'https://api.example.com' + baseUrl
    }
  }

  // Find the specific endpoint from the manifest
  const endpoint = toolDef.endpoints?.find((ep: any) => ep.id === action || ep.id === action)
  if (!endpoint) {
    return c.json({ error: `Action '${action}' not found in tool manifest` }, 400)
  }

  // Build target URL with path parameter substitution
  const targetUrl = (baseUrl + endpoint.path).replace(/\{(\w+)\}/g, (_: string, p: string) => (params || {})[p] ?? `{${p}}`)

  // Prepare fetch options
  const fetchOptions: RequestInit = {
    method: endpoint.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
  }

  if (endpoint.method !== 'GET' && endpoint.method !== 'HEAD') {
    fetchOptions.body = JSON.stringify(params)
  }

  // CREDENTIAL INJECTION: Check if tool has auth defined and inject credentials
  const authConfig = endpoint.auth || toolDef.auth
  if (authConfig && providerId) {
    const authType = authConfig.type

    if (authType === 'api_key') {
      // Look up API key credential for this provider
      const { data: cred, error: credError } = await supabase
        .from('credentials')
        .select('encrypted_value, encrypted_iv')
        .eq('provider_id', providerId)
        .eq('type', 'api_key')
        .single()

      if (credError || !cred) {
        console.warn(`No API key credential found for provider ${providerId}, proceeding without auth`)
      } else {
        // Decrypt the API key
        const apiKey = await decryptSecret(cred.encrypted_value, cred.encrypted_iv)
        // Inject into headers based on auth config
        const headerName = authConfig.header_name || 'X-API-Key'
        ;(fetchOptions.headers as Record<string, string>)[headerName] = apiKey
      }
    }

    if (authType === 'bearer_token') {
      // Look up bearer token credential for this provider
      const { data: cred, error: credError } = await supabase
        .from('credentials')
        .select('encrypted_value, encrypted_iv')
        .eq('provider_id', providerId)
        .eq('type', 'bearer_token')
        .single()

      if (credError || !cred) {
        console.warn(`No bearer token credential found for provider ${providerId}, proceeding without auth`)
      } else {
        // Decrypt the bearer token
        const bearerToken = await decryptSecret(cred.encrypted_value, cred.encrypted_iv)
        ;(fetchOptions.headers as Record<string, string>)['Authorization'] = `Bearer ${bearerToken}`
      }
    }

    if (authType === 'oauth2') {
      // For OAuth2, we need to perform client credentials flow
      const { data: cred, error: credError } = await supabase
        .from('credentials')
        .select('encrypted_value, encrypted_iv, metadata')
        .eq('provider_id', providerId)
        .eq('type', 'oauth2_client')
        .single()

      if (credError || !cred) {
        console.warn(`No OAuth2 client credential found for provider ${providerId}, proceeding without auth`)
      } else {
        // Decrypt client secret
        const clientSecret = await decryptSecret(cred.encrypted_value, cred.encrypted_iv)
        const clientId = (cred.metadata as any)?.client_id
        const tokenUrl = authConfig.token_url

        if (!clientId || !tokenUrl) {
          console.warn('OAuth2 configuration missing client_id or token_url')
        } else {
          // Perform client credentials flow
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

          if (!tokenResponse.ok) {
            console.warn('Failed to obtain OAuth2 access token')
          } else {
            const tokenData = await tokenResponse.json()
            const accessToken = tokenData.access_token
            ;(fetchOptions.headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`
          }
        }
      }
    }
  }

  try {
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