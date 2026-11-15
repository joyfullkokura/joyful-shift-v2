import { describe, expect, it, vi } from 'vitest'
import { createRetryingFetch, type RetryInfo } from '@/lib/server/retrying-fetch'

const URL_WITH_QUERY = 'https://example.supabase.co/rest/v1/staff?id=eq.secret-id'

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const pgrst303 = () => jsonResponse(401, { code: 'PGRST303', message: 'JWT issued at future' })
const ok = () => jsonResponse(200, [{ id: 1 }])

/** A fetch that returns the queued results in order (an Error is thrown). */
const queuedFetch = (results: Array<Response | Error>) => {
  const calls: string[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init?.method ?? 'GET')
    const next = results.shift()
    if (!next) throw new Error('no more queued results')
    if (next instanceof Error) throw next
    return next
  })
  return { fetch: fn as unknown as typeof fetch, calls, mock: fn }
}

const setup = (results: Array<Response | Error>, maxAttempts = 4) => {
  const queued = queuedFetch(results)
  const sleeps: number[] = []
  const retries: RetryInfo[] = []
  const retryingFetch = createRetryingFetch(queued.fetch, {
    maxAttempts,
    baseDelayMs: 100,
    maxDelayMs: 1_000,
    random: () => 0,
    sleep: async ms => { sleeps.push(ms) },
    onRetry: info => { retries.push(info) },
  })
  return { retryingFetch, sleeps, retries, calls: queued.calls }
}

describe('createRetryingFetch', () => {
  it('retries PGRST303 with exponential backoff and returns the eventual success', async () => {
    const { retryingFetch, sleeps, retries } = setup([pgrst303(), pgrst303(), ok()])
    const response = await retryingFetch(URL_WITH_QUERY)
    expect(response.status).toBe(200)
    expect(sleeps).toEqual([100, 200])
    expect(retries.map(retry => retry.reason)).toEqual(['PGRST303', 'PGRST303'])
  })

  it('retries PGRST303 for writes too (rejected before the query runs)', async () => {
    const { retryingFetch, calls } = setup([pgrst303(), ok()])
    const response = await retryingFetch(URL_WITH_QUERY, { method: 'POST', body: '{}' })
    expect(response.status).toBe(200)
    expect(calls).toEqual(['POST', 'POST'])
  })

  it('stops after maxAttempts and returns the last error response', async () => {
    const { retryingFetch, sleeps } = setup([pgrst303(), pgrst303(), pgrst303()], 3)
    const response = await retryingFetch(URL_WITH_QUERY)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'PGRST303', message: 'JWT issued at future' })
    expect(sleeps).toHaveLength(2)
  })

  it('caps the delay at maxDelayMs', async () => {
    const { retryingFetch, sleeps } = setup(Array.from({ length: 6 }, pgrst303).concat(ok()), 7)
    await retryingFetch(URL_WITH_QUERY)
    expect(sleeps).toEqual([100, 200, 400, 800, 1_000, 1_000])
  })

  it('retries 503 and network errors for reads only', async () => {
    const read = setup([jsonResponse(503, {}), new TypeError('fetch failed'), ok()])
    expect((await read.retryingFetch(URL_WITH_QUERY)).status).toBe(200)

    const write = setup([jsonResponse(503, {})])
    expect((await write.retryingFetch(URL_WITH_QUERY, { method: 'PATCH', body: '{}' })).status).toBe(503)
    expect(write.calls).toHaveLength(1)

    const failingWrite = setup([new TypeError('fetch failed')])
    await expect(failingWrite.retryingFetch(URL_WITH_QUERY, { method: 'POST', body: '{}' })).rejects.toThrow('fetch failed')
    expect(failingWrite.calls).toHaveLength(1)
  })

  it('does not retry other errors such as permission denied', async () => {
    const { retryingFetch, calls } = setup([jsonResponse(401, { code: '42501', message: 'permission denied' })])
    expect((await retryingFetch(URL_WITH_QUERY)).status).toBe(401)
    expect(calls).toHaveLength(1)
  })

  it('keeps the response body readable for the caller', async () => {
    const { retryingFetch } = setup([ok()])
    expect(await (await retryingFetch(URL_WITH_QUERY)).json()).toEqual([{ id: 1 }])
  })

  it('logs the path without the query string', async () => {
    const { retryingFetch, retries } = setup([pgrst303(), ok()])
    await retryingFetch(URL_WITH_QUERY)
    expect(retries[0].path).toBe('/rest/v1/staff')
  })
})
