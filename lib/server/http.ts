import 'server-only'
import { AuthorizationError } from '@/lib/server/dal'

/** Maps errors thrown inside Route Handlers to JSON responses without leaking internals. */
export const errorResponse = (label: string, error: unknown): Response => {
  if (error instanceof AuthorizationError) {
    return Response.json({ error: error.reason }, { status: error.reason === 'unauthenticated' ? 401 : 403 })
  }
  console.error(label, error)
  return Response.json({ error: 'Request failed.' }, { status: 500 })
}

/** Removes server-only columns before a row leaves the server. */
export const omitColumns = (row: unknown, columns: readonly string[]): Record<string, unknown> | null => {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null
  return Object.fromEntries(Object.entries(row).filter(([key]) => !columns.includes(key)))
}
