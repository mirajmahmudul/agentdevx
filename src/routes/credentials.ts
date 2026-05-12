// src/routes/credentials.ts — Credential management endpoints

import { Hono } from 'hono'
import { supabase } from '../db'
import { encryptSecret, decryptSecret } from '../services/credential-vault'

const credentialsRoute = new Hono()

/**
 * POST /credentials — Store an encrypted credential for a provider
 * Body: { provider_id, type, value, expires_at?, metadata? }
 * type: 'api_key' | 'oauth2_client' | 'bearer_token'
 */
credentialsRoute.post('/', async (c) => {
  const { provider_id, type, value, expires_at, metadata } = await c.req.json()

  if (!provider_id || !type || !value) {
    return c.json({ error: 'provider_id, type, and value are required' }, 400)
  }

  if (!['api_key', 'oauth2_client', 'bearer_token'].includes(type)) {
    return c.json({ error: 'Invalid type. Must be api_key, oauth2_client, or bearer_token' }, 400)
  }

  // Encrypt the secret value
  const { ciphertext, iv } = await encryptSecret(value)

  // Insert into credentials table
  const { data, error } = await supabase
    .from('credentials')
    .insert({
      provider_id,
      type,
      encrypted_value: ciphertext,
      encrypted_iv: iv,
      expires_at: expires_at || null,
      metadata: metadata || {}
    })
    .select()
    .single()

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    id: data.id,
    provider_id: data.provider_id,
    type: data.type,
    created_at: data.created_at,
    expires_at: data.expires_at
  }, 201)
})

/**
 * GET /credentials/:provider_id — List credential types (not values) for a provider
 */
credentialsRoute.get('/:provider_id', async (c) => {
  const provider_id = c.req.param('provider_id')

  const { data, error } = await supabase
    .from('credentials')
    .select('id, type, created_at, expires_at, metadata')
    .eq('provider_id', provider_id)
    .order('created_at', { ascending: false })

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json(data)
})

/**
 * GET /credentials/:id/decrypt — Decrypt a specific credential (admin only)
 * This should be protected in production with additional auth
 */
credentialsRoute.get('/:id/decrypt', async (c) => {
  const id = c.req.param('id')

  const { data, error } = await supabase
    .from('credentials')
    .select('encrypted_value, encrypted_iv, type')
    .eq('id', id)
    .single()

  if (error || !data) {
    return c.json({ error: 'Credential not found' }, 404)
  }

  const plaintext = await decryptSecret(data.encrypted_value, data.encrypted_iv)

  return c.json({
    id,
    type: data.type,
    value: plaintext
  })
})

/**
 * DELETE /credentials/:id — Revoke a credential
 */
credentialsRoute.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const { error } = await supabase
    .from('credentials')
    .delete()
    .eq('id', id)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({ message: 'Credential revoked' })
})

export { credentialsRoute }
