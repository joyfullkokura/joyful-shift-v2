'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { parseSkillOptions } from '@/lib/skill-options'
import { parseParsedShiftRequest } from '@/lib/parsed-conditions'
import { useParams, useRouter } from 'next/navigation'
import { ArrowRight, Calendar as CalendarIcon, CheckCircle2, Save, Rocket, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import ShiftTimeEditor from '@/components/ShiftTimeEditor'

const tToF = (t: string | undefined) => {
  if (!t) return 10
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}

const fToT = (f: number) => {
  const h = Math.floor(f)
  const m = Math.round((f % 1) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const HOLIDAYS: { [key: string]: string } = {
  '2026-01-01': '元日', '2026-01-12': '成人の日', '2026-02-11': '建国記念の日', '2026-02-23': '天皇誕生日',
  '2026-03-21': '春分の日', '2026-04-29': '昭和の日', '2026-05-03': '憲法記念日', '2026-05-04': 'みどりの日',
  '2026-05-05': 'こどもの日', '2026-05-06': '振替休日', '2026-07-20': '海の日', '2026-08-11': '山の日',
  '2026-09-21': '敬老の日', '2026-09-22': '国民の休日', '2026-09-23': '秋分の日', '2026-10-12': 'スポーツの日',
  '2026-11-03': '文化の日', '2026-11-23': '勤労感謝の日',
  '2027-01-01': '元日', '2027-01-11': '成人の日', '2027-02-11': '建国記念の日', '2027-02-23': '天皇誕生日',
  '2027-03-21': '春分の日', '2027-03-22': '振替休日', '2027-04-29': '昭和の日', '2027-05-03': '憲法記念日',
  '2027-05-04': 'みどりの日', '2027-05-05': 'こどもの日', '2027-07-19': '海の日', '2027-08-11': '山の日',
  '2027-09-20': '敬老の日', '2027-09-23': '秋分の日', '2027-10-11': 'スポーツの日', '2027-11-03': '文化の日',
  '2027-11-23': '勤労感謝の日',
}

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

type GeneratedStaffShift = {
  id: string
  name: string
  mainJob: string
  jobOptions?: string[]
  isEmployee: boolean
  employmentType: string
  shifts: Record<string, string>
  assignedDays: number
  assignedHours: number
  weeklyTargetDays?: number
}

type GeneratedSchedule = {
  staff: GeneratedStaffShift[]
  vacancyCount: number
  assignedHours: number
  alerts: ScheduleAlert[]
}

type ScheduleAlert = {
  id: string
  type: 'vacancy' | 'skill'
  message: string
}

type StaffRecord = {
  id: string
  name: string
  rank?: string | null
  weekly_target_days?: number | null
  monthly_target_hours?: number | null
  skills?: string | null
  is_employee?: boolean | null
  main_job?: string | null
  possible_groups?: string | null
  work_start_1?: string | null
  work_end_1?: string | null
  work_start_2?: string | null
  work_end_2?: string | null
}

type ShiftRequest = {
  id?: string
  staff_id?: string | null
  date?: string | null
  is_off?: boolean | null
  start_time?: string | null
  end_time?: string | null
  memo?: string | null
  parsed_request?: unknown
}

type ActiveShiftCell = {
  staffId: string
  date: string
  mode: 'quick' | 'detail'
}

const getJobOptions = (mainJob: string | null | undefined, possibleGroups: string | null | undefined) => {
  const options = new Set<string>()
  const addJob = (value: string) => {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'hd' || normalized === 'hn' || value.includes('ホール')) options.add('ホール')
    if (normalized === 'kd' || normalized === 'kn' || value.includes('キッチン')) options.add('キッチン')
    if (value.trim() && value !== '共通' && !['hd', 'hn', 'kd', 'kn'].includes(normalized) && !value.includes('ホール') && !value.includes('キッチン')) options.add(value.trim())
  }

  if (mainJob === '共通') {
    options.add('ホール')
    options.add('キッチン')
  } else if (mainJob) {
    addJob(mainJob)
  }
  ;(possibleGroups || '').split(',').filter(Boolean).forEach(addJob)
  return [...options]
}

type TimeRange = {
  start: number
  end: number
}

const toTimeRange = (startValue?: string | null, endValue?: string | null): TimeRange | null => {
  if (!startValue || !endValue) return null
  const start = tToF(startValue)
  let end = tToF(endValue)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (end < start) end += 24
  return end > start ? { start, end } : null
}

const isRequestUnavailable = (request?: ShiftRequest) =>
  request?.is_off === true || parseParsedShiftRequest(request?.parsed_request)?.is_available === false

const getRequestedRange = (request?: ShiftRequest) => {
  const explicitRange = toTimeRange(request?.start_time, request?.end_time)
  if (explicitRange) return explicitRange
  const parsedRequest = parseParsedShiftRequest(request?.parsed_request)
  return parsedRequest?.is_available
    ? toTimeRange(parsedRequest.start_time, parsedRequest.end_time)
    : null
}

const jobForGroup = (group: string): 'ホール' | 'キッチン' | null => {
  const normalizedGroup = group.trim().toLowerCase()
  if (normalizedGroup === 'hd' || normalizedGroup === 'hn' || group.includes('ホール')) return 'ホール'
  if (normalizedGroup === 'kd' || normalizedGroup === 'kn' || group.includes('キッチン')) return 'キッチン'
  return null
}

const labelForGroup = (group: string) => {
  const labels: Record<string, string> = {
    hd: 'ホール昼',
    hn: 'ホール夜',
    kd: 'キッチン昼',
    kn: 'キッチン夜',
  }
  return labels[group.trim().toLowerCase()] || group
}

const formatAlertTime = (time: number) => {
  if (time === 24) return '24:00'
  const normalizedTime = time % 24
  const hour = Math.floor(normalizedTime)
  const minute = Math.round((normalizedTime - hour) * 60)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

const shiftHoursFromLabel = (shift: string) => {
  const match = shift.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/)
  if (!match) return 0
  const start = Number(match[1]) + Number(match[2]) / 60
  let end = Number(match[3]) + Number(match[4]) / 60
  if (end < start) end += 24
  return Math.max(0, end - start)
}

const WEEKS_PER_MONTH = 4.3
const DATE_COL_CLASS = 'w-[104px] min-w-[104px] max-w-[104px]'
const STAFF_COL_CLASS = 'sticky left-0 w-[148px] min-w-[148px] max-w-[148px] border-r border-slate-200 shadow-[2px_0_6px_-3px_rgba(15,23,42,0.18)]'
const SUMMARY_COL_CLASS = 'sticky right-0 w-[132px] min-w-[132px] border-l border-slate-200 shadow-[-2px_0_6px_-3px_rgba(15,23,42,0.18)]'

const fulfillmentPercent = (assignedDays: number, weeklyTargetDays?: number) => {
  if (!weeklyTargetDays || weeklyTargetDays <= 0) return null
  const targetDays = weeklyTargetDays * WEEKS_PER_MONTH
  if (targetDays <= 0) return null
  return Math.round((assignedDays / targetDays) * 100)
}

const dayTone = (dateStr: string) => {
  const weekDay = new Date(`${dateStr}T00:00:00`).getDay()
  if (weekDay === 0 || HOLIDAYS[dateStr]) return 'text-rose-600'
  if (weekDay === 6) return 'text-sky-600'
  return 'text-slate-600'
}

export default function GeneratePage() {
  const { store_id } = useParams()
  const router = useRouter()
  const [storeInfo, setStoreInfo] = useState<any>(null)
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
  const [slots, setSlots] = useState<Record<string, Record<string, { start: number, end: number }>>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [generatedSchedule, setGeneratedSchedule] = useState<GeneratedSchedule | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [isCheckingDraft, setIsCheckingDraft] = useState(true)
  const [isDraftEdit, setIsDraftEdit] = useState(false)
  const [draftNotice, setDraftNotice] = useState('')
  const [draftError, setDraftError] = useState('')
  const [requestAnalysisWarning, setRequestAnalysisWarning] = useState('')
  const [draftAction, setDraftAction] = useState<'save' | 'discard' | 'confirm' | null>(null)
  const [monthlyTargetHours, setMonthlyTargetHours] = useState<number>(168)
  const [activeCell, setActiveCell] = useState<ActiveShiftCell | null>(null)
  const closeShiftEditor = useCallback(() => setActiveCell(null), [])

  const minTime = useMemo(() => tToF(storeInfo?.open_time), [storeInfo])
  const maxTime = useMemo(() => tToF(storeInfo?.close_time), [storeInfo])
  const groups = useMemo(() => storeInfo?.group_options?.split(',') || [], [storeInfo])

  useEffect(() => {
    const closeEditorOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-shift-editor]')) closeShiftEditor()
    }
    document.addEventListener('pointerdown', closeEditorOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeEditorOnOutsidePointer)
  }, [closeShiftEditor])

  const loadAllSettings = useCallback(async () => {
    if (!store_id) return
    const currentStoreId = Array.isArray(store_id) ? store_id[0] : store_id
    setIsCheckingDraft(true)
    setDraftError('')

    try {
    const { data: sInfo } = await supabase.from('stores').select('*').eq('store_id', currentStoreId).single()
    if (sInfo) setStoreInfo(sInfo)

    const { data: draftRow, error: draftFetchError } = await supabase
      .from('monthly_shifts')
      .select('*')
      .eq('store_id', currentStoreId)
      .eq('target_month', targetMonthStr)
      .maybeSingle()

    if (draftFetchError) {
      setDraftError(`下書きを確認できませんでした: ${draftFetchError.message}`)
    } else if (draftRow?.status === 'draft') {
      const storedSchedule = (draftRow.schedule_data ?? draftRow.schedule ?? draftRow.shifts) as GeneratedSchedule | undefined
      if (storedSchedule && Array.isArray(storedSchedule.staff) && Array.isArray(storedSchedule.alerts)) {
        setGeneratedSchedule(storedSchedule)
        setIsDraftEdit(true)
        return
      }
      setDraftError('保存された下書きの形式を読み取れませんでした。')
    }

    setIsDraftEdit(false)
    const storeGroups = sInfo?.group_options?.split(',') || []

    const { data: currentSettings } = await supabase
      .from('generation_settings')
      .select('*')
      .eq('store_id', currentStoreId)
      .eq('target_month', targetMonthStr)

    const newCounts: any = {}
    const newSlots: any = {}
    const specials: string[] = []

    if (currentSettings && currentSettings.length > 0) {
      currentSettings.forEach(set => {
        newCounts[set.config_type] = set.counts
        newSlots[set.config_type] = set.slots
        if (set.config_type !== 'wd' && set.config_type !== 'we') {
          specials.push(set.config_type)
        }
      })
    } else {
      const { data: pastSettings } = await supabase
        .from('generation_settings')
        .select('*')
        .eq('store_id', currentStoreId)
        .in('config_type', ['wd', 'we'])
        .order('target_month', { ascending: false })
        .limit(10)

      if (pastSettings && pastSettings.length > 0) {
        const latestWd = pastSettings.find(s => s.config_type === 'wd')
        const latestWe = pastSettings.find(s => s.config_type === 'we')

        if (latestWd) {
          newCounts['wd'] = latestWd.counts
          newSlots['wd'] = latestWd.slots
        }
        if (latestWe) {
          newCounts['we'] = latestWe.counts
          newSlots['we'] = latestWe.slots
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
    setSelectedSpecialDays(specials)
    } catch (error) {
      setDraftError(`下書きまたは設定を読み込めませんでした: ${error instanceof Error ? error.message : '通信エラー'}`)
    } finally {
      setIsCheckingDraft(false)
    }
  }, [store_id, targetMonthStr])

  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  const firstDay = new Date(targetYear, targetMonth - 1, 1).getDay()

  useEffect(() => {
    loadAllSettings()
  }, [loadAllSettings])

  const changeMonth = (diff: number) => {
    setViewDate(new Date(targetYear, targetMonth - 1 + diff, 1))
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
      tabData[id] = { start, end }
      return { ...prev, [tab]: tabData }
    })
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const { data: existingSettings, error: fetchError } = await supabase
        .from('generation_settings')
        .select('config_type')
        .eq('store_id', store_id)
        .eq('target_month', targetMonthStr)

      if (fetchError) throw fetchError

      const existingSpecials = (existingSettings || [])
        .map((row: any) => row.config_type)
        .filter((type: string) => type !== 'wd' && type !== 'we')

      const removeSpecials = existingSpecials.filter((type: string) => !selectedSpecialDays.includes(type))

      if (removeSpecials.length > 0) {
        const { error: deleteError } = await supabase
          .from('generation_settings')
          .delete()
          .eq('store_id', store_id)
          .eq('target_month', targetMonthStr)
          .in('config_type', removeSpecials)

        if (deleteError) throw deleteError
      }

      const payload = ['wd', 'we', ...selectedSpecialDays].map(type => ({
        store_id: store_id,
        target_month: targetMonthStr,
        config_type: type,
        counts: counts[type] || {},
        slots: slots[type] || {},
      }))
      const { error } = await supabase.from('generation_settings').upsert(payload, { onConflict: 'store_id, target_month, config_type' })
      if (error) throw error
      alert('設定を保存しました！')
    } catch (e: any) {
      alert('保存失敗: ' + e.message)
    } finally { setIsSaving(false) }
  }

  const currentTabCounts = counts[activeTab] || {}
  const currentTabSlots = slots[activeTab] || {}

  const currentTotalMH = useMemo(() => {
    let total = 0
    Object.keys(currentTabCounts).forEach(g => {
      const c = currentTabCounts[g] || 0
      for (let i = 0; i < c; i++) {
        const s = currentTabSlots[`${g}_${i}`] || { start: 10, end: 18 }
        total += (s.end - s.start)
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

    const { data: staffData } = await supabase
      .from('staff')
      .select('*')
      .eq('store_id', store_id)
      .order('name', { ascending: true })

    const startDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
    const nextMonth = targetMonth === 12 ? 1 : targetMonth + 1
    const nextYear = targetMonth === 12 ? targetYear + 1 : targetYear
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

    const { data: requestData } = await supabase
      .from('shift_requests')
      .select('*')
      .eq('store_id', store_id)
      .gte('date', startDate)
      .lt('date', endDate)

    const requests = (requestData || []) as ShiftRequest[]
    const staffNames = new Map(((staffData || []) as StaffRecord[]).map(staff => [staff.id, staff.name]))
    const analysisWarnings: string[] = []
    const pendingMemoRequests = requests.filter(request =>
      Boolean(request.id && request.staff_id && request.date && request.memo?.trim())
      && (request.parsed_request === null || request.parsed_request === undefined)
    )

    // Only notes without a cached result reach Gemini. Sequential calls avoid an avoidable rate-limit burst.
    for (const request of pendingMemoRequests) {
      try {
        const response = await fetch('/api/parse-conditions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'daily_request', date: request.date, memo: request.memo }),
        })
        if (!response.ok) throw new Error(await response.text())
        const parsedRequest = parseParsedShiftRequest(await response.json())
        if (!parsedRequest) throw new Error('Invalid parsed request response.')
        const { error } = await supabase
          .from('shift_requests')
          .update({ parsed_request: parsedRequest })
          .eq('id', request.id)
          .eq('store_id', store_id)
        if (error) throw error
        request.parsed_request = parsedRequest
      } catch (error) {
        console.error('日付要望のAI解析に失敗しました。', error)
        const staffName = staffNames.get(request.staff_id || '') || 'スタッフ'
        const day = Number(request.date?.slice(-2) || 0)
        analysisWarnings.push(`⚠️ ${staffName}さんの${day || '対象'}日の要望解析に失敗したため、基本条件で生成しました。生成後に手動でご確認ください。`)
      }
    }
    setRequestAnalysisWarning(analysisWarnings.join(' '))

    const requestMap: Record<string, ShiftRequest> = {}
    requests.forEach((row) => {
      if (row.staff_id && row.date) requestMap[`${row.staff_id}_${row.date}`] = row
    })

    const storeRange = toTimeRange(storeInfo.open_time, storeInfo.close_time)
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()

    const staffList = (staffData || []) as StaffRecord[]
    const scheduleStaff: GeneratedStaffShift[] = staffList.map(staff => ({
      id: staff.id,
      name: staff.name,
      mainJob: staff.main_job || '未設定',
      jobOptions: getJobOptions(staff.main_job, staff.possible_groups),
      isEmployee: Boolean(staff.is_employee),
      employmentType: staff.is_employee ? '社員' : 'アルバイト',
      shifts: {},
      assignedDays: 0,
      assignedHours: 0,
      weeklyTargetDays: staff.weekly_target_days ?? undefined,
    }))
    let vacancyCount = 0
    let assignedHours = 0
    const alerts: ScheduleAlert[] = []
    const consecutiveDays = new Map(staffList.map(staff => [staff.id, 0]))
    const skillOptions = parseSkillOptions(storeInfo.skill_options)
    const hallSkills = skillOptions.filter((skill: string) => skill.startsWith('[H]'))
    const kitchenSkills = skillOptions.filter((skill: string) => skill.startsWith('[K]'))
    const assignmentsByDate = new Map<string, {
      shifts: { staffId: string; start: number; end: number; skills: string[]; job: 'ホール' | 'キッチン' | null; slotKey: string }[]
      slots: { group: string; slotIndex: number; start: number; end: number; assigned: boolean; staffId: string | null }[]
      assignedStaffIds: Set<string>
    }>()

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const weekDay = new Date(targetYear, targetMonth - 1, day).getDay()
      const configType = selectedSpecialDays.includes(dateStr)
        ? dateStr
        : weekDay === 0 || weekDay === 6 || HOLIDAYS[dateStr]
          ? 'we'
          : 'wd'
      const dailyAssignments = new Set<string>()

      staffList.forEach((staff, index) => {
        if (isRequestUnavailable(requestMap[`${staff.id}_${dateStr}`])) {
          scheduleStaff[index].shifts[dateStr] = '×'
        }
      })

      const dailyShifts: { staffId: string; start: number; end: number; skills: string[]; job: 'ホール' | 'キッチン' | null; slotKey: string }[] = []
      const dailySlots: { group: string; slotIndex: number; start: number; end: number; assigned: boolean; staffId: string | null }[] = []

      for (const group of groups) {
        const count = Math.max(0, counts[configType]?.[group] || 0)
        for (let slotIndex = 0; slotIndex < count; slotIndex++) {
          const slot = slots[configType]?.[`${group}_${slotIndex}`] || { start: 10, end: 18 }
          const slotEnd = slot.end < slot.start ? slot.end + 24 : slot.end
          const dailySlot = { group, slotIndex, start: slot.start, end: slotEnd, assigned: false, staffId: null as string | null }
          dailySlots.push(dailySlot)
          const candidates: { index: number; priority: number; score: number }[] = []

          staffList.forEach((staff, index) => {
            const request = requestMap[`${staff.id}_${dateStr}`]
            if (isRequestUnavailable(request) || dailyAssignments.has(staff.id)) return

            const possibleGroups = (staff.possible_groups || '').split(',').map(value => value.trim()).filter(Boolean)
            const groupJob = jobForGroup(group)
            const matchesJob = staff.main_job === group
              || possibleGroups.includes(group)
              || Boolean(groupJob && (
                staff.main_job === groupJob
                || staff.main_job === '共通'
                || possibleGroups.includes(groupJob)
              ))
            if (!matchesJob) return

            const requestedRange = getRequestedRange(request)
            const workRange1 = toTimeRange(staff.work_start_1, staff.work_end_1)
            const workRange2 = toTimeRange(staff.work_start_2, staff.work_end_2)
            const hasStaffTimeRange = Boolean(requestedRange || workRange1 || workRange2)
            const availableRanges = requestedRange
              ? [{ range: requestedRange, priority: 0 }]
              : [
                  ...(workRange1 ? [{ range: workRange1, priority: 0 }] : []),
                  ...(workRange2 ? [{ range: workRange2, priority: 1 }] : []),
                  ...(!hasStaffTimeRange && storeRange ? [{ range: storeRange, priority: 2 }] : []),
                ]
            const matchingRange = availableRanges.find(({ range }) =>
              range.start <= slot.start && range.end >= slotEnd
            )
            if (matchingRange) {
              const targetRate = ((staff.weekly_target_days || 0) * 4) / daysInMonth
              const previousDays = day - 1
              const currentRate = previousDays > 0 ? scheduleStaff[index].assignedDays / previousDays : 0
              const attendanceScore = (targetRate - currentRate) * 100
              const wouldReachThreeConsecutiveDays = (consecutiveDays.get(staff.id) || 0) + 1 >= 3
              const streakScore = wouldReachThreeConsecutiveDays ? -500 : 0
              const rankScore = staff.rank === 'A' ? 30 : staff.rank === 'B' ? 20 : 0
              candidates.push({
                index,
                priority: matchingRange.priority,
                score: attendanceScore + streakScore + rankScore,
              })
            }
          })

          candidates.sort((left, right) =>
            right.score - left.score || left.priority - right.priority || left.index - right.index
          )
          const candidateIndex = candidates[0]?.index ?? -1

          if (candidateIndex < 0) {
            vacancyCount++
            alerts.push({
              id: `${dateStr}-${group}-${slotIndex}-vacancy`,
              type: 'vacancy',
              message: `${targetMonth}/${String(day).padStart(2, '0')} ${formatAlertTime(slot.start)}-${formatAlertTime(slotEnd)} ${labelForGroup(group)} 1枠欠員`,
            })
            continue
          }

          const assignedStaff = staffList[candidateIndex]
          const assignedRow = scheduleStaff[candidateIndex]
          dailyAssignments.add(assignedStaff.id)
          dailySlot.assigned = true
          dailySlot.staffId = assignedStaff.id
          dailyShifts.push({
            staffId: assignedStaff.id,
            start: slot.start,
            end: slotEnd,
            skills: (assignedStaff.skills || '').split(',').map(skill => skill.trim()).filter(Boolean),
            job: jobForGroup(group),
            slotKey: `${group}_${slotIndex}`,
          })
          assignedRow.shifts[dateStr] = `${fToT(slot.start)}-${fToT(slotEnd)}`
          assignedRow.assignedDays++
          const slotHours = Math.max(0, slotEnd - slot.start)
          assignedRow.assignedHours += slotHours
          assignedHours += slotHours
        }
      }

      assignmentsByDate.set(dateStr, {
        shifts: dailyShifts,
        slots: dailySlots,
        assignedStaffIds: dailyAssignments,
      })

      staffList.forEach(staff => {
        consecutiveDays.set(
          staff.id,
          dailyAssignments.has(staff.id) ? (consecutiveDays.get(staff.id) || 0) + 1 : 0
        )
      })
    }

    const staffIndexById = new Map(staffList.map((staff, index) => [staff.id, index]))
    const employeeTarget = (staff: StaffRecord) => staff.monthly_target_hours ?? monthlyTargetHours
    const canWorkSlot = (staff: StaffRecord, dateStr: string, slot: { group: string; start: number; end: number }) => {
      const request = requestMap[`${staff.id}_${dateStr}`]
      if (isRequestUnavailable(request)) return false
      const possibleGroups = (staff.possible_groups || '').split(',').map(value => value.trim()).filter(Boolean)
      const job = jobForGroup(slot.group)
      const matchesJob = staff.main_job === slot.group
        || possibleGroups.includes(slot.group)
        || Boolean(job && (
          staff.main_job === job
          || staff.main_job === '共通'
          || possibleGroups.includes(job)
        ))
      if (!matchesJob) return false

      const requestedRange = getRequestedRange(request)
      const workRanges = [
        toTimeRange(staff.work_start_1, staff.work_end_1),
        toTimeRange(staff.work_start_2, staff.work_end_2),
      ].filter((range): range is TimeRange => range !== null)
      const availableRanges = requestedRange ? [requestedRange] : workRanges.length > 0 ? workRanges : storeRange ? [storeRange] : []
      return availableRanges.some(range => range.start <= slot.start && range.end >= slot.end)
    }

    while (true) {
      const employeesBelowTarget = staffList
        .map((staff, index) => ({ staff, row: scheduleStaff[index] }))
        .filter(({ staff, row }) => staff.is_employee && row.assignedHours < employeeTarget(staff))
        .sort((left, right) =>
          (employeeTarget(right.staff) - right.row.assignedHours)
          - (employeeTarget(left.staff) - left.row.assignedHours)
        )
      if (employeesBelowTarget.length === 0) break

      let progress = false
      for (const { staff: employee, row: employeeRow } of employeesBelowTarget) {
        const employeeIndex = staffIndexById.get(employee.id)
        if (employeeIndex === undefined) continue
        let employeeProgress = false

        for (const [dateStr, dayData] of assignmentsByDate) {
          if (!dayData.assignedStaffIds.has(employee.id)) continue
          const employeeShift = dayData.shifts.find(shift => shift.staffId === employee.id)
          const employeeSlot = employeeShift && dayData.slots.find(slot => slot.staffId === employee.id)
          if (!employeeShift || !employeeSlot) continue

          const longerSlots = dayData.slots
            .filter(slot => slot.staffId && slot.end - slot.start > employeeSlot.end - employeeSlot.start)
            .sort((left, right) => (right.end - right.start) - (left.end - left.start))
          for (const longerSlot of longerSlots) {
            const partTimeIndex = staffIndexById.get(longerSlot.staffId || '')
            const partTimeStaff = partTimeIndex === undefined ? undefined : staffList[partTimeIndex]
            const partTimeShift = dayData.shifts.find(shift => shift.slotKey === `${longerSlot.group}_${longerSlot.slotIndex}`)
            if (
              partTimeIndex === undefined
              ||
              !partTimeStaff
              || partTimeStaff.is_employee
              || !partTimeShift
              || !canWorkSlot(employee, dateStr, longerSlot)
              || !canWorkSlot(partTimeStaff, dateStr, employeeSlot)
            ) continue

            const partTimeRow = scheduleStaff[partTimeIndex]
            const employeeSkillSet = (employee.skills || '').split(',').map(skill => skill.trim()).filter(Boolean)
            const partTimeSkillSet = (partTimeStaff.skills || '').split(',').map(skill => skill.trim()).filter(Boolean)
            const extraHours = (longerSlot.end - longerSlot.start) - (employeeSlot.end - employeeSlot.start)
            employeeShift.staffId = partTimeStaff.id
            employeeShift.skills = partTimeSkillSet
            employeeSlot.staffId = partTimeStaff.id
            partTimeShift.staffId = employee.id
            partTimeShift.skills = employeeSkillSet
            longerSlot.staffId = employee.id
            employeeRow.assignedHours += extraHours
            partTimeRow.assignedHours -= extraHours
            employeeRow.shifts[dateStr] = `${fToT(longerSlot.start)}-${fToT(longerSlot.end)}`
            partTimeRow.shifts[dateStr] = `${fToT(employeeSlot.start)}-${fToT(employeeSlot.end)}`
            employeeProgress = true
            break
          }
          if (employeeProgress) break
        }

        if (!employeeProgress) {
          for (const [dateStr, dayData] of assignmentsByDate) {
            if (dayData.assignedStaffIds.has(employee.id)) continue
            const partTimeSlots = dayData.slots
              .filter(slot => slot.staffId)
              .map(slot => {
                const index = staffIndexById.get(slot.staffId || '')
                const staff = index === undefined ? undefined : staffList[index]
                const row = index === undefined ? undefined : scheduleStaff[index]
                const monthlyTargetDays = (staff?.weekly_target_days || 0) * daysInMonth / 7
                return { slot, staff, row, daysAtTarget: Boolean(row && monthlyTargetDays > 0 && row.assignedDays >= monthlyTargetDays) }
              })
              .filter((candidate): candidate is typeof candidate & { staff: StaffRecord; row: GeneratedStaffShift } =>
                Boolean(candidate.staff && candidate.row && !candidate.staff.is_employee)
              )
              .sort((left, right) => Number(right.daysAtTarget) - Number(left.daysAtTarget))

            for (const { slot, staff: partTimeStaff, row: partTimeRow } of partTimeSlots) {
              if (!canWorkSlot(employee, dateStr, slot)) continue
              const shift = dayData.shifts.find(item => item.slotKey === `${slot.group}_${slot.slotIndex}`)
              if (!shift) continue
              const slotHours = slot.end - slot.start
              shift.staffId = employee.id
              shift.skills = (employee.skills || '').split(',').map(skill => skill.trim()).filter(Boolean)
              slot.staffId = employee.id
              dayData.assignedStaffIds.delete(partTimeStaff.id)
              dayData.assignedStaffIds.add(employee.id)
              partTimeRow.assignedDays--
              partTimeRow.assignedHours -= slotHours
              delete partTimeRow.shifts[dateStr]
              employeeRow.assignedDays++
              employeeRow.assignedHours += slotHours
              employeeRow.shifts[dateStr] = `${fToT(slot.start)}-${fToT(slot.end)}`
              employeeProgress = true
              break
            }
            if (employeeProgress) break
          }
        }

        if (!employeeProgress) {
          const maxShiftHours = 10
          for (const [dateStr, dayData] of assignmentsByDate) {
            const shift = dayData.shifts.find(item => item.staffId === employee.id)
            if (!shift) continue
            const slot = dayData.slots.find(item => item.staffId === employee.id)
            if (!slot) continue
            const request = requestMap[`${employee.id}_${dateStr}`]
            if (isRequestUnavailable(request)) continue
            const requestedRange = getRequestedRange(request)
            const workRanges = [
              toTimeRange(employee.work_start_1, employee.work_end_1),
              toTimeRange(employee.work_start_2, employee.work_end_2),
            ].filter((range): range is TimeRange => range !== null)
            const availableRanges = requestedRange ? [requestedRange] : workRanges.length > 0 ? workRanges : storeRange ? [storeRange] : []
            const extensionRanges = availableRanges.filter(range => range.start <= slot.start && range.end >= shift.end)
            if (extensionRanges.length === 0) continue
            const availableEnd = Math.min(
              storeRange?.end ?? maxTime,
              slot.start + maxShiftHours,
              Math.max(...extensionRanges.map(range => range.end))
            )
            const extraHours = Math.min(availableEnd - shift.end, employeeTarget(employee) - employeeRow.assignedHours)
            if (extraHours <= 0) continue
            shift.end += extraHours
            slot.end += extraHours
            employeeRow.assignedHours += extraHours
            assignedHours += extraHours
            employeeRow.shifts[dateStr] = `${fToT(shift.start)}-${fToT(shift.end)}`
            employeeProgress = true
            break
          }
        }

        if (employeeProgress) {
          progress = true
          break
        }
      }
      if (!progress) break
    }

    const vacancyAlerts = alerts.filter(alert => alert.type === 'vacancy')
    alerts.splice(0, alerts.length, ...vacancyAlerts)
    assignmentsByDate.forEach((dayData, dateStr) => {
      const missingIntervals = new Map<string, { job: 'ホール' | 'キッチン'; start: number; end: number }[]>()
      const operatingStart = storeRange?.start ?? minTime
      const operatingEnd = storeRange?.end ?? maxTime
      for (let intervalStart = operatingStart; intervalStart < operatingEnd; intervalStart += 0.5) {
        const intervalEnd = Math.min(intervalStart + 0.5, operatingEnd)
        const requiredSkillsByJob: { job: 'ホール' | 'キッチン'; skills: string[] }[] = [
          { job: 'ホール', skills: hallSkills },
          { job: 'キッチン', skills: kitchenSkills },
        ]
        for (const { job, skills: requiredSkills } of requiredSkillsByJob) {
          requiredSkills.forEach((skill: string) => {
            if (skill.includes('レジ締め') && job === 'ホール') return
            const covered = dayData.shifts.some(shift =>
              shift.job === job && shift.start <= intervalStart && shift.end >= intervalEnd && shift.skills.includes(skill)
            )
            if (covered) return
            const ranges = missingIntervals.get(skill) || []
            const previous = ranges[ranges.length - 1]
            if (previous && previous.job === job && Math.abs(previous.end - intervalStart) < 0.001) previous.end = intervalEnd
            else ranges.push({ job, start: intervalStart, end: intervalEnd })
            missingIntervals.set(skill, ranges)
          })
        }
      }
      const dateDay = Number(dateStr.slice(-2))
      const grouped = new Map<string, { job: 'ホール' | 'キッチン'; start: number; end: number; skills: string[] }>()
      missingIntervals.forEach((ranges, skill) => ranges.forEach(({ job, start, end }) => {
        const key = `${job}-${start}-${end}`
        const entry = grouped.get(key) || { job, start, end, skills: [] }
        entry.skills.push(skill)
        grouped.set(key, entry)
      }))
      grouped.forEach(({ job, start, end, skills }, index) => alerts.push({
        id: `${dateStr}-skills-${index}`,
        type: 'skill',
        message: `${targetMonth}/${String(dateDay).padStart(2, '0')} ${formatAlertTime(start)}-${formatAlertTime(end)} ${job}: スキル不足 (${skills.join(', ')})`,
      }))

      const closingSkill = skillOptions.find((skill: string) => skill.includes('レジ締め') && !skill.startsWith('[K]'))
      if (closingSkill) {
        const lastHallEnd = dayData.slots
          .filter(slot => jobForGroup(slot.group) === 'ホール')
          .reduce((latestEnd, slot) => Math.max(latestEnd, slot.end), Number.NEGATIVE_INFINITY)
        const hasClosingStaff = dayData.shifts.some(shift =>
          shift.job === 'ホール' && shift.end >= lastHallEnd
          && shift.skills.some(skill => skill.replace(/^\[H\]\s*/, '').includes('レジ締め'))
        )
        if (Number.isFinite(lastHallEnd) && !hasClosingStaff) {
          alerts.push({
            id: `${dateStr}-skills-register-closing`,
            type: 'skill',
            message: `${targetMonth}/${String(dateDay).padStart(2, '0')} ラスト スキル不足 (${closingSkill.startsWith('[H]') ? closingSkill : `[H]${closingSkill}`})`,
          })
        }
      }
    })

    scheduleStaff.sort((left, right) =>
      Number(right.isEmployee) - Number(left.isEmployee) || left.name.localeCompare(right.name, 'ja')
    )
    setGeneratedSchedule({ staff: scheduleStaff, vacancyCount, assignedHours, alerts })
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
      const { error } = await supabase.from('monthly_shifts').upsert({
        store_id: storeId,
        target_month: targetMonthStr,
        status: 'draft',
        schedule_data: generatedSchedule,
      }, { onConflict: 'store_id,target_month' })
      if (error) throw error
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
        const assignedHours = Object.values(shifts).reduce((total, shift) => total + shiftHoursFromLabel(shift), 0)
        const assignedDays = Object.values(shifts).filter(shift => shiftHoursFromLabel(shift) > 0).length
        return { ...person, shifts, assignedHours, assignedDays }
      })
      const assignedHours = staff.reduce((total, person) => total + person.assignedHours, 0)
      return { ...current, staff, assignedHours }
    })
  }

  const toggleDraftStaffJob = (staffId: string) => {
    setGeneratedSchedule(current => {
      if (!current) return current
      return {
        ...current,
        staff: current.staff.map(person => {
          if (person.id !== staffId || !person.jobOptions || person.jobOptions.length < 2) return person
          const currentIndex = Math.max(0, person.jobOptions.indexOf(person.mainJob))
          return { ...person, mainJob: person.jobOptions[(currentIndex + 1) % person.jobOptions.length] }
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
      const { error } = await supabase.from('monthly_shifts').upsert({
        store_id: currentStoreId,
        target_month: targetMonthStr,
        status: 'draft',
        schedule_data: generatedSchedule,
      }, { onConflict: 'store_id,target_month' })
      if (error) throw error
      setDraftNotice('下書きを保存しました')
    } catch (error) {
      setDraftError(`下書きを保存できませんでした: ${error instanceof Error ? error.message : '通信エラー'}`)
    } finally {
      setDraftAction(null)
    }
  }

  const discardDraft = async () => {
    if (!window.confirm('現在の編集内容を破棄して、AI生成の設定画面に戻りますか？') || !store_id) return
    const currentStoreId = Array.isArray(store_id) ? store_id[0] : store_id
    setDraftAction('discard')
    setDraftError('')
    try {
      const { error } = await supabase
        .from('monthly_shifts')
        .delete()
        .eq('store_id', currentStoreId)
        .eq('target_month', targetMonthStr)
      if (error) throw error
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

  const confirmDraft = async () => {
    if (!generatedSchedule || !store_id) return
    if (!window.confirm('このシフトを確定して公開しますか？')) return
    const currentStoreId = Array.isArray(store_id) ? store_id[0] : store_id
    setDraftAction('confirm')
    setDraftError('')
    try {
      const { error } = await supabase.from('monthly_shifts').upsert({
        store_id: currentStoreId,
        target_month: targetMonthStr,
        status: 'confirmed',
        schedule_data: generatedSchedule,
      }, { onConflict: 'store_id,target_month' })
      if (error) throw error
      alert('シフトを確定・公開しました！')
      router.push(`/${encodeURIComponent(currentStoreId)}/view`)
    } catch (error) {
      setDraftError(`シフトを確定できませんでした: ${error instanceof Error ? error.message : '通信エラー'}`)
      setDraftAction(null)
    }
  }

  if (isCheckingDraft || !storeInfo) return <div className="p-10 text-slate-400">読み込み中...</div>

  if (isDraftEdit && generatedSchedule) {
    const editDates = Array.from({ length: daysInMonth }, (_, index) =>
      `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`
    )
    const dailyHours = Object.fromEntries(editDates.map(date => [date,
      generatedSchedule.staff.reduce((total, staff) => total + shiftHoursFromLabel(staff.shifts[date] || ''), 0),
    ])) as Record<string, number>
    const presets = Array.from(new Set([
      ...Object.values(slots).flatMap(daySlots => Object.values(daySlots).map(slot => `${fToT(slot.start)}-${fToT(slot.end)}`)),
      ...generatedSchedule.staff.flatMap(staff => Object.values(staff.shifts).filter(shift => shiftHoursFromLabel(shift) > 0)),
    ])).sort((left, right) => tToF(left.split('-')[0]) - tToF(right.split('-')[0])).slice(0, 10)
    const activateShiftCell = (staffId: string, date: string, mode: 'quick' | 'detail') => {
      setActiveCell(current => {
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
              <button type="button" onClick={discardDraft} disabled={draftAction !== null} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60 sm:text-sm">
                <Trash2 size={16} /> {draftAction === 'discard' ? '破棄中...' : '破棄して生成し直す'}
              </button>
              <button type="button" onClick={confirmDraft} disabled={draftAction !== null} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-60 sm:text-sm">
                <Rocket size={16} /> {draftAction === 'confirm' ? '確定中...' : 'この案をベースに確定'}
              </button>
            </div>
          </div>
        </header>

        {draftNotice && <p role="status" className="mb-4 text-sm text-slate-600">{draftNotice}</p>}
        {(draftError || confirmError) && <p role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{draftError || confirmError}</p>}

        <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
          <span>スタッフ {generatedSchedule.staff.length}名</span>
          <span>合計人時 <strong className="font-semibold text-slate-900">{generatedSchedule.assignedHours.toFixed(1)}h</strong></span>
          <span>欠員 {generatedSchedule.vacancyCount}枠</span>
        </div>

        <div className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-max border-separate border-spacing-0 text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-600">
                <th className={`${STAFF_COL_CLASS} z-30 border-b bg-slate-50 px-3 py-3 text-left font-semibold`}>スタッフ名</th>
                {editDates.map(date => (
                  <th key={date} className={`${DATE_COL_CLASS} border-b border-slate-200 px-1.5 py-2 text-center font-semibold ${dayTone(date)}`}>
                    <span className="block text-[13px] leading-none">{Number(date.slice(-2))}</span>
                    <span className="mt-0.5 block text-[10px] font-normal">{weekdayLabel(date)}</span>
                    <span className="mt-1 block text-[10px] font-medium tabular-nums text-slate-500">{dailyHours[date].toFixed(1)}h</span>
                  </th>
                ))}
                <th className={`${SUMMARY_COL_CLASS} z-30 border-b bg-slate-50 px-3 py-3 text-right font-semibold`}>月間集計</th>
              </tr>
            </thead>
            <tbody>
              {generatedSchedule.staff.map(staff => {
                const fulfillment = fulfillmentPercent(staff.assignedDays, staff.weeklyTargetDays)
                return (
                  <tr key={staff.id} className="text-slate-700">
                    <th scope="row" className={`${STAFF_COL_CLASS} z-10 border-b bg-white px-3 py-2 text-left font-medium`}>
                      <span className="block truncate text-xs text-slate-800">{staff.name}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-slate-400">{staff.mainJob}</span>
                    </th>
                    {editDates.map(date => (
                      <td key={date} className={`${DATE_COL_CLASS} border-b border-slate-100 px-1 py-1`}>
                        <ShiftTimeEditor
                          value={staff.shifts[date] || ''}
                          minTime={minTime}
                          maxTime={maxTime}
                          presets={presets}
                          isActive={activeCell?.staffId === staff.id && activeCell.date === date}
                          mode={activeCell?.staffId === staff.id && activeCell.date === date ? activeCell.mode : 'quick'}
                          onActivate={nextMode => activateShiftCell(staff.id, date, nextMode)}
                          onDeactivate={closeShiftEditor}
                          onChange={nextValue => updateDraftShift(staff.id, date, nextValue)}
                        />
                      </td>
                    ))}
                    <td className={`${SUMMARY_COL_CLASS} z-10 border-b bg-white px-3 py-2 text-right`}>
                      <span className="block font-semibold tabular-nums text-slate-900">{staff.assignedHours.toFixed(1)}h</span>
                      <span className="mt-0.5 block text-[10px] tabular-nums text-slate-500">出勤 {staff.assignedDays}日</span>
                      <span className={`mt-0.5 block text-[10px] font-medium tabular-nums ${fulfillment !== null && fulfillment < 80 ? 'text-amber-700' : 'text-slate-600'}`}>
                        充足率 {fulfillment === null ? '—' : `${fulfillment}%`}
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
                const holidayName = HOLIDAYS[dateStr]
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
          <span className={`text-2xl font-bold ${currentTotalMH > storeInfo.target_mh_per_day ? 'text-red-600' : 'text-slate-800'}`}>
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
                  const { start, end } = currentTabSlots[slotId] || { start: 10, end: 18 }
                  return (
                    <div key={slotId} className={`flex flex-col gap-4 rounded-md border bg-white p-4 md:flex-row md:items-center ${color.border}`}>
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
                        {(end - start).toFixed(1)}h
                      </div>
                    </div>
                  )
                })}
              </div>

            </div>
          )
        })}

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
                      const dayAlerts = generatedSchedule.alerts.filter(alert => alert.id.startsWith(`${dateStr}-`))
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
                  {generatedSchedule.staff.map(staff => {
                    const fulfillment = fulfillmentPercent(staff.assignedDays, staff.weeklyTargetDays)
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
                        return (
                          <td key={dateStr} className={`${DATE_COL_CLASS} border-b border-slate-100 px-1 py-2 text-center ${shift === '×' ? 'bg-red-50 font-bold text-red-500' : shift ? 'font-medium tabular-nums text-slate-700' : 'text-slate-300'}`}>
                            <span className="block whitespace-nowrap">{shift || '—'}</span>
                          </td>
                        )
                      })}
                      <td className={`${SUMMARY_COL_CLASS} z-10 border-b bg-white px-3 py-2 text-right`}>
                        <span className="block font-bold tabular-nums">{staff.assignedHours.toFixed(1)}h</span>
                        <span className="mt-0.5 block text-[10px] tabular-nums text-slate-500">出勤 {staff.assignedDays}日</span>
                        <span className="mt-0.5 block text-[10px] font-medium tabular-nums text-slate-600">充足率 {fulfillment === null ? '—' : `${fulfillment}%`}</span>
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

      <div className="fixed bottom-28 left-0 right-0 z-50 flex gap-3 border-t border-[var(--border)] bg-white/95 p-4 pb-3 shadow-sm md:bottom-0 md:left-[268px] md:justify-center md:pb-4">
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

