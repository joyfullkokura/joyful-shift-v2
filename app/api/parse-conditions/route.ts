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

export async function POST(request: Request) {
  try {
    const payload: unknown = await request.json().catch(() => null)
    const storeId = getStoreId(payload)
    if (!storeId) return Response.json({ error: 'Invalid store.' }, { status: 400 })

    const dailyRequest = getDailyRequestInput(payload)
    if (dailyRequest) {
      // Only shift generation (admin) analyses per-day requests.
      await requireAdmin(storeId)
      return Response.json(await analyzeDailyRequest(dailyRequest))
    }

    await requireSession(storeId)
    const input = getConditionInput(payload)
    if (!input) return Response.json({ error: 'Invalid condition data.' }, { status: 400 })
    return Response.json(await analyzeWeeklyConditions(input))
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json({ error: error.reason }, { status: error.reason === 'unauthenticated' ? 401 : 403 })
    }
    console.error('Gemini API Error:', error)
    return Response.json({ error: 'Condition analysis failed.' }, { status: 500 })
  }
}
