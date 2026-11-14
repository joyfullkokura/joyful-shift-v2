import 'server-only'
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { getPinPepper } from '@/lib/server/env'

export const PIN_PATTERN = /^\d{4,8}$/

const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 32
const SALT_LENGTH = 16
// scrypt needs 128 * N * r bytes (32 MiB here); Node's default maxmem is exactly 32 MiB.
const SCRYPT_MAXMEM = 64 * 1024 * 1024
const LEGACY_SHA256_PATTERN = /^[0-9a-f]{64}$/i

const deriveKey = (secret: Buffer, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(secret, salt, KEY_LENGTH, { N: n, r, p, maxmem: SCRYPT_MAXMEM }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })

// The pepper lives only in server env vars, so a leaked pin_hash column alone
// cannot be brute-forced offline even though the PIN space is small.
const pepper = (pin: string): Buffer => createHmac('sha256', getPinPepper()).update(pin).digest()

export const isValidPin = (pin: unknown): pin is string => typeof pin === 'string' && PIN_PATTERN.test(pin)

export const hashPin = async (pin: string): Promise<string> => {
  const salt = randomBytes(SALT_LENGTH)
  const key = await deriveKey(pepper(pin), salt, SCRYPT_N, SCRYPT_R, SCRYPT_P)
  return ['scrypt', 'v1', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export type PinVerification = { ok: boolean; needsRehash: boolean }

const safeEqual = (left: Buffer, right: Buffer) => left.length === right.length && timingSafeEqual(left, right)

export const verifyPin = async (pin: string, storedHash: string): Promise<PinVerification> => {
  if (LEGACY_SHA256_PATTERN.test(storedHash)) {
    // Legacy: unsalted SHA-256 hex written by the old browser-side login.
    const candidate = createHash('sha256').update(pin).digest()
    return { ok: safeEqual(candidate, Buffer.from(storedHash, 'hex')), needsRehash: true }
  }

  const parts = storedHash.split('$')
  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== 'v1') return { ok: false, needsRehash: false }
  const [n, r, p] = [Number(parts[2]), Number(parts[3]), Number(parts[4])]
  if (![n, r, p].every(Number.isSafeInteger)) return { ok: false, needsRehash: false }
  const expected = Buffer.from(parts[6], 'base64url')
  const candidate = await deriveKey(pepper(pin), Buffer.from(parts[5], 'base64url'), n, r, p)
  const ok = safeEqual(candidate, expected)
  return { ok, needsRehash: ok && (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) }
}
