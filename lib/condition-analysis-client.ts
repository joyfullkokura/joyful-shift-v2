import { supabase } from '@/lib/supabase'
import {
  type ConditionAnalysisInput,
  parseParsedConditions,
  type ParsedConditions,
} from '@/lib/parsed-conditions'

type AnalysisTarget = ConditionAnalysisInput & {
  staffId: string
  storeId: string
}

/** Starts an optional AI analysis without making the calling form fail on errors. */
export const analyzeAndSaveStaffConditions = async ({ staffId, storeId, ...conditions }: AnalysisTarget): Promise<ParsedConditions | null> => {
  try {
    const response = await fetch('/api/parse-conditions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(conditions),
    })
    if (!response.ok) throw new Error(`Condition parsing failed: ${response.status}`)

    const parsed = parseParsedConditions(await response.json())
    if (!parsed) throw new Error('Condition parsing returned an invalid response')

    const { error } = await supabase
      .from('staff')
      .update({ parsed_conditions: parsed })
      .eq('id', staffId)
      .eq('store_id', storeId)
    if (error) throw error
    return parsed
  } catch (error) {
    console.error('勤務条件のAI解析に失敗しました。', error)
    return null
  }
}
