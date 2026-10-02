'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { useAdmin } from '@/context/AdminContext'

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
  const { currentStaff, isEmployee } = useAdmin()
  const [staff, setStaff] = useState<any[]>([])
  const selectedStaff = currentStaff
  const [requests, setRequests] = useState<{[key: string]: {is_off: boolean, memo: string}}>({})
  const [activeDate, setActiveDate] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [allRequests, setAllRequests] = useState<any[]>([])
  const [ruleMap, setRuleMap] = useState<Record<string, string>>({})

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
      const { data: staffData } = await supabase.from('staff').select('id, name, is_employee').eq('store_id', storeId).order('name')
      setStaff((staffData || []).sort((left, right) =>
        Number(Boolean(right.is_employee)) - Number(Boolean(left.is_employee)) || left.name.localeCompare(right.name, 'ja')
      ))

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
    if (isReadOnly || !selectedStaff) return
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
  }

  if (!selectedStaff) {
    return <div className="p-8 text-center text-sm text-slate-500">ログイン情報を読み込んでいます...</div>
  }

  return (
    <div className="mx-auto max-w-[1600px] p-4 pb-20 md:p-8">
      <div className="mx-auto mb-8 max-w-md rounded-lg border border-[var(--border)] bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text)]">{targetMonth}月 <span className="font-normal text-[var(--text-subtle)]">希望</span></h1>
            <p className="text-xs font-bold text-[var(--primary-strong)]">{selectedStaff.name} さん</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => changeMonth(-1)} aria-label="前月" className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-50">←</button>
            <button type="button" onClick={() => changeMonth(1)} aria-label="翌月" className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-50">→</button>
            {isEmployee && <button onClick={exportToExcel} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Excel</button>}
          </div>
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

      <section className="mt-8 border-t border-slate-200 pt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">店舗全体の休み希望状況</h2>
            <p className="mt-1 text-xs text-slate-500">{targetYear}年{targetMonth}月</p>
          </div>
          <button type="button" onClick={exportToExcel} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">休み希望をExcel出力</button>
        </div>

        <div className="touch-pan-x overscroll-x-contain overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-max min-w-full table-fixed border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 w-[112px] min-w-[112px] border border-slate-200 bg-slate-50 px-2 py-2 text-left font-semibold text-slate-700">スタッフ名</th>
                {daysArray.map(day => {
                  const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                  const dateKind = getDateKind(dateStr, targetYear)
                  const headerClass = dateKind === 'holiday' || dateKind === 'sunday'
                    ? 'bg-red-50/40 text-red-600'
                    : dateKind === 'saturday'
                      ? 'bg-blue-50/40 text-blue-600'
                      : 'bg-slate-50 text-slate-600'
                  return <th key={dateStr} title={getHolidayMap(targetYear)[dateStr]} className={`w-9 min-w-[36px] border border-slate-200 px-1 py-2 text-center font-semibold ${headerClass}`}>{day}</th>
                })}
                <th className="w-[76px] min-w-[76px] border border-slate-200 bg-slate-50 px-2 py-2 text-right font-semibold text-slate-700">希望日数</th>
              </tr>
            </thead>
            <tbody>
              {staff.map(person => {
                const isCurrentStaff = person.id === selectedStaff.id
                const offCount = allRequests.filter(request => request.staff_id === person.id && request.is_off).length
                return (
                  <tr key={person.id} className={isCurrentStaff ? 'bg-amber-50/50' : 'bg-white'}>
                    <th scope="row" className={`sticky left-0 z-10 w-[112px] min-w-[112px] border border-slate-200 px-2 py-2 text-left font-medium ${isCurrentStaff ? 'bg-amber-50/50' : 'bg-white'} text-slate-800`}>
                      <span className="block max-w-[104px] truncate">{person.name}</span>
                    </th>
                    {daysArray.map(day => {
                      const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                      const request = allRequests.find(row => row.staff_id === person.id && row.date === dateStr)
                      const isOff = Boolean(request?.is_off)
                      const hasMemo = Boolean((request?.memo || '').trim())
                      const dateKind = getDateKind(dateStr, targetYear)
                      const dateTint = dateKind === 'holiday' || dateKind === 'sunday'
                        ? 'bg-red-50/20'
                        : dateKind === 'saturday'
                          ? 'bg-blue-50/20'
                          : ''
                      return (
                        <td key={dateStr} title={(request?.memo || '').trim() || undefined} className={`w-9 min-w-[36px] border border-slate-200 px-1 py-2 text-center ${isOff ? 'bg-red-50 font-semibold text-red-600' : `${dateTint} ${isCurrentStaff ? 'bg-amber-50/50' : 'bg-white'} text-slate-500`}`}>
                          {isOff ? '×' : hasMemo ? <span className="font-bold text-amber-600" aria-label="メモあり">•</span> : ''}
                        </td>
                      )
                    })}
                    <td className={`border border-slate-200 px-2 py-2 text-right font-medium tabular-nums ${isCurrentStaff ? 'bg-amber-50/50 text-slate-900' : 'bg-slate-50/60 text-slate-700'}`}>{offCount}日</td>
                  </tr>
                )
              })}
              {staff.length === 0 && <tr><td colSpan={daysArray.length + 2} className="px-4 py-8 text-center text-sm text-slate-500">スタッフ情報がありません。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}