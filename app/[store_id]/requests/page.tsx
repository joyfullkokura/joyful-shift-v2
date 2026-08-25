'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'

export default function RequestsPage() {
  const params = useParams()
  const storeId = params.store_id as string
  const [staff, setStaff] = useState<any[]>([])
  const [selectedStaff, setSelectedStaff] = useState<any>(null)
  
  // カレンダー用の状態
  const [offDates, setOffDates] = useState<string[]>([]) // 休みとして選んだ日付(YYYY-MM-DD)のリスト
  const [isSaving, setIsSaving] = useState(false)

  // 1. 来月の年・月を計算
  const now = new Date()
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const targetYear = nextMonthDate.getFullYear()
  const targetMonth = nextMonthDate.getMonth() + 1

  // 2. カレンダーの土台データ作成
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate() // 末日
  const firstDayOfWeek = new Date(targetYear, targetMonth - 1, 1).getDay() // 1日の曜日(0:日〜6:土)
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const emptySlots = Array.from({ length: firstDayOfWeek }, (_, i) => i)

  // --- 初期データ読み込み ---
  useEffect(() => {
    const fetchStaff = async () => {
      const { data } = await supabase.from('staff').select('id, name').eq('store_id', storeId).order('name')
      setStaff(data || [])
    }
    if (storeId) fetchStaff()
  }, [storeId])

  // 名前が選ばれた時、既存の休み希望をSupabaseから取ってくる
  useEffect(() => {
    if (selectedStaff) {
      const fetchRequests = async () => {
        const startOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
        const endOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${daysInMonth}`
        
        const { data } = await supabase
          .from('shift_requests')
          .select('date')
          .eq('staff_id', selectedStaff.id)
          .eq('is_off', true)
          .gte('date', startOfMonth)
          .lte('date', endOfMonth)
        
        if (data) setOffDates(data.map(d => d.date))
      }
      fetchRequests()
    }
  }, [selectedStaff])

  // --- 休み選択の切り替えロジック ---
  const toggleDate = (dateStr: string) => {
    setOffDates(prev => 
      prev.includes(dateStr) ? prev.filter(d => d !== dateStr) : [...prev, dateStr]
    )
  }

  // --- 保存処理 ---
  const handleSave = async () => {
    setIsSaving(true)
    
    // 1. 一旦、その人の来月の休み希望を全部リセット（上書きのため）
    await supabase.from('shift_requests')
      .delete()
      .eq('staff_id', selectedStaff.id)
      .gte('date', `${targetYear}-${targetMonth}-01`)

    // 2. 新しく選ばれた日付を保存
    const insertData = offDates.map(d => ({
      staff_id: selectedStaff.id,
      store_id: storeId,
      date: d,
      is_off: true
    }))

    const { error } = await supabase.from('shift_requests').insert(insertData)

    if (error) alert('保存失敗: ' + error.message)
    else alert('休み希望を保存しました！')
    
    setIsSaving(false)
  }

  // A. 本人選択画面 (変更なし)
  if (!selectedStaff) {
    return (
      <div className="p-8 max-w-md mx-auto min-h-screen">
        <h1 className="text-2xl font-bold mb-2 text-orange-600 text-center">📅 休み希望入力</h1>
        <p className="text-gray-400 mb-8 text-center text-sm">{targetMonth}月分の希望を入力します</p>
        <div className="grid gap-3">
          {staff.map((p) => (
            <button key={p.id} onClick={() => setSelectedStaff(p)} className="w-full bg-white p-5 rounded-2xl shadow-sm border border-gray-100 font-bold text-gray-700 text-lg flex justify-between items-center hover:bg-orange-50 transition-all">
              {p.name}<span className="text-orange-300">→</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // B. カレンダー画面
  return (
    <div className="p-4 max-w-md mx-auto">
      <div className="bg-white p-6 rounded-3xl shadow-xl border border-orange-100">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-black text-gray-800">{targetMonth}月 <span className="text-sm font-normal text-gray-400">休み希望</span></h1>
            <p className="text-orange-600 font-bold text-sm">{selectedStaff.name} さん</p>
          </div>
          <button onClick={() => setSelectedStaff(null)} className="text-[10px] bg-gray-100 px-2 py-1 rounded text-gray-400">戻る</button>
        </div>

        {/* 曜日ヘッダー */}
        <div className="grid grid-cols-7 gap-1 mb-2 text-center text-[10px] font-bold text-gray-400">
          {['日','月','火','水','木','金','土'].map((d, i) => (
            <div key={d} className={i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : ''}>{d}</div>
          ))}
        </div>

        {/* カレンダー本体 */}
        <div className="grid grid-cols-7 gap-2 mb-8">
          {emptySlots.map(i => <div key={`empty-${i}`} />)}
          {daysArray.map(day => {
            const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const isSelected = offDates.includes(dateStr)
            const weekDay = new Date(targetYear, targetMonth - 1, day).getDay()
            
            return (
              <button
                key={day}
                onClick={() => toggleDate(dateStr)}
                className={`h-12 rounded-xl flex flex-col items-center justify-center transition-all ${
                  isSelected 
                  ? 'bg-red-500 text-white shadow-lg shadow-red-200 scale-105' 
                  : 'bg-gray-50 text-gray-700 hover:bg-orange-50'
                }`}
              >
                <span className={`text-xs font-bold ${!isSelected && weekDay === 0 ? 'text-red-400' : !isSelected && weekDay === 6 ? 'text-blue-400' : ''}`}>
                  {day}
                </span>
                {isSelected && <span className="text-[8px] font-black">休み</span>}
              </button>
            )
          })}
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full bg-orange-600 text-white py-4 rounded-2xl font-black shadow-lg shadow-orange-200 hover:bg-orange-700 transition-all"
        >
          {isSaving ? '保存中...' : 'この内容で確定保存'}
        </button>
      </div>
    </div>
  )
}