import type { SlotSetting } from '../../start-options'
import type { GeneratorInput, ShiftRequest, StaffRecord } from '../../types'

// Small, explicit inputs for rule tests.

export const staffMember = (overrides: Partial<StaffRecord> & { id: string }): StaffRecord => ({
  name: overrides.id,
  rank: null,
  weekly_target_days: 7,
  is_employee: false,
  main_job: 'ホール',
  work_start_1: '09:00',
  work_end_1: '24:00',
  ...overrides,
})

/** One 'ホール' group with `perDay` identical slots every day (weekdays and weekends). */
export const hallInput = (options: {
  staff: StaffRecord[]
  requests?: ShiftRequest[]
  year?: number
  month?: number
  perDay?: number
  slot?: SlotSetting
  monthlyTargetHours?: number
  holidays?: Record<string, string>
}): GeneratorInput => {
  const perDay = options.perDay ?? 1
  const slot = options.slot ?? { start: 10, end: 14 }
  const slotsFor = Object.fromEntries(Array.from({ length: perDay }, (_, index) => [`ホール_${index}`, slot]))
  return {
    staff: options.staff,
    requests: options.requests ?? [],
    store: { open_time: '09:00', close_time: '24:00', skill_options: '' },
    targetYear: options.year ?? 2026,
    targetMonth: options.month ?? 3,
    groups: ['ホール'],
    counts: { wd: { ホール: perDay }, we: { ホール: perDay } },
    slots: { wd: slotsFor, we: slotsFor },
    selectedSpecialDays: [],
    monthlyTargetHours: options.monthlyTargetHours ?? 168,
    holidays: options.holidays ?? {},
  }
}

export const dateKey = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

/** Dates (YYYY-MM-DD) with a real shift (not '×') for one staff row. */
export const workedDates = (shifts: Record<string, string>) =>
  Object.entries(shifts).filter(([, shift]) => shift !== '×').map(([date]) => date).sort()
