import { GoogleGenAI, Type } from '@google/genai'
import {
  type ConditionAnalysisInput,
  parseParsedConditions,
} from '@/lib/parsed-conditions'

export const runtime = 'nodejs'

const isNullableTime = (value: unknown): value is string | null => typeof value === 'string' || value === null

const getInput = (value: unknown): ConditionAnalysisInput | null => {
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

const daySchema = {
  type: Type.OBJECT,
  properties: {
    is_available: { type: Type.BOOLEAN },
    start_time: { type: Type.STRING, nullable: true },
    end_time: { type: Type.STRING, nullable: true },
  },
  required: ['is_available', 'start_time', 'end_time'],
}

const responseSchema = {
  type: Type.OBJECT,
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

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return Response.json({ error: 'Gemini API is not configured.' }, { status: 503 })

  try {
    const input = getInput(await request.json())
    if (!input) return Response.json({ error: 'Invalid condition data.' }, { status: 400 })

    const ai = new GoogleGenAI({ apiKey })
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: `あなたは飲食店のシフト管理者です。スタッフの「出勤可能時間」および「勤務に関する補足メモ」を解析し、月曜日〜日曜日ごとの出勤可能な時間帯を JSON 形式で出力してください。店舗の基本営業時間は 09:00〜24:00 です。出勤不可の曜日には is_available: false を設定してください。\n\n時刻は必ず HH:MM（24:00 は使用可）で、営業時間外は営業時間内に収めてください。曜日指定がない場合は、基本の出勤可能時間帯を全曜日に適用してください。補足メモの明示的な曜日指定を優先してください。基本時間が未設定で補足メモにも時間指定がない曜日は出勤不可にしてください。出勤不可の場合、start_time と end_time は null にしてください。\n\n対象スタッフのデータ:\n${JSON.stringify(input)}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema,
      },
    })

    const parsed = parseParsedConditions(JSON.parse(response.text || 'null'))
    if (!parsed) throw new Error('Gemini returned an invalid condition schema.')
    return Response.json(parsed)
  } catch (error) {
    console.error('Gemini condition parsing failed.', error)
    return Response.json({ error: 'Failed to parse conditions.' }, { status: 502 })
  }
}
