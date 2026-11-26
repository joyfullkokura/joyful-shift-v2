'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  deleteMonthlyShift,
  getGenerateContext,
  getGenerationInputs,
  resolveShiftRequest,
  saveGenerationSettings,
  saveMonthlyShift,
  type RequestReview,
} from '@/app/actions/generate'
import { unwrap, type DataRow } from '@/lib/action-result'
import { getHolidayName, holidaysOfYear, isHoliday } from '@/lib/holidays'
import { type DayRequest, businessHoursOf, formatDayRequest } from '@/lib/day-request'
import { useParams, useRouter } from 'next/navigation'
import { ArrowRight, Calendar as CalendarIcon, CheckCircle2, Save, Rocket, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import ShiftTimeEditor from '@/components/ShiftTimeEditor'
import ConfirmDialog from '@/components/ConfirmDialog'
import DayRequestSheet from '@/components/DayRequestSheet'
import GenerateSkeleton from './GenerateSkeleton'
import LaborRulesPanel from '@/components/LaborRulesPanel'
import HourlySalesPanel from '@/components/HourlySalesPanel'
import DemandPanel, { type HourJobValues } from '@/components/DemandPanel'
import { getPastStaffingCurve, type HourlySalesRow, type PastStaffingCurveResult } from '@/app/actions/labor'
import { DEFAULT_LABOR_RULES, type LaborRules, laborRulesOf } from '@/lib/labor-rules'
import { type RequiredCurve, parseRequiredCurve } from '@/lib/required-curve'
import { peopleFromSales } from '@/lib/hourly-sales'
import { type CapacityCheck, checkCapacity } from '@/lib/shift-generator/capacity'
import { evaluateSchedule } from '@/lib/shift-generator/metrics'
import { DEFAULT_START_OFFSETS, START_OFFSET_CHOICES, type SlotSetting, parseSlotSettings } from '@/lib/shift-generator/start-options'
import ScheduleMetricsPanel from '@/components/ScheduleMetricsPanel'
import type { PreviousMonthTail } from '@/app/actions/generate'
import { useUnsavedChanges } from '@/lib/client/app-version'
import { useFlash } from '@/components/FlashMessage'
import { type StaffRank, sortByRank } from '@/lib/staff-order'
import {
  actualHoursForShifts,
  calculateActualHours,
  calculateScheduleAlerts,
  fToT,
  generateSchedule,
  isMultiRoleStaff,
  jobForGroup,
  shiftHoursFromLabel,
  tToF,
  type GeneratedSchedule,
  type GeneratorStore,
  type ShiftRequest,
  type StaffRecord,
} from '@/lib/shift-generator'

const ROLE_COLORS = [
  { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', bar: 'bg-slate-700', thumb: 'border-slate-700' },
  { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', bar: 'bg-slate-600', thumb: 'border-slate-600' },
  { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', bar: 'bg-slate-700', thumb: 'border-slate-700' },
  { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', bar: 'bg-slate-600', thumb: 'border-slate-600' },
  { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', bar: 'bg-slate-700', thumb: 'border-slate-700' },
]

const weekdayLabel = (dateStr: string) => {
  const d = new Date(`${dateStr}T00:00:00`)
  const labels = ['日', '月', '火', '水', '木', '金', '土']
  return labels[d.getDay()]
}

type GenerationSettingRow = {
  config_type: string
  counts: unknown
  slots: unknown
  expected_sales?: unknown
  required_curve?: unknown
}

/** Starting values until the manager enters expected sales (provisional: year-end averages). */
const DEFAULT_EXPECTED_SALES: Record<string, number> = { wd: 230_000, we: 345_000 }

const expectedSalesOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null

type SlotTimes = SlotSetting

/** Store columns used by this screen (row from the server, typed). */
type GenerateStoreInfo = GeneratorStore & {
  group_options: string | null
  target_mh_per_day: number | null
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toStoreInfo = (row: DataRow): GenerateStoreInfo => ({
  open_time: typeof row.open_time === 'string' ? row.open_time : null,
  close_time: typeof row.close_time === 'string' ? row.close_time : null,
  skill_options: row.skill_options,
  group_options: typeof row.group_options === 'string' ? row.group_options : null,
  target_mh_per_day: typeof row.target_mh_per_day === 'number' ? row.target_mh_per_day : null,
})

/** generation_settings.counts: group -> required people. Non-numeric entries are ignored. */
const toCounts = (value: unknown): Record<string, number> => isPlainObject(value)
  ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
  : {}

/** generation_settings.slots: "group_index" -> hours. Malformed entries are ignored. */
const toSlots = (value: unknown): Record<string, SlotTimes> => parseSlotSettings(value)

type ActiveShiftCell = {
  staffId: string
  date: string
  mode: 'quick' | 'detail'
}

const DATE_COL_CLASS = 'w-[104px] min-w-[104px] max-w-[104px]'
const STAFF_COL_CLASS = 'sticky left-0 w-[148px] min-w-[148px] max-w-[148px] border-r border-slate-200 shadow-[2px_0_6px_-3px_rgba(15,23,42,0.18)]'
const SUMMARY_COL_CLASS = 'sticky right-0 w-[132px] min-w-[132px] border-l border-slate-200 shadow-[-2px_0_6px_-3px_rgba(15,23,42,0.18)]'

const fulfillmentPercent = (
  assignedDays: number,
  weeklyTargetDays: number | undefined,
  daysInMonth: number,
  assignedHours: number,
  monthlyTargetHours?: number
) => {
  if (monthlyTargetHours && monthlyTargetHours > 0) {
    return Math.round((assignedHours / monthlyTargetHours) * 100)
  }
  if (!weeklyTargetDays || weeklyTargetDays <= 0 || daysInMonth <= 0) return null
  const targetDays = (weeklyTargetDays / 7) * daysInMonth
  if (targetDays <= 0) return null
  return Math.round((assignedDays / targetDays) * 100)
}

const dayTone = (dateStr: string) => {
  const weekDay = new Date(`${dateStr}T00:00:00`).getDay()
  if (weekDay === 0 || isHoliday(dateStr)) return 'text-rose-600'
  if (weekDay === 6) return 'text-sky-600'
  return 'text-slate-600'
}

export default function GeneratePage() {
  const { store_id } = useParams()
  const router = useRouter()
  const { notify } = useFlash()
  const [pendingDraftConfirmation, setPendingDraftConfirmation] = useState<'discard' | 'publish' | null>(null)
  const [storeInfo, setStoreInfo] = useState<GenerateStoreInfo | null>(null)
  const [activeTab, setActiveTab] = useState<string>('wd')

  const [viewDate, setViewDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const targetYear = viewDate.getFullYear()
  const targetMonth = viewDate.getMonth() + 1
  const targetMonthStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`

  const [selectedSpecialDays, setSelectedSpecialDays] = useState<string[]>([])
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({})
  const [slots, setSlots] = useState<Record<string, Record<string, SlotTimes>>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [generatedSchedule, setGeneratedSchedule] = useState<GeneratedSchedule | null>(null)
  /** The schedule as last loaded or saved; any other schedule on screen is unsaved (reload banner warns). */
  const [savedSchedule, setSavedSchedule] = useState<GeneratedSchedule | null>(null)
  useUnsavedChanges('generate', generatedSchedule !== null && generatedSchedule !== savedSchedule)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [isCheckingDraft, setIsCheckingDraft] = useState(true)
  const [isDraftEdit, setIsDraftEdit] = useState(false)
  const [draftNotice, setDraftNotice] = useState('')
  const [draftError, setDraftError] = useState('')
  const [requestAnalysisWarning, setRequestAnalysisWarning] = useState('')
  const [requestReviews, setRequestReviews] = useState<RequestReview[]>([])
  /** Paper-form order (id → position) for showing the schedule; generation itself keeps its own order. */
  const [staffRank, setStaffRank] = useState<StaffRank>({})
  /** Labor rules, expected sales and required staff (commit 3: stored and shown; the generator uses them later). */
  const [laborRules, setLaborRules] = useState<LaborRules>(DEFAULT_LABOR_RULES)
  const [expectedSales, setExpectedSales] = useState<Record<string, number | null>>({})
  const [curves, setCurves] = useState<Record<string, RequiredCurve | null>>({})
  const [hourlySales, setHourlySales] = useState<Record<'wd' | 'we', HourlySalesRow[]>>({ wd: [], we: [] })
  const [pastCurve, setPastCurve] = useState<PastStaffingCurveResult | null>(null)
  const [isLoadingPast, setIsLoadingPast] = useState(false)
  const [flagCounts, setFlagCounts] = useState<{ lead: number; open: number; close: number } | null>(null)
  /** What the last generation ran with: staff flags, the previous month's last week, the capacity check. */
  const [generationExtras, setGenerationExtras] = useState<{ staff: StaffRecord[]; previousMonth: PreviousMonthTail; capacity: CapacityCheck } | null>(null)
  const [resolvedReviews, setResolvedReviews] = useState<Record<string, DayRequest>>({})
  const [reviewSheet, setReviewSheet] = useState<RequestReview | null>(null)
  const [reviewError, setReviewError] = useState('')
  const [draftAction, setDraftAction] = useState<'save' | 'discard' | 'confirm' | null>(null)
  const [monthlyTargetHours, setMonthlyTargetHours] = useState<number>(168)
  const [activeCell, setActiveCell] = useState<ActiveShiftCell | null>(null)
  const [weekIndex, setWeekIndex] = useState(0)
  const [scheduleView, setScheduleView] = useState<'week' | 'month'>('week')
  const closeShiftEditor = useCallback(() => setActiveCell(null), [])

  const minTime = useMemo(() => tToF(storeInfo?.open_time ?? undefined), [storeInfo])
  const maxTime = useMemo(() => tToF(storeInfo?.close_time ?? undefined), [storeInfo])
  const groups = useMemo(() => storeInfo?.group_options?.split(',') || [], [storeInfo])

  useEffect(() => {
    const closeEditorOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-shift-editor]')) closeShiftEditor()
    }
    document.addEventListener('pointerdown', closeEditorOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeEditorOnOutsidePointer)
  }, [closeShiftEditor])


  const resolveReview = async (review: RequestReview, request: DayRequest) => {
    if (!store_id) return
    const currentStoreId = Array.isArray(store_id) ? store_id[0] : store_id
    setReviewError('')
    const result = await resolveShiftRequest(currentStoreId, review.id, request.kind, request.start, request.end)
    if (!result.ok) {
      setReviewError(result.error)
      return
    }
    setResolvedReviews(previous => ({ ...previous, [review.id]: result.data }))
  }

  const loadAllSettings = useCallback(async () => {
    if (!store_id) return
    const currentStoreId = Array.isArray(store_id) ? store_id[0] : store_id
    setIsCheckingDraft(true)
    setDraftError('')

    try {
    // One admin-only server call: store settings, this month's draft and generation settings.
    const context = unwrap(await getGenerateContext(currentStoreId, targetMonthStr))
    // 要確認の要望 arrive with the context (one Server Action when the month opens).
    setRequestReviews(context.reviews)
    setStaffRank(context.staffRank)
    setLaborRules(laborRulesOf(context.store))
    setFlagCounts(context.flagCounts)
    setPastCurve(null)
    setResolvedReviews({})
    setReviewError('')
    const sInfo = context.store ? toStoreInfo(context.store) : null
    if (sInfo) setStoreInfo(sInfo)

    const draftRow = context.draft
    if (draftRow?.status === 'draft') {
      const storedSchedule = (draftRow.schedule_data ?? draftRow.schedule ?? draftRow.shifts) as GeneratedSchedule | undefined
      if (storedSchedule && Array.isArray(storedSchedule.staff) && Array.isArray(storedSchedule.alerts)) {
        setGeneratedSchedule(storedSchedule)
        setSavedSchedule(storedSchedule)
        setIsDraftEdit(true)
        return
      }
      setDraftError('保存された下書きの形式を読み取れませんでした。')
    }

    setIsDraftEdit(false)
    const storeGroups = sInfo?.group_options ? sInfo.group_options.split(',') : []

    const currentSettings = context.settings as GenerationSettingRow[]

    const newCounts: Record<string, Record<string, number>> = {}
    const newSlots: Record<string, Record<string, SlotTimes>> = {}
    const newSales: Record<string, number | null> = {}
    const newCurves: Record<string, RequiredCurve | null> = {}
    const specials: string[] = []

    if (currentSettings && currentSettings.length > 0) {
      currentSettings.forEach(set => {
        newCounts[set.config_type] = toCounts(set.counts)
        newSlots[set.config_type] = toSlots(set.slots)
        newSales[set.config_type] = expectedSalesOf(set.expected_sales)
        newCurves[set.config_type] = parseRequiredCurve(set.required_curve)
        if (set.config_type !== 'wd' && set.config_type !== 'we') {
          specials.push(set.config_type)
        }
      })
    } else {
      const pastSettings = context.pastSettings as GenerationSettingRow[]

      if (pastSettings && pastSettings.length > 0) {
        const latestWd = pastSettings.find(s => s.config_type === 'wd')
        const latestWe = pastSettings.find(s => s.config_type === 'we')

        if (latestWd) {
          newCounts['wd'] = toCounts(latestWd.counts)
          newSlots['wd'] = toSlots(latestWd.slots)
          newSales['wd'] = expectedSalesOf(latestWd.expected_sales)
          newCurves['wd'] = parseRequiredCurve(latestWd.required_curve)
        }
        if (latestWe) {
          newCounts['we'] = toCounts(latestWe.counts)
          newSlots['we'] = toSlots(latestWe.slots)
          newSales['we'] = expectedSalesOf(latestWe.expected_sales)
          newCurves['we'] = parseRequiredCurve(latestWe.required_curve)
        }
      } else {
        ;['wd', 'we'].forEach(t => {
          newCounts[t] = {}
          newSlots[t] = {}
          storeGroups.forEach((g: string) => {
            newCounts[t][g] = 6
            for (let i = 0; i < 6; i++) {
              newSlots[t][`${g}_${i}`] = { start: 10, end: 18 }
            }
          })
        })
      }
    }

    setCounts(newCounts)
    setSlots(newSlots)
    for (const type of ['wd', 'we']) if (newSales[type] == null) newSales[type] = DEFAULT_EXPECTED_SALES[type]
    setExpectedSales(newSales)
    setCurves(newCurves)
    setSelectedSpecialDays(specials)
    } catch (error) {
      setDraftError(`下書きまたは設定を読み込めませんでした: ${error instanceof Error ? error.message : '通信エラー'}`)
    } finally {
      setIsCheckingDraft(false)
    }
  }, [store_id, targetMonthStr])

  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  const firstDay = new Date(targetYear, targetMonth - 1, 1).getDay()
  const currentScheduleAlerts = useMemo(
    () => generatedSchedule ? calculateScheduleAlerts(generatedSchedule, targetMonth) : [],
    [generatedSchedule, targetMonth]
  )
  const currentVacancyCount = currentScheduleAlerts.filter(alert => alert.type === 'vacancy').length
  const sortedGeneratedStaff = generatedSchedule
    ? sortByRank(generatedSchedule.staff, staffRank)
    : []

  // Evaluation of the schedule on screen (generated or a draft being edited). Read-only.
  const evaluation = (() => {
    if (!generatedSchedule) return null
    const minors = new Set((generationExtras?.staff ?? []).filter(person => (person as { is_minor?: unknown }).is_minor === true).map(person => person.id))
    return evaluateSchedule({
      targetYear,
      targetMonth,
      staff: generatedSchedule.staff.map(person => ({
        id: person.id, name: person.name, isEmployee: person.isEmployee, isMinor: minors.has(person.id),
        mainJob: person.mainJob, shifts: person.shifts, assignedRoles: person.assignedRoles,
      })),
      previousMonth: generationExtras?.previousMonth.staff,
      rules: laborRules,
      selectedSpecialDays,
      holidays: holidaysOfYear(targetYear),
      expectedSales,
      curves,
    })
  })()
  const staffNames = Object.fromEntries((generatedSchedule?.staff ?? []).map(person => [person.id, person.name]))
  const metricsPanel = evaluation
    ? <ScheduleMetricsPanel evaluation={evaluation} capacity={generationExtras?.capacity ?? null} target={laborRules.targetSalesPerLaborHour} staffNames={staffNames} />
    : null

  useEffect(() => {
    loadAllSettings()
  }, [loadAllSettings])

  const changeMonth = (diff: number) => {
    setViewDate(new Date(targetYear, targetMonth - 1 + diff, 1))
    setWeekIndex(0)
    setGeneratedSchedule(null)
  }

  const updateCount = (tab: string, group: string, delta: number) => {
    setGeneratedSchedule(null)
    setCounts(prev => {
      const tabData = { ...(prev[tab] || {}) }
      tabData[group] = Math.max(0, (tabData[group] || 0) + delta)
      return { ...prev, [tab]: tabData }
    })
  }

  const updateTimeSlot = (tab: string, id: string, type: 'start' | 'end', val: number) => {
    setGeneratedSchedule(null)
    setSlots(prev => {
      const tabData = { ...(prev[tab] || {}) }
      const current = tabData[id] || { start: 10, end: 18 }
      let { start, end } = current
      if (type === 'start') start = Math.min(val, end - 0.5)
      if (type === 'end') end = Math.max(val, start + 0.5)
      tabData[id] = { ...current, start, end }
      return { ...prev, [tab]: tabData }
    })
  }

  /** Turns one start-time candidate of a slot on or off (the slot start always stays on). */
  const toggleStartOffset = (tab: string, id: string, offset: number) => {
    if (offset === 0) return
    setGeneratedSchedule(null)
    setSlots(prev => {
      const tabData = { ...(prev[tab] || {}) }
      const current = tabData[id] || { start: 10, end: 18 }
      const offsets = current.startOffsets ?? DEFAULT_START_OFFSETS
      const next = offsets.includes(offset) ? offsets.filter(value => value !== offset) : [...offsets, offset]
      tabData[id] = { ...current, startOffsets: [...new Set([0, ...next])].sort((left, right) => left - right) }
      return { ...prev, [tab]: tabData }
    })
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      // The server removes deselected special days and upserts the rest for this store only.
      const entries = ['wd', 'we', ...selectedSpecialDays].map(type => ({
        config_type: type,
        counts: counts[type] || {},
        slots: slots[type] || {},
        expected_sales: expectedSales[type] ?? null,
        required_curve: curves[type] ?? null,
      }))
      unwrap(await saveGenerationSettings(String(Array.isArray(store_id) ? store_id[0] : store_id), targetMonthStr, entries))
      notify('設定を保存しました。')
    } catch (error) {
      notify('設定を保存できませんでした: ' + (error instanceof Error ? error.message : '通信エラー'), 'error')
    } finally { setIsSaving(false) }
  }

  const currentTabCounts = useMemo(() => counts[activeTab] || {}, [activeTab, counts])
  const currentTabSlots = useMemo(() => slots[activeTab] || {}, [activeTab, slots])
  const demandDayType: 'wd' | 'we' = activeTab === 'wd' ? 'wd' : 'we'
  const demandHours = useMemo(() => {
    const from = Math.floor(minTime)
    const to = Math.ceil(maxTime)
    return Array.from({ length: Math.max(0, Math.min(24, to) - from) }, (_, index) => from + index)
  }, [maxTime, minTime])
  const slotPeople = useMemo<HourJobValues>(() => {
    const result: HourJobValues = { ホール: {}, キッチン: {} }
    for (const group of groups) {
      const job = jobForGroup(group) ?? 'ホール'
      for (let index = 0; index < (currentTabCounts[group] || 0); index++) {
        const slot = currentTabSlots[`${group}_${index}`] || { start: 10, end: 18 }
        const end = slot.end < slot.start ? slot.end + 24 : slot.end
        for (let hour = Math.floor(slot.start); hour < Math.ceil(end); hour++) {
          const overlap = Math.min(end, hour + 1) - Math.max(slot.start, hour)
          if (overlap > 0) result[job][hour] = (result[job][hour] ?? 0) + overlap
        }
      }
    }
    return result
  }, [currentTabCounts, currentTabSlots, groups])
  const pastPeople = useMemo<HourJobValues | null>(() => {
    if (!pastCurve) return null
    const part = pastCurve[demandDayType].curve
    return {
      ホール: Object.fromEntries(Object.entries(part['ホール']).map(([hour, people]) => [Number(hour), people])),
      キッチン: Object.fromEntries(Object.entries(part['キッチン']).map(([hour, people]) => [Number(hour), people])),
    }
  }, [demandDayType, pastCurve])
  const salesPeople = useMemo(() => hourlySales[demandDayType].length > 0
    ? peopleFromSales(hourlySales[demandDayType].map(row => ({ hour: row.hour, sales: row.sales, customers: row.customers })), laborRules.targetSalesPerLaborHour, laborRules.salesOffsetHours)
    : null, [demandDayType, hourlySales, laborRules])

  const loadPastCurve = async () => {
    if (!store_id) return
    setIsLoadingPast(true)
    const result = await getPastStaffingCurve(Array.isArray(store_id) ? store_id[0] : store_id, targetMonthStr)
    setIsLoadingPast(false)
    if (result.ok) setPastCurve(result.data)
    else notify('過去の実績を集計できませんでした: ' + result.error, 'error')
  }

  const currentTotalMH = useMemo(() => {
    let total = 0
    Object.keys(currentTabCounts).forEach(g => {
      const c = currentTabCounts[g] || 0
      for (let i = 0; i < c; i++) {
        const s = currentTabSlots[`${g}_${i}`] || { start: 10, end: 18 }
        total += calculateActualHours(s.start, s.end)
      }
    })
    return total
  }, [activeTab, counts, slots])

  const formatSliderPos = (value: number) => {
    if (!storeInfo?.open_time || !storeInfo?.close_time) return 0
    return Math.min(100, Math.max(0, ((value - minTime) / (maxTime - minTime)) * 100))
  }

  const buildGeneratedSchedule = async () => {
    if (!store_id || !storeInfo) return

    const currentStoreId = Array.isArray(store_id) ? store_id[0] : store_id
    const inputsResult = await getGenerationInputs(currentStoreId, targetMonthStr)
    if (!inputsResult.ok) {
      setRequestAnalysisWarning(inputsResult.error)
      return
    }
    const staffData = inputsResult.data.staff

    const requests = inputsResult.data.requests as ShiftRequest[]
    // Requests are structured data; nothing is analysed here. Unread old memos use the usual conditions.
    const pendingReviews = inputsResult.data.reviews
    setRequestReviews(previous => {
      const listed = new Set(previous.map(review => review.id))
      return [...previous, ...pendingReviews.filter(review => !listed.has(review.id))]
    })
    setRequestAnalysisWarning(pendingReviews.length > 0
      ? `要確認の要望が${pendingReviews.length}件残っているため、その日は基本条件で作成しました。`
      : '')

    const generatorInput = {
      staff: (staffData || []) as StaffRecord[],
      requests,
      store: storeInfo,
      targetYear,
      targetMonth,
      groups,
      counts,
      slots,
      selectedSpecialDays,
      monthlyTargetHours,
      holidays: holidaysOfYear(targetYear),
      // Hard limits (rule settings) and the previous month's last week for the weekly limit / rest interval.
      rules: laborRules,
      previousMonth: inputsResult.data.previousMonth.staff,
    }
    const schedule = generateSchedule(generatorInput)
    setGenerationExtras({
      staff: generatorInput.staff,
      previousMonth: inputsResult.data.previousMonth,
      capacity: (() => {
        const check = checkCapacity({ ...generatorInput, rules: laborRules, expectedSales })
        if (inputsResult.data.previousMonth.source === 'none') {
          check.warnings.push('前月のシフト（確定・下書き）がないため、月初の週の上限と勤務間インターバルは今月の分だけで判定しました。')
        } else if (inputsResult.data.previousMonth.source === 'draft') {
          check.warnings.push('前月は確定前のため、下書きのシフトで月初の週の上限と勤務間インターバルを判定しました。')
        }
        return check
      })(),
    })
    setGeneratedSchedule(schedule)
  }

  const handleGenerate = async () => {
    setIsGenerating(true)
    setRequestAnalysisWarning('')
    try {
      await buildGeneratedSchedule()
    } finally {
      setIsGenerating(false)
    }
  }

  const handleConfirmSchedule = async () => {
    if (!generatedSchedule || !store_id) return
    setIsConfirming(true)
    setConfirmError('')
    try {
      const storeId = Array.isArray(store_id) ? store_id[0] : store_id
      unwrap(await saveMonthlyShift(storeId, targetMonthStr, 'draft', {
        ...generatedSchedule,
        alerts: currentScheduleAlerts,
        vacancyCount: currentVacancyCount,
      }))
      setSavedSchedule(generatedSchedule)
      setIsDraftEdit(true)
      setDraftNotice('下書きを保存しました')
      setDraftError('')
    } catch (error) {
      setConfirmError(`下書きを保存できませんでした: ${error instanceof Error ? error.message : '保存エラー'}`)
    } finally {
      setIsConfirming(false)
    }
  }

  const updateDraftShift = (staffId: string, date: string, value: string) => {
    setDraftNotice('')
    setGeneratedSchedule(current => {
      if (!current) return current
      const staff = current.staff.map(person => {
        if (person.id !== staffId) return person
        const shifts = { ...person.shifts, [date]: value }
        const assignedHours = actualHoursForShifts(shifts)
        const assignedDays = Object.values(shifts).filter(shift => shiftHoursFromLabel(shift) > 0).length
        return { ...person, shifts, assignedHours, assignedDays }
      })
      const assignedHours = staff.reduce((total, person) => total + person.assignedHours, 0)
      return { ...current, staff, assignedHours }
    })
  }

  const toggleDraftShiftRole = (staffId: string, date: string) => {
    setGeneratedSchedule(current => {
      if (!current) return current
      return {
        ...current,
        staff: current.staff.map(person => {
          if (
            person.id !== staffId
            || !isMultiRoleStaff(person)
            || shiftHoursFromLabel(person.shifts[date] || '') <= 0
          ) return person
          const assignedRoles = { ...person.assignedRoles }
          const currentRole = assignedRoles[date] || 'ホール'
          assignedRoles[date] = currentRole === 'ホール' ? 'キッチン' : 'ホール'
          return { ...person, assignedRoles }
        }),
      }
    })
  }

  const saveDraft = async () => {
    if (!generatedSchedule || !store_id) return
    const currentStoreId = Array.isArray(store_id) ? store_id[0] : store_id
    setDraftAction('save')
    setDraftError('')
    setDraftNotice('')
    try {
      unwrap(await saveMonthlyShift(currentStoreId, targetMonthStr, 'draft', {
        ...generatedSchedule,
        alerts: currentScheduleAlerts,
        vacancyCount: currentVacancyCount,
      }))
      setSavedSchedule(generatedSchedule)
      setDraftNotice('下書きを保存しました')
    } catch (error) {
      setDraftError(`下書きを保存できませんでした: ${error instanceof Error ? error.message : '通信エラー'}`)
    } finally {
      setDraftAction(null)
    }
  }

  /** Runs after the in-page confirmation (ConfirmDialog). */
  const discardDraft = async () => {
    setPendingDraftConfirmation(null)
    if (!store_id) return
    const currentStoreId = Array.isArray(store_id) ? store_id[0] : store_id
    setDraftAction('discard')
    setDraftError('')
    try {
      unwrap(await deleteMonthlyShift(currentStoreId, targetMonthStr))
      setGeneratedSchedule(null)
      setIsDraftEdit(false)
      setDraftNotice('')
      await loadAllSettings()
    } catch (error) {
      setDraftError(`下書きを破棄できませんでした: ${error instanceof Error ? error.message : '通信エラー'}`)
    } finally {
      setDraftAction(null)
    }
  }

  /** Runs after the in-page confirmation (ConfirmDialog). */
  const confirmDraft = async () => {
    setPendingDraftConfirmation(null)
    if (!generatedSchedule || !store_id) return
    const currentStoreId = Array.isArray(store_id) ? store_id[0] : store_id
    setDraftAction('confirm')
    setDraftError('')
    try {
      unwrap(await saveMonthlyShift(currentStoreId, targetMonthStr, 'confirmed', {
        ...generatedSchedule,
        alerts: currentScheduleAlerts,
        vacancyCount: currentVacancyCount,
      }))
      setSavedSchedule(generatedSchedule)
      // The flash message lives in the store layout, so it stays visible after navigating.
      notify(`${targetMonth}月のシフトを確定・公開しました。`)
      router.push(`/${encodeURIComponent(currentStoreId)}/view`)
    } catch (error) {
      setDraftError(`シフトを確定できませんでした: ${error instanceof Error ? error.message : '通信エラー'}`)
      setDraftAction(null)
    }
  }

  if (isCheckingDraft || !storeInfo) return <GenerateSkeleton />

  if (isDraftEdit && generatedSchedule) {
    const editDates = Array.from({ length: daysInMonth }, (_, index) =>
      `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`
    )
    const firstOfMonth = new Date(targetYear, targetMonth - 1, 1)
    const firstWeekOffset = (firstOfMonth.getDay() + 6) % 7
    const firstWeekStart = new Date(targetYear, targetMonth - 1, 1 - firstWeekOffset)
    const weekCount = Math.ceil((daysInMonth + firstWeekOffset) / 7)
    const currentWeekIndex = Math.min(weekIndex, weekCount - 1)
    const selectedWeekStart = new Date(firstWeekStart)
    selectedWeekStart.setDate(firstWeekStart.getDate() + currentWeekIndex * 7)
    const weekDates = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(selectedWeekStart)
      date.setDate(selectedWeekStart.getDate() + index)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    })
    const visibleDates = scheduleView === 'week' ? weekDates : editDates
    const weekEnd = new Date(selectedWeekStart)
    weekEnd.setDate(selectedWeekStart.getDate() + 6)
    const formatShortDate = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`
    const dailyHours = Object.fromEntries(editDates.map(date => [date,
      sortedGeneratedStaff.reduce((total, staff) => total + shiftHoursFromLabel(staff.shifts[date] || ''), 0),
    ])) as Record<string, number>
    const presets = Array.from(new Set([
      ...Object.values(slots).flatMap(daySlots => Object.values(daySlots).map(slot => `${fToT(slot.start)}-${fToT(slot.end)}`)),
      ...generatedSchedule.staff.flatMap(staff => Object.values(staff.shifts).filter(shift => shiftHoursFromLabel(shift) > 0)),
    ])).sort((left, right) => tToF(left.split('-')[0]) - tToF(right.split('-')[0])).slice(0, 10)
    const activateShiftCell = (staffId: string, date: string, mode: 'quick' | 'detail') => {
      setActiveCell(current => {
        if (current?.staffId === staffId && current.date === date) return null
        if (mode === 'quick' && current?.mode === 'detail' && (current.staffId !== staffId || current.date !== date)) return current
        return { staffId, date, mode }
      })
    }
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1600px] p-4 pb-60 md:p-8 md:pb-10">
        <header className="sticky top-0 z-30 mb-5 border-b border-slate-200 bg-white/95 py-3 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Draft schedule</p>
              <h1 className="mt-1 truncate text-xl font-semibold text-slate-900">{targetMonth}月 シフト編集</h1>
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">
              <button type="button" onClick={saveDraft} disabled={draftAction !== null} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 sm:text-sm">
                <Save size={16} /> {draftAction === 'save' ? '保存中...' : 'いったん保存'}
              </button>
              <button type="button" onClick={() => setPendingDraftConfirmation('discard')} disabled={draftAction !== null} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60 sm:text-sm">
                <Trash2 size={16} /> {draftAction === 'discard' ? '破棄中...' : '破棄して生成し直す'}
              </button>
              <button type="button" onClick={() => setPendingDraftConfirmation('publish')} disabled={draftAction !== null} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-60 sm:text-sm">
                <Rocket size={16} /> {draftAction === 'confirm' ? '確定中...' : 'この案をベースに確定'}
              </button>
            </div>
          </div>
        </header>
        {metricsPanel && <div className="mb-5">{metricsPanel}</div>}

        <ConfirmDialog
          open={pendingDraftConfirmation === 'discard'}
          tone="danger"
          title="下書きを破棄しますか？"
          message="現在の編集内容を破棄して、AI生成の設定画面に戻ります。この操作は取り消せません。"
          confirmLabel="破棄する"
          onConfirm={() => void discardDraft()}
          onCancel={() => setPendingDraftConfirmation(null)}
        />
        <ConfirmDialog
          open={pendingDraftConfirmation === 'publish'}
          title="シフトを確定して公開しますか？"
          message={`${targetMonth}月のシフトを確定し、スタッフ全員に公開します。`}
          confirmLabel="確定して公開"
          onConfirm={() => void confirmDraft()}
          onCancel={() => setPendingDraftConfirmation(null)}
        />
        {draftNotice && <p role="status" className="mb-4 text-sm text-slate-600">{draftNotice}</p>}
        {(draftError || confirmError) && <p role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{draftError || confirmError}</p>}

        <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
          <span>スタッフ {sortedGeneratedStaff.length}名</span>
          <span>合計人時 <strong className="font-semibold text-slate-900">{generatedSchedule.assignedHours.toFixed(1)}h</strong></span>
          <span>欠員 {currentVacancyCount}枠</span>
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={() => setWeekIndex(index => Math.max(0, index - 1))} disabled={scheduleView !== 'week' || currentWeekIndex === 0} aria-label="前の週" className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 px-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30">
              <ChevronLeft size={14} /> 前の週
            </button>
            <p className="min-w-[190px] text-center text-xs font-semibold tabular-nums text-slate-800">
              第{currentWeekIndex + 1}週 ({formatShortDate(selectedWeekStart)} 〜 {formatShortDate(weekEnd)})
            </p>
            <button type="button" onClick={() => setWeekIndex(index => Math.min(weekCount - 1, index + 1))} disabled={scheduleView !== 'week' || currentWeekIndex >= weekCount - 1} aria-label="次の週" className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 px-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30">
              次の週 <ChevronRight size={14} />
            </button>
          </div>
          <div role="group" aria-label="表示期間" className="inline-flex rounded border border-slate-300 p-0.5">
            {(['week', 'month'] as const).map(view => (
              <button key={view} type="button" aria-pressed={scheduleView === view} onClick={() => setScheduleView(view)} className={`rounded px-2.5 py-1 text-xs font-medium ${scheduleView === view ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                {view === 'week' ? '1週間表示' : '全期間表示'}
              </button>
            ))}
          </div>
        </div>

        <div className={`min-w-0 max-w-full rounded-lg border border-slate-200 bg-white shadow-sm ${scheduleView === 'week' ? 'overflow-x-hidden' : 'overflow-x-auto overscroll-x-contain'}`}>
          <table className={`${scheduleView === 'week' ? 'w-full table-fixed' : 'w-max'} border-separate border-spacing-0 text-xs`}>
            <thead>
              <tr className="bg-slate-50 text-slate-600">
                <th className={`${STAFF_COL_CLASS} z-30 border-b bg-slate-50 px-2 py-1.5 text-left font-semibold`}>スタッフ名</th>
                {visibleDates.map(date => {
                  const inMonth = date.startsWith(`${targetYear}-${String(targetMonth).padStart(2, '0')}-`)
                  const dateColumnClass = scheduleView === 'week' ? 'min-w-0 px-0.5' : DATE_COL_CLASS
                  const dateAlerts = currentScheduleAlerts.filter(alert => alert.id.startsWith(`${date}-`))
                  const vacancyCount = dateAlerts.filter(alert => alert.type === 'vacancy').length
                  const skillAlerts = dateAlerts.filter(alert => alert.type === 'skill')
                  return (
                  <th key={date} className={`${dateColumnClass} border-b border-slate-200 py-1.5 text-center font-semibold ${inMonth ? dayTone(date) : 'text-slate-300'}`}>
                    <span className="block text-[13px] leading-none">{Number(date.slice(-2))}</span>
                    <span className="mt-0.5 block text-[10px] font-normal">{weekdayLabel(date)}</span>
                    <span className="mt-0.5 block text-[10px] font-medium tabular-nums text-slate-500">{inMonth ? `${dailyHours[date].toFixed(1)}h` : ' '}</span>
                    {inMonth && (vacancyCount > 0 || skillAlerts.length > 0) && (
                      <span className="mt-1 flex max-h-14 flex-col gap-0.5 overflow-y-auto text-left font-medium">
                        {vacancyCount > 0 && (
                          <span className="rounded border border-red-200 bg-red-50 px-1 py-0.5 text-[10px] leading-tight text-red-700">
                            欠員 {vacancyCount}枠
                          </span>
                        )}
                        {skillAlerts.map(alert => {
                          const label = alert.message.includes('ラスト')
                            ? 'ラスト レジ締め'
                            : alert.message
                              .replace(/^\d+\/\d+\s+/, '')
                              .replace(/: スキル不足/, '')
                              .replace(/[()]/g, '')
                              .replace(/\[H\]|\[K\]/g, '')
                              .replace(/(\d{2}):00-(\d{2}):00/, '$1-$2')
                          return (
                            <span key={alert.id} title={alert.message} className="rounded border border-red-200 bg-red-50 px-1 py-0.5 text-[10px] leading-tight text-red-700">
                              {label}
                            </span>
                          )
                        })}
                      </span>
                    )}
                  </th>
                )})}
                <th className={`${SUMMARY_COL_CLASS} z-30 border-b bg-slate-50 px-2 py-1.5 text-right font-semibold`}>月間集計</th>
              </tr>
            </thead>
            <tbody>
              {sortedGeneratedStaff.map(staff => {
                const fulfillment = fulfillmentPercent(staff.assignedDays, staff.weeklyTargetDays, daysInMonth, staff.assignedHours, staff.monthlyTargetHours)
                const roleTone = staff.isEmployee || isMultiRoleStaff(staff)
                  ? { cell: 'bg-slate-50 text-slate-800', tag: 'bg-slate-100 text-slate-600' }
                  : staff.mainJob === 'ホール'
                    ? { cell: 'bg-amber-50/40 text-slate-800', tag: 'bg-amber-100/60 text-amber-700' }
                    : staff.mainJob === 'キッチン'
                      ? { cell: 'bg-emerald-50/40 text-slate-800', tag: 'bg-emerald-100/60 text-emerald-700' }
                      : { cell: 'bg-slate-50 text-slate-800', tag: 'bg-slate-100 text-slate-600' }
                return (
                  <tr key={staff.id} className="text-slate-700">
                    <th scope="row" className={`${STAFF_COL_CLASS} z-10 border-b px-2 py-1 text-left font-medium ${roleTone.cell}`}>
                      <span className="block truncate text-xs">{staff.name}</span>
                      <span className={`mt-0.5 inline-block max-w-full truncate rounded px-1 py-0.5 text-[9px] leading-none ${roleTone.tag}`}>{staff.mainJob}{staff.isEmployee ? ' · 社員' : ''}</span>
                    </th>
                    {visibleDates.map(date => {
                      const inMonth = date.startsWith(`${targetYear}-${String(targetMonth).padStart(2, '0')}-`)
                      const dateColumnClass = scheduleView === 'week' ? 'min-w-0 px-0.5' : DATE_COL_CLASS
                      const shiftValue = staff.shifts[date] || ''
                      const assignedRole = staff.assignedRoles?.[date] || 'ホール'
                      const showRoleToggle = isMultiRoleStaff(staff) && shiftHoursFromLabel(shiftValue) > 0
                      return (
                      <td key={date} className={`${dateColumnClass} border-b border-slate-100 py-0.5 ${inMonth ? '' : 'bg-slate-50/70'}`}>
                        {inMonth ? (
                          <div className="flex min-w-0 items-center gap-0.5">
                            {showRoleToggle && (
                              <button
                                type="button"
                                aria-label={`担当職種を${assignedRole}から${assignedRole === 'ホール' ? 'キッチン' : 'ホール'}に切り替え`}
                                title="クリックして担当職種を切り替え"
                                onClick={event => {
                                  event.stopPropagation()
                                  toggleDraftShiftRole(staff.id, date)
                                }}
                                className={`shrink-0 rounded border px-1 text-[10px] leading-5 ${assignedRole === 'ホール' ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-emerald-300 bg-emerald-100 text-emerald-800'}`}
                              >
                                {assignedRole === 'ホール' ? '[ホ]' : '[キ]'}
                              </button>
                            )}
                            <div className="min-w-0 flex-1">
                              <ShiftTimeEditor
                                value={shiftValue}
                                minTime={minTime}
                                maxTime={maxTime}
                                presets={presets}
                                isActive={activeCell?.staffId === staff.id && activeCell.date === date}
                                mode={activeCell?.staffId === staff.id && activeCell.date === date ? activeCell.mode : 'quick'}
                                onActivate={nextMode => activateShiftCell(staff.id, date, nextMode)}
                                onDeactivate={closeShiftEditor}
                                onChange={nextValue => updateDraftShift(staff.id, date, nextValue)}
                              />
                            </div>
                          </div>
                        ) : <span aria-hidden="true" className="block h-8" />}
                      </td>
                    )})}
                    <td className={`${SUMMARY_COL_CLASS} z-10 border-b bg-white px-2 py-1 text-right`}>
                      <span className="block font-semibold tabular-nums text-slate-900">{staff.assignedHours.toFixed(1)}h</span>
                      <span className="mt-0.5 block text-[10px] tabular-nums text-slate-500">出勤 {staff.assignedDays}日</span>
                      <span className={`mt-0.5 block text-[10px] font-medium tabular-nums ${fulfillment !== null && fulfillment < 80 ? 'text-amber-700' : 'text-slate-600'}`}>
                        充足率 {fulfillment === null ? '―' : `${fulfillment}%`}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto min-w-0 max-w-6xl p-4 pb-60 md:p-8 md:pb-10">
      <div className="mb-8 flex items-center justify-between rounded-md border border-[var(--border)] bg-white p-5 shadow-sm">
        <button onClick={() => changeMonth(-1)} className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100"><ChevronLeft size={18} /></button>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[var(--text)]">{targetYear}年 {targetMonth}月</h1>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-subtle)]">シフト生成設定</p>
        </div>
        <button onClick={() => changeMonth(1)} className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100"><ChevronRight size={18} /></button>
      </div>

      {draftError && <p role="alert" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{draftError}</p>}
      {requestAnalysisWarning && <p role="alert" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{requestAnalysisWarning}</p>}

      {(requestReviews.length > 0 || reviewError) && (
        <RequestReviewPanel
          reviews={requestReviews}
          resolved={resolvedReviews}
          error={reviewError}
          onResolve={resolveReview}
          onOpenTime={setReviewSheet}
        />
      )}
      {reviewSheet && (
        <DayRequestSheet
          title={`${reviewSheet.staff_name} さん ${Number(reviewSheet.date.slice(5, 7))}月${Number(reviewSheet.date.slice(-2))}日`}
          subtitle={reviewSheet.memo}
          initial={resolvedReviews[reviewSheet.id] ?? null}
          hours={businessHoursOf(storeInfo?.open_time, storeInfo?.close_time)}
          onApply={request => {
            const review = reviewSheet
            setReviewSheet(null)
            if (request) void resolveReview(review, request)
          }}
          onClose={() => setReviewSheet(null)}
        />
      )}

      <section className="mb-8">
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:items-stretch">
          <div className="rounded-l-md border border-r-0 border-[var(--border)] bg-white p-5 shadow-sm lg:max-w-[320px]">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Monthly target</p>
            <h3 className="mt-1 text-base font-bold text-slate-800">社員の月間最低出勤時間</h3>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMonthlyTargetHours(prev => Math.max(0, prev - 1))}
                className="h-10 w-10 rounded-md border border-slate-200 bg-slate-50 text-lg font-bold text-slate-600 transition-colors hover:bg-slate-100"
              >
                −
              </button>

              <div className="flex flex-1 items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 shadow-sm">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={monthlyTargetHours}
                  onChange={(e) => setMonthlyTargetHours(Number(e.target.value || 0))}
                  className="w-full border-0 bg-transparent text-right text-lg font-bold text-slate-800 outline-none"
                />
                <span className="ml-2 text-sm font-bold text-slate-500">時間</span>
              </div>

              <button
                type="button"
                onClick={() => setMonthlyTargetHours(prev => prev + 1)}
                className="h-10 w-10 rounded-md border border-slate-200 bg-slate-50 text-lg font-bold text-slate-600 transition-colors hover:bg-slate-100"
              >
                +
              </button>
            </div>
          </div>

          <div className="rounded-r-md border border-[var(--border)] bg-white p-3 shadow-sm lg:ml-0 lg:flex-1">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              <CalendarIcon size={14} /> 特別勤務日を選択
            </h3>
            <div className="mx-auto grid max-w-[540px] grid-cols-7 gap-1 md:gap-1 lg:max-w-[620px]">
              {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
                <div key={d} className={`text-center text-[10px] font-bold ${i === 0 ? 'text-red-500' : i === 6 ? 'text-sky-600' : 'text-slate-400'}`}>{d}</div>
              ))}
              {Array(firstDay).fill(0).map((_, i) => <div key={`e-${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1
                const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const holidayName = getHolidayName(dateStr)
                const isSelected = selectedSpecialDays.includes(dateStr)
                const weekDay = new Date(targetYear, targetMonth - 1, day).getDay()
                const isRedDay = weekDay === 0 || holidayName
                const isBlueDay = weekDay === 6

                return (
                  <button
                    key={day}
                    onClick={() => {
                      if (isSelected) {
                        setGeneratedSchedule(null)
                        setSelectedSpecialDays(prev => prev.filter(d => d !== dateStr))
                      }
                      else {
                        setGeneratedSchedule(null)
                        setSelectedSpecialDays(prev => [...prev, dateStr])
                        if (!counts[dateStr]) {
                          setCounts(p => ({ ...p, [dateStr]: counts['we'] || {} }))
                          setSlots(p => ({ ...p, [dateStr]: slots['we'] || {} }))
                        }
                      }
                    }}
                    className={`relative flex h-12 flex-col items-center justify-center rounded-md transition-colors ${
                      isSelected ? 'bg-slate-800 text-white' : 'bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    <span className={`text-[11px] font-bold ${!isSelected && isRedDay ? 'text-red-500' : !isSelected && isBlueDay ? 'text-sky-600' : ''}`}>
                      {day}
                    </span>
                    {holidayName && (
                      <span className={`absolute bottom-0.5 w-full truncate px-0.5 text-[5px] font-bold ${isSelected ? 'text-slate-200' : 'text-red-500'}`}>
                        {holidayName}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <details className="mb-6 rounded-md border border-[var(--border)] bg-slate-50 p-4">
        <summary className="cursor-pointer text-base font-bold text-slate-900">ルール設定・時間別売上</summary>
        <div className="mt-4 space-y-4">
          <LaborRulesPanel storeId={String(Array.isArray(store_id) ? store_id[0] : store_id)} initial={laborRules} daysInMonth={daysInMonth} flagCounts={flagCounts} onSaved={setLaborRules} />
          <HourlySalesPanel storeId={String(Array.isArray(store_id) ? store_id[0] : store_id)} openHour={Math.floor(minTime)} closeHour={Math.min(24, Math.ceil(maxTime))} year={targetYear} onChange={setHourlySales} />
        </div>
      </details>

      <div className="sticky top-0 z-30 mb-6 border-b border-[var(--border)] bg-[var(--background)]/95 pb-4 pt-2">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          <TabButton id="wd" label="平日" active={activeTab} onClick={setActiveTab} />
          <TabButton id="we" label="土日祝" active={activeTab} onClick={setActiveTab} />
          {selectedSpecialDays.sort().map(date => (
            <TabButton key={date} id={date} label={`${parseInt(date.split('-')[2])}日`} active={activeTab} onClick={setActiveTab} />
          ))}
        </div>
      </div>

      <div className="sticky top-4 z-30 mb-6 flex justify-end">
        <div className="rounded-md border border-[var(--border)] bg-white px-5 py-3 shadow-sm ring-1 ring-slate-200/80 backdrop-blur-sm">
          <span className={`text-2xl font-bold ${storeInfo.target_mh_per_day !== null && currentTotalMH > storeInfo.target_mh_per_day ? 'text-red-600' : 'text-slate-800'}`}>
            {currentTotalMH.toFixed(1)}H
          </span>
        </div>
      </div>

      <div className="space-y-12 pb-8">

        {groups.map((group: string, gIdx: number) => {
          const color = ROLE_COLORS[gIdx % ROLE_COLORS.length]
          const count = currentTabCounts[group] || 0
          return (
            <div key={group} className="space-y-6">
              <div className={`flex items-center justify-between rounded-md border p-5 ${color.bg} ${color.border}`}>
                <h4 className={`text-xl font-bold ${color.text}`}>{group}</h4>
                <div className="flex items-center gap-3 rounded-md bg-white p-2 shadow-sm ring-1 ring-slate-200">
                  <button onClick={() => updateCount(activeTab, group, -1)} className="h-9 w-9 rounded-md bg-slate-100 text-xl font-bold text-slate-700">－</button>
                  <span className={`w-8 text-center text-2xl font-bold ${color.text}`}>{count}</span>
                  <button onClick={() => updateCount(activeTab, group, 1)} className="h-9 w-9 rounded-md bg-slate-100 text-xl font-bold text-slate-700">＋</button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 border-l border-dashed border-slate-200 pl-4">
                {Array.from({ length: count }).map((_, i) => {
                  const slotId = `${group}_${i}`
                  const slotSetting = currentTabSlots[slotId] || { start: 10, end: 18 }
                  const { start, end } = slotSetting
                  const startOffsets = slotSetting.startOffsets ?? DEFAULT_START_OFFSETS
                  const slotSpan = (end < start ? end + 24 : end) - start
                  return (
                    <div key={slotId} className={`rounded-md border bg-white p-4 ${color.border}`}>
                    <div className="flex flex-col gap-4 md:flex-row md:items-center">
                      <div className="w-24 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{group} No.{i + 1}</div>
                      <div className="flex flex-1 items-center gap-3">
                        <div className="relative flex h-16 flex-1 items-center">
                          <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-slate-100" />
                          <div className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full ${color.bar}`} style={{ left: `${formatSliderPos(start)}%`, width: `${Math.max(0, formatSliderPos(end) - formatSliderPos(start))}%` }} />

                          <div className="absolute inset-x-0 top-0 h-5">
                            <span className="absolute -translate-x-1/2 text-[11px] font-mono font-bold text-slate-500" style={{ left: `${formatSliderPos(start)}%`, top: '0px', transform: 'translateX(-50%)' }}>{fToT(start)}</span>
                            <span className="absolute -translate-x-1/2 text-[11px] font-mono font-bold text-slate-500" style={{ left: `${formatSliderPos(end)}%`, top: '0px', transform: 'translateX(-50%)' }}>{fToT(end)}</span>
                          </div>

                          <input type="range" min={minTime} max={maxTime} step="0.5" value={start} onChange={(e) => updateTimeSlot(activeTab, slotId, 'start', parseFloat(e.target.value))} className="pointer-events-none absolute inset-x-0 top-1/2 z-20 h-6 -translate-y-1/2 appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:top-1/2 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:-translate-y-1/2 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-slate-700 [&::-webkit-slider-thumb]:shadow-sm" />
                          <input type="range" min={minTime} max={maxTime} step="0.5" value={end} onChange={(e) => updateTimeSlot(activeTab, slotId, 'end', parseFloat(e.target.value))} className="pointer-events-none absolute inset-x-0 top-1/2 z-20 h-6 -translate-y-1/2 appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:top-1/2 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:-translate-y-1/2 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-slate-700 [&::-webkit-slider-thumb]:shadow-sm" />
                        </div>
                      </div>
                      <div className={`min-w-[70px] rounded-md border px-3 py-1.5 text-center text-sm font-bold ${color.border} ${color.bg} ${color.text}`}>
                        {calculateActualHours(start, end).toFixed(1)}h
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      <span className="text-xs font-bold text-slate-600">開始時刻の候補</span>
                      {START_OFFSET_CHOICES.filter(offset => offset < slotSpan).map(offset => {
                        const isOn = startOffsets.includes(offset)
                        return (
                          <button key={offset} type="button" aria-pressed={isOn} disabled={offset === 0}
                            aria-label={`${group} No.${i + 1} の開始時刻の候補 ${fToT(start + offset)}`}
                            onClick={() => toggleStartOffset(activeTab, slotId, offset)}
                            className={`min-h-9 rounded-md border px-3 text-xs font-bold tabular-nums disabled:cursor-default ${isOn ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                            {fToT(start + offset)}
                          </button>
                        )
                      })}
                      <span className="text-[11px] text-slate-500">{slotSetting.startOffsets ? '選んだ時刻のどれかから入ります。' : '未設定：枠の開始から1時間ごと、2時間後まで。'}</span>
                    </div>
                    </div>
                  )
                })}
              </div>

            </div>
          )
        })}

        <DemandPanel
          label={activeTab === 'wd' ? '平日' : activeTab === 'we' ? '土日祝' : `${Number(activeTab.slice(-2))}日`}
          hours={demandHours}
          expectedSales={expectedSales[activeTab] ?? null}
          onExpectedSales={value => setExpectedSales(current => ({ ...current, [activeTab]: value }))}
          curve={curves[activeTab] ?? null}
          onCurve={curve => setCurves(current => ({ ...current, [activeTab]: curve }))}
          slotPeople={slotPeople}
          pastPeople={pastPeople}
          pastDays={pastCurve ? pastCurve[demandDayType].days : null}
          salesPeople={salesPeople}
          slotLaborHours={currentTotalMH}
          target={laborRules.targetSalesPerLaborHour}
          onLoadPast={() => void loadPastCurve()}
          isLoadingPast={isLoadingPast}
        />

        {metricsPanel}

        {generatedSchedule && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <span className="rounded-md bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700">
                合計割り当て人時: {generatedSchedule.assignedHours.toFixed(1)}h
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleConfirmSchedule}
                  disabled={isConfirming}
                  className="flex items-center gap-2 rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
                >
                  <CheckCircle2 size={16} />
                  {isConfirming ? '保存中...' : 'この案をベースに確定して微調整へ'}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
            {confirmError && <p role="alert" className="text-sm font-medium text-red-700">{confirmError}</p>}
            <div className="min-w-0 overflow-x-auto overscroll-x-contain rounded-md border border-[var(--border)] bg-white">
              <table className="w-max border-separate border-spacing-0 text-[11px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-600">
                    <th className={`${STAFF_COL_CLASS} z-20 border-b bg-slate-50 px-3 py-2 text-left font-bold`}>スタッフ名</th>
                    {Array.from({ length: daysInMonth }, (_, index) => {
                      const day = index + 1
                      const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                      const dayAlerts = currentScheduleAlerts.filter(alert => alert.id.startsWith(`${dateStr}-`))
                      const dayVacancyCount = dayAlerts.filter(alert => alert.type === 'vacancy').length
                      const daySkillAlerts = dayAlerts.filter(alert => alert.type === 'skill')
                      const dayHours = generatedSchedule.staff.reduce((total, person) => total + shiftHoursFromLabel(person.shifts[dateStr] || ''), 0)
                      return (
                        <th key={dateStr} className={`${DATE_COL_CLASS} border-b border-[var(--border)] px-1 py-2 text-center align-top font-bold ${dayTone(dateStr)}`}>
                          <span className="block">{day}日</span>
                          <span className="block text-[10px] font-medium">{weekdayLabel(dateStr)}</span>
                          <span className="mt-1 block text-[10px] font-medium tabular-nums text-slate-500">{dayHours.toFixed(1)}h</span>
                          <span className="mt-1 flex max-h-16 flex-col gap-1 overflow-y-auto break-words text-left font-medium">
                            {dayVacancyCount > 0 && (
                              <span className="rounded border border-red-200 bg-red-50 px-1 py-0.5 text-[10px] leading-tight text-red-800">
                                欠員{dayVacancyCount}枠
                              </span>
                            )}
                            {daySkillAlerts.map(alert => {
                              const label = alert.message.includes('ラスト')
                                ? 'ラスト レジ締め'
                                : alert.message
                                  .replace(/^\d+\/\d+\s+/, '')
                                  .replace(/: スキル不足/, '')
                                  .replace(/[()]/g, '')
                                  .replace(/\[H\]|\[K\]/g, '')
                                  .replace(/(\d{2}):00-(\d{2}):00/, '$1-$2')
                              return (
                                <span key={alert.id} title={alert.message} className="rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-[10px] leading-tight text-amber-900">
                                  {label}
                                </span>
                              )
                            })}
                          </span>
                        </th>
                      )
                    })}
                    <th className={`${SUMMARY_COL_CLASS} z-20 border-b bg-slate-50 px-3 py-2 text-right font-bold`}>月間集計</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedGeneratedStaff.map(staff => {
                    const fulfillment = fulfillmentPercent(staff.assignedDays, staff.weeklyTargetDays, daysInMonth, staff.assignedHours, staff.monthlyTargetHours)
                    return (
                    <tr key={staff.id} className="text-slate-700">
                      <th scope="row" className={`${STAFF_COL_CLASS} z-10 border-b bg-white px-3 py-2 text-left font-bold`}>
                        <span className="block truncate">{staff.name}</span>
                        <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">{staff.mainJob} · {staff.employmentType}</span>
                      </th>
                      {Array.from({ length: daysInMonth }, (_, index) => {
                        const day = index + 1
                        const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                        const shift = staff.shifts[dateStr] || ''
                        const assignedRole = staff.assignedRoles?.[dateStr] || 'ホール'
                        const showRoleToggle = isMultiRoleStaff(staff) && shiftHoursFromLabel(shift) > 0
                        return (
                          <td key={dateStr} className={`${DATE_COL_CLASS} border-b border-slate-100 px-1 py-2 text-center ${shift === '×' ? 'bg-red-50 font-bold text-red-500' : shift ? 'font-medium tabular-nums text-slate-700' : 'text-slate-300'}`}>
                            <div className="flex items-center justify-center gap-1">
                              {showRoleToggle && (
                                <button
                                  type="button"
                                  aria-label={`担当職種を${assignedRole}から${assignedRole === 'ホール' ? 'キッチン' : 'ホール'}に切り替え`}
                                  title="クリックして担当職種を切り替え"
                                  onClick={() => toggleDraftShiftRole(staff.id, dateStr)}
                                  className={`shrink-0 rounded border px-1 text-[10px] leading-5 ${assignedRole === 'ホール' ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-emerald-300 bg-emerald-100 text-emerald-800'}`}
                                >
                                  {assignedRole === 'ホール' ? '[ホ]' : '[キ]'}
                                </button>
                              )}
                              <span className="block whitespace-nowrap">{shift || '—'}</span>
                            </div>
                          </td>
                        )
                      })}
                      <td className={`${SUMMARY_COL_CLASS} z-10 border-b bg-white px-3 py-2 text-right`}>
                        <span className="block font-bold tabular-nums">{staff.assignedHours.toFixed(1)}h</span>
                        <span className="mt-0.5 block text-[10px] tabular-nums text-slate-500">出勤 {staff.assignedDays}日</span>
                        <span className="mt-0.5 block text-[10px] font-medium tabular-nums text-slate-600">充足率 {fulfillment === null ? '―' : `${fulfillment}%`}</span>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <div className="fixed bottom-[var(--mobile-nav-height,0px)] left-0 right-0 z-50 flex gap-3 border-t border-[var(--border)] bg-white p-4 pb-3 shadow-sm md:bottom-0 md:left-[268px] md:justify-center md:pb-4">
        <button onClick={handleSave} disabled={isSaving} className="flex-1 rounded-md bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-200 md:max-w-[150px]">
          <span className="inline-flex items-center gap-2"><Save size={16} /> {isSaving ? '...' : '保存'}</span>
        </button>
        <button onClick={handleGenerate} disabled={isGenerating} className="flex-[2] rounded-md bg-slate-900 px-4 py-3 text-base font-bold text-white transition-colors hover:bg-slate-700 disabled:bg-slate-500 md:max-w-[420px]">
          <span className="inline-flex items-center justify-center gap-2"><Rocket size={18} /> {isGenerating ? '生成中...' : 'シフトを自動生成'}</span>
        </button>
      </div>
    </div>
  )
}

function TabButton({ id, label, active, onClick }: { id: string; label: string; active: string; onClick: (id: string) => void }) {
  const isActive = active === id
  return (
    <button
      onClick={() => onClick(id)}
      className={`whitespace-nowrap rounded-md border px-5 py-2.5 text-[11px] font-bold transition-colors ${
        isActive ? 'border-slate-800 bg-slate-800 text-white' : 'border-[var(--border)] bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
      }`}
    >
      {label}
    </button>
  )
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/** Old memo-only requests the rules could not read. Unhandled ones use the usual conditions. */
function RequestReviewPanel({ reviews, resolved, error, onResolve, onOpenTime }: {
  reviews: RequestReview[]
  resolved: Record<string, DayRequest>
  error: string
  onResolve: (review: RequestReview, request: DayRequest) => void
  onOpenTime: (review: RequestReview) => void
}) {
  const remaining = reviews.filter(review => !resolved[review.id]).length
  return (
    <section aria-labelledby="request-review-title" className="mb-8 rounded-md border border-[var(--border)] bg-white p-4 shadow-sm sm:p-5">
      <h2 id="request-review-title" className="text-lg font-bold text-slate-900">要確認の要望</h2>
      <p className="mt-1 text-sm text-slate-600">メモだけで時間が決まらなかった要望です。入れなかったものは「希望なし」として作成します。</p>
      {reviews.length > 0 && <p className="mt-3 text-[15px] font-bold text-slate-900">{remaining > 0 ? `残り ${remaining} 件` : 'すべて確認済み'}</p>}
      {error && <p role="alert" className="mt-2 text-sm font-bold text-red-700">{error}</p>}
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {reviews.map(review => {
          const decided = resolved[review.id]
          const date = new Date(`${review.date}T00:00:00`)
          return (
            <li key={review.id} className={`flex flex-col gap-2 rounded-md border border-slate-200 p-3 ${decided ? 'bg-slate-50' : 'bg-white'}`}>
              <div className="flex justify-between gap-2 font-bold text-slate-900">
                <span className="min-w-0 truncate">{review.staff_name} さん</span>
                <span className="shrink-0 tabular-nums">{date.getMonth() + 1}月{date.getDate()}日（{WEEKDAY_LABELS[date.getDay()]}）</span>
              </div>
              <p className="whitespace-pre-wrap break-words rounded bg-slate-50 px-3 py-2 text-[15px] text-slate-800">{review.memo}</p>
              {decided ? (
                <div className="flex items-center gap-2">
                  <span className={`font-bold ${decided.kind === 'off' ? 'text-red-700' : 'text-slate-900'}`}>{formatDayRequest(decided)}</span>
                  <button type="button" onClick={() => onOpenTime(review)} className="ml-auto px-1 py-2 text-sm font-bold text-slate-600 underline underline-offset-4">変更</button>
                </div>
              ) : (
                <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-1.5">
                  <button type="button" onClick={() => onResolve(review, { kind: 'off', start: null, end: null })} className="min-h-12 rounded-md border border-slate-300 bg-white text-[15px] font-bold text-red-700 hover:bg-slate-50">休み</button>
                  <button type="button" onClick={() => onResolve(review, { kind: 'any', start: null, end: null })} className="min-h-12 rounded-md border border-slate-300 bg-white text-[15px] font-bold text-slate-900 hover:bg-slate-50">終日OK</button>
                  <button type="button" onClick={() => onOpenTime(review)} className="min-h-12 rounded-md border border-slate-300 bg-white text-[15px] font-bold text-slate-900 hover:bg-slate-50">時間を入れる</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
