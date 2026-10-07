'use client'

import { startTransition, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { CalendarDays, ChevronLeft, ChevronRight, Printer, Users, Clock3 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAdmin } from '@/context/AdminContext'

type ShiftStaff = {
  id: string
  name: string
  mainJob: string
  isEmployee: boolean
  employmentType: string
  shifts: Record<string, string>
  assignedDays: number
  assignedHours: number
}

type ConfirmedSchedule = {
  staff: ShiftStaff[]
  vacancyCount: number
  assignedHours: number
  alerts: { id: string; type: 'vacancy' | 'skill'; message: string }[]
}

type ConfirmedShiftRow = {
  status: string
  schedule_data?: unknown
  schedule?: unknown
  shifts?: unknown
}

const HOLIDAYS: Record<string, string> = {
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

const isConfirmedSchedule = (value: unknown): value is ConfirmedSchedule => {
  if (!value || typeof value !== 'object') return false
  const schedule = value as Partial<ConfirmedSchedule>
  return Array.isArray(schedule.staff)
    && schedule.staff.every(person =>
      typeof person.id === 'string'
      && typeof person.name === 'string'
      && typeof person.shifts === 'object'
      && person.shifts !== null
    )
}

export default function ViewShiftPage() {
  const params = useParams<{ store_id: string }>()
  const storeId = params.store_id
  const { currentStaff } = useAdmin()
  const [viewDate, setViewDate] = useState(() => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })
  const [storeName, setStoreName] = useState('')
  const [schedule, setSchedule] = useState<ConfirmedSchedule | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [highlightedStaffId, setHighlightedStaffId] = useState(currentStaff?.id || '')

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth() + 1
  const targetMonthStr = `${year}-${String(month).padStart(2, '0')}-01`
  const daysInMonth = new Date(year, month, 0).getDate()
  const dates = Array.from({ length: daysInMonth }, (_, index) =>
    `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`
  )
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay()

  useEffect(() => {
    let isCurrent = true
    const loadMonth = async () => {
      setIsLoading(true)
      setLoadError('')
      try {
        const [storeResult, shiftResult] = await Promise.all([
          supabase.from('stores').select('name').eq('store_id', storeId).maybeSingle(),
          supabase
            .from('monthly_shifts')
            .select('*')
            .eq('store_id', storeId)
            .eq('target_month', targetMonthStr)
            .eq('status', 'confirmed')
            .maybeSingle(),
        ])
        if (shiftResult.error) throw shiftResult.error
        const record = shiftResult.data as ConfirmedShiftRow | null
        const savedSchedule = record?.schedule_data ?? record?.schedule ?? record?.shifts
        startTransition(() => {
          if (!isCurrent) return
          setStoreName(storeResult.data?.name || '')
          setSchedule(isConfirmedSchedule(savedSchedule) ? savedSchedule : null)
          setHighlightedStaffId(currentStaff?.id || '')
          setIsLoading(false)
        })
      } catch (error) {
        startTransition(() => {
          if (!isCurrent) return
          setSchedule(null)
          setLoadError(error instanceof Error ? error.message : 'シフトを読み込めませんでした。')
          setIsLoading(false)
        })
      }
    }
    void loadMonth()
    return () => {
      isCurrent = false
    }
  }, [currentStaff?.id, storeId, targetMonthStr])

  const changeMonth = (offset: number) => {
    setViewDate(current => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  const staffCount = schedule?.staff.length ?? 0
  const assignedHours = schedule?.assignedHours
    ?? schedule?.staff.reduce((total, person) => total + (Number(person.assignedHours) || 0), 0)
    ?? 0
  const currentPerson = schedule?.staff.find(person => person.id === currentStaff?.id)

  return (
    <div className="mx-auto max-w-[1600px] p-4 pb-10 md:p-8 print:max-w-none print:p-0">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase text-slate-500">Confirmed schedule</p>
          <h1 className="text-2xl font-semibold text-slate-900">{storeName || storeId}</h1>
          <p className="mt-1 text-sm text-slate-600">{year}年{month}月 確定シフト</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <div className="inline-flex items-center rounded-md border border-slate-200 bg-white">
            <button type="button" onClick={() => changeMonth(-1)} aria-label="前月" className="rounded-l-md p-2.5 text-slate-600 transition-colors hover:bg-slate-50">
              <ChevronLeft size={18} />
            </button>
            <span className="min-w-[104px] border-x border-slate-200 px-3 py-2 text-center text-sm font-medium text-slate-800">{year}年{month}月</span>
            <button type="button" onClick={() => changeMonth(1)} aria-label="翌月" className="rounded-r-md p-2.5 text-slate-600 transition-colors hover:bg-slate-50">
              <ChevronRight size={18} />
            </button>
          </div>
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
            <Printer size={16} /> 印刷
          </button>
        </div>
      </header>

      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">確定シフトを読み込んでいます...</div>
      ) : loadError ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">シフトを取得できませんでした。時間をおいて再度お試しください。</div>
      ) : !schedule ? (
        <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-700">
          <CalendarDays size={18} className="mt-0.5 shrink-0 text-slate-500" />
          <p>{year}年{month}月の確定シフトはまだ公開されていません。店長が作成・確定するまでお待ちください。</p>
        </div>
      ) : (
        <>
          <section className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-600"><Users size={16} /><span>スタッフ <strong className="font-semibold text-slate-900">{staffCount}名</strong></span></div>
            <div className="flex items-center gap-2 text-sm text-slate-600"><Clock3 size={16} /><span>合計稼働人時 <strong className="font-semibold text-slate-900">{assignedHours.toFixed(1)}h</strong></span></div>
          </section>

          <section className="mb-7 rounded-lg border border-slate-200 bg-white p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-500">My schedule</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">{currentStaff?.name || '個人'}さんのシフト</h2>
              </div>
              <div className="flex gap-2">
                <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">勤務時間 <strong className="ml-1 text-slate-900">{Number(currentPerson?.assignedHours || 0).toFixed(1)}h</strong></span>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">出勤日数 <strong className="ml-1 text-slate-900">{Number(currentPerson?.assignedDays || 0)}日</strong></span>
              </div>
            </div>
            {currentPerson ? (
              <div className="grid grid-cols-7 gap-1.5 md:gap-2">
                {['日', '月', '火', '水', '木', '金', '土'].map((label, index) => (
                  <div key={label} className={`py-1 text-center text-[10px] font-semibold ${index === 0 ? 'text-red-600' : index === 6 ? 'text-blue-600' : 'text-slate-500'}`}>{label}</div>
                ))}
                {Array.from({ length: firstDayOfWeek }, (_, index) => <div key={`empty-${index}`} />)}
                {dates.map(date => {
                  const day = Number(date.slice(-2))
                  const weekday = new Date(year, month - 1, day).getDay()
                  const holiday = HOLIDAYS[date]
                  const shift = currentPerson.shifts?.[date] || ''
                  const isOff = shift === '×' || !shift
                  const tone = isOff
                    ? 'border-slate-200 bg-slate-50 text-slate-500'
                    : 'border-amber-200 bg-amber-50/60 text-slate-800'
                  return (
                    <div key={date} className={`flex min-h-[72px] flex-col rounded-md border p-1.5 md:min-h-[92px] md:p-2 ${tone}`}>
                      <span className={`text-[10px] font-semibold ${weekday === 0 || holiday ? 'text-red-600' : weekday === 6 ? 'text-blue-600' : 'text-slate-600'}`}>{day}日</span>
                      {isOff
                        ? <span className="mt-auto text-center text-[10px] text-slate-400">休み</span>
                        : <span className="mt-auto break-words text-center text-[9px] font-semibold leading-tight md:text-[11px]">{shift}</span>}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="rounded-md bg-slate-50 px-4 py-5 text-center text-sm text-slate-600">この月のシフト表にログイン中のスタッフが見つかりません。</p>
            )}
          </section>

          <section className="mb-4 flex flex-wrap items-end justify-between gap-2 border-t border-slate-200 pt-6">
            <div>
              <p className="text-[10px] font-semibold uppercase text-slate-500">Store schedule</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">全スタッフのシフト一覧表</h2>
            </div>
            <p className="text-xs text-slate-500">自分の行はアンバーで表示</p>
          </section>

          <div className="w-full overflow-x-auto overscroll-x-contain -webkit-overflow-scrolling-touch rounded-md border border-slate-200 bg-white">
            <table className="w-max min-w-full border-separate border-spacing-0 text-[11px]">
              <thead>
                <tr className="text-slate-600">
                  <th className="sticky left-0 z-20 w-[88px] min-w-[88px] max-w-[88px] border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-left font-semibold">スタッフ</th>
                  {dates.map(date => {
                    const day = Number(date.slice(-2))
                    const weekday = new Date(year, month - 1, day).getDay()
                    const holiday = HOLIDAYS[date]
                    const dayClass = weekday === 0 || holiday
                      ? 'bg-red-50/40 text-red-600'
                      : weekday === 6
                        ? 'bg-blue-50/40 text-blue-600'
                        : 'bg-slate-50'
                    return (
                      <th key={date} className={`w-[52px] min-w-[52px] border-b border-slate-200 px-0.5 py-2 text-center font-semibold ${dayClass}`} title={holiday || undefined}>
                        <span className="block">{day}日</span>
                        <span className="block text-[9px] font-normal">{new Date(year, month - 1, day).toLocaleDateString('ja-JP', { weekday: 'short' })}</span>
                      </th>
                    )
                  })}
                  <th className="w-[76px] min-w-[76px] border-b border-l border-slate-200 bg-slate-50 px-1 py-2 text-right font-semibold">出勤日数</th>
                  <th className="w-[84px] min-w-[84px] border-b border-l border-slate-200 bg-slate-50 px-2 py-2 text-right font-semibold">勤務時間</th>
                </tr>
              </thead>
              <tbody>
                {schedule.staff.map(person => (
                  <tr key={person.id} className={person.id === highlightedStaffId ? 'bg-amber-50/60 text-slate-800' : 'text-slate-700'}>
                    <th scope="row" className={`sticky left-0 z-10 w-[88px] min-w-[88px] max-w-[88px] border-b border-r border-slate-200 px-2 py-1.5 text-left font-medium ${person.id === highlightedStaffId ? 'bg-amber-50' : 'bg-white'}`}>
                      <span className="block truncate text-[11px] text-slate-800">{person.name}</span>
                      <span className="mt-0.5 block truncate text-[9px] leading-tight text-slate-400">{person.mainJob}・{person.employmentType || (person.isEmployee ? '社員' : 'アルバイト')}</span>
                    </th>
                    {dates.map(date => {
                      const day = Number(date.slice(-2))
                      const weekday = new Date(year, month - 1, day).getDay()
                      const holiday = HOLIDAYS[date]
                      const shift = person.shifts?.[date] || ''
                      const cellClass = shift === '×'
                        ? 'bg-red-50/70 font-medium text-red-500'
                        : person.id === highlightedStaffId
                          ? 'bg-amber-50/60 text-slate-800'
                          : weekday === 0 || holiday
                            ? 'bg-red-50/20 text-slate-700'
                            : weekday === 6
                              ? 'bg-blue-50/20 text-slate-700'
                              : 'bg-white text-slate-700'
                      return <td key={date} className={`w-[52px] min-w-[52px] border-b border-slate-100 px-0.5 py-2 text-center text-[10px] tabular-nums ${cellClass}`}>{shift === '×' ? '×' : shift || '-'}</td>
                    })}
                    <td className={`w-[76px] min-w-[76px] border-b border-l border-slate-100 px-1 py-2 text-right tabular-nums ${person.id === highlightedStaffId ? 'bg-amber-50' : 'bg-white'}`}>{person.assignedDays}日</td>
                    <td className={`w-[84px] min-w-[84px] border-b border-l border-slate-100 px-2 py-2 text-right font-semibold tabular-nums ${person.id === highlightedStaffId ? 'bg-amber-50' : 'bg-white'}`}>{Number(person.assignedHours || 0).toFixed(1)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}