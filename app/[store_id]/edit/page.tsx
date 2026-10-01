'use client'

import { startTransition, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Save } from 'lucide-react'

type GeneratedStaffShift = {
  id: string
  name: string
  mainJob: string
  isEmployee: boolean
  employmentType: string
  shifts: Record<string, string>
  assignedDays: number
  assignedHours: number
}

type ScheduleAlert = {
  id: string
  type: 'vacancy' | 'skill'
  message: string
}

type GeneratedSchedule = {
  staff: GeneratedStaffShift[]
  vacancyCount: number
  assignedHours: number
  alerts: ScheduleAlert[]
}

type SavedSchedule = {
  storeId: string
  targetMonth: string
  schedule: GeneratedSchedule
}

const storageKeyFor = (storeId: string, targetMonth: string) =>
  `joyful-shift:${storeId}:${targetMonth}`

const getShiftHours = (shift: string) => {
  const match = shift.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/)
  if (!match) return 0
  const start = Number(match[1]) + Number(match[2]) / 60
  let end = Number(match[3]) + Number(match[4]) / 60
  if (end < start) end += 24
  return Math.max(0, end - start)
}

const parseSavedSchedule = (value: string | null, storeId: string, targetMonth: string): SavedSchedule | null => {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as SavedSchedule
    if (
      parsed.storeId !== storeId
      || parsed.targetMonth !== targetMonth
      || !Array.isArray(parsed.schedule?.staff)
      || !Array.isArray(parsed.schedule?.alerts)
    ) return null
    return parsed
  } catch {
    return null
  }
}

export default function EditSchedulePage() {
  const params = useParams<{ store_id: string }>()
  const router = useRouter()
  const storeId = params.store_id
  const [savedSchedule, setSavedSchedule] = useState<SavedSchedule | null>(null)
  const [schedule, setSchedule] = useState<GeneratedSchedule | null>(null)
  const [targetMonth, setTargetMonth] = useState('')
  const [isSaved, setIsSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    const month = new URLSearchParams(window.location.search).get('month') || ''
    if (!/^\d{4}-\d{2}-01$/.test(month)) return
    const loaded = parseSavedSchedule(
      sessionStorage.getItem(storageKeyFor(storeId, month)),
      storeId,
      month
    )
    if (loaded) {
      startTransition(() => {
        setTargetMonth(month)
        setSavedSchedule(loaded)
        setSchedule(loaded.schedule)
      })
    }
  }, [storeId])

  const updateShift = (staffId: string, date: string, value: string) => {
    setIsSaved(false)
    setSchedule(current => {
      if (!current) return current
      const staff = current.staff.map(person => {
        if (person.id !== staffId) return person
        const shifts = { ...person.shifts, [date]: value }
        const assignedHours = Object.values(shifts).reduce((total, shift) => total + getShiftHours(shift), 0)
        const assignedDays = Object.values(shifts).filter(shift => getShiftHours(shift) > 0).length
        return { ...person, shifts, assignedHours, assignedDays }
      })
      const assignedHours = staff.reduce((total, person) => total + person.assignedHours, 0)
      return { ...current, staff, assignedHours }
    })
  }

  const saveChanges = () => {
    if (!schedule || !savedSchedule || !targetMonth) return
    try {
      const updated = { ...savedSchedule, schedule }
      sessionStorage.setItem(storageKeyFor(storeId, targetMonth), JSON.stringify(updated))
      setSavedSchedule(updated)
      setIsSaved(true)
      setSaveError('')
    } catch {
      setSaveError('変更を保存できませんでした。ブラウザーの保存容量を確認してください。')
    }
  }

  const goBack = () => router.push(`/${encodeURIComponent(storeId)}/generate`)

  if (!schedule || !targetMonth) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h1 className="text-lg font-semibold text-slate-900">編集するシフト案がありません</h1>
          <p className="mt-2 text-sm text-slate-600">シフトを生成してから、編集へ進んでください。</p>
          <button type="button" onClick={goBack} className="mt-5 inline-flex items-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <ArrowLeft size={16} /> シフト生成へ戻る
          </button>
        </section>
      </div>
    )
  }

  const [year, month] = targetMonth.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const dates = Array.from({ length: daysInMonth }, (_, index) =>
    `${targetMonth.slice(0, 7)}-${String(index + 1).padStart(2, '0')}`
  )

  return (
    <div className="mx-auto max-w-[1440px] p-4 md:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <button type="button" onClick={goBack} className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
            <ArrowLeft size={16} /> 生成画面へ戻る
          </button>
          <p className="text-xs font-medium uppercase text-slate-500">Shift editing</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{year}年{month}月 シフト微調整</h1>
        </div>
        <button type="button" onClick={saveChanges} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800">
          {isSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
          {isSaved ? '変更を保存しました' : '変更を保存'}
        </button>
      </header>

      {saveError && <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{saveError}</p>}

      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
        <span>スタッフ {schedule.staff.length}名</span>
        <span>合計勤務時間 <strong className="font-semibold text-slate-900">{schedule.assignedHours.toFixed(1)}h</strong></span>
        <span>欠員 {schedule.vacancyCount}枠</span>
      </div>

      <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-600">
              <th className="sticky left-0 z-20 min-w-[150px] border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left font-semibold">スタッフ名</th>
              <th className="min-w-[100px] border-b border-slate-200 px-3 py-3 text-left font-semibold">職種</th>
              {dates.map(date => {
                const day = Number(date.slice(-2))
                const weekday = new Date(year, month - 1, day).toLocaleDateString('ja-JP', { weekday: 'short' })
                return <th key={date} className="w-[112px] min-w-[112px] border-b border-slate-200 px-2 py-2 text-center font-semibold">{day}日<span className="mt-0.5 block text-[10px] font-normal text-slate-500">{weekday}</span></th>
              })}
              <th className="min-w-[88px] border-b border-slate-200 px-3 py-3 text-right font-semibold">出勤日数</th>
              <th className="sticky right-0 z-20 min-w-[100px] border-b border-l border-slate-200 bg-slate-50 px-3 py-3 text-right font-semibold">勤務時間</th>
            </tr>
          </thead>
          <tbody>
            {schedule.staff.map(person => (
              <tr key={person.id} className="text-slate-700">
                <th scope="row" className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-3 py-2 text-left font-medium">{person.name}</th>
                <td className="border-b border-slate-100 px-3 py-2">{person.mainJob}</td>
                {dates.map(date => (
                  <td key={date} className="border-b border-slate-100 px-1.5 py-1.5">
                    <input
                      aria-label={`${person.name} ${date} の勤務時間`}
                      type="text"
                      value={person.shifts[date] || ''}
                      onChange={event => updateShift(person.id, date, event.target.value)}
                      placeholder="-"
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-center text-xs text-slate-700 outline-none transition-colors hover:border-slate-200 focus:border-slate-400 focus:bg-white"
                    />
                  </td>
                ))}
                <td className="border-b border-slate-100 px-3 py-2 text-right tabular-nums">{person.assignedDays}日</td>
                <td className="sticky right-0 z-10 border-b border-l border-slate-100 bg-white px-3 py-2 text-right font-semibold tabular-nums">{person.assignedHours.toFixed(1)}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
