// src/auth/jwt.ts – HS256 via Bun's native crypto, fully type‑safe

const encoder = new TextEncoder()

function base64urlEncode(arr: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = atob(base64)
  const bytes = new Uint8Array(decoded.length)
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
  return bytes
}

function encodePart(obj: Record<string, unknown>): string {
  return base64urlEncode(encoder.encode(JSON.stringify(obj)))
}

/** Convert Uint8Array to ArrayBuffer that satisfies BufferSource */
function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  // Create a fresh copy, then take its .buffer
  const copy = new Uint8Array(arr)
  return copy.buffer as ArrayBuffer
}

async function getSecretKey(): Promise<CryptoKey> {
  const secretHex = process.env.JWT_SECRET
  if (!secretHex) throw new Error('JWT_SECRET missing in .env')
  const secretBytes = Buffer.from(secretHex, 'hex')
  return crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signToken(
  payload: Record<string, unknown>,
  expiresInSeconds = 300
): Promise<string> {
  const key = await getSecretKey()
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = { ...payload, iss: 'agentdevx', iat: now, exp: now + expiresInSeconds }

  const header = { alg: 'HS256', typ: 'JWT' }
  const encodedHeader = encodePart(header)
  const encodedPayload = encodePart(fullPayload)
  const signingInput = `${encodedHeader}.${encodedPayload}`

  const signature = await crypto.subtle.sign('HMAC', key, toArrayBuffer(encoder.encode(signingInput)))
  const encodedSignature = base64urlEncode(new Uint8Array(signature))

  return `${signingInput}.${encodedSignature}`
}

export async function verifyToken(token: string): Promise<Record<string, any> | null> {
  const key = await getSecretKey()
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [encodedHeader, encodedPayload, encodedSignature] = parts
  const signingInput = `${encodedHeader}.${encodedPayload}`

  try {
    const sigBytes = base64urlDecode(encodedSignature)
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      toArrayBuffer(sigBytes),                         // safe ArrayBuffer
      toArrayBuffer(encoder.encode(signingInput))      // safe ArrayBuffer
    )
    if (!valid) return null

    const payloadBytes = base64urlDecode(encodedPayload)
    const payloadJson = JSON.parse(new TextDecoder().decode(payloadBytes))
    const now = Math.floor(Date.now() / 1000)
    if (payloadJson.exp && payloadJson.exp < now) return null
    return payloadJson
  } catch {
    return null
  }
}