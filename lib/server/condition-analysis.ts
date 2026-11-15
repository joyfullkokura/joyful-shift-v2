import 'server-only'
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai'
import {
  type ConditionAnalysisInput,
  type ParsedConditions,
  parseParsedConditions,
  parseParsedShiftRequest,
} from '@/lib/parsed-conditions'
import { getAdminClient } from '@/lib/server/supabase-admin'

const modelName = process.env.GEMINI_MODEL || 'gemini-flash-latest'

export type DailyRequestInput = {
  kind: 'daily_request'
  date: string
  memo: string
}

const isNullableTime = (value: unknown): value is string | null => typeof value === 'string' || value === null

export const getConditionInput = (value: unknown): ConditionAnalysisInput | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Partial<ConditionAnalysisInput>
  if (!(isNullableTime(input.work_start_1) && isNullableTime(input.work_end_1) &&
    isNullableTime(input.work_start_2) && isNullableTime(input.work_end_2) &&
    typeof input.memo === 'string')) return null
  return {
    work_start_1: input.work_start_1,
    work_end_1: input.work_end_1,
    work_start_2: input.work_start_2,
    work_end_2: input.work_end_2,
    memo: input.memo.slice(0, 2_000),
  }
}

export const getDailyRequestInput = (value: unknown): DailyRequestInput | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Partial<DailyRequestInput>
  if (input.kind !== 'daily_request' || typeof input.date !== 'string' || typeof input.memo !== 'string') return null
  return { kind: 'daily_request', date: input.date.slice(0, 10), memo: input.memo.slice(0, 2_000) }
}

const daySchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    is_available: { type: SchemaType.BOOLEAN },
    start_time: { type: SchemaType.STRING, nullable: true },
    end_time: { type: SchemaType.STRING, nullable: true },
  },
  required: ['is_available', 'start_time', 'end_time'],
}

const responseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    monday: daySchema,
    tuesday: daySchema,
    wednesday: daySchema,
    thursday: daySchema,
    friday: daySchema,
    saturday: daySchema,
    sunday: daySchema,
  },
  required: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
}

const dailyRequestSchema: ResponseSchema = daySchema

const wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))

const getErrorStatus = (error: unknown): number | null => {
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') return error.status
  const message = error instanceof Error ? error.message : String(error)
  const match = message.match(/\[(\d{3})\]/)
  return match ? Number(match[1]) : null
}

/** Which analysis a Gemini call belongs to (logged; the prompt content never is). */
type AnalysisKind = 'weekly_conditions' | 'daily_request'

/**
 * Structured timing log for one Gemini attempt. Contains no request content,
 * only what is needed to find where the time goes (latency, retries, status).
 */
const logGeminiAttempt = (entry: { kind: AnalysisKind; attempt: number; ms: number; outcome: 'ok' | 'error'; status?: number | null; willRetry?: boolean }) => {
  console.info(JSON.stringify({ event: 'gemini_call', model: modelName, ...entry }))
}

const generateWithRetry = async (kind: AnalysisKind, prompt: string, schema: ResponseSchema): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.')
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: modelName,
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
  })

  for (let attempt = 0; attempt < 3; attempt++) {
    const startedAt = Date.now()
    try {
      const result = await model.generateContent(prompt)
      const text = result.response.text()
      logGeminiAttempt({ kind, attempt: attempt + 1, ms: Date.now() - startedAt, outcome: 'ok' })
      return text
    } catch (error) {
      const status = getErrorStatus(error)
      const isRetryable = status === null || status === 429 || status >= 500
      const willRetry = attempt < 2 && isRetryable
      logGeminiAttempt({ kind, attempt: attempt + 1, ms: Date.now() - startedAt, outcome: 'error', status, willRetry })
      if (!willRetry) throw error
      await wait(1_500 * 2 ** attempt)
    }
  }
  throw new Error('Gemini API retry limit reached.')
}

export const analyzeWeeklyConditions = async (input: ConditionAnalysisInput): Promise<ParsedConditions> => {
  const text = await generateWithRetry('weekly_conditions', `あなたは飲食店のシフト管理者です。スタッフの「出勤可能時間」および「勤務に関する補足メモ」を解析し、月曜日〜日曜日ごとの出勤可能な時間帯を JSON 形式で出力してください。店舗の基本営業時間は 09:00〜24:00 です。出勤不可の曜日には is_available: false を設定してください。\n\n時刻は必ず HH:MM（24:00 は使用可）で、営業時間外は営業時間内に収めてください。曜日指定がない場合は、基本の出勤可能時間帯を全曜日に適用してください。補足メモの明示的な曜日指定を優先してください。基本時間が未設定で補足メモにも時間指定がない曜日は出勤不可にしてください。出勤不可の場合、start_time と end_time は null にしてください。\n\n対象スタッフのデータ:\n${JSON.stringify(input)}`, responseSchema)
  const parsed = parseParsedConditions(JSON.parse(text || 'null'))
  if (!parsed) throw new Error('Gemini returned an invalid condition schema.')
  return parsed
}

export const analyzeDailyRequest = async (input: DailyRequestInput) => {
  const text = await generateWithRetry('daily_request', `飲食店のシフト管理者として、${input.date} のスタッフ個別要望を解析してください。営業時間は09:00〜24:00です。要望からその日に勤務できないと判断できる場合は is_available を false にし、時刻は null にしてください。勤務可能なら、要望に合う営業時間内の開始・終了時刻を HH:MM で返してください。「18時以降」は18:00〜24:00です。\n\n要望: ${input.memo}`, dailyRequestSchema)
  const parsed = parseParsedShiftRequest(JSON.parse(text || 'null'))
  if (!parsed) throw new Error('Gemini returned an invalid daily request schema.')
  return parsed
}

/** Background job used after unauthenticated setup / registration. Never throws. */
export const analyzeAndStoreStaffConditions = async (storeId: string, staffId: string, input: ConditionAnalysisInput): Promise<void> => {
  try {
    const parsed = await analyzeWeeklyConditions(input)
    const { error } = await getAdminClient()
      .from('staff')
      .update({ parsed_conditions: parsed })
      .eq('id', staffId)
      .eq('store_id', storeId)
    if (error) throw error
  } catch (error) {
    console.error('勤務条件のAI解析に失敗しました。', error)
  }
}
