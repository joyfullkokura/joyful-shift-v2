'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'

interface Store {
  id: string; store_id: string; name: string;
  group_options: string; open_time: string; close_time: string;
  target_mh_per_day: number;
}

interface ShiftSlot {
  id: string;
  group: string;
  startTime: string;
  endTime: string;
}

export default function GeneratePage() {
  const params = useParams()
  const storeId = params.store_id as string
  const [storeInfo, setStoreInfo] = useState<Store | null>(null)
  const [slots, setSlots] = useState<ShiftSlot[]>([])

  // 時間の選択肢を生成 (00:00 - 24:00)
  const timeOptions = Array.from({ length: 49 }, (_, i) => {
    const h = Math.floor(i / 2);
    const m = i % 2 === 0 ? "00" : "30";
    return `${String(h).padStart(2, '0')}:${m}`;
  });

  useEffect(() => {
    const fetchStore = async () => {
      const { data } = await supabase.from('stores').select('*').eq('store_id', storeId).single()
      if (data) setStoreInfo(data)
    }
    fetchStore()
  }, [storeId])

  // 枠を追加する関数
  const addSlot = (groupName: string) => {
    const newSlot: ShiftSlot = {
      id: Math.random().toString(36).substr(2, 9),
      group: groupName,
      startTime: storeInfo?.open_time.slice(0, 5) || "10:00",
      endTime: "15:00"
    }
    setSlots([...slots, newSlot])
  }

  // 枠を削除する関数
  const removeSlot = (id: string) => {
    setSlots(slots.filter(s => s.id !== id))
  }

  // 時間を更新する関数
  const updateTime = (id: string, field: 'startTime' | 'endTime', value: string) => {
    setSlots(slots.map(s => s.id === id ? { ...s, [field]: value } : s))
  }

  // 合計人時の計算（V1と同じ計算ロジック）
  const calculateTotalMH = () => {
    return slots.reduce((total, s) => {
      const start = parseInt(s.startTime.split(':')[0]) + (s.startTime.split(':')[1] === '30' ? 0.5 : 0)
      const end = parseInt(s.endTime.split(':')[0]) + (s.endTime.split(':')[1] === '30' ? 0.5 : 0)
      let diff = end - start
      if (diff < 0) diff += 24 // 深夜跨ぎ対応
      
      // 休憩時間の簡易計算 (6h超で0.75, 8h超で1.0)
      let breakTime = 0
      if (diff > 8) breakTime = 1.0
      else if (diff > 6) breakTime = 0.75
      
      return total + (diff - breakTime)
    }, 0)
  }

  if (!storeInfo) return <div className="p-8">読み込み中...</div>

  const groups = storeInfo.group_options.split(',')

  return (
    <div className="p-4 md:p-8 pb-32">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-black text-gray-800 uppercase tracking-tighter">Shift Generator</h1>
          <p className="text-orange-600 font-bold">📍 {storeInfo.name}</p>
        </div>
        
        <div className="bg-white px-6 py-3 rounded-2xl shadow-sm border-2 border-orange-500 text-right">
          <p className="text-[10px] text-gray-400 font-bold">予想総人時 (休憩差引後)</p>
          <div className="flex items-baseline justify-end gap-2">
            <span className="text-3xl font-black text-gray-800">{calculateTotalMH().toFixed(1)}</span>
            <span className="text-gray-400 font-bold">/ {storeInfo.target_mh_per_day}h</span>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {groups.map((group: string) => (
          <div key={group} className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-black text-gray-700 flex items-center gap-2">
                <span className="w-2 h-6 bg-orange-500 rounded-full"></span>
                {group}
              </h2>
              <button 
                onClick={() => addSlot(group)}
                className="bg-orange-50 text-orange-600 px-4 py-1.5 rounded-full text-xs font-bold hover:bg-orange-100 transition-all"
              >
                ＋ 枠を追加
              </button>
            </div>

            <div className="space-y-3">
              {slots.filter(s => s.group === group).map((slot, index) => (
                <div key={slot.id} className="flex items-center gap-4 bg-gray-50 p-3 rounded-2xl border border-gray-100 animate-in slide-in-from-left-2 duration-200">
                  <span className="text-[10px] font-bold text-gray-400 w-8">{index + 1}人目</span>
                  
                  <div className="flex-1 flex items-center gap-2">
                    <select 
                      value={slot.startTime} 
                      onChange={(e) => updateTime(slot.id, 'startTime', e.target.value)}
                      className="bg-white border-none rounded-lg px-2 py-1 text-sm font-bold shadow-sm focus:ring-2 focus:ring-orange-500 outline-none"
                    >
                      {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <span className="text-gray-300">〜</span>
                    <select 
                      value={slot.endTime} 
                      onChange={(e) => updateTime(slot.id, 'endTime', e.target.value)}
                      className="bg-white border-none rounded-lg px-2 py-1 text-sm font-bold shadow-sm focus:ring-2 focus:ring-orange-500 outline-none"
                    >
                      {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>

                  <button 
                    onClick={() => removeSlot(slot.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              ))}
              {slots.filter(s => s.group === group).length === 0 && (
                <p className="text-center py-4 text-xs text-gray-300 italic">枠が設定されていません</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="fixed bottom-8 left-0 right-0 flex justify-center px-4 md:pl-72 z-50">
        <button className="w-full max-w-lg bg-gray-900 text-white py-5 rounded-[2rem] font-black shadow-2xl hover:bg-black active:scale-95 transition-all">
          🚀 この設定でシフトを生成する
        </button>
      </div>
    </div>
  )
}