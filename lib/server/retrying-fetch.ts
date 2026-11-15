import 'server-only'

// fetch wrapper for the server-side Supabase client: retries transient
// failures with exponential backoff, but only when a retry cannot apply a
// write twice.
//
// - PostgREST errors in TRANSIENT_POSTGREST_CODES are rejected before the
//   query runs (e.g. PGRST303 "JWT issued at future", a short clock skew),
//   so they are retried for every method.
// - Network errors and 502/503/504 are retried for GET / HEAD only: for a
//   write the server may already have applied it.

export const TRANSIENT_POSTGREST_CODES: ReadonlySet<string> = new Set(['PGRST303'])
const RETRYABLE_STATUS_FOR_READS: ReadonlySet<number> = new Set([502, 503, 504])

export type RetryInfo = {
  attempt: number
  delayMs: number
  method: string
  /** Path only; the query string can contain ids and is left out. */
  path: string
  reason: string
}

export type RetryOptions = {
  /** Total attempts including the first one. */
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  onRetry?: (info: RetryInfo) => void
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const methodOf = (input: RequestInfo | URL, init?: RequestInit) =>
  (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

const pathOf = (input: RequestInfo | URL) => {
  try {
    const url = input instanceof Request ? new URL(input.url) : new URL(String(input))
    return url.pathname
  } catch {
    return 'unknown'
  }
}

/** PostgREST error code of a response, without consuming its body. */
const postgrestCodeOf = async (response: Response): Promise<string | null> => {
  if (response.ok) return null
  try {
    const body: unknown = await response.clone().json()
    return typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : null
  } catch {
    return null
  }
}

export const createRetryingFetch = (baseFetch: typeof fetch, options: RetryOptions): typeof fetch => {
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random

  const delayFor = (attempt: number) =>
    Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1)) + Math.floor(random() * options.baseDelayMs)

  return async (input, init) => {
    const method = methodOf(input, init)
    const isRead = method === 'GET' || method === 'HEAD'

    for (let attempt = 1; ; attempt++) {
      const canRetry = attempt < options.maxAttempts
      let reason: string | null = null
      try {
        const response = await baseFetch(input, init)
        const code = await postgrestCodeOf(response)
        if (code && TRANSIENT_POSTGREST_CODES.has(code)) reason = code
        else if (isRead && RETRYABLE_STATUS_FOR_READS.has(response.status)) reason = `HTTP ${response.status}`
        if (!reason || !canRetry) return response
      } catch (error) {
        if (!isRead || !canRetry) throw error
        reason = error instanceof Error ? error.name : 'network error'
      }

      const delayMs = delayFor(attempt)
      options.onRetry?.({ attempt, delayMs, method, path: pathOf(input), reason })
      await sleep(delayMs)
    }
  }
}
