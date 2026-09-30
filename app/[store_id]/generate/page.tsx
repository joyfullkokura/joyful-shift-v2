'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import { Calendar as CalendarIcon, Save, Rocket, ChevronLeft, ChevronRight } from 'lucide-react'

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

export default function GeneratePage() {
  const { store_id } = useParams()
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
  const [availabilityCards, setAvailabilityCards] = useState<any[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [monthlyTargetHours, setMonthlyTargetHours] = useState<number>(168)

  const minTime = useMemo(() => tToF(storeInfo?.open_time), [storeInfo])
  const maxTime = useMemo(() => tToF(storeInfo?.close_time), [storeInfo])
  const groups = useMemo(() => storeInfo?.group_options?.split(',') || [], [storeInfo])

  const loadAllSettings = useCallback(async () => {
    if (!store_id) return

    const { data: sInfo } = await supabase.from('stores').select('*').eq('store_id', store_id).single()
    if (sInfo) setStoreInfo(sInfo)

    const storeGroups = sInfo?.group_options?.split(',') || []

    const { data: currentSettings } = await supabase
      .from('generation_settings')
      .select('*')
      .eq('store_id', store_id)
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
        .eq('store_id', store_id)
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
  }, [store_id, targetMonthStr])

  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  const firstDay = new Date(targetYear, targetMonth - 1, 1).getDay()

  useEffect(() => {
    loadAllSettings()
  }, [loadAllSettings])

  const changeMonth = (diff: number) => {
    setViewDate(new Date(targetYear, targetMonth - 1 + diff, 1))
  }

  const updateCount = (tab: string, group: string, delta: number) => {
    setCounts(prev => {
      const tabData = { ...(prev[tab] || {}) }
      tabData[group] = Math.max(0, (tabData[group] || 0) + delta)
      return { ...prev, [tab]: tabData }
    })
  }

  const updateTimeSlot = (tab: string, id: string, type: 'start' | 'end', val: number) => {
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

  const buildAvailabilityCards = useCallback(async () => {
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

    const requestMap: Record<string, any> = {}
    ;(requestData || []).forEach((row: any) => {
      if (row.staff_id && row.date) requestMap[`${row.staff_id}_${row.date}`] = row
    })

    const storeOpen = tToF(storeInfo.open_time)
    const storeClose = tToF(storeInfo.close_time)
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()

    const cards = (staffData || []).map((staff: any) => {
      const days = Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1
        const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const request = requestMap[`${staff.id}_${dateStr}`]
        let isAvailable = true
        let ranges: { start: number; end: number }[] = []
        let source = '通常枠'
        let note = ''

        if (request?.is_off === true) {
          isAvailable = false
          ranges = []
          source = '休み希望'
          note = request.memo || '希望提出'
        } else if (request && (request.start_time || request.end_time)) {
          const start = tToF(request.start_time)
          const end = tToF(request.end_time)
          if (start !== null && end !== null && end > start) {
            ranges = [{ start, end }]
            source = '個別要望'
            note = request.memo || '時間指定'
          }
        } else {
          const candidateRanges: { start: number; end: number }[] = []

          const slot1Start = tToF(staff.work_start_1)
          const slot1End = tToF(staff.work_end_1)
          if (slot1Start && slot1End && slot1End > slot1Start) candidateRanges.push({ start: slot1Start, end: slot1End })

          const slot2Start = tToF(staff.work_start_2)
          const slot2End = tToF(staff.work_end_2)
          if (slot2Start && slot2End && slot2End > slot2Start) candidateRanges.push({ start: slot2Start, end: slot2End })

          if (candidateRanges.length > 0) {
            ranges = candidateRanges
            source = '通常枠'
          } else if (storeOpen && storeClose && storeClose > storeOpen) {
            ranges = [{ start: storeOpen, end: storeClose }]
            source = '店舗営業時間'
          } else {
            isAvailable = false
            ranges = []
            source = '未設定'
            note = '勤務可能時間なし'
          }
        }

        return {
          date: dateStr,
          weekday: weekdayLabel(dateStr),
          isAvailable,
          ranges,
          source,
          note,
        }
      })

      return {
        id: staff.id,
        name: staff.name,
        type: staff.is_employee ? '社員' : 'アルバイト',
        rank: staff.rank || '未設定',
        mainJob: staff.main_job || '未設定',
        weeklyTargetDays: staff.weekly_target_days || 0,
        skills: (staff.skills || '').split(',').map((s: string) => s.trim()).filter(Boolean),
        possibleGroups: (staff.possible_groups || '').split(',').map((s: string) => s.trim()).filter(Boolean),
        workStart1: staff.work_start_1 || null,
        workEnd1: staff.work_end_1 || null,
        workStart2: staff.work_start_2 || null,
        workEnd2: staff.work_end_2 || null,
        days,
      }
    })

    setAvailabilityCards(cards)
  }, [store_id, storeInfo, targetYear, targetMonth])

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      await buildAvailabilityCards()
    } finally {
      setIsGenerating(false)
    }
  }

  if (!storeInfo) return <div className="p-10 text-slate-400">読み込み中...</div>

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-8 flex items-center justify-between rounded-md border border-[var(--border)] bg-white p-5 shadow-sm">
        <button onClick={() => changeMonth(-1)} className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100"><ChevronLeft size={18} /></button>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[var(--text)]">{targetYear}年 {targetMonth}月</h1>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-subtle)]">シフト生成設定</p>
        </div>
        <button onClick={() => changeMonth(1)} className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100"><ChevronRight size={18} /></button>
      </div>

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
                      if (isSelected) setSelectedSpecialDays(prev => prev.filter(d => d !== dateStr))
                      else {
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
            <TabButton key={date} id={date} label={`${parseInt(date.split('-')[2])}日`} active={activeTab} onClick={setActiveTab} color="gray" />
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

      <div className="space-y-12 pb-40">

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

        {availabilityCards.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-white">
            <table className="min-w-full text-[11px]">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left font-bold">氏名</th>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left font-bold">役職</th>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left font-bold">種別</th>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left font-bold">ランク</th>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left font-bold">週希望</th>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left font-bold">スキル</th>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left font-bold">可能グループ</th>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left font-bold">勤務1</th>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left font-bold">勤務2</th>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left font-bold">日付</th>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left font-bold">時間帯</th>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left font-bold">種別</th>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left font-bold">備考</th>
                </tr>
              </thead>
              <tbody>
                {availabilityCards.flatMap((staff) =>
                  staff.days.map((day: any) => (
                    <tr key={`${staff.id}-${day.date}`} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-2 py-2 font-bold text-slate-700">{staff.name}</td>
                      <td className="px-2 py-2 text-slate-600">{staff.mainJob}</td>
                      <td className="px-2 py-2 text-slate-600">{staff.type}</td>
                      <td className="px-2 py-2 text-slate-600">{staff.rank}</td>
                      <td className="px-2 py-2 text-slate-600">{staff.weeklyTargetDays}日</td>
                      <td className="px-2 py-2 text-slate-600">{staff.skills.length > 0 ? staff.skills.join(', ') : '-'}</td>
                      <td className="px-2 py-2 text-slate-600">{staff.possibleGroups.length > 0 ? staff.possibleGroups.join(', ') : '-'}</td>
                      <td className="px-2 py-2 text-slate-600">{staff.workStart1 && staff.workEnd1 ? `${staff.workStart1}-${staff.workEnd1}` : '-'}</td>
                      <td className="px-2 py-2 text-slate-600">{staff.workStart2 && staff.workEnd2 ? `${staff.workStart2}-${staff.workEnd2}` : '-'}</td>
                      <td className="px-2 py-2 text-slate-600">{day.date}</td>
                      <td className="px-2 py-2 text-slate-700">
                        {day.ranges.length > 0
                          ? day.ranges.map((r: any) => `${fToT(r.start)}-${fToT(r.end)}`).join(', ')
                          : '休み'}
                      </td>
                      <td className="px-2 py-2 text-slate-600">{day.isAvailable ? day.source : '休み'}</td>
                      <td className="px-2 py-2 text-slate-500">{day.note || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-50 flex gap-3 border-t border-[var(--border)] bg-white/95 p-4 pb-12 shadow-sm md:left-[268px] md:justify-center">
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