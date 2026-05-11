// src/routes/policies.ts — Policy management endpoints

import { Hono } from 'hono'
import { supabase } from '../db'
import { policyEngine } from '../policy/engine'

const policiesRoute = new Hono()

/**
 * POST /policies — Upload a Rego policy
 * Body: { name, rego_code, description? }
 */
policiesRoute.post('/', async (c) => {
  const { name, rego_code, description } = await c.req.json()

  if (!name || !rego_code) {
    return c.json({ error: 'name and rego_code are required' }, 400)
  }

  // Insert into policies table
  const { data, error } = await supabase
    .from('policies')
    .insert({
      name,
      rego_code,
      description: description || null,
      status: 'active'
    })
    .select()
    .single()

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Load policy into engine
  await policyEngine.loadPolicy(name, rego_code)

  return c.json({
    id: data.id,
    name: data.name,
    description: data.description,
    status: data.status,
    created_at: data.created_at
  }, 201)
})

/**
 * GET /policies — List active policies
 */
policiesRoute.get('/', async (c) => {
  const { data, error } = await supabase
    .from('policies')
    .select('id, name, description, status, created_at, updated_at')
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json(data)
})

/**
 * GET /policies/:id — Get a specific policy
 */
policiesRoute.get('/:id', async (c) => {
  const id = c.req.param('id')

  const { data, error } = await supabase
    .from('policies')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    return c.json({ error: 'Policy not found' }, 404)
  }

  return c.json(data)
})

/**
 * PUT /policies/:id — Update a policy
 */
policiesRoute.put('/:id', async (c) => {
  const id = c.req.param('id')
  const { rego_code, description, status } = await c.req.json()

  const updateData: Record<string, any> = {}
  if (rego_code !== undefined) updateData.rego_code = rego_code
  if (description !== undefined) updateData.description = description
  if (status !== undefined) updateData.status = status
  updateData.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('policies')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Reload policy into engine if rego_code changed
  if (rego_code && data.status === 'active') {
    await policyEngine.loadPolicy(data.name, rego_code)
  }

  return c.json(data)
})

/**
 * DELETE /policies/:id — Delete a policy (soft delete by setting status to deprecated)
 */
policiesRoute.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const { error } = await supabase
    .from('policies')
    .update({ status: 'deprecated', updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({ message: 'Policy deprecated' })
})

export { policiesRoute }
