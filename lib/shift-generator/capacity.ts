// Check before generating: are the slots affordable, and can the staff cover them?
//   availableHours  what the staff could work this month, capped by the daily
//                   limit and the weekly limit (or the monthly legal total)
//   slotHours       paid hours the slot settings ask for
//   budgetHours     expected sales ÷ the 人時売上 target
// Pure; it uses the same availability reading as the generator.

import { type LaborRules, monthlyLegalHours } from '@/lib/labor-rules'
import { getRequestedRange, isUnavailableOn, weeklyRangeFor } from './requests'
import { calculateActualHours, toTimeRange } from './time'
import type { GeneratorInput, ShiftRequest, TimeRange } from './types'

export type CapacityInput = GeneratorInput & {
  rules: LaborRules
  expectedSales: Record<string, number | null | undefined>
}

export type CapacityCheck = {
  availableHours: number
  slotHours: number
  budgetHours: number | null
  warnings: string[]
}

const pad = (value: number) => String(value).padStart(2, '0')
const round1 = (value: number) => Math.round(value * 10) / 10

export const checkCapacity = (input: CapacityInput): CapacityCheck => {
  const { targetYear, targetMonth, staff, requests, store, rules, counts, slots, groups } = input
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  const dates = Array.from({ length: daysInMonth }, (_, index) => `${targetYear}-${pad(targetMonth)}-${pad(index + 1)}`)
  const storeRange = toTimeRange(store.open_time, store.close_time)
  const requestMap = new Map<string, ShiftRequest>()
  for (const request of requests) if (request.staff_id && request.date) requestMap.set(`${request.staff_id}|${request.date}`, request)
  const configTypeOf = (date: string) => {
    if (input.selectedSpecialDays.includes(date)) return date
    const weekday = new Date(`${date}T00:00:00`).getDay()
    return weekday === 0 || weekday === 6 || input.holidays[date] ? 'we' : 'wd'
  }

  let availableHours = 0
  for (const person of staff) {
    const daily = dates.map(date => {
      const request = requestMap.get(`${person.id}|${date}`)
      if (isUnavailableOn(person, request, date, storeRange)) return 0
      const range: TimeRange | null = getRequestedRange(request, storeRange)
        ?? weeklyRangeFor(person, date, storeRange)
        ?? toTimeRange(person.work_start_1, person.work_end_1)
        ?? toTimeRange(person.work_start_2, person.work_end_2)
        ?? storeRange
      return range ? Math.min(rules.dailyMaxHours, calculateActualHours(range.start, range.end)) : 0
    })
    if (rules.laborTimeMode === 'weekly_40') {
      const firstWeekday = new Date(`${dates[0]}T00:00:00`).getDay()
      const offset = (firstWeekday - rules.weekStartDay + 7) % 7
      for (let start = -offset; start < daysInMonth; start += 7) {
        const week = daily.slice(Math.max(0, start), Math.max(0, start + 7))
        availableHours += Math.min(rules.weeklyMaxHours, week.reduce((total, hours) => total + hours, 0))
      }
    } else {
      availableHours += Math.min(monthlyLegalHours(daysInMonth, rules.weeklyMaxHours), daily.reduce((total, hours) => total + hours, 0))
    }
  }

  let slotHours = 0
  let budgetHours: number | null = 0
  for (const date of dates) {
    const type = configTypeOf(date)
    for (const group of groups) {
      for (let index = 0; index < Math.max(0, counts[type]?.[group] ?? 0); index++) {
        const slot = slots[type]?.[`${group}_${index}`] ?? { start: 10, end: 18 }
        slotHours += calculateActualHours(slot.start, slot.end < slot.start ? slot.end + 24 : slot.end)
      }
    }
    const sales = input.expectedSales[type]
    if (budgetHours !== null) budgetHours = typeof sales === 'number' && rules.targetSalesPerLaborHour > 0 ? budgetHours + sales / rules.targetSalesPerLaborHour : null
  }

  const warnings: string[] = []
  if (budgetHours !== null && budgetHours > 0 && slotHours > budgetHours * 1.05) {
    warnings.push(`枠の設定から出る人時（${round1(slotHours)}h）が、人時売上の目標で使える人時（${round1(budgetHours)}h）を${Math.round((slotHours / budgetHours - 1) * 100)}%超えています。枠を見直すと人件費を下げられます。`)
  }
  if (availableHours < slotHours) {
    warnings.push(`出られる時間の合計（${round1(availableHours)}h、1日・週の上限で頭打ち）が、枠の人時（${round1(slotHours)}h）に足りません。埋まらない枠が出ます。`)
  }
  return { availableHours: round1(availableHours), slotHours: round1(slotHours), budgetHours: budgetHours === null ? null : round1(budgetHours), warnings }
}
