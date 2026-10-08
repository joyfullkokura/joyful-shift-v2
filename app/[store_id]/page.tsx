'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Edit3,
  KeyRound,
  Store,
} from 'lucide-react'
import PinLoginModal from '@/components/PinLoginModal'
import { useAdmin } from '@/context/AdminContext'
import { supabase } from '@/lib/supabase'

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
}

type PinResetRequest = {
  id: string
  name: string
}

type ShiftRequest = {
  is_off?: boolean | null
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

export default function HomePage() {
  const { store_id } = useParams<{ store_id: string }>()
  const { currentStaff, login, isAdmin } = useAdmin()
  const [isChangingPin, setIsChangingPin] = useState(false)
  const [isEditingNotice, setIsEditingNotice] = useState(false)
  const [notice, setNotice] = useState('')
  const [draftNotice, setDraftNotice] = useState('')
  const [storeName, setStoreName] = useState('')
  const [schedule, setSchedule] = useState<ScheduleData | null>(null)
  const [selectedDate, setSelectedDate] = useState(() => startOfLocalDay(new Date()))
  const [isLoading, setIsLoading] = useState(true)
  const [isSavingNotice, setIsSavingNotice] = useState(false)
  const [pinResetRequests, setPinResetRequests] = useState<PinResetRequest[]>([])
  const [isUpdatingResetRequest, setIsUpdatingResetRequest] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState('')
  const [hasRequestedDayOff, setHasRequestedDayOff] = useState(false)
  const [error, setError] = useState('')

  const storeId = Array.isArray(store_id) ? store_id[0] : store_id
  const selectedDateKey = toDateKey(selectedDate)
  const targetMonth = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-01`
  const today = startOfLocalDay(new Date())
  const todayKey = toDateKey(today)

  useEffect(() => {
    let isCurrent = true
    const loadDashboard = async () => {
      setIsLoading(true)
      setError('')
      try {
        const [storeResult, shiftResult, resetRequestResult] = await Promise.all([
          supabase.from('stores').select('name, notice').eq('store_id', storeId).maybeSingle(),
          supabase
            .from('monthly_shifts')
            .select('schedule_data')
            .eq('store_id', storeId)
            .eq('target_month', targetMonth)
            .eq('status', 'confirmed')
            .order('created_at', { ascending: false })
            .limit(1),
          supabase
            .from('staff')
            .select('id, name')
            .eq('store_id', storeId)
            .eq('pin_reset_requested', true)
            .order('name'),
        ])
        if (storeResult.error) throw storeResult.error
        if (shiftResult.error) throw shiftResult.error
        if (resetRequestResult.error) throw resetRequestResult.error
        const store = storeResult.data as StoreRecord | null
        const latestShift = shiftResult.data?.[0] as { schedule_data?: unknown } | undefined
        const parsedSchedule = latestShift?.schedule_data
        if (!isCurrent) return
        setStoreName(store?.name || storeId)
        setNotice(store?.notice || '現在の店内お知らせはありません。')
        setDraftNotice(store?.notice || '')
        setSchedule(isScheduleData(parsedSchedule) ? parsedSchedule : null)
        setPinResetRequests((resetRequestResult.data || []) as PinResetRequest[])
      } catch (caughtError) {
        if (isCurrent) setError(caughtError instanceof Error ? caughtError.message : 'ダッシュボードを読み込めませんでした。')
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    }
    void loadDashboard()
    return () => { isCurrent = false }
  }, [storeId, targetMonth])

  useEffect(() => {
    let isCurrent = true
    const loadDayOffRequest = async () => {
      if (!currentStaff?.id) {
        setHasRequestedDayOff(false)
        return
      }
      const { data, error: requestError } = await supabase
        .from('shift_requests')
        .select('is_off')
        .eq('store_id', storeId)
        .eq('staff_id', currentStaff.id)
        .eq('date', selectedDateKey)
        .maybeSingle()
      if (!isCurrent || requestError) return
      setHasRequestedDayOff(Boolean((data as ShiftRequest | null)?.is_off))
    }
    void loadDayOffRequest()
    return () => { isCurrent = false }
  }, [currentStaff?.id, selectedDateKey, storeId])

  const schedulePeople = useMemo(() => schedule?.staff || [], [schedule])
  const todayPerson = schedulePeople.find(person => person.id === currentStaff?.id)
  const selectedShift = todayPerson?.shifts?.[selectedDateKey] || ''
  const isSelectedDateToday = selectedDateKey === todayKey
  const relativeDayLabel = getRelativeDayLabel(selectedDate, today)
  const myShiftSummary = hasRequestedDayOff
    ? '📝 今日のシフト: 休み希望提出済み'
    : !selectedShift || selectedShift === '×'
      ? '☕ 今日のシフト: 公休（休み）'
      : `☀️ 今日のシフト: ${selectedShift}`
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
      const { error: updateError } = await supabase
        .from('stores')
        .update({ notice: draftNotice.trim() })
        .eq('store_id', storeId)
      if (updateError) throw updateError
      setNotice(draftNotice.trim() || '現在の店舗からのお知らせはありません。')
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
      const update = approved
        ? { pin_hash: null, pin_reset_requested: false }
        : { pin_reset_requested: false }
      const { error: updateError } = await supabase
        .from('staff')
        .update(update)
        .eq('id', request.id)
        .eq('store_id', storeId)
      if (updateError) throw updateError
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

  if (isLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500">ダッシュボードを読み込み中です…</div>
  }

  return (
    <div className="mx-auto max-w-[1800px] p-4 pb-28 md:p-8 md:pb-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Store dashboard</p>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white"><Store size={19} /></span>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{storeName || storeId}</h1>
              <p className="mt-0.5 text-sm text-slate-500">{currentStaff?.name || 'スタッフ'} · {isAdmin ? '管理者' : '従業員'}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {currentStaff?.pin_hash && (
            <button type="button" onClick={() => setIsChangingPin(true)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <KeyRound size={14} />暗証番号を変更
            </button>
          )}
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {successMessage && <p role="status" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</p>}

      {isAdmin && pinResetRequests.length > 0 && (
        <section className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">PIN reset requests</p>
          <div className="mt-3 space-y-3">
            {pinResetRequests.map(request => (
              <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-white px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">⚠️ {request.name}さんから暗証番号のリセット申請が届いています</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void updatePinResetRequest(request, false)} disabled={isUpdatingResetRequest !== null} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">拒否</button>
                  <button type="button" onClick={() => void updatePinResetRequest(request, true)} disabled={isUpdatingResetRequest !== null} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">初期化（承認）</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Store notice</p>
            <h2 className="mt-1 text-sm font-bold text-slate-900">📢 店舗からのお知らせ</h2>
          </div>
          {isAdmin && <button type="button" onClick={() => setIsEditingNotice(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"><Edit3 size={12} />✎ 編集</button>}
        </div>
        {isEditingNotice ? (
          <div className="p-4">
            <textarea value={draftNotice} onChange={event => setDraftNotice(event.target.value)} className="min-h-28 w-full rounded-md border border-slate-300 bg-white p-3 text-sm outline-none focus:border-slate-500" rows={5} />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => { setDraftNotice(notice === '現在の店舗からのお知らせはありません。' ? '' : notice); setIsEditingNotice(false) }} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">キャンセル</button>
              <button type="button" disabled={isSavingNotice} onClick={saveNotice} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{isSavingNotice ? '保存中…' : '保存'}</button>
            </div>
          </div>
        ) : <div className="whitespace-pre-wrap p-5 text-sm leading-6 text-slate-600">{notice}</div>}
      </section>

      <section className="mb-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-4 md:px-5">
          <p className="text-sm font-semibold text-slate-900">{myShiftSummary}</p>
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
            <CalendarDays size={15} />
            <span className={isSelectedDateToday ? 'font-semibold text-emerald-700' : 'font-semibold text-sky-700'}>{relativeDayLabel}</span>
          </div>
        </div>
      </section>

      <section className="mb-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-4 py-4 md:px-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Daily time table</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">当日のタイムテーブル</h2>
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
            <div className="grid grid-cols-[170px_repeat(15,minmax(52px,1fr))] border-b border-slate-200 bg-slate-50">
              <div className="border-r border-slate-200 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Staff</div>
              {Array.from({ length: 15 }, (_, index) => {
                const hour = index + 9
                return <div key={hour} className="border-r border-slate-100 px-1 py-3 text-center text-[10px] font-semibold text-slate-500">{String(hour).padStart(2, '0')}:00</div>
              })}
            </div>

            {currentNowPosition !== null && (
              <div className="pointer-events-none absolute bottom-0 left-[170px] top-0 z-20" style={{ width: 'calc(100% - 170px)' }}>
                <div className="absolute bottom-0 top-0 w-0.5 bg-red-500" style={{ left: `${currentNowPosition * 100}%` }}>
                  <span className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-red-500 px-2 py-1 text-[10px] font-bold text-white shadow-sm">📍 {currentTimeLabel}</span>
                </div>
              </div>
            )}

            {scheduledPeople.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-slate-500">本日の出勤予定者はいません</div>
            ) : scheduledPeople.map(({ person, shift, position }) => {
              return (
                <div key={person.id} className="grid min-h-16 grid-cols-[170px_minmax(0,1fr)] border-b border-slate-100 last:border-0">
                  <div className="flex items-center gap-2 border-r border-slate-200 px-4 py-3">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold ${person.id === currentStaff?.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>{person.name.slice(0, 2)}</span>
                    <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">{person.name}</p><p className="truncate text-[10px] text-slate-500">{person.mainJob || '職種未登録'}</p></div>
                  </div>
                  <div className="relative grid min-w-0" style={{ gridTemplateColumns: 'repeat(15, minmax(0, 1fr))' }}>
                    {Array.from({ length: 15 }, (_, index) => <div key={index} className="border-r border-slate-100" />)}
                    {position && (
                      <div
                        className={`absolute top-1/2 z-10 flex h-8 -translate-y-1/2 items-center justify-center overflow-hidden rounded-md px-2 text-[10px] shadow-sm ${person.id === currentStaff?.id || person.name === currentStaff?.name ? 'bg-orange-500 font-semibold text-white shadow-orange-200' : 'bg-slate-900 font-bold text-white'}`}
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
