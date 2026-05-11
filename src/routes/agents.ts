import { Hono } from 'hono'
import { supabase } from '../db'
import { signToken } from '../auth/jwt'

const agentsRoute = new Hono()

// ---- Registration ----
agentsRoute.post('/register', async (c) => {
  try {
    const { name, public_key, owner_id } = await c.req.json()

    if (!name || !public_key || !owner_id) {
      return c.json({ error: 'name, public_key, and owner_id are required' }, 400)
    }

    if (!/^[0-9a-fA-F]{64}$/.test(public_key)) {
      return c.json({ error: 'public_key must be a 64-character hex string' }, 400)
    }

    const { data, error } = await supabase
      .from('agents')
      .insert({ name, public_key, owner_id })
      .select('id, name, public_key, key_algorithm, created_at')
      .single()

    if (error) {
      return c.json({ error: error.message }, 400)
    }

    return c.json(data, 201)
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// ---- Token issuance (challenge-response) ----
agentsRoute.post('/token', async (c) => {
  try {
    const { agent_id, nonce, signature } = await c.req.json()

    if (!agent_id || !nonce || !signature) {
      return c.json({ error: 'agent_id, nonce, and signature are required' }, 400)
    }

    // Fetch agent record
    const { data: agent, error } = await supabase
      .from('agents')
      .select('id, public_key')
      .eq('id', agent_id)
      .single()

    if (error || !agent) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    // Verify signature over the nonce using the agent's registered public key
    const publicKeyHex = agent.public_key
    const publicKeyBuffer = Buffer.from(publicKeyHex, 'hex')
    const publicKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBuffer,
      { name: 'Ed25519' },
      false,
      ['verify']
    )

    const encoder = new TextEncoder()
    const valid = await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      Buffer.from(signature, 'hex'),
      encoder.encode(nonce)
    )

    if (!valid) {
      return c.json({ error: 'Invalid signature' }, 401)
    }

    // Issue a short-lived JWT bound to the agent's public key (RFC 8705)
    const token = await signToken({
      sub: agent.id,
      cnf: {
        jwk: {
          kty: 'OKP',
          crv: 'Ed25519',
          x: publicKeyHex,
        },
      },
      scope: ['*'],
    })

    return c.json({ access_token: token, expires_in: 300 })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

export { agentsRoute }