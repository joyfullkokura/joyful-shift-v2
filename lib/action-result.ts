// Shared between Server Actions and client components.

/** A database row as it crosses the server boundary (secret columns already removed). */
export type DataRow = Record<string, unknown>

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Client helper: returns the data or throws an Error carrying the user-facing message. */
export const unwrap = <T,>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(result.error)
  return result.data
}
