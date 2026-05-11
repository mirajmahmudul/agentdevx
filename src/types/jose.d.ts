declare module 'jose' {
  // KeyLike matches jose's internal type (CryptoKey or Uint8Array)
  export type KeyLike = CryptoKey | Uint8Array

  // importJWK – we use with 'EdDSA'
  export function importJWK(
    jwk: Record<string, unknown>,
    alg?: string | undefined
  ): Promise<KeyLike>

  // SignJWT class
  export class SignJWT {
    constructor(payload: Record<string, unknown>)
    setProtectedHeader(
      protectedHeader: Record<string, string | number | boolean>
    ): this
    sign(key: KeyLike): Promise<string>
  }

  // jwtVerify
  export function jwtVerify(
    token: string,
    key: KeyLike,
    options?: { issuer?: string; [key: string]: unknown }
  ): Promise<{
    payload: Record<string, unknown>
    protectedHeader: Record<string, unknown>
  }>
}