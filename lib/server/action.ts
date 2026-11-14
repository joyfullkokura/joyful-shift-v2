import 'server-only'
import type { ActionResult, DataRow } from '@/lib/action-result'
import { AuthorizationError } from '@/lib/server/dal'

/** An error whose message is safe to show to the user as-is. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserFacingError'
  }
}

const GENERIC_ERROR = '処理に失敗しました。時間をおいて再度お試しください。'

/**
 * Wraps a Server Action body. Errors become { ok: false } with a safe message;
 * unexpected errors are logged on the server and never echoed to the client.
 */
export const runAction = async <T>(label: string, body: () => Promise<T>): Promise<ActionResult<T>> => {
  try {
    return { ok: true, data: await body() }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        ok: false,
        error: error.reason === 'unauthenticated'
          ? 'ログインの有効期限が切れました。画面を再読み込みしてログインし直してください。'
          : 'この操作を行う権限がありません。',
      }
    }
    if (error instanceof UserFacingError) return { ok: false, error: error.message }
    console.error(label, error)
    return { ok: false, error: GENERIC_ERROR }
  }
}

const isRow = (value: unknown): value is DataRow => typeof value === 'object' && value !== null && !Array.isArray(value)

export const toRows = (value: unknown): DataRow[] => (Array.isArray(value) ? value.filter(isRow) : [])
export const toRow = (value: unknown): DataRow | null => (isRow(value) ? value : null)

/** Throws the Supabase error (logged by runAction) when present. */
export const check = (error: unknown): void => {
  if (error) throw error
}

export const omit = (row: DataRow, columns: readonly string[]): DataRow =>
  Object.fromEntries(Object.entries(row).filter(([key]) => !columns.includes(key)))

export const STAFF_SECRET_COLUMNS = ['pin_hash', 'session_version'] as const
export const STORE_SECRET_COLUMNS = ['admin_pw'] as const
