'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'

export default function RequestsPage() {
  const params = useParams()
  const storeId = params.store_id as string

  // --- 状態管理 ---
  const [staff, setStaff] = useState<any[]>([])
  const [selectedStaff, setSelectedStaff] = useState<any>(null)
  const [requests, setRequests] = useState<{[key: string]: {is_off: boolean, memo: string}}>({})
  const [activeDate, setActiveDate] = useState<string | null>(null) 
  const [isSaving, setIsSaving] = useState(false)
  const [allRequests, setAllRequests] = useState<any[]>([])
  const [showOverview, setShowOverview] = useState(false)

  // --- ★追加：表示月の管理 ---
  const now = new Date()
  // 初期表示は「来月」に設定
  const defaultMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const [viewDate, setViewDate] = useState(defaultMonth)

  const targetYear = viewDate.getFullYear()
  const targetMonth = viewDate.getMonth() + 1
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  const firstDayOfWeek = new Date(targetYear, targetMonth - 1, 1).getDay()
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const emptySlots = Array.from({ length: firstDayOfWeek }, (_, i) => i)

  // 今月より前の月かどうかの判定（閲覧専用フラグ）
  const isReadOnly = viewDate <= new Date(now.getFullYear(), now.getMonth(), 1)

  // 月を切り替える関数
  const changeMonth = (offset: number) => {
    const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + offset, 1)
    setViewDate(newDate)
    setSelectedStaff(null) // 月を変えたら選択をリセット
    setActiveDate(null)
  }

  // データ取得（viewDateが変わるたびに再実行）
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
  }, [storeId, viewDate]) // viewDateを監視対象に追加

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
    if (isReadOnly) {
      setActiveDate(dateStr) // 閲覧モードでもメモは見れるようにする
      return
    }
    setRequests(prev => {
      const current = prev[dateStr] || { is_off: false, memo: "" }
      return { ...prev, [dateStr]: { is_off: !current.is_off, memo: current.memo } }
    })
    setActiveDate(dateStr)
  }

  const updateMemo = (dateStr: string, text: string) => {
    if (isReadOnly) return
    setRequests(prev => ({ ...prev, [dateStr]: { is_off: prev[dateStr]?.is_off || false, memo: text } }))
  }

  const handleSave = async () => {
    if (isReadOnly) return
    setIsSaving(true)
    try {
      const startOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
      const endOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${daysInMonth}`
      await supabase.from('shift_requests').delete().eq('staff_id', selectedStaff.id).gte('date', startOfMonth).lte('date', endOfMonth)
      const insertData = Object.entries(requests).filter(([_, val]) => val.is_off || val.memo.trim() !== "").map(([date, val]) => ({
        staff_id: selectedStaff.id, store_id: storeId, date: date, is_off: val.is_off, memo: val.memo
      }))
      if (insertData.length > 0) {
        const { error } = await supabase.from('shift_requests').insert(insertData)
        if (error) throw error
      }
      alert('保存しました！')
      setSelectedStaff(null) // 保存後に一覧へ戻る
    } catch (err: any) {
      alert('保存失敗: ' + err.message)
    } finally {
      setIsSaving(false)
    }
  }

  const exportToExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`${targetMonth}月休み希望`);
    worksheet.pageSetup.orientation = 'landscape';
    worksheet.pageSetup.fitToPage = true;
    worksheet.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0, footer: 0 };

    const titleCell = worksheet.getCell('A1');
    titleCell.value = `【${targetYear}年${targetMonth}月】 休み希望一覧`;
    titleCell.font = { bold: true, size: 16 };
    worksheet.mergeCells(1, 1, 1, daysArray.length + 2);

    const headerRow = worksheet.getRow(3);
    const headers = ["名前", ...daysArray.map(d => String(d)), "合計"];
    headerRow.values = headers;

    staff.forEach((person, staffIdx) => {
      const currentRow = worksheet.getRow(4 + staffIdx);
      currentRow.getCell(1).value = person.name;
      let count = 0;
      daysArray.forEach((day, dayIdx) => {
        const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const req = allRequests.find(r => r.staff_id === person.id && r.date === dateStr);
        if (req?.is_off) {
          currentRow.getCell(dayIdx + 2).value = "×";
          count++;
        }
        if (req?.memo) currentRow.getCell(dayIdx + 2).value = (req.is_off ? "×\n" : "") + req.memo;
      });
      currentRow.getCell(daysArray.length + 2).value = count;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `${targetMonth}月希望_${storeId}.xlsx`);
  };

  // --- A. 名前選択 / 全体閲覧画面 ---
  if (!selectedStaff) {
    return (
      <div className="p-4 max-w-md mx-auto min-h-screen pb-24">
        {/* 月切り替えヘッダー */}
        <div className="flex justify-between items-center mb-8 bg-white p-4 rounded-3xl shadow-sm border border-orange-50">
          <button onClick={() => changeMonth(-1)} className="text-[10px] font-bold text-gray-400 bg-gray-50 px-3 py-2 rounded-2xl hover:bg-gray-100">
            ◀ {targetMonth === 1 ? 12 : targetMonth - 1}月
          </button>
          <h1 className="text-xl font-black text-gray-800 text-center leading-tight">
            {targetYear}年<br/><span className="text-orange-600 text-2xl">{targetMonth}月</span>
          </h1>
          <button onClick={() => changeMonth(1)} className="text-[10px] font-bold text-orange-400 bg-orange-50 px-3 py-2 rounded-2xl hover:bg-orange-100">
            {targetMonth === 12 ? 1 : targetMonth + 1}月 ▶
          </button>
        </div>

        <h2 className="text-center font-bold text-gray-500 mb-6 flex items-center justify-center gap-2">
           {isReadOnly ? '🔒 過去月の閲覧モード' : '✏️ 休み希望の入力'}
        </h2>
        
        {/* 閲覧専用モードなら最初から一覧表を出す */}
        {isReadOnly ? (
          <div className="animate-in fade-in duration-500">
             <p className="text-[10px] text-center text-gray-400 mb-4">過去のデータは修正できません</p>
             {/* 簡易テーブルをここに表示 */}
             <div className="overflow-x-auto bg-white p-2 rounded-2xl shadow-inner border border-gray-100">
                <table className="w-full text-[9px] border-collapse">
                  <thead>
                    <tr>
                      <th className="border p-1 bg-gray-50 min-w-[40px]">名前</th>
                      {daysArray.map(d => <th key={d} className="border p-1 bg-gray-50">{d}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map(p => (
                      <tr key={p.id}>
                        <td className="border p-1 font-bold bg-gray-50">{p.name}</td>
                        {daysArray.map(day => {
                          const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                          const req = allRequests.find(r => r.staff_id === p.id && r.date === dateStr)
                          return <td key={day} className={`border p-1 text-center ${req?.is_off ? 'bg-red-50 text-red-500 font-bold' : ''}`}>{req?.is_off ? '×' : req?.memo ? '●' : ''}</td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
             <button onClick={exportToExcel} className="w-full mt-6 bg-green-600 text-white py-4 rounded-2xl text-sm font-bold shadow-lg">
                📥 この月の希望をExcelで保存
             </button>
          </div>
        ) : (
          /* 入力可能モードなら個人の名前ボタンを出す */
          <div className="grid gap-2 animate-in slide-in-from-bottom-4 duration-500">
            {staff.map((p) => (
              <button key={p.id} onClick={() => setSelectedStaff(p)} className="w-full bg-white p-5 rounded-2xl shadow-sm border border-gray-100 font-bold text-gray-700 flex justify-between items-center active:scale-95 transition-all">
                {p.name}<span className="text-orange-300">→</span>
              </button>
            ))}
            <div className="mt-10 pt-10 border-t border-gray-100">
               <button onClick={() => setShowOverview(!showOverview)} className="w-full bg-gray-800 text-white py-4 rounded-2xl text-xs font-bold opacity-80 mb-2">
                 {showOverview ? '閉じる' : '🔍 全体の状況をプレビュー'}
               </button>
               {showOverview && (
                 <div className="overflow-x-auto bg-white p-2 rounded-xl mt-2 border text-[8px]">
                    {/* (簡易テーブル：isReadOnly時と同じなので省略可) */}
                    <table>...</table>
                 </div>
               )}
               <button onClick={exportToExcel} className="w-full bg-green-600 text-white py-4 rounded-2xl text-sm font-bold">📥 Excel出力</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // --- B. カレンダー画面（閲覧時は保存ボタン非表示） ---
  return (
    <div className="p-4 max-w-md mx-auto pb-24">
      <div className="bg-white p-6 rounded-[2.5rem] shadow-2xl border border-orange-50">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-black text-gray-800">{targetMonth}月 <span className="font-normal text-gray-400">希望</span></h1>
            <p className="text-orange-500 font-bold text-xs">👤 {selectedStaff.name} さん</p>
          </div>
          <button onClick={() => setSelectedStaff(null)} className="text-xs bg-gray-100 text-gray-400 px-3 py-1.5 rounded-full font-bold">戻る</button>
        </div>

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
                className={`h-14 rounded-2xl flex flex-col items-center justify-center relative transition-all duration-200 ${
                  req.is_off ? 'bg-red-500 text-white z-10 scale-105 shadow-lg' : isActive ? 'bg-orange-100 ring-2 ring-orange-500' : 'bg-gray-50 text-gray-700'
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
          <div className="mb-6 p-4 bg-orange-50 rounded-3xl animate-in fade-in slide-in-from-bottom-2">
            <label className="text-sm font-black text-orange-700 block mb-2">📍 {parseInt(activeDate.split('-')[2])}日の要望</label>
            <textarea
              disabled={isReadOnly}
              className="w-full bg-white border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-orange-400 outline-none shadow-inner disabled:opacity-50"
              placeholder={isReadOnly ? "閲覧のみです" : "例: 18時以降なら可能"}
              rows={2}
              value={requests[activeDate]?.memo || ""}
              onChange={(e) => updateMemo(activeDate, e.target.value)}
            />
          </div>
        )}

        {!isReadOnly && (
          <button onClick={handleSave} disabled={isSaving} className="w-full bg-orange-600 text-white py-5 rounded-[1.5rem] font-black shadow-xl shadow-orange-200 active:scale-95 transition-all disabled:bg-gray-200">
            {isSaving ? '保存中...' : 'この内容で確定保存'}
          </button>
        )}
      </div>
    </div>
  )
}