'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'

export default function RequestsPage() {
  const params = useParams()
  const storeId = params.store_id as string
  const [staff, setStaff] = useState<any[]>([])
  const [selectedStaff, setSelectedStaff] = useState<any>(null)
  const [requests, setRequests] = useState<{[key: string]: {is_off: boolean, memo: string}}>({})
  const [activeDate, setActiveDate] = useState<string | null>(null) 
  const [isSaving, setIsSaving] = useState(false)
  const [allRequests, setAllRequests] = useState<any[]>([])
  const [showOverview, setShowOverview] = useState(true) // 閲覧時は最初から表示

  // --- ★追加：表示対象の年月を管理する状態 ---
  const now = new Date()
  // 初期表示は「来月」に設定
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth() + 1, 1))

  const targetYear = viewDate.getFullYear()
  const targetMonth = viewDate.getMonth() + 1
  
  // 今月・来月の判定用（過去月かどうか）
  const entryMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const isReadOnly = viewDate < entryMonthDate

  // カレンダー計算
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  const firstDayOfWeek = new Date(targetYear, targetMonth - 1, 1).getDay()
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const emptySlots = Array.from({ length: firstDayOfWeek }, (_, i) => i)

  // 1. スタッフ一覧と「表示中の月」のデータを取得
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
    // viewDateが変わるたびにデータを再取得する
  }, [storeId, viewDate, targetYear, targetMonth, daysInMonth])

  // 2. 個人が選ばれた時の既存データ読み込み
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
        data?.forEach(r => { initialRequests[r.date] = { is_off: r.is_off, memo: r.memo || "" } })
        setRequests(initialRequests)
      }
      fetchRequests()
    }
  }, [selectedStaff, targetYear, targetMonth, daysInMonth])

  const handleDateClick = (dateStr: string) => {
    if (isReadOnly) return // 閲覧専用モードなら何もしない
    setRequests(prev => {
      const current = prev[dateStr] || { is_off: false, memo: "" }
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
        .filter(([_, val]) => val.is_off || val.memo.trim() !== "")
        .map(([date, val]) => ({
          staff_id: selectedStaff.id, store_id: storeId, date: date, is_off: val.is_off, memo: val.memo
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
    worksheet.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0, footer: 0 }
    
    const borderStyle: Partial<ExcelJS.Borders> = {
      top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
    }

    const titleCell = worksheet.getCell('A1')
    titleCell.value = `【${targetYear}年${targetMonth}月】 休み希望・要望 一覧表`
    titleCell.font = { bold: true, size: 18 }
    worksheet.mergeCells(1, 1, 1, daysArray.length + 3)
    
    const headerRow = worksheet.getRow(3)
    headerRow.values = ["名前", ...daysArray.map(d => String(d)), "今月のスタンス", "休み希望数"]
    
    staff.forEach((person, staffIdx) => {
      const currentRow = worksheet.getRow(4 + staffIdx)
      currentRow.height = 45
      currentRow.getCell(1).value = person.name
      daysArray.forEach((day, dayIdx) => {
        const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const req = allRequests.find(r => r.staff_id === person.id && r.date === dateStr)
        const cell = currentRow.getCell(dayIdx + 2)
        let txt = req?.is_off ? "×" : ""
        if (req?.memo) txt += (txt ? "\n" : "") + req.memo
        cell.value = txt
        cell.border = borderStyle
        if (req?.is_off) cell.font = { color: { argb: 'FFFF0000' }, bold: true }
      })
    })

    const buffer = await workbook.xlsx.writeBuffer()
    saveAs(new Blob([buffer]), `${targetMonth}月休み希望_${storeId}.xlsx`)
  }

  // --- 年月切り替え関数 ---
  const changeMonth = (diff: number) => {
    setViewDate(new Date(targetYear, targetMonth - 1 + diff, 1))
    setSelectedStaff(null) // 月を変えたら個人選択をリセット
  }

  // A. 名前選択画面
  if (!selectedStaff) {
    return (
      <div className="p-4 max-w-md mx-auto min-h-screen">
        {/* タイトル & 月切り替えヘッダー */}
        <div className="flex flex-col items-center mb-8 gap-4">
          <h1 className="text-xl md:text-2xl font-black text-gray-800 text-center">
             {targetYear}年 {targetMonth}月<br />
             <span className="text-orange-600">休み希望入力</span>
          </h1>
          
          <div className="flex justify-between w-full items-center gap-2">
            <button 
              onClick={() => changeMonth(-1)}
              className="flex-1 bg-gray-100 text-gray-500 py-2 rounded-xl text-xs font-bold active:bg-gray-200"
            >
              ← {targetMonth === 1 ? 12 : targetMonth - 1}月閲覧
            </button>
            <div className="w-1 h-1 bg-gray-200 rounded-full"></div>
            <button 
              onClick={() => changeMonth(1)}
              className="flex-1 bg-orange-50 text-orange-600 py-2 rounded-xl text-xs font-bold active:bg-orange-100"
            >
              {targetMonth === 12 ? 1 : targetMonth + 1}月へ →
            </button>
          </div>
        </div>

        {/* 過去月ならスタッフボタンを隠して案内を出す */}
        {isReadOnly ? (
          <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 text-center mb-8">
            <p className="text-blue-600 font-bold text-sm">以前の月は閲覧のみ可能です</p>
            <p className="text-blue-400 text-[10px] mt-1">自分のボタンからの編集はできません</p>
          </div>
        ) : (
          <div className="grid gap-3 mb-12">
            {staff.map((p) => (
              <button key={p.id} onClick={() => setSelectedStaff(p)} className="w-full bg-white p-5 rounded-2xl shadow-sm border border-gray-100 font-bold text-gray-700 text-lg flex justify-between items-center active:scale-95 transition-all">
                {p.name}<span className="text-orange-300">→</span>
              </button>
            ))}
          </div>
        )}

        {/* 管理者用エリア */}
        <div className="pt-6 border-t border-gray-100">
          <div className="grid gap-2">
            <button onClick={() => setShowOverview(!showOverview)} className="w-full bg-gray-800 text-white py-3 rounded-xl text-xs font-bold shadow-md">
              {showOverview ? '全体状況を隠す' : '🔍 全体の休み状況を確認'}
            </button>
            <button onClick={exportToExcel} className="w-full bg-green-600 text-white py-3 rounded-xl text-xs font-bold shadow-md">
              📥 {targetMonth}月分をExcel出力
            </button>
          </div>
        </div>

        {showOverview && (
          <div className="mt-8 overflow-x-auto bg-white p-2 rounded-xl shadow-inner border border-gray-50">
            <table className="w-full text-[8px] border-collapse">
              <thead>
                <tr>
                  <th className="border p-1 bg-gray-50 min-w-[35px] sticky left-0 z-10">名前</th>
                  {daysArray.map(d => <th key={d} className="border p-1 bg-gray-50">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {staff.map(p => (
                  <tr key={p.id}>
                    <td className="border p-1 font-bold bg-gray-50 sticky left-0 z-10">{p.name}</td>
                    {daysArray.map(day => {
                      const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                      const req = allRequests.find(r => r.staff_id === p.id && r.date === dateStr)
                      return (
                        <td key={day} className={`border p-1 text-center ${req?.is_off ? 'bg-red-100 text-red-500 font-bold' : ''}`}>
                          {req?.is_off ? '×' : req?.memo ? '●' : ''}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // B. カレンダー画面
  return (
    <div className="p-4 max-w-md mx-auto pb-20">
      <div className="bg-white p-6 rounded-[2.5rem] shadow-2xl border border-orange-50">
        {/* ... (中略: カレンダー表示部分は以前のコードと同様ですが、isReadOnlyでガードを入れています) ... */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-black text-gray-800">{targetMonth}月 <span className="font-normal text-gray-400">希望</span></h1>
            <p className="text-orange-500 font-bold text-xs">👤 {selectedStaff.name} さん</p>
          </div>
          <button onClick={() => setSelectedStaff(null)} className="text-xs bg-gray-100 text-gray-400 px-3 py-1.5 rounded-full font-bold">戻る</button>
        </div>

        {isReadOnly && <p className="text-center text-red-500 font-bold text-xs mb-4">※過去の月のため編集できません</p>}

        <div className="grid grid-cols-7 gap-2 mb-6">
          {['日','月','火','水','木','金','土'].map((d, i) => (
            <div key={d} className={`text-center text-[10px] font-bold ${i===0?'text-red-300':i===6?'text-blue-300':'text-gray-300'}`}>{d}</div>
          ))}
          {emptySlots.map(i => <div key={`empty-${i}`} />)}
          {daysArray.map(day => {
            const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const req = requests[dateStr] || { is_off: false, memo: "" }
            const isActive = activeDate === dateStr
            const weekDay = new Date(targetYear, targetMonth - 1, day).getDay()
            
            return (
              <button
                key={day}
                onClick={() => handleDateClick(dateStr)}
                disabled={isReadOnly}
                className={`h-14 rounded-2xl flex flex-col items-center justify-center relative transition-all duration-200 ${
                  req.is_off 
                    ? 'bg-red-500 text-white shadow-lg z-10 scale-105' 
                    : isActive 
                      ? 'bg-orange-100 ring-2 ring-orange-500' 
                      : 'bg-gray-50 text-gray-700'
                }`}
              >
                <span className={`text-xs font-bold ${!req.is_off && !isActive && weekDay === 0 ? 'text-red-400' : !req.is_off && !isActive && weekDay === 6 ? 'text-blue-400' : ''}`}>
                  {day}
                </span>
                {req.is_off && <span className="text-[8px] font-black">休み</span>}
                {req.memo && !req.is_off && <span className="w-1.5 h-1.5 bg-orange-500 rounded-full mt-1"></span>}
              </button>
            )
          })}
        </div>

        {activeDate && (
          <div className="mb-6 p-4 bg-orange-50 rounded-3xl">
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-black text-orange-700">📍 {parseInt(activeDate.split('-')[2])}日の要望</label>
            </div>
            <textarea
              className="w-full bg-white border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-orange-400 outline-none shadow-inner"
              placeholder={isReadOnly ? "要望はありません" : "例: 18時以降なら可能など"}
              rows={2}
              readOnly={isReadOnly}
              value={requests[activeDate]?.memo || ""}
              onChange={(e) => updateMemo(activeDate, e.target.value)}
            />
          </div>
        )}

        {!isReadOnly && (
          <button 
            onClick={handleSave} 
            disabled={isSaving} 
            className="w-full bg-orange-600 text-white py-5 rounded-[1.5rem] font-black shadow-xl active:scale-95 transition-all disabled:bg-gray-200"
          >
            {isSaving ? '保存中...' : 'この内容で確定保存'}
          </button>
        )}
      </div>
    </div>
  )
}