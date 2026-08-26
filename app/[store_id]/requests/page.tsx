'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'

export default function RequestsPage() {
  const params = useParams()
  const storeId = params.store_id as string
  
  // --- 1. 日付状態の管理 ---
  const now = new Date()
  // デフォルトは「翌月」を表示（例：現在8月なら9月）
  const defaultDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const [viewDate, setViewDate] = useState(defaultDate)

  const [staff, setStaff] = useState<any[]>([])
  const [selectedStaff, setSelectedStaff] = useState<any>(null)
  const [requests, setRequests] = useState<{[key: string]: {is_off: boolean, memo: string}}>({})
  const [activeDate, setActiveDate] = useState<string | null>(null) 
  const [isSaving, setIsSaving] = useState(false)
  const [allRequests, setAllRequests] = useState<any[]>([])
  const [showOverview, setShowOverview] = useState(true) // 初期状態で一覧を見せる設定にしました

  // カレンダー計算用
  const targetYear = viewDate.getFullYear()
  const targetMonth = viewDate.getMonth() + 1
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  const firstDayOfWeek = new Date(targetYear, targetMonth - 1, 1).getDay()
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const emptySlots = Array.from({ length: firstDayOfWeek }, (_, i) => i)

  // 閲覧モードかどうかの判定 (表示月がデフォルトの翌月より前なら閲覧のみ)
  const isPastMonth = viewDate.getTime() < defaultDate.getTime()

  // 月を切り替える関数
  const changeMonth = (offset: number) => {
    const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + offset, 1)
    setViewDate(newDate)
    setSelectedStaff(null) // 月を変えたら選択中のスタッフをリセット
    setActiveDate(null)
  }

  // 2. データの取得 (viewDateが変わるたびに再実行)
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
  }, [storeId, viewDate]) // viewDateを監視

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
  }, [selectedStaff, viewDate])

  const handleDateClick = (dateStr: string) => {
    if (isPastMonth) return // 過去の月なら変更不可
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
    if (isPastMonth) return
    setIsSaving(true)
    try {
      const startOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
      const endOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${daysInMonth}`
      await supabase.from('shift_requests').delete().eq('staff_id', selectedStaff.id).gte('date', startOfMonth).lte('date', endOfMonth)
      const insertData = Object.entries(requests)
        .filter(([_, val]) => val.is_off || val.memo.trim() !== "")
        .map(([date, val]) => ({ staff_id: selectedStaff.id, store_id: storeId, date: date, is_off: val.is_off, memo: val.memo }))
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
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`${targetMonth}月休み希望`);
    const ruleSheetName = `rules_${targetYear}_${String(targetMonth).padStart(2, '0')}`;
    const { data: ruleData } = await supabase.from(ruleSheetName).select('*');
    
    worksheet.pageSetup.orientation = 'landscape';
    worksheet.pageSetup.fitToPage = true;
    worksheet.pageSetup.fitToWidth = 1;
    worksheet.pageSetup.fitToHeight = 1;
    
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `【${targetYear}年${targetMonth}月】 休み希望・要望 一覧表`;
    titleCell.font = { bold: true, size: 18 };
    worksheet.mergeCells(1, 1, 1, daysArray.length + 3);

    const headers = ["名前", ...daysArray.map(d => String(d)), "今月のスタンス", "休み希望数"];
    const headerRow = worksheet.getRow(3);
    headerRow.values = headers;

    staff.forEach((person, staffIdx) => {
      const currentRow = worksheet.getRow(4 + staffIdx);
      currentRow.height = 40;
      currentRow.getCell(1).value = person.name;
      let offCount = 0;
      daysArray.forEach((day, dayIdx) => {
        const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const req = allRequests.find(r => r.staff_id === person.id && r.date === dateStr);
        let cellText = req?.is_off ? "×" : "";
        if (req?.is_off) offCount++;
        if (req?.memo) cellText += (cellText ? "\n" : "") + req.memo;
        currentRow.getCell(dayIdx + 2).value = cellText;
      });
      currentRow.getCell(daysArray.length + 3).value = `${offCount}日`;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `${targetMonth}月休み希望一覧_${storeId}.xlsx`);
  };

  // --- 表示部分 ---
  return (
    <div className="p-4 max-w-4xl mx-auto pb-20">
      {/* タイトルと月切り替えボタン */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-black text-gray-800 mb-4">
          {targetYear}年{targetMonth}月の休み希望入力
          {isPastMonth && <span className="ml-2 text-sm bg-gray-200 text-gray-600 px-2 py-1 rounded">閲覧のみ</span>}
        </h1>
        <div className="flex justify-between items-center bg-white p-2 rounded-2xl shadow-sm border border-orange-50">
          <button onClick={() => changeMonth(-1)} className="px-4 py-2 text-sm font-bold text-orange-600 hover:bg-orange-50 rounded-xl transition-all flex items-center gap-1">
            ← {viewDate.getMonth() === 0 ? 12 : viewDate.getMonth()}月閲覧
          </button>
          <div className="h-4 w-px bg-gray-200"></div>
          <button onClick={() => changeMonth(1)} className="px-4 py-2 text-sm font-bold text-orange-600 hover:bg-orange-50 rounded-xl transition-all flex items-center gap-1">
            {targetMonth === 12 ? 1 : targetMonth + 1}月入力 →
          </button>
        </div>
      </div>

      {/* A. 名前選択画面（閲覧モードの時は非表示） */}
      {!isPastMonth && !selectedStaff && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-10 animate-in fade-in duration-500">
          {staff.map((p) => (
            <button key={p.id} onClick={() => setSelectedStaff(p)} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 font-bold text-gray-700 hover:border-orange-500 hover:bg-orange-50 transition-all text-center">
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* B. カレンダー入力画面 */}
      {selectedStaff && (
        <div className="bg-white p-6 rounded-[2.5rem] shadow-2xl border border-orange-50 mb-10 animate-in slide-in-from-top-4 duration-300">
          <div className="flex justify-between items-center mb-6 border-b pb-4">
            <h2 className="text-xl font-black text-gray-800">👤 {selectedStaff.name} さんの希望</h2>
            <button onClick={() => {setSelectedStaff(null); setActiveDate(null);}} className="text-xs bg-gray-100 text-gray-400 px-3 py-1.5 rounded-full font-bold">閉じる</button>
          </div>

          {/* 曜日表示 */}
          <div className="grid grid-cols-7 gap-2 mb-2 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            {['日','月','火','水','木','金','土'].map((d, i) => (
              <div key={d} className={i===0?'text-red-300':i===6?'text-blue-300':''}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2 mb-6">
            {emptySlots.map(i => <div key={`empty-${i}`} />)}
            {daysArray.map(day => {
              const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const req = requests[dateStr] || { is_off: false, memo: "" }
              const isActive = activeDate === dateStr
              return (
                <button
                  key={day}
                  onClick={() => handleDateClick(dateStr)}
                  className={`h-14 rounded-2xl flex flex-col items-center justify-center relative transition-all duration-200 ${
                    req.is_off ? 'bg-red-500 text-white shadow-lg' : isActive ? 'bg-orange-100 ring-2 ring-orange-500' : 'bg-gray-50'
                  }`}
                >
                  <span className="text-xs font-bold">{day}</span>
                  {req.is_off && <span className="text-[8px] font-black uppercase">Off</span>}
                  {req.memo && !req.is_off && <span className="w-1.5 h-1.5 bg-orange-500 rounded-full mt-1"></span>}
                </button>
              )
            })}
          </div>

          {activeDate && !isPastMonth && (
            <div className="mb-6 p-4 bg-orange-50 rounded-3xl animate-in zoom-in-95 duration-200">
              <label className="text-sm font-black text-orange-700 block mb-2">📍 {parseInt(activeDate.split('-')[2])}日の要望</label>
              <textarea className="w-full bg-white border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-orange-400 outline-none shadow-inner" placeholder="要望を入力..." rows={2} value={requests[activeDate]?.memo || ""} onChange={(e) => updateMemo(activeDate, e.target.value)} />
            </div>
          )}

          {!isPastMonth && (
            <button onClick={handleSave} disabled={isSaving} className="w-full bg-orange-600 text-white py-4 rounded-2xl font-black shadow-xl hover:brightness-110 transition-all">
              {isSaving ? '保存中...' : '確定保存'}
            </button>
          )}
        </div>
      )}

      {/* C. 管理者用メニュー（一覧・Excel） */}
      {!selectedStaff && (
        <div className="space-y-6">
          <div className="flex gap-2">
            <button onClick={() => setShowOverview(!showOverview)} className="flex-1 bg-gray-800 text-white py-4 rounded-2xl text-sm font-bold shadow-lg">
              {showOverview ? '全体表を閉じる' : '🔍 全体の休み状況を確認'}
            </button>
            <button onClick={exportToExcel} className="flex-1 bg-green-600 text-white py-4 rounded-2xl text-sm font-bold shadow-lg">
              📥 Excel出力
            </button>
          </div>

          {showOverview && (
            <div className="overflow-x-auto bg-white p-4 rounded-[2rem] shadow-xl border border-orange-50">
              <table className="w-full text-[10px] border-collapse min-w-[600px]">
                <thead>
                  <tr>
                    <th className="border p-2 bg-gray-50 sticky left-0 z-10">名前</th>
                    {daysArray.map(d => <th key={d} className="border p-1 bg-gray-50">{d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {staff.map(p => (
                    <tr key={p.id}>
                      <td className="border p-2 font-bold bg-gray-50 sticky left-0 z-10">{p.name}</td>
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
      )}
    </div>
  )
}