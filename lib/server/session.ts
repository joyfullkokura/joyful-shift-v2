import 'server-only'
import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { getSessionSecret } from '@/lib/server/env'

export const SESSION_TTL_SECONDS = 12 * 60 * 60
const AUDIENCE = 'joyful-shift'

export type SessionClaims = {
  staffId: string
  storeId: string
  sessionVersion: number
}

const secretKey = () => new TextEncoder().encode(getSessionSecret())

// One cookie per store keeps the existing "logged in per store" behaviour.
// store_id is hashed because cookie names only allow a restricted character set.
const cookieName = (storeId: string) => `jss_${createHash('sha256').update(storeId).digest('hex').slice(0, 16)}`

export const createSession = async ({ staffId, storeId, sessionVersion }: SessionClaims): Promise<void> => {
  const token = await new SignJWT({ st: storeId, sv: sessionVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(staffId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey())

  const cookieStore = await cookies()
  cookieStore.set(cookieName(storeId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export const readSession = async (storeId: string): Promise<SessionClaims | null> => {
  const token = (await cookies()).get(cookieName(storeId))?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'], audience: AUDIENCE })
    if (typeof payload.sub !== 'string' || payload.st !== storeId || typeof payload.sv !== 'number') return null
    return { staffId: payload.sub, storeId, sessionVersion: payload.sv }
  } catch {
    return null
  }
}

export const deleteSession = async (storeId: string): Promise<void> => {
  (await cookies()).delete(cookieName(storeId))
}
