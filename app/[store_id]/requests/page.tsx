'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'

const HOLIDAY_MAP_2026: Record<string, string> = {
  '2026-01-01': '元日',
  '2026-01-12': '成人の日',
  '2026-02-11': '建国記念の日',
  '2026-02-23': '天皇誕生日',
  '2026-03-21': '春分の日',
  '2026-04-29': '昭和の日',
  '2026-05-03': '憲法記念日',
  '2026-05-04': 'みどりの日',
  '2026-05-05': 'こどもの日',
  '2026-05-06': '振替休日',
  '2026-07-20': '海の日',
  '2026-08-11': '山の日',
  '2026-09-21': '敬老の日',
  '2026-09-22': '国民の休日',
  '2026-09-23': '秋分の日',
  '2026-10-12': 'スポーツの日',
  '2026-11-03': '文化の日',
  '2026-11-23': '勤労感謝の日',
}

const getHolidayMap = (year: number) => {
  const map: Record<string, string> = { ...HOLIDAY_MAP_2026 }
  if (year === 2027) {
    Object.assign(map, {
      '2027-01-01': '元日',
      '2027-01-11': '成人の日',
      '2027-02-11': '建国記念の日',
      '2027-02-23': '天皇誕生日',
      '2027-03-21': '春分の日',
      '2027-04-29': '昭和の日',
      '2027-05-03': '憲法記念日',
      '2027-05-04': 'みどりの日',
      '2027-05-05': 'こどもの日',
      '2027-07-19': '海の日',
      '2027-08-11': '山の日',
      '2027-09-20': '敬老の日',
      '2027-09-23': '秋分の日',
      '2027-10-11': 'スポーツの日',
      '2027-11-03': '文化の日',
      '2027-11-23': '勤労感謝の日',
    })
  }
  return map
}

const getDateKind = (dateStr: string, year: number) => {
  const holidayMap = getHolidayMap(year)
  const date = new Date(`${dateStr}T00:00:00`)
  const weekday = date.getDay()
  if (holidayMap[dateStr]) return 'holiday'
  if (weekday === 0) return 'sunday'
  if (weekday === 6) return 'saturday'
  return 'weekday'
}

const excelCellBorder = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
} as any

const toColumnName = (index: number) => {
  let column = ''
  let current = index
  while (current > 0) {
    const remainder = (current - 1) % 26
    column = String.fromCharCode(65 + remainder) + column
    current = Math.floor((current - 1) / 26)
  }
  return column
}

export default function RequestsPage() {
  const params = useParams()
  const storeId = params.store_id as string
  const [staff, setStaff] = useState<any[]>([])
  const [selectedStaff, setSelectedStaff] = useState<any>(null)
  const [requests, setRequests] = useState<{[key: string]: {is_off: boolean, memo: string}}>({})
  const [activeDate, setActiveDate] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [allRequests, setAllRequests] = useState<any[]>([])
  const [ruleMap, setRuleMap] = useState<Record<string, string>>({})
  const [showOverview, setShowOverview] = useState(true)

  const now = new Date()
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth() + 1, 1))

  const targetYear = viewDate.getFullYear()
  const targetMonth = viewDate.getMonth() + 1

  const entryMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const isReadOnly = viewDate < entryMonthDate

  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  const firstDayOfWeek = new Date(targetYear, targetMonth - 1, 1).getDay()
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const emptySlots = Array.from({ length: firstDayOfWeek }, (_, i) => i)

  useEffect(() => {
    const fetchInitialData = async () => {
      if (!storeId) return
      const { data: staffData } = await supabase.from('staff').select('id, name').eq('store_id', storeId).order('name')
      setStaff(staffData || [])

      const startOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
      const endOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${daysInMonth}`

      const { data: reqData } = await supabase
        .from('shift_requests')
        .select('*')
        .eq('store_id', storeId)
        .gte('date', startOfMonth)
        .lte('date', endOfMonth)
      setAllRequests(reqData || [])
    }
    fetchInitialData()
  }, [storeId, viewDate, targetYear, targetMonth, daysInMonth])

  useEffect(() => {
    const fetchRuleMap = async () => {
      if (!storeId) return
      const tableName = `rules_${targetYear}_${String(targetMonth).padStart(2, '0')}`

      try {
        const { data, error } = await supabase.from(tableName).select('*')
        if (error) {
          if (!/does not exist|not found/i.test(error.message)) {
            console.warn('rules table load failed:', error.message)
          }
          setRuleMap({})
          return
        }

        const nextMap: Record<string, string> = {}
        ;(data || []).forEach((row: Record<string, any>) => {
          const staffId = row.staff_id ?? row.staffId ?? row.id
          if (staffId == null) return
          const candidate = row.stance ?? row.rule ?? row.rule_text ?? row.memo ?? row.note ?? row.text ?? row.content ?? ''
          nextMap[String(staffId)] = String(candidate || '未設定')
        })
        setRuleMap(nextMap)
      } catch (error) {
        console.warn('rules table unavailable:', error)
        setRuleMap({})
      }
    }

    fetchRuleMap()
  }, [storeId, targetYear, targetMonth])

  useEffect(() => {
    if (selectedStaff) {
      const fetchRequests = async () => {
        const startOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
        const endOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${daysInMonth}`
        const { data } = await supabase
          .from('shift_requests')
          .select('date, is_off, memo')
          .eq('staff_id', selectedStaff.id)
          .gte('date', startOfMonth)
          .lte('date', endOfMonth)
        const initialRequests: any = {}
        data?.forEach(r => { initialRequests[r.date] = { is_off: r.is_off, memo: r.memo || '' } })
        setRequests(initialRequests)
      }
      fetchRequests()
    }
  }, [selectedStaff, targetYear, targetMonth, daysInMonth])

  const handleDateClick = (dateStr: string) => {
    if (isReadOnly) return
    setRequests(prev => {
      const current = prev[dateStr] || { is_off: false, memo: '' }
      return { ...prev, [dateStr]: { is_off: !current.is_off, memo: current.memo } }
    })
    setActiveDate(dateStr)
  }

  const updateMemo = (dateStr: string, text: string) => {
    setRequests(prev => ({ ...prev, [dateStr]: { is_off: prev[dateStr]?.is_off || false, memo: text } }))
  }

  const handleSave = async () => {
    if (isReadOnly) return
    setIsSaving(true)
    try {
      const startOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
      const endOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${daysInMonth}`
      await supabase.from('shift_requests').delete().eq('staff_id', selectedStaff.id).gte('date', startOfMonth).lte('date', endOfMonth)
      const insertData = Object.entries(requests)
        .filter(([_, val]) => val.is_off || val.memo.trim() !== '')
        .map(([date, val]) => ({
          staff_id: selectedStaff.id, store_id: storeId, date: date, is_off: val.is_off, memo: val.memo,
        }))
      if (insertData.length > 0) {
        const { error } = await supabase.from('shift_requests').insert(insertData)
        if (error) throw error
      }
      alert('保存しました！')
      window.location.reload()
    } catch (err: any) {
      alert('保存失敗: ' + err.message)
    } finally { setIsSaving(false) }
  }

  const exportToExcel = async () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet(`${targetMonth}月休み希望`)
    worksheet.pageSetup.orientation = 'landscape'
    worksheet.pageSetup.fitToPage = true
    worksheet.pageSetup.fitToWidth = 1
    worksheet.pageSetup.fitToHeight = 1
    worksheet.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0, footer: 0 }

    const titleCell = worksheet.getCell('A1')
    titleCell.value = `【${targetYear}年${targetMonth}月】 休み希望・要望 一覧表`
    titleCell.font = { bold: true, size: 18 }
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
    worksheet.mergeCells(1, 1, 1, daysArray.length + 2)

    const headerRow = worksheet.getRow(3)
    headerRow.values = ['名前', ...daysArray.map(d => String(d)), '休み希望数']
    headerRow.height = 24
    headerRow.font = { bold: true, size: 10 }
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' }

    worksheet.getColumn(1).width = 12
    worksheet.getColumn(daysArray.length + 2).width = 12
    for (let i = 0; i < daysArray.length; i += 1) {
      worksheet.getColumn(i + 2).width = 5.2
    }

    staff.forEach((person, staffIdx) => {
      const currentRow = worksheet.getRow(4 + staffIdx)
      currentRow.height = 48
      currentRow.getCell(1).value = person.name
      currentRow.getCell(1).font = { bold: true, size: 11 }
      currentRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' }
      currentRow.getCell(1).border = excelCellBorder as any

      const staffOffCount = allRequests.filter(r => r.staff_id === person.id && r.is_off).length

      daysArray.forEach((day, dayIdx) => {
        const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const req = allRequests.find(r => r.staff_id === person.id && r.date === dateStr)
        const cell = currentRow.getCell(dayIdx + 2)
        const dateKind = getDateKind(dateStr, targetYear)
        const isOff = Boolean(req?.is_off)
        const memoText = (req?.memo || '').trim()

        cell.border = excelCellBorder as any
        cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }

        if (isOff) {
          const offText = memoText ? `✖\n${memoText}` : '✖'
          cell.value = offText
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } }
          cell.font = { bold: true, size: 9, color: { argb: 'FFFF0000' } }
          cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }
        } else {
          cell.value = memoText ? `●\n${memoText}` : ''
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
          cell.font = { color: { argb: 'FF333333' }, size: 7 }
          if (memoText) {
            cell.font = { ...cell.font, bold: true }
          }
        }
      })

      const countCell = currentRow.getCell(daysArray.length + 2)
      countCell.value = `${staffOffCount}日`
      countCell.border = excelCellBorder as any
      countCell.alignment = { vertical: 'middle', horizontal: 'center' }
      countCell.font = { bold: true, size: 11 }
      countCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
    })

    for (let col = 1; col <= headerRow.cellCount; col += 1) {
      const cell = headerRow.getCell(col)
      cell.border = excelCellBorder as any
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
      if (col >= 2 && col <= daysArray.length + 1) {
        const day = col - 1
        const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const dateKind = getDateKind(dateStr, targetYear)
        if (dateKind === 'holiday' || dateKind === 'sunday') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } }
          cell.font = { bold: true, color: { argb: 'FFFF0000' }, size: 10 }
        } else if (dateKind === 'saturday') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } }
          cell.font = { bold: true, color: { argb: 'FF0000FF' }, size: 10 }
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } }
          cell.font = { bold: true, color: { argb: 'FF333333' }, size: 10 }
        }
      }
      if (col === daysArray.length + 2) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
        cell.font = { bold: true, color: { argb: 'FF111827' }, size: 10 }
      }
    }

    worksheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
    worksheet.getCell('A3').font = { bold: true, size: 10 }
    worksheet.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' }

    const lastColumn = toColumnName(daysArray.length + 2)
    worksheet.getCell(`${lastColumn}1`).font = { bold: true }

    const buffer = await workbook.xlsx.writeBuffer()
    saveAs(new Blob([buffer]), `${targetMonth}月休み希望_${storeId}.xlsx`)
  }

  const changeMonth = (diff: number) => {
    setViewDate(new Date(targetYear, targetMonth - 1 + diff, 1))
    setSelectedStaff(null)
  }

  if (!selectedStaff) {
    return (
      <div className="mx-auto w-full max-w-md min-h-screen px-2 py-4">
        <div className="mb-8 flex flex-col items-center gap-4">
          <div className="text-center">
            <p className="mb-1 text-lg font-bold text-[var(--text-muted)]">{targetYear}年</p>
            <h1 className="text-3xl font-bold leading-tight text-[var(--text)]">
              {targetMonth}月 <span className="text-[var(--primary)]">休み希望入力</span>
            </h1>
          </div>

          <div className="flex w-full items-center justify-between gap-3 px-2">
            <button onClick={() => changeMonth(-1)} className="flex-1 rounded-md border border-[var(--border)] bg-white px-3 py-3 text-xs font-bold text-[var(--text-muted)]">
              ← {targetMonth === 1 ? 12 : targetMonth - 1}月閲覧
            </button>
            <button onClick={() => changeMonth(1)} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-3 text-xs font-bold text-[var(--primary-strong)]">
              {targetMonth === 12 ? 1 : targetMonth + 1}月へ →
            </button>
          </div>
        </div>

        {isReadOnly ? (
          <div className="mx-2 mb-8 rounded-md border border-slate-200 bg-slate-50 p-8 text-center">
            <p className="font-bold text-slate-700">閲覧のみ可能です</p>
            <p className="mt-2 text-xs text-slate-500">以前の月は編集できません</p>
          </div>
        ) : (
          <div className="mb-12 grid gap-3 px-2">
            {staff.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedStaff(p)}
                className="flex w-full items-center justify-between rounded-md border border-[var(--border)] bg-white p-5 text-left text-xl font-bold text-[var(--text)] transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                {p.name}
                <span className="text-slate-400">→</span>
              </button>
            ))}
          </div>
        )}

        <div className="border-t border-[var(--border)] px-2 pt-8">
          <div className="grid gap-3">
            <button onClick={() => setShowOverview(!showOverview)} className="w-full rounded-md bg-slate-800 px-4 py-4 text-sm font-bold text-white">
              {showOverview ? '全体状況を隠す' : '全体の状況を確認'}
            </button>
            <button onClick={exportToExcel} className="w-full rounded-md bg-[var(--primary)] px-4 py-4 text-sm font-bold text-white">
              {targetMonth}月分をExcel出力
            </button>
          </div>
        </div>

        {showOverview && (
          <div className="mt-8 overflow-x-auto rounded-md border border-[var(--border)] bg-white p-2">
            <table className="w-full border-collapse text-[8px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-[42px] border border-[var(--border)] bg-slate-50 p-1 font-bold text-slate-700">名前</th>
                  {daysArray.map(day => {
                    const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                    const dateKind = getDateKind(dateStr, targetYear)
                    const headerClass = dateKind === 'holiday' || dateKind === 'sunday'
                      ? 'border border-red-200 bg-red-50 text-red-700'
                      : dateKind === 'saturday'
                        ? 'border border-blue-200 bg-blue-50 text-blue-700'
                        : 'border border-slate-200 bg-slate-50 text-slate-600'
                    return (
                      <th key={day} className={`min-w-[18px] p-1 text-center font-bold ${headerClass}`}>{day}</th>
                    )
                  })}
                  <th className="min-w-[42px] border border-slate-200 bg-slate-50 p-1 font-bold text-slate-700">休み希望数</th>
                </tr>
              </thead>
              <tbody>
                {staff.map(p => {
                  const offCount = allRequests.filter(r => r.staff_id === p.id && r.is_off).length
                  return (
                    <tr key={p.id}>
                      <td className="sticky left-0 z-10 border border-[var(--border)] bg-slate-50 p-1 font-bold text-slate-700">{p.name}</td>
                      {daysArray.map(day => {
                        const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                        const req = allRequests.find(r => r.staff_id === p.id && r.date === dateStr)
                        const dateKind = getDateKind(dateStr, targetYear)
                        const isOff = Boolean(req?.is_off)
                        const hasMemo = Boolean((req?.memo || '').trim())

                        const baseCell = 'border border-slate-200 bg-white text-slate-500'
                        const offCell = 'border border-red-200 bg-red-100 text-red-600 font-bold'

                        return (
                          <td key={day} className={`min-w-[18px] p-1 text-center align-middle ${isOff ? offCell : baseCell}`}>
                            {isOff ? (
                              <span className="inline-flex h-4 w-4 items-center justify-center text-[9px] font-bold leading-none">✖</span>
                            ) : hasMemo ? (
                              <div className="flex flex-col items-center justify-center leading-none">
                                <span className="text-[7px] font-bold text-amber-600">●</span>
                                <span className="mt-0.5 max-w-[12px] break-words text-[5.5px] font-medium text-amber-700">{(req.memo || '').slice(0, 7)}</span>
                              </div>
                            ) : ''}
                          </td>
                        )
                      })}
                      <td className="border border-slate-200 bg-slate-50 p-1 text-center font-bold text-slate-700">
                        {offCount}日
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md p-4 pb-20">
      <div className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text)]">{targetMonth}月 <span className="font-normal text-[var(--text-subtle)]">希望</span></h1>
            <p className="text-xs font-bold text-[var(--primary-strong)]">{selectedStaff.name} さん</p>
          </div>
          <button onClick={() => setSelectedStaff(null)} className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">戻る</button>
        </div>

        {isReadOnly && <p className="mb-4 text-center text-xs font-bold text-red-700">※過去の月のため編集できません</p>}

        <div className="mb-6 grid grid-cols-7 gap-2">
          {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
            <div key={d} className={`text-center text-[10px] font-bold ${i === 0 ? 'text-red-600' : i === 6 ? 'text-sky-600' : 'text-slate-500'}`}>{d}</div>
          ))}
          {emptySlots.map(i => <div key={`empty-${i}`} />)}
          {daysArray.map(day => {
            const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const req = requests[dateStr] || { is_off: false, memo: '' }
            const isActive = activeDate === dateStr
            const weekDay = new Date(targetYear, targetMonth - 1, day).getDay()

            return (
              <button
                key={day}
                onClick={() => handleDateClick(dateStr)}
                disabled={isReadOnly}
                className={`relative flex h-14 flex-col items-center justify-center rounded-md border transition-colors ${
                  req.is_off ? 'border-red-200 bg-red-600 text-white' : isActive ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-[var(--border)] bg-white text-[var(--text)] hover:border-slate-300'
                }`}
              >
                <span className={`text-xs font-bold ${!req.is_off && !isActive && weekDay === 0 ? 'text-red-600' : !req.is_off && !isActive && weekDay === 6 ? 'text-sky-600' : ''}`}>
                  {day}
                </span>
                {req.is_off && <span className="mt-0.5 text-[8px] font-bold">休み</span>}
                {req.memo && !req.is_off && <span className="mt-1 h-1.5 w-1.5 rounded-full bg-orange-500" />}
              </button>
            )
          })}
        </div>

        {activeDate && (
          <div className="mb-6 rounded-md border border-[var(--border)] bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-bold text-slate-700">{parseInt(activeDate.split('-')[2])}日の要望</label>
            </div>
            <textarea
              className="w-full min-h-[88px] resize-none rounded-md border border-[var(--border)] bg-white p-3 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
              placeholder={isReadOnly ? '要望はありません' : '例: 18時以降なら可能など'}
              rows={2}
              readOnly={isReadOnly}
              value={requests[activeDate]?.memo || ''}
              onChange={(e) => updateMemo(activeDate, e.target.value)}
            />
          </div>
        )}

        {!isReadOnly && (
          <button onClick={handleSave} disabled={isSaving} className="w-full rounded-md bg-[var(--primary)] px-4 py-3.5 text-base font-bold text-white transition-colors hover:bg-[var(--primary-strong)] disabled:bg-slate-300">
            {isSaving ? '保存中...' : 'この内容で確定保存'}
          </button>
        )}
      </div>
    </div>
  )
}