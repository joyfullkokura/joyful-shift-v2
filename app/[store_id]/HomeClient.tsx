'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Edit3,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  Megaphone,
  Store,
  UserRoundPen,
} from 'lucide-react'
import PinLoginModal from '@/components/PinLoginModal'
import { useAdmin } from '@/context/AdminContext'
import { resolvePinReset } from '@/app/actions/auth'
import {
  getDashboard,
  getMyDayOff,
  markConditionRequestRead,
  resolveConditionRequest as resolveConditionRequestAction,
  resolveNewStaffRequest as resolveNewStaffRequestAction,
  saveStoreNotice,
  submitConditionChange as submitConditionChangeAction,
  unlockStaffPin,
  type DashboardData,
  type LockedStaff,
} from '@/app/actions/dashboard'
import { unwrap } from '@/lib/action-result'
import { parseSkillOptions } from '@/lib/skill-options'
import { type BusinessHours, DEFAULT_BUSINESS_HOURS } from '@/lib/day-request'
import { WEEKDAY_KEYS, WEEKDAY_LABELS, formatWeeklyAvailability, type WeeklyAvailabilityChange } from '@/lib/weekly-availability'
import { usualAvailabilityOf, type UsualAvailabilityInput } from '@/lib/usual-availability'
import { formatDayRequest } from '@/lib/day-request'
import UsualAvailabilityCard from '@/components/UsualAvailabilityCard'
import { CardSkeleton, LoadingNote, SkeletonBlock, SkeletonRegion } from '@/components/Skeleton'
import { getConditionChangeDetails, getNewStaffRegistrationDetails, type ConditionChangeDetails } from '@/lib/staff-request-details'
import { STAFF_CATEGORIES, STAFF_CATEGORY_LABELS, type StaffCategory, type StaffRank, isStaffCategory, sortByRank, suggestCategory } from '@/lib/staff-order'

type SchedulePerson = {
  id: string
  name: string
  mainJob?: string
  isEmployee?: boolean
  assignedHours?: number
  shifts?: Record<string, string>
}

type ScheduleData = {
  staff: SchedulePerson[]
  vacancyCount?: number
  assignedHours?: number
  alerts?: Array<{ id: string; type: string; message: string }>
}

type StoreRecord = {
  name?: string | null
  notice?: string | null
  skill_options?: unknown
  hours?: BusinessHours
}

type PinResetRequest = {
  id: string
  name: string
}

type StaffProfile = {
  id: string
  name: string
  weekly_target_days?: number | null
  main_job?: string | null
  memo?: string | null
  skills?: string | null
  work_start_1?: string | null
  work_end_1?: string | null
  work_start_2?: string | null
  work_end_2?: string | null
  is_employee?: boolean | null
  parsed_conditions?: unknown
  weekly_availability?: unknown
}

type StaffRequestRecord = {
  id: string
  staff_id: string
  type: string
  details: unknown
  status: 'pending' | 'approved' | 'rejected'
  is_read_by_staff: boolean | null
  created_at: string
  resolved_at?: string | null
}

const toDateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const startOfLocalDay = (date: Date) => new Date(
  date.getFullYear(),
  date.getMonth(),
  date.getDate(),
)

const getCalendarDayDifference = (from: Date, to: Date) => {
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((toUtc - fromUtc) / 86_400_000)
}

const getRelativeDayLabel = (date: Date, today: Date) => {
  const difference = getCalendarDayDifference(today, date)
  if (difference === 0) return '今日'
  if (difference === 1) return '明日'
  if (difference === -1) return '昨日'
  return difference > 0 ? String(difference) + '日後' : String(Math.abs(difference)) + '日前'
}

const isScheduleData = (value: unknown): value is ScheduleData => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ScheduleData>
  return Array.isArray(candidate.staff) && candidate.staff.every(person =>
    typeof person.id === 'string' && typeof person.name === 'string'
  )
}

const shiftLabel = (value: unknown) => {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

const getShiftPosition = (shift: string) => {
  const match = shift.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const toHour = (hours: number, minutes: number) => hours + minutes / 60
  const start = toHour(Number(match[1]), Number(match[2]))
  const end = toHour(Number(match[3]), Number(match[4]))
  if (end < start) return null
  const startPosition = Math.max(0, Math.min(1, (start - 9) / 15))
  const endPosition = Math.max(startPosition, Math.min(1, (end - 9) / 15))
  return { startPosition, endPosition }
}

const NO_NOTICE = '現在の店内お知らせはありません。'

/** First-render data loaded by the server page (today in Japan time). */
export type HomeInitialData = { dateKey: string; month: string; dashboard: DashboardData; dayOff: boolean }

const storeOf = (dashboard: DashboardData | undefined) => dashboard?.store as StoreRecord | null | undefined

const dateFromKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * Home screen. Today's month arrives with the page (loaded on the server);
 * other months / days are fetched when the selected date changes.
 */
export default function HomeClient({ initial }: { initial: HomeInitialData | null }) {
  const { store_id } = useParams<{ store_id: string }>()
  const { currentStaff, login, isAdmin } = useAdmin()
  const initialDashboard = initial?.dashboard
  const [isChangingPin, setIsChangingPin] = useState(false)
  const [isEditingNotice, setIsEditingNotice] = useState(false)
  const [notice, setNotice] = useState(() => storeOf(initialDashboard)?.notice || NO_NOTICE)
  const [draftNotice, setDraftNotice] = useState(() => storeOf(initialDashboard)?.notice || '')
  const [storeName, setStoreName] = useState(() => storeOf(initialDashboard)?.name || '')
  const [schedule, setSchedule] = useState<ScheduleData | null>(() => isScheduleData(initialDashboard?.schedule) ? initialDashboard.schedule : null)
  /** Current paper-form order (id → position) for the shift list. */
  const [staffRank, setStaffRank] = useState<StaffRank>(() => initialDashboard?.staffRank ?? {})
  /** Category picked for each pending registration (the suggestion until changed). */
  const [approvalCategories, setApprovalCategories] = useState<Record<string, StaffCategory>>({})
  const [selectedDate, setSelectedDate] = useState(() => initial ? dateFromKey(initial.dateKey) : startOfLocalDay(new Date()))
  const [isSavingNotice, setIsSavingNotice] = useState(false)
  const [pinResetRequests, setPinResetRequests] = useState<PinResetRequest[]>(() => (initialDashboard?.pinResetRequests ?? []) as PinResetRequest[])
  const [isUpdatingResetRequest, setIsUpdatingResetRequest] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState('')
  const [hasRequestedDayOff, setHasRequestedDayOff] = useState(() => initial?.dayOff ?? false)
  const [error, setError] = useState('')
  const [staffProfiles, setStaffProfiles] = useState<StaffProfile[]>(() => (initialDashboard?.staffProfiles ?? []) as StaffProfile[])
  const [skillOptions, setSkillOptions] = useState<string[]>(() => parseSkillOptions(storeOf(initialDashboard)?.skill_options))
  const [conditionRequests, setConditionRequests] = useState<StaffRequestRecord[]>(() => (initialDashboard?.conditionRequests ?? []) as StaffRequestRecord[])
  const [newStaffRequests, setNewStaffRequests] = useState<StaffRequestRecord[]>(() => (initialDashboard?.newStaffRequests ?? []) as StaffRequestRecord[])
  const [isConditionModalOpen, setIsConditionModalOpen] = useState(false)
  const [requestedWorkDays, setRequestedWorkDays] = useState('3')
  const [requestedMainJob, setRequestedMainJob] = useState('ホール')
  const [requestedSkills, setRequestedSkills] = useState<string[]>([])
  const [storeHours, setStoreHours] = useState<BusinessHours>(() => storeOf(initialDashboard)?.hours ?? DEFAULT_BUSINESS_HOURS)
  const [requestedMemo, setRequestedMemo] = useState('')
  const [isSubmittingConditionRequest, setIsSubmittingConditionRequest] = useState(false)
  const [isResolvingConditionRequest, setIsResolvingConditionRequest] = useState<string | null>(null)
  const [isResolvingNewStaffRequest, setIsResolvingNewStaffRequest] = useState<string | null>(null)
  const [lockedStaff, setLockedStaff] = useState<LockedStaff[]>(() => initialDashboard?.lockedStaff ?? [])
  const [isUnlockingStaff, setIsUnlockingStaff] = useState<string | null>(null)

  const storeId = Array.isArray(store_id) ? store_id[0] : store_id
  const selectedDateKey = toDateKey(selectedDate)
  const targetMonth = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-01`
  const today = startOfLocalDay(new Date())
  const todayKey = toDateKey(today)

  // Which month (for which person) the screen holds. The server page provides the first one.
  const dashboardKey = `${storeId}|${targetMonth}|${currentStaff?.id ?? ''}|${isAdmin}`
  const [loadedDashboardKey, setLoadedDashboardKey] = useState<string | null>(() =>
    initial ? `${storeId}|${initial.month}|${currentStaff?.id ?? ''}|${isAdmin}` : null)
  const isLoading = loadedDashboardKey !== dashboardKey

  useEffect(() => {
    if (loadedDashboardKey === dashboardKey) return
    let isCurrent = true
    const loadDashboard = async () => {
      try {
        const dashboard = unwrap(await getDashboard(storeId, targetMonth))
        const store = dashboard.store as StoreRecord | null
        if (!isCurrent) return
        setError('')
        setStoreName(store?.name || storeId)
        setSkillOptions(parseSkillOptions(store?.skill_options))
        setStoreHours(store?.hours ?? DEFAULT_BUSINESS_HOURS)
        setNotice(store?.notice || NO_NOTICE)
        setDraftNotice(store?.notice || '')
        setSchedule(isScheduleData(dashboard.schedule) ? dashboard.schedule : null)
        setStaffRank(dashboard.staffRank)
        setPinResetRequests(dashboard.pinResetRequests as PinResetRequest[])
        setStaffProfiles(dashboard.staffProfiles as StaffProfile[])
        setConditionRequests(dashboard.conditionRequests as StaffRequestRecord[])
        setNewStaffRequests(dashboard.newStaffRequests as StaffRequestRecord[])
        setLockedStaff(dashboard.lockedStaff)
      } catch (caughtError) {
        if (isCurrent) setError(caughtError instanceof Error ? caughtError.message : 'ダッシュボードを読み込めませんでした。')
      } finally {
        if (isCurrent) setLoadedDashboardKey(dashboardKey)
      }
    }
    void loadDashboard()
    return () => { isCurrent = false }
  }, [dashboardKey, loadedDashboardKey, storeId, targetMonth])

  const currentProfile = staffProfiles.find(profile => profile.id === currentStaff?.id) || null

  const openConditionRequestModal = () => {
    if (!currentProfile) return
    setRequestedWorkDays(String(currentProfile.weekly_target_days || 3))
    setRequestedMainJob(currentProfile.main_job || 'ホール')
    setRequestedSkills(parseSkillOptions(currentProfile.skills)
      .filter(skill => skillOptions.includes(skill)))
    setRequestedMemo(currentProfile.memo || '')
    setIsConditionModalOpen(true)
  }

  const dayOffKey = `${selectedDateKey}|${currentStaff?.id ?? ''}`
  const [loadedDayOffKey, setLoadedDayOffKey] = useState<string | null>(() =>
    initial ? `${initial.dateKey}|${currentStaff?.id ?? ''}` : null)

  useEffect(() => {
    if (!currentStaff?.id || loadedDayOffKey === dayOffKey) return
    let isCurrent = true
    getMyDayOff(storeId, selectedDateKey).then(result => {
      if (!isCurrent) return
      setHasRequestedDayOff(result.ok && result.data)
      setLoadedDayOffKey(dayOffKey)
    })
    return () => { isCurrent = false }
  }, [currentStaff?.id, dayOffKey, loadedDayOffKey, selectedDateKey, storeId])

  const schedulePeople = useMemo(() => sortByRank(schedule?.staff || [], staffRank), [schedule, staffRank])
  const todayPerson = schedulePeople.find(person => person.id === currentStaff?.id)
  const selectedShift = todayPerson?.shifts?.[selectedDateKey] || ''
  const isSelectedDateToday = selectedDateKey === todayKey
  const relativeDayLabel = getRelativeDayLabel(selectedDate, today)
  const shiftStatus = hasRequestedDayOff
    ? 'requested'
    : !selectedShift || selectedShift === '×'
      ? 'off'
      : 'working'
  const currentTime = new Date()
  const currentHour = currentTime.getHours() + currentTime.getMinutes() / 60
  const currentNowPosition = isSelectedDateToday && currentHour >= 9 && currentHour <= 24
    ? Math.max(0, Math.min(1, (currentHour - 9) / 15))
    : null
  const currentTimeLabel = currentTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  const scheduledPeople = useMemo(() => schedulePeople
    .map(person => {
      const shift = shiftLabel(person.shifts?.[selectedDateKey])
      return { person, shift, position: getShiftPosition(shift) }
    })
    .filter(({ position }) => position !== null), [schedulePeople, selectedDateKey])

  const changeSelectedDate = (offset: number) => {
    setSelectedDate(current => {
      const nextDate = startOfLocalDay(current)
      nextDate.setDate(nextDate.getDate() + offset)
      return nextDate
    })
  }

  const saveNotice = async () => {
    if (!isAdmin) return
    setIsSavingNotice(true)
    try {
      const savedNotice = unwrap(await saveStoreNotice(storeId, draftNotice))
      setNotice(savedNotice || '現在の店舗からのお知らせはありません。')
      setIsEditingNotice(false)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'お知らせを保存できませんでした。')
    } finally {
      setIsSavingNotice(false)
    }
  }

  const updatePinResetRequest = async (request: PinResetRequest, approved: boolean) => {
    if (!isAdmin || isUpdatingResetRequest) return
    setIsUpdatingResetRequest(request.id)
    setError('')
    try {
      // Clearing a PIN also revokes that staff member's sessions, so it runs on the server.
      const result = await resolvePinReset(storeId, request.id, approved)
      if (result.status !== 'ok') throw new Error(result.status === 'error' ? result.message : 'リセット申請を更新できませんでした。')
      setPinResetRequests(current => current.filter(item => item.id !== request.id))
      setSuccessMessage(approved
        ? `${request.name}さんの暗証番号を初期化しました。`
        : `${request.name}さんのリセット申請を拒否しました。`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'リセット申請を更新できませんでした。')
    } finally {
      setIsUpdatingResetRequest(null)
    }
  }

  const unlockStaff = async (staff: LockedStaff) => {
    if (!isAdmin || isUnlockingStaff) return
    setIsUnlockingStaff(staff.id)
    setError('')
    try {
      unwrap(await unlockStaffPin(storeId, staff.id))
      setLockedStaff(current => current.filter(item => item.id !== staff.id))
      setSuccessMessage(`${staff.name}さんのロックを解除しました。`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'ロックを解除できませんでした。')
    } finally {
      setIsUnlockingStaff(null)
    }
  }

  const notifyRequestUpdate = () => {
    window.dispatchEvent(new Event('staff-request-updated'))
  }

  const submitConditionChange = async () => {
    if (!currentStaff || isSubmittingConditionRequest) return
    setIsSubmittingConditionRequest(true)
    setError('')
    try {
      const details: ConditionChangeDetails = {
        weekly_target_days: Number(requestedWorkDays),
        main_job: requestedMainJob,
        skills: requestedSkills,
        memo: requestedMemo.trim(),
      }
      const created = unwrap(await submitConditionChangeAction(storeId, details))
      setConditionRequests(current => [created as StaffRequestRecord, ...current])
      setIsConditionModalOpen(false)
      setSuccessMessage('勤務条件の変更申請を店長へ送信しました。')
      notifyRequestUpdate()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '変更申請を送信できませんでした。')
    } finally {
      setIsSubmittingConditionRequest(false)
    }
  }

  const resolveConditionRequest = async (request: StaffRequestRecord, approved: boolean) => {
    if (!isAdmin || isResolvingConditionRequest) return
    setIsResolvingConditionRequest(request.id)
    setError('')
    try {
      // The server applies the stored request details; the client only says approve / reject.
      const { resolvedAt, staffUpdate } = unwrap(await resolveConditionRequestAction(storeId, request.id, approved))
      if (staffUpdate) {
        setStaffProfiles(current => current.map(profile => profile.id === request.staff_id
          ? { ...profile, ...(staffUpdate as Partial<StaffProfile>) }
          : profile))
      }
      setConditionRequests(current => current.map(item => item.id === request.id
        ? { ...item, status: approved ? 'approved' : 'rejected', resolved_at: resolvedAt }
        : item))
      setSuccessMessage(approved ? '勤務条件の変更申請を承認しました。' : '勤務条件の変更申請を拒否しました。')
      notifyRequestUpdate()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '変更申請を更新できませんでした。')
    } finally {
      setIsResolvingConditionRequest(null)
    }
  }

  const resolveNewStaffRequest = async (request: StaffRequestRecord, approved: boolean, category?: StaffCategory) => {
    if (!isAdmin || isResolvingNewStaffRequest) return
    setIsResolvingNewStaffRequest(request.id)
    setError('')
    try {
      const { name } = unwrap(await resolveNewStaffRequestAction(storeId, request.id, approved, category ?? null))
      if (approved) {
        setSuccessMessage(`${name}さんの新規登録を承認しました。`)
      } else {
        setStaffProfiles(current => current.filter(profile => profile.id !== request.staff_id))
        setSuccessMessage(`${name}さんの新規登録申請を却下しました。`)
      }
      setNewStaffRequests(current => current.filter(item => item.id !== request.id))
      notifyRequestUpdate()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '新規登録申請を更新できませんでした。')
    } finally {
      setIsResolvingNewStaffRequest(null)
    }
  }

  const markConditionRequestAsRead = async (request: StaffRequestRecord) => {
    try {
      unwrap(await markConditionRequestRead(storeId, request.id))
      setConditionRequests(current => current.map(item => item.id === request.id ? { ...item, is_read_by_staff: true } : item))
      notifyRequestUpdate()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '通知を確認済みにできませんでした。')
    }
  }

  const pendingConditionRequests = conditionRequests.filter(request => request.status === 'pending')
  const unreadConditionResults = conditionRequests.filter(request =>
    request.staff_id === currentStaff?.id && request.status !== 'pending' && !request.is_read_by_staff
  )
  const getRequestStaff = (staffId: string) => staffProfiles.find(profile => profile.id === staffId)
  const currentSkills = (currentProfile?.skills || '').split(',').map(skill => skill.trim()).filter(Boolean)
  const myPendingConditionRequest = conditionRequests.find(request => request.staff_id === currentStaff?.id && request.status === 'pending') ?? null
  const myPendingConditionDetails = myPendingConditionRequest ? getConditionChangeDetails(myPendingConditionRequest.details) : null

  /** Weekday times only; the manager's approval applies them. */
  const submitUsualAvailabilityChange = async (change: WeeklyAvailabilityChange): Promise<string | null> => {
    const result = await submitConditionChangeAction(storeId, { weekly_availability: change } satisfies ConditionChangeDetails)
    if (!result.ok) return result.error
    setConditionRequests(current => [result.data as StaffRequestRecord, ...current])
    setSuccessMessage('いつもの出勤できる時間の変更を店長へ申請しました。')
    notifyRequestUpdate()
    return null
  }
  const toggleRequestedSkill = (skill: string) => {
    setRequestedSkills(current => current.includes(skill)
      ? current.filter(item => item !== skill)
      : [...current, skill])
  }

  if (isLoading) return <HomeSkeleton />

  return (
    <div className="mx-auto max-w-[1800px] p-4 pb-28 md:p-8 md:pb-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600"><Store size={18} /></span>
            <div>
              <h1 className="text-xl font-bold text-slate-900">{storeName || storeId}</h1>
              <p className="mt-0.5 text-xs font-medium text-slate-500">{currentStaff?.name || 'スタッフ'} · {isAdmin ? '管理者' : '従業員'}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {currentStaff && (
            <button type="button" onClick={() => setIsChangingPin(true)} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50">
              <KeyRound size={16} className="text-slate-500" />暗証番号を変更
            </button>
          )}
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {successMessage && <p role="status" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</p>}

      {isAdmin && pendingConditionRequests.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-300 bg-white px-4 py-3">
          <p className="text-sm font-bold text-slate-900">承認待ちの条件変更 {pendingConditionRequests.length}件</p>
          <a href="#condition-requests" className="inline-flex min-h-10 items-center rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">確認する</a>
        </div>
      )}

      {isAdmin && pinResetRequests.length > 0 && (
        <section className="mb-5 rounded-md border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle size={17} className="text-amber-700" />暗証番号リセット申請</div>
          <div className="mt-3 space-y-2">
            {pinResetRequests.map(request => (
              <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-white px-4 py-3">
                <p className="text-sm font-medium text-slate-800">{request.name}さんから暗証番号のリセット申請が届いています</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void updatePinResetRequest(request, false)} disabled={isUpdatingResetRequest !== null} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">拒否</button>
                  <button type="button" onClick={() => void updatePinResetRequest(request, true)} disabled={isUpdatingResetRequest !== null} className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50">初期化（承認）</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {isAdmin && lockedStaff.length > 0 && (
        <section className="mb-5 rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><LockKeyhole size={17} className="text-slate-500" />暗証番号の入力ロック中</div>
          <div className="mt-3 space-y-2">
            {lockedStaff.map(staff => (
              <div key={staff.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3">
                <p className="text-sm font-medium text-slate-800">{staff.name}さんは暗証番号の入力に続けて失敗したため、{new Date(staff.lockedUntil).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}までロックされています</p>
                <button type="button" onClick={() => void unlockStaff(staff)} disabled={isUnlockingStaff !== null} className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50">ロックを解除</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {isAdmin && newStaffRequests.length > 0 && (
        <section className="mb-5 rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><UserRoundPen size={17} className="text-slate-500" />新規スタッフ登録申請</div>
          <div className="mt-3 space-y-2">
            {newStaffRequests.map(request => {
              const details = getNewStaffRegistrationDetails(request.details)
              if (!details) return null
              const suggested = suggestCategory({
                isEmployee: details.employment_type === '社員',
                main_job: details.main_job,
                weekly_availability: details.weekly_availability,
                work_start_1: details.work_start_1,
              })
              const chosenCategory = approvalCategories[request.id] ?? suggested
              return (
                <div key={request.id} className="rounded-md border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{details.name}さん（{details.employment_type} / {details.main_job}）から新規登録申請が届いています</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">週の希望勤務日数: 週{details.weekly_target_days}日　申請日時: {new Date(request.created_at).toLocaleString('ja-JP')}</p>
                      {details.weekly_availability && <p className="mt-1 text-xs text-slate-600">出勤できる時間: {formatWeeklyAvailability(details.weekly_availability)}</p>}
                      {details.memo && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">店長へのメモ: {details.memo}</p>}
                      <label className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-700">
                        区分（並び順）
                        <select value={chosenCategory} disabled={isResolvingNewStaffRequest !== null}
                          onChange={event => {
                            const value = event.target.value
                            if (isStaffCategory(value)) setApprovalCategories(current => ({ ...current, [request.id]: value }))
                          }}
                          className="min-h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-slate-500">
                          {STAFF_CATEGORIES.map(category => <option key={category} value={category}>{STAFF_CATEGORY_LABELS[category]}</option>)}
                        </select>
                        <span className="text-slate-500">{chosenCategory === suggested ? '申請内容からの提案。承認するとこの区分の最後に入ります。' : '承認するとこの区分の最後に入ります。'}</span>
                      </label>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => void resolveNewStaffRequest(request, false)} disabled={isResolvingNewStaffRequest !== null} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">却下</button>
                      <button type="button" onClick={() => void resolveNewStaffRequest(request, true, chosenCategory)} disabled={isResolvingNewStaffRequest !== null} className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50">承認</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {isAdmin && pendingConditionRequests.length > 0 && (
        <section id="condition-requests" className="mb-5 scroll-mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><FileCheck2 size={17} className="text-slate-500" />勤務条件の変更申請</div>
          <div className="mt-3 space-y-2">
            {pendingConditionRequests.map(request => {
              const details = getConditionChangeDetails(request.details)
              const staff = getRequestStaff(request.staff_id)
              if (!details) return null
              return (
                <div key={request.id} className="rounded-md border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{staff?.name || 'スタッフ'}さんの勤務条件変更</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">申請日時: {new Date(request.created_at).toLocaleString('ja-JP')}</p>
                      <div className="mt-3 space-y-1 text-xs text-slate-600">
                        {details.weekly_target_days !== undefined && <p>週希望日数: {staff?.weekly_target_days || '未設定'}日 → {details.weekly_target_days}日</p>}
                        {details.main_job !== undefined && <p>メイン職種: {staff?.main_job || '未設定'} → {details.main_job}</p>}
                        {details.skills && <p>習得スキル: {details.skills.length > 0 ? details.skills.join('、') : '登録なし'}</p>}
                        {details.available_hours !== undefined && <p>基本出勤可能時間: {details.available_hours ? `${details.available_hours.start}〜${details.available_hours.end}` : '登録なし'}</p>}
                        {details.weekly_availability && <WeeklyChangeDiff staff={staff ?? null} requested={details.weekly_availability} />}
                        {details.memo !== undefined && <p className="whitespace-pre-wrap">店長へのメモ: {staff?.memo || '未設定'} → {details.memo || '未設定'}</p>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => void resolveConditionRequest(request, false)} disabled={isResolvingConditionRequest !== null} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">拒否</button>
                      <button type="button" onClick={() => void resolveConditionRequest(request, true)} disabled={isResolvingConditionRequest !== null} className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50">承認</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {!isAdmin && unreadConditionResults.map(request => (
        <section key={request.id} className="mb-5 rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <FileCheck2 size={18} className="mt-0.5 shrink-0 text-slate-500" />
              <div>
                <h2 className="text-sm font-semibold text-slate-800">勤務条件の変更申請</h2>
                <p className="mt-1 text-sm text-slate-700">店長が勤務条件の変更申請を{request.status === 'approved' ? '承認' : '拒否'}しました。</p>
              </div>
            </div>
            <button type="button" onClick={() => void markConditionRequestAsRead(request)} className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50">確認</button>
          </div>
        </section>
      ))}

      <section className="mb-5 rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Megaphone size={18} className="mt-0.5 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-800">店舗からのお知らせ</h2>
              {!isEditingNotice && <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{notice}</div>}
            </div>
          </div>
          {isAdmin && <button type="button" onClick={() => setIsEditingNotice(true)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"><Edit3 size={14} className="text-slate-500" />編集</button>}
        </div>
        {isEditingNotice ? (
          <div className="mt-3">
            <textarea value={draftNotice} onChange={event => setDraftNotice(event.target.value)} className="min-h-28 w-full rounded-md border border-slate-300 bg-white p-3 text-sm outline-none focus:border-slate-500" rows={5} />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => { setDraftNotice(notice === '現在の店舗からのお知らせはありません。' ? '' : notice); setIsEditingNotice(false) }} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50">キャンセル</button>
              <button type="button" disabled={isSavingNotice} onClick={saveNotice} className="rounded-md bg-slate-800 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50">{isSavingNotice ? '保存中…' : '保存'}</button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="mb-5 rounded-md border border-slate-200 bg-white px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CalendarCheck2 size={18} className="text-slate-500" />
            <div>
              <p className="text-xs font-medium text-slate-500">本日の勤務予定</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {shiftStatus === 'working' && <><span className="text-sm font-bold text-slate-900">{selectedShift}</span><span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">出勤</span></>}
                {shiftStatus === 'off' && <span className="rounded border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">公休</span>}
                {shiftStatus === 'requested' && <span className="rounded border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">希望休</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
            <CalendarDays size={15} />
            <span className={isSelectedDateToday ? 'font-medium text-emerald-700' : 'font-medium text-sky-700'}>{relativeDayLabel}</span>
          </div>
        </div>
      </section>

      <section className="mb-5 overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-4 py-4 md:px-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">当日のタイムテーブル</h2>
          </div>
          <div className="flex items-center rounded-md border border-slate-200 bg-white">
            <button type="button" onClick={() => changeSelectedDate(-1)} aria-label="前日" className="p-3 text-slate-600 transition hover:bg-slate-50"><ChevronLeft size={18} /></button>
            <p className="min-w-52 border-x border-slate-200 px-4 py-2 text-center text-sm font-bold text-slate-900">{selectedDate.getFullYear()}年{selectedDate.getMonth() + 1}月{selectedDate.getDate()}日（{['日', '月', '火', '水', '木', '金', '土'][selectedDate.getDay()]}）</p>
            <button type="button" onClick={() => changeSelectedDate(1)} aria-label="翌日" className="p-3 text-slate-600 transition hover:bg-slate-50"><ChevronRight size={18} /></button>
            <button type="button" onClick={() => setSelectedDate(startOfLocalDay(new Date()))} className="mr-2 rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">今日</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="relative min-w-[980px]">
            <div className="grid grid-cols-[140px_repeat(15,minmax(44px,1fr))] border-b border-slate-200 bg-slate-50">
              <div className="border-r border-slate-200 px-2 py-1.5 text-[10px] font-medium text-slate-500">スタッフ</div>
              {Array.from({ length: 15 }, (_, index) => {
                const hour = index + 9
                return <div key={hour} className="border-r border-slate-100 px-1 py-1.5 text-center text-[10px] font-semibold text-slate-500">{String(hour).padStart(2, '0')}:00</div>
              })}
            </div>

            {currentNowPosition !== null && (
              <div className="pointer-events-none absolute bottom-0 left-[140px] top-0 z-20" style={{ width: 'calc(100% - 140px)' }}>
                <div className="absolute bottom-0 top-0 w-0.5 bg-red-500" style={{ left: `${currentNowPosition * 100}%` }}>
                  <span className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-sm bg-red-500 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white shadow-sm">{currentTimeLabel}</span>
                </div>
              </div>
            )}

            {scheduledPeople.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-slate-500">本日の出勤予定者はいません</div>
            ) : scheduledPeople.map(({ person, shift, position }) => {
              return (
                <div key={person.id} className="grid min-h-10 grid-cols-[140px_minmax(0,1fr)] border-b border-slate-100 last:border-0">
                  <div className="flex items-center gap-1.5 border-r border-slate-200 px-2 py-1">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold ${person.id === currentStaff?.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>{person.name.slice(0, 2)}</span>
                    <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">{person.name}</p><p className="truncate text-[10px] text-slate-500">{person.mainJob || '職種未登録'}</p></div>
                  </div>
                  <div className="relative grid min-w-0" style={{ gridTemplateColumns: 'repeat(15, minmax(0, 1fr))' }}>
                    {Array.from({ length: 15 }, (_, index) => <div key={index} className="border-r border-slate-100" />)}
                    {position && (
                      <div
                        className={`absolute top-1/2 z-10 flex h-5 -translate-y-1/2 items-center justify-center overflow-hidden rounded-sm px-1 text-[9px] shadow-sm ${person.id === currentStaff?.id || person.name === currentStaff?.name ? 'bg-orange-500 font-medium text-white shadow-orange-200' : 'bg-slate-900 font-medium text-white'}`}
                        style={{
                          left: `${position.startPosition * 100}%`,
                          width: `${(position.endPosition - position.startPosition) * 100}%`,
                        }}
                      >
                        {shift}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-[11px] text-slate-500">
          <span className="h-2 w-2 rounded-full bg-slate-900" />勤務時間
          <span className="ml-3 h-2 w-2 rounded-full bg-rose-500" />現在時刻
        </div>
      </section>

      {!isAdmin && currentProfile && (
        <UsualAvailabilityCard
          profile={currentProfile}
          hasPendingRequest={Boolean(myPendingConditionRequest)}
          pendingWeekly={myPendingConditionDetails?.weekly_availability ?? null}
          hours={storeHours}
          onSubmit={submitUsualAvailabilityChange}
        />
      )}

      {!isAdmin && currentProfile && (
        <section className="mb-5 rounded-md border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <UserRoundPen size={18} className="mt-0.5 shrink-0 text-slate-500" />
              <div>
                <h2 className="text-sm font-semibold text-slate-800">現在の登録勤務条件</h2>
                <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs font-medium text-slate-500">週の希望勤務日数</dt><dd className="mt-0.5 font-medium text-slate-800">週{currentProfile.weekly_target_days || 3}日</dd></div>
                  <div><dt className="text-xs font-medium text-slate-500">メイン職種</dt><dd className="mt-0.5 font-medium text-slate-800">{currentProfile.main_job || '未設定'}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-xs font-medium text-slate-500">習得スキル</dt><dd className="mt-1 flex flex-wrap gap-1.5">{currentSkills.length > 0 ? currentSkills.map(skill => <span key={skill} className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{skill}</span>) : <span className="text-sm text-slate-600">登録なし</span>}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-xs font-medium text-slate-500">店長へのメモ</dt><dd className="mt-0.5 whitespace-pre-wrap text-slate-700">{currentProfile.memo || '登録されていません'}</dd></div>
                </dl>
              </div>
            </div>
            {myPendingConditionRequest
              ? <span role="status" className="shrink-0 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">申請中（店長の確認待ち）</span>
              : <button type="button" onClick={openConditionRequestModal} className="inline-flex shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"><UserRoundPen size={15} className="text-slate-500" />条件の変更を申請する</button>}
          </div>
        </section>
      )}

      {isConditionModalOpen && currentProfile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setIsConditionModalOpen(false) }}>
          <section role="dialog" aria-modal="true" aria-labelledby="condition-request-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-md border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 id="condition-request-title" className="text-sm font-semibold text-slate-800">勤務条件の変更を申請</h2>
              <p className="mt-1 text-xs text-slate-500">店長の承認後に登録内容へ反映されます。</p>
            </div>
            <div className="space-y-4 p-5">
              <label className="block"><span className="text-xs font-medium text-slate-700">週の希望勤務日数</span><select value={requestedWorkDays} onChange={event => setRequestedWorkDays(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500">{[1, 2, 3, 4, 5, 6].map(days => <option key={days} value={days}>週{days}日</option>)}</select></label>
              <label className="block"><span className="text-xs font-medium text-slate-700">メイン職種</span><select value={requestedMainJob} onChange={event => setRequestedMainJob(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500"><option value="ホール">ホール</option><option value="キッチン">キッチン</option><option value="共通">共通</option></select></label>
              <fieldset>
                <legend className="text-xs font-medium text-slate-700">習得スキル</legend>
                <p className="mt-1 text-xs text-slate-500">できるようになったポジションを選択してください。</p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {skillOptions.map(skill => (
                    <label key={skill} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 transition hover:bg-slate-50">
                      <input type="checkbox" checked={requestedSkills.includes(skill)} onChange={() => toggleRequestedSkill(skill)} className="h-3.5 w-3.5 rounded border-slate-300 text-slate-800 focus:ring-slate-500" />
                      <span>{skill}</span>
                    </label>
                  ))}
                  {skillOptions.length === 0 && (
                    <p className="col-span-full text-xs text-slate-500">店舗にスキル項目が設定されていません。</p>
                  )}
                </div>
              </fieldset>
              <label className="block"><span className="text-xs font-medium text-slate-700">店長へのメモ</span><textarea value={requestedMemo} onChange={event => setRequestedMemo(event.target.value)} rows={4} className="mt-1.5 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500" /><span className="mt-1 block text-xs text-slate-500">メモはシフトの自動作成には使われません。</span></label>
              <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={() => setIsConditionModalOpen(false)} disabled={isSubmittingConditionRequest} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50">キャンセル</button><button type="button" onClick={() => void submitConditionChange()} disabled={isSubmittingConditionRequest} className="rounded-md bg-slate-800 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50">店長に申請する</button></div>
            </div>
          </section>
        </div>
      )}

      {isChangingPin && currentStaff && (
        <PinLoginModal
          staff={currentStaff}
          storeId={storeId}
          mode="change"
          onClose={() => setIsChangingPin(false)}
          onSuccess={updatedStaff => {
            login(updatedStaff)
            setIsChangingPin(false)
          }}
        />
      )}
    </div>
  )
}

/** Placeholder of the home screen (also used by loading.tsx while the server loads it). */
export function HomeSkeleton() {
  return (
    <SkeletonRegion label="ホームを読み込んでいます…" className="mx-auto max-w-[1800px] space-y-5 p-4 md:p-8">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-5">
        <SkeletonBlock className="h-10 w-10" />
        <div className="space-y-2">
          <SkeletonBlock className="h-5 w-40" />
          <SkeletonBlock className="h-3 w-24" />
        </div>
      </div>
      <LoadingNote />
      <SkeletonBlock className="h-28 w-full" />
      <div className="grid gap-5 lg:grid-cols-2">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={4} />
      </div>
    </SkeletonRegion>
  )
}

/** Approval list: each weekday now → requested; only the requested weekdays are bold, the others stay as they are. */
function WeeklyChangeDiff({ staff, requested }: { staff: UsualAvailabilityInput | null; requested: WeeklyAvailabilityChange }) {
  const usual = usualAvailabilityOf(staff)
  return (
    <div>
      <p>出勤できる時間（曜日ごと）{usual.source === 'bands' ? '：以前の時間帯から' : ''}</p>
      <dl className="mt-1 grid gap-y-0.5">
        {WEEKDAY_KEYS.map(day => (
          <div key={day} className={`flex flex-wrap gap-x-2 ${requested[day] ? 'font-bold text-slate-900' : 'text-slate-500'}`}>
            <dt className="w-5 shrink-0">{WEEKDAY_LABELS[day]}</dt>
            <dd className="tabular-nums">
              {usual.days[day].long || '未設定'}{requested[day] ? ` → ${formatDayRequest(requested[day], 'long', '出られない')}` : '（そのまま）'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
