// src/services/credential-vault.ts — AES-256-GCM encryption for API keys and OAuth secrets

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Derive a 32-byte key from VAULT_SECRET using SHA-256
 */
async function getVaultKey(): Promise<CryptoKey> {
  const secret = process.env.VAULT_SECRET
  if (!secret) throw new Error('VAULT_SECRET missing in environment')
  
  const secretBytes = encoder.encode(secret)
  const hashBuffer = await crypto.subtle.digest('SHA-256', secretBytes)
  
  return crypto.subtle.importKey(
    'raw',
    hashBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Generate a random 12-byte IV for AES-GCM
 */
function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12))
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 * Returns base64url-encoded ciphertext and IV
 */
export async function encryptSecret(plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await getVaultKey()
  const iv = generateIV()
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  )
  
  return {
    ciphertext: Buffer.from(encrypted).toString('base64url'),
    iv: Buffer.from(iv).toString('base64url')
  }
}

/**
 * Decrypt a ciphertext string using AES-256-GCM
 * Takes base64url-encoded ciphertext and IV
 */
export async function decryptSecret(ciphertext: string, iv: string): Promise<string> {
  const key = await getVaultKey()
  
  const ciphertextBuffer = Buffer.from(ciphertext, 'base64url')
  const ivBuffer = Buffer.from(iv, 'base64url')
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    key,
    ciphertextBuffer
  )
  
  return decoder.decode(decrypted)
}
