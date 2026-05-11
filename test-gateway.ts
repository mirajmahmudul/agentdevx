const AGENT_NAME = "gateway-test-agent"
const OWNER_ID = "user123"

async function generateAgentKeypair() {
  const key = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
  const privJwk = await crypto.subtle.exportKey("jwk", key.privateKey)
  const pubJwk = await crypto.subtle.exportKey("jwk", key.publicKey)
  const privHex = Buffer.from(privJwk.d!, "base64url").toString("hex")
  const pubHex = Buffer.from(pubJwk.x!, "base64url").toString("hex")
  return { privHex, pubHex }
}

async function registerAgent(pubHex: string) {
  try {
    const res = await fetch("http://127.0.0.1:3000/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: AGENT_NAME, public_key: pubHex, owner_id: OWNER_ID })
    })
    const data = await res.json()
    if (data.error) throw new Error(`Register failed: ${data.error}`)
    return data.id as string
  } catch (err: any) {
    console.error("registerAgent fetch/parse error:", err.message)
    throw err
  }
}

async function signNonce(privHex: string, nonce: string) {
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "OKP", crv: "Ed25519",
      d: Buffer.from(privHex, "hex").toString("base64url"),
      x: Buffer.from("00".repeat(32), "hex").toString("base64url"),
      key_ops: ["sign"], ext: true
    },
    { name: "Ed25519" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(nonce))
  return Buffer.from(sig).toString("hex")
}

async function getToken(agentId: string, privHex: string) {
  const nonce = "challenge-" + Date.now()
  const signature = await signNonce(privHex, nonce)
  try {
    const res = await fetch("http://127.0.0.1:3000/agents/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, nonce, signature })
    })
    const data = await res.json()
    if (data.error) throw new Error(`Token failed: ${data.error}`)
    return data.access_token as string
  } catch (err: any) {
    console.error("getToken fetch/parse error:", err.message)
    throw err
  }
}

async function main() {
  console.log("1. Generating agent keypair...")
  const { privHex, pubHex } = await generateAgentKeypair()
  console.log("   public key:", pubHex)

  console.log("2. Registering agent...")
  const agentId = await registerAgent(pubHex)
  console.log("   agent id:", agentId)

  console.log("3. Requesting access token...")
  const token = await getToken(agentId, privHex)
  console.log("   token:", token.slice(0, 40) + "...")

  console.log("4. Calling proxy...")
  try {
    const proxyRes = await fetch("http://127.0.0.1:3000/proxy/call", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tool_name: "petstore-api", action: "getPetById", params: { petId: 10 } })
    })
    const proxyBody = await proxyRes.text()
    console.log("   status:", proxyRes.status)
    console.log("   response:", proxyBody.slice(0, 200))
  } catch (err: any) {
    console.error("proxy call error:", err.message)
  }
}

main().catch(err => console.error("FAILED:", err.message))