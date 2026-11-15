import { AuthorizationError, isValidStoreId, requireAdmin, requireSession } from '@/lib/server/dal'
import {
  analyzeDailyRequest,
  analyzeWeeklyConditions,
  getConditionInput,
  getDailyRequestInput,
} from '@/lib/server/condition-analysis'

export const runtime = 'nodejs'

const getStoreId = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object' || !('storeId' in payload)) return null
  return isValidStoreId(payload.storeId) ? payload.storeId : null
}

/** One line per request: total time including auth, retries and Gemini latency. No request content. */
const logRequest = (kind: string, startedAt: number, status: number) => {
  console.info(JSON.stringify({ event: 'parse_conditions_request', kind, ms: Date.now() - startedAt, status }))
}

export async function POST(request: Request) {
  const startedAt = Date.now()
  let kind = 'unknown'
  try {
    const payload: unknown = await request.json().catch(() => null)
    const storeId = getStoreId(payload)
    if (!storeId) {
      logRequest(kind, startedAt, 400)
      return Response.json({ error: 'Invalid store.' }, { status: 400 })
    }

    const dailyRequest = getDailyRequestInput(payload)
    if (dailyRequest) {
      kind = 'daily_request'
      // Only shift generation (admin) analyses per-day requests.
      await requireAdmin(storeId)
      const parsed = await analyzeDailyRequest(dailyRequest)
      logRequest(kind, startedAt, 200)
      return Response.json(parsed)
    }

    kind = 'weekly_conditions'
    await requireSession(storeId)
    const input = getConditionInput(payload)
    if (!input) {
      logRequest(kind, startedAt, 400)
      return Response.json({ error: 'Invalid condition data.' }, { status: 400 })
    }
    const parsed = await analyzeWeeklyConditions(input)
    logRequest(kind, startedAt, 200)
    return Response.json(parsed)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      const status = error.reason === 'unauthenticated' ? 401 : 403
      logRequest(kind, startedAt, status)
      return Response.json({ error: error.reason }, { status })
    }
    console.error('Gemini API Error:', error)
    logRequest(kind, startedAt, 500)
    return Response.json({ error: 'Condition analysis failed.' }, { status: 500 })
  }
}
