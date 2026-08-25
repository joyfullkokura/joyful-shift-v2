'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'

export default function RequestsPage() {
  const params = useParams()
  const storeId = params.store_id as string
  const [staff, setStaff] = useState<any[]>([])
  const [selectedStaff, setSelectedStaff] = useState<any>(null)
  
  // 状態管理：日付(YYYY-MM-DD)をキーにする
  const [requests, setRequests] = useState<{[key: string]: {is_off: boolean, memo: string}}>({})
  const [activeDate, setActiveDate] = useState<string | null>(null) 
  const [isSaving, setIsSaving] = useState(false)

  // カレンダー計算
  const now = new Date()
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const targetYear = nextMonthDate.getFullYear()
  const targetMonth = nextMonthDate.getMonth() + 1
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  const firstDayOfWeek = new Date(targetYear, targetMonth - 1, 1).getDay()
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const emptySlots = Array.from({ length: firstDayOfWeek }, (_, i) => i)

  // スタッフ取得
  useEffect(() => {
    const fetchStaff = async () => {
      const { data } = await supabase.from('staff').select('id, name').eq('store_id', storeId).order('name')
      setStaff(data || [])
    }
    if (storeId) fetchStaff()
  }, [storeId])

  // 既存データ読み込み（修正済み）
  useEffect(() => {
    if (selectedStaff) {
      const fetchRequests = async () => {
        const { data } = await supabase
          .from('shift_requests')
          .select('date, is_off, memo')
          .eq('staff_id', selectedStaff.id)
        
        const initialRequests: any = {}
        data?.forEach(r => {
          // r.date（DBの日付）をキーにして格納
          initialRequests[r.date] = { is_off: r.is_off, memo: r.memo || "" }
        })
        setRequests(initialRequests)
      }
      fetchRequests()
    }
  }, [selectedStaff])

  // --- タップ挙動の核：休み切り替え ＋ 選択状態維持 ---
  const handleDateClick = (dateStr: string) => {
    setRequests(prev => {
      const current = prev[dateStr] || { is_off: false, memo: "" }
      return {
        ...prev,
        [dateStr]: { 
          is_off: !current.is_off, // 休みを反転
          memo: current.memo 
        }
      }
    })
    setActiveDate(dateStr) // 何度押してもその日が「選択中」になる
  }

  // メモ更新
  const updateMemo = (dateStr: string, text: string) => {
    setRequests(prev => ({
      ...prev,
      [dateStr]: { 
        is_off: prev[dateStr]?.is_off || false, 
        memo: text 
      }
    }))
  }

  // 保存処理
  const handleSave = async () => {
    setIsSaving(true)
    try {
      // 1. その人の来月分を一旦削除
      const startOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
      const endOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${daysInMonth}`
      
      await supabase.from('shift_requests')
        .delete()
        .eq('staff_id', selectedStaff.id)
        .gte('date', startOfMonth)
        .lte('date', endOfMonth)

      // 2. 有効なデータだけ抽出して保存
      const insertData = Object.entries(requests)
        .filter(([_, val]) => val.is_off || val.memo.trim() !== "")
        .map(([date, val]) => ({
          staff_id: selectedStaff.id,
          store_id: storeId,
          date: date,
          is_off: val.is_off,
          memo: val.memo
        }))

      if (insertData.length > 0) {
        const { error } = await supabase.from('shift_requests').insert(insertData)
        if (error) throw error
      }
      
      alert('休み・要望を保存しました！')
    } catch (err: any) {
      alert('保存に失敗しました: ' + err.message)
    } finally {
      setIsSaving(false)
    }
  }

  if (!selectedStaff) {
    return (
      <div className="p-8 max-w-md mx-auto min-h-screen">
        <h1 className="text-2xl font-bold mb-8 text-orange-600 text-center font-black">📅 休み希望入力</h1>
        <div className="grid gap-3">
          {staff.map((p) => (
            <button key={p.id} onClick={() => setSelectedStaff(p)} className="w-full bg-white p-5 rounded-2xl shadow-sm border border-gray-100 font-bold text-gray-700 text-lg flex justify-between items-center active:scale-95 transition-all">
              {p.name}<span className="text-orange-300">→</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-md mx-auto pb-20">
      <div className="bg-white p-6 rounded-[2.5rem] shadow-2xl border border-orange-50">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-black text-gray-800">{targetMonth}月 <span className="font-normal text-gray-400">希望</span></h1>
            <p className="text-orange-500 font-bold text-xs">👤 {selectedStaff.name} さん</p>
          </div>
          <button onClick={() => setSelectedStaff(null)} className="text-[10px] bg-gray-100 text-gray-400 px-3 py-1.5 rounded-full font-bold">名前変更</button>
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
                  req.is_off 
                    ? 'bg-red-500 text-white shadow-lg shadow-red-200 z-10 scale-105' 
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

        {/* --- 詳細要望入力エリア --- */}
        {activeDate && (
          <div className="mb-6 p-4 bg-orange-50 rounded-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-black text-orange-700 font-sans">
                📍 {parseInt(activeDate.split('-')[2])}日の要望
              </label>
              <button onClick={() => setActiveDate(null)} className="text-[10px] bg-white/50 px-2 py-1 rounded-lg text-orange-400 font-bold">閉じる</button>
            </div>
            <textarea
              className="w-full bg-white border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-orange-400 outline-none shadow-inner"
              placeholder="例: 18時以降なら可能 / 早番希望 など"
              rows={2}
              value={requests[activeDate]?.memo || ""}
              onChange={(e) => updateMemo(activeDate, e.target.value)}
            />
          </div>
        )}

        <button 
          onClick={handleSave} 
          disabled={isSaving} 
          className="w-full bg-orange-600 text-white py-5 rounded-[1.5rem] font-black shadow-xl shadow-orange-200 active:scale-95 transition-all disabled:bg-gray-200"
        >
          {isSaving ? '保存中...' : 'この内容で確定保存'}
        </button>
      </div>
    </div>
  )
}