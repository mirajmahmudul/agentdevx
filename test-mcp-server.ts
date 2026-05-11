// test-mcp-server.ts – minimal MCP 2024-11-05 compatible server for testing
const server = Bun.serve({
  port: 8765,
  async fetch(req) {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    let body: any
    try { body = await req.json() } catch { return new Response('Bad JSON', { status: 400 }) }

    const { method, id } = body

    if (method === 'initialize') {
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'test-mock', version: '1.0.0' }
        }
      })
    }

    if (method === 'tools/list') {
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'echo',
              description: 'Returns whatever you send',
              inputSchema: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: 'Text to echo' }
                },
                required: ['text']
              }
            },
            {
              name: 'add',
              description: 'Add two numbers',
              inputSchema: {
                type: 'object',
                properties: {
                  a: { type: 'number', description: 'First number' },
                  b: { type: 'number', description: 'Second number' }
                },
                required: ['a', 'b']
              }
            }
          ]
        }
      })
    }

    return new Response('Not found', { status: 404 })
  }
})

console.log('✅ Mock MCP server running at http://localhost:8765')