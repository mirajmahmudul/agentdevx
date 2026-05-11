import { Hono } from 'hono'
import { z } from 'zod'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { supabase } from '../db'
import { toolManifestSchema } from '../schemas/tool-manifest.schema'
import { convertOpenApiToManifest } from '../ingestion/openapi-converter'
import { convertMcpToManifest } from '../ingestion/mcp-converter'

const toolsRoute = new Hono()

const ajv = new Ajv({ strict: false })
addFormats(ajv)
const validateManifest = ajv.compile(toolManifestSchema)

const publishSchema = z.object({
  provider_name: z.string(),
  provider_owner: z.string(),
  tool_name: z.string(),
  version: z.string(),
  manifest: z.any()
})

// Publish a manifest manually
toolsRoute.post('/publish', async (c) => {
  try {
    const body = await c.req.json()
    const data = publishSchema.parse(body)

    if (!validateManifest(data.manifest)) {
      return c.json({
        error: 'Invalid manifest',
        details: validateManifest.errors
      }, 400)
    }

    const { data: provider, error: providerError } = await supabase
      .from('tool_providers')
      .upsert(
        { name: data.provider_name, owner_id: data.provider_owner },
        { onConflict: 'name' }
      )
      .select('id')
      .single()

    if (providerError) {
      return c.json({ error: providerError.message }, 400)
    }
    if (!provider) {
      return c.json({ error: 'Provider not created' }, 500)
    }

    const { data: manifest, error: manifestError } = await supabase
      .from('tool_manifests')
      .insert({
        provider_id: provider.id,
        tool_name: data.tool_name,
        version: data.version,
        manifest: data.manifest,
        status: 'published'
      })
      .select()
      .single()

    if (manifestError) {
      return c.json({ error: manifestError.message }, 400)
    }
    if (!manifest) {
      return c.json({ error: 'Manifest not created' }, 500)
    }

    return c.json({ manifest_id: manifest.id, status: 'published' }, 201)
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// Search tools
toolsRoute.get('/', async (c) => {
  const toolName = c.req.query('name') || ''
  const capability = c.req.query('capability') || ''

  let query = supabase
    .from('tool_manifests')
    .select('id, tool_name, version, manifest')
    .eq('status', 'published')

  if (toolName) {
    query = query.ilike('tool_name', `%${toolName}%`)
  }
  if (capability) {
    query = query.or(`manifest->'tool'->>'description'.ilike.%${capability}%,manifest->'tool'->>'name'.ilike.%${capability}%`)
  }

  const { data, error } = await query.limit(20)
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data || [])
})

// Get specific manifest
toolsRoute.get('/:name/:version/manifest', async (c) => {
  const name = c.req.param('name')
  const version = c.req.param('version')

  const { data, error } = await supabase
    .from('tool_manifests')
    .select('id, tool_name, version, manifest, provider_id, published_at')
    .eq('tool_name', name)
    .eq('version', version)
    .eq('status', 'published')
    .single()

  if (error || !data) {
    return c.json({ error: 'Manifest not found' }, 404)
  }

  return c.json(data)
})

// Ingest from OpenAPI spec and auto‑publish
toolsRoute.post('/ingest', async (c) => {
  try {
    const body = await c.req.json()
    const { url, tool_name, tool_version, provider_name, provider_owner } = body
    if (!url) return c.json({ error: 'url required' }, 400)

    const manifest = await convertOpenApiToManifest(url, tool_name, tool_version)

    const name = provider_name ?? manifest.tool.name
    const owner = provider_owner ?? 'auto-ingested'

    const { data: provider, error: providerError } = await supabase
      .from('tool_providers')
      .upsert({ name, owner_id: owner }, { onConflict: 'name' })
      .select('id')
      .single()
    if (providerError) throw new Error(providerError.message)
    if (!provider) throw new Error('Provider not created')

    const { data: record, error: manifestError } = await supabase
      .from('tool_manifests')
      .upsert(
        {
          provider_id: provider.id,
          tool_name: manifest.tool.name,
          version: manifest.tool.version,
          manifest: manifest,
          status: 'published'
        },
        { onConflict: 'tool_name, version' }
      )
      .select()
      .single()
    if (manifestError) throw new Error(manifestError.message)
    if (!record) throw new Error('Manifest not created')

    return c.json({ manifest_id: record.id, tool_name: record.tool_name, version: record.version, status: 'published' }, 201)
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// Ingest from MCP server and auto‑publish
toolsRoute.post('/ingest-mcp', async (c) => {
  try {
    const { url, tool_name, tool_version, provider_name, provider_owner } = await c.req.json()
    if (!url) return c.json({ error: 'url required' }, 400)

    const manifest = await convertMcpToManifest(url, tool_name, tool_version)

    const name = provider_name ?? manifest.tool.name
    const owner = provider_owner ?? 'auto-ingested'

    const { data: provider, error: providerError } = await supabase
      .from('tool_providers')
      .upsert({ name, owner_id: owner }, { onConflict: 'name' })
      .select('id')
      .single()
    if (providerError) throw new Error(providerError.message)
    if (!provider) throw new Error('Provider not created')

    const { data: record, error: manifestError } = await supabase
      .from('tool_manifests')
      .upsert(
        {
          provider_id: provider.id,
          tool_name: manifest.tool.name,
          version: manifest.tool.version,
          manifest: manifest,
          status: 'published'
        },
        { onConflict: 'tool_name, version' }
      )
      .select()
      .single()
    if (manifestError) throw new Error(manifestError.message)
    if (!record) throw new Error('Manifest not created')

    return c.json({ manifest_id: record.id, tool_name: record.tool_name, version: record.version, status: 'published' }, 201)
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

export { toolsRoute }