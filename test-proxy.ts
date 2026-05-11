// test-proxy.ts — automated proxy test, no copy‑paste needed

const PRIV_HEX = '098cb4ec22af2a69c5032210517d9c2413b340a4d7e48bc24d2066c401f468c4'
const PUB_HEX  = '7c446d4a08efb4cda6ec2941537c916b1086deb634c53e0657f7a91aa02a70cf'
const AGENT_ID = 'agt_c89549285b787abead68d46f'

// Helper: hex → base64url
const b64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64url')

async function main() {
  // 1. Build JWK for signing
  const jwk = {
    kty: 'OKP',
    crv: 'Ed25519',
    d: b64(PRIV_HEX),
    x: b64(PUB_HEX),
    key_ops: ['sign'],
    ext: true,
  }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign'])

  // 2. Sign a challenge nonce
  const nonce = 'challenge-' + Date.now()
  const sig = Buffer.from(
    await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(nonce))
  ).toString('hex')

  // 3. Request token from AgentDevX
  const tokenRes = await fetch('http://localhost:3000/agents/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: AGENT_ID, nonce, signature: sig }),
  })
  const tokenData: any = await tokenRes.json()
  if (!tokenData.access_token) {
    console.error('❌ Failed to get token:', tokenData)
    return
  }
  const accessToken: string = tokenData.access_token
  console.log('✅ Token obtained:', accessToken.substring(0, 50) + '...')

  // 4. Call the proxy (getPetById) with the fresh token
  const proxyRes = await fetch('http://localhost:3000/proxy/call', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tool_name: 'petstore-api', action: 'getPetById', params: { petId: 1 } }),
  })

  const proxyBody = await proxyRes.text()
  console.log('Proxy status:', proxyRes.status)
  console.log('Proxy response:')
  console.log(proxyBody)
}

main()