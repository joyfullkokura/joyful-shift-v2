import 'server-only'

/**
 * Runs a server-side data load and logs one line with its duration (no data).
 * Used by server pages for their first-render data (event "page_data").
 */
export const timedPageData = async <T extends { ok: boolean }>(page: string, load: () => Promise<T>): Promise<T> => {
  const startedAt = Date.now()
  const result = await load()
  console.info(JSON.stringify({ event: 'page_data', page, ms: Date.now() - startedAt, ok: result.ok }))
  return result
}
