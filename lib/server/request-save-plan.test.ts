import { describe, expect, it } from 'vitest'
import { planMonthRequestSave } from '@/lib/server/request-save-plan'

describe('planMonthRequestSave', () => {
  it('keeps the analysis of an unchanged memo, even when is_off changes', () => {
    const plan = planMonthRequestSave(
      [{ date: '2026-12-03', memo: '18時以降' }],
      [{ date: '2026-12-03', is_off: true, memo: '18時以降' }],
    )
    expect(plan.keepAnalysis.map(row => row.date)).toEqual(['2026-12-03'])
    expect(plan.resetAnalysis).toEqual([])
    expect(plan.deleteDates).toEqual([])
  })

  it('treats whitespace-only edits as unchanged', () => {
    const plan = planMonthRequestSave(
      [{ date: '2026-12-03', memo: '18時以降' }],
      [{ date: '2026-12-03', is_off: false, memo: ' 18時以降\n' }],
    )
    expect(plan.keepAnalysis).toHaveLength(1)
  })

  it('resets the analysis of a changed memo and of a new day', () => {
    const plan = planMonthRequestSave(
      [{ date: '2026-12-03', memo: '18時以降' }],
      [
        { date: '2026-12-03', is_off: false, memo: '15時以降' },
        { date: '2026-12-04', is_off: false, memo: '午前のみ' },
      ],
    )
    expect(plan.keepAnalysis).toEqual([])
    expect(plan.resetAnalysis.map(row => row.date)).toEqual(['2026-12-03', '2026-12-04'])
  })

  it('treats a stored null memo like an empty memo', () => {
    const plan = planMonthRequestSave(
      [{ date: '2026-12-05', memo: null }],
      [{ date: '2026-12-05', is_off: true, memo: '' }],
    )
    expect(plan.keepAnalysis).toHaveLength(1)
  })

  it('deletes stored days that are no longer in the entries', () => {
    const plan = planMonthRequestSave(
      [{ date: '2026-12-10', memo: '' }, { date: '2026-12-02', memo: 'x' }, { date: '2026-12-03', memo: '' }],
      [{ date: '2026-12-03', is_off: true, memo: '' }],
    )
    expect(plan.deleteDates).toEqual(['2026-12-02', '2026-12-10'])
  })

  it('deletes everything when the month is cleared', () => {
    const plan = planMonthRequestSave([{ date: '2026-12-01', memo: '' }], [])
    expect(plan).toEqual({ keepAnalysis: [], resetAnalysis: [], deleteDates: ['2026-12-01'] })
  })
})
