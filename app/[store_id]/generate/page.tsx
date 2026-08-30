'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'

export default function GeneratePage() {
  const params = useParams()
  const storeId = params.store_id as string
  const [storeInfo, setStoreInfo] = useState<any>(null)
  const [requirements, setRequests] = useState<{[key: string]: number}>({}) // {"10:00-ホール": 2, ...}

  useEffect(() => {
    const fetchStore = async () => {
      const { data } = await supabase.from('stores').select('*').eq('store_id', storeId).single()
      if (data) setStoreInfo(data)
    }
    fetchStore()
  }, [storeId])

  if (!storeInfo) return <div className="p-8">読み込み中...</div>

  // 30分刻みの時間リストを営業期間に合わせて作成
  const generateTimeSlots = () => {
    const slots = []
    let current = parseInt(storeInfo.open_time.split(':')[0])
    const end = parseInt(storeInfo.close_time.split(':')[0])
    for (let h = current; h < end; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`)
      slots.push(`${String(h).padStart(2, '0')}:30`)
    }
    return slots
  }

  const timeSlots = generateTimeSlots()
  const groups = storeInfo.group_options.split(',')

  // 必要人数（積み木）を書き換える関数
  const updateReq = (time: string, group: string, value: number) => {
    setRequests(prev => ({
      ...prev,
      [`${time}-${group}`]: Math.max(0, value) // 0以下にはならない
    }))
  }

  // 現在の合計人時を計算 (人数 × 0.5時間)
  const totalMH = Object.values(requirements).reduce((sum, val) => sum + (val * 0.5), 0)

  return (
    <div className="p-4 md:p-8">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl font-black text-gray-800">🤖 シフト自動生成設定</h1>
          <p className="text-sm text-gray-500">店舗: {storeInfo.name}</p>
        </div>
        
        {/* リアルタイム人時メーター */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-orange-100 text-right">
          <p className="text-[10px] text-gray-400 font-bold uppercase">現在の合計人時 (1日あたり)</p>
          <div className="flex items-baseline justify-end gap-2">
            <span className={`text-3xl font-black ${totalMH > storeInfo.target_mh_per_day ? 'text-red-500' : 'text-green-500'}`}>
              {totalMH.toFixed(1)}
            </span>
            <span className="text-gray-400 font-bold">/ {storeInfo.target_mh_per_day}h</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="p-4 border-b border-gray-100 text-left text-xs font-bold text-gray-400 uppercase">時間 / ポジション</th>
                {groups.map((g: string) => (
                  <th key={g} className="p-4 border-b border-gray-100 text-center text-xs font-bold text-gray-600">{g}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeSlots.map(time => (
                <tr key={time} className="hover:bg-orange-50/30 transition-colors">
                  <td className="p-2 border-b border-gray-50 font-mono text-xs text-gray-500 text-center">{time}</td>
                  {groups.map((group: string) => {
                    const val = requirements[`${time}-${group}`] || 0
                    return (
                      <td key={group} className="p-1 border-b border-gray-50">
                        <div className="flex items-center justify-center gap-1">
                          <button 
                            onClick={() => updateReq(time, group, val - 1)}
                            className="w-6 h-6 rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200"
                          >-</button>
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-black transition-all ${val > 0 ? 'bg-orange-500 text-white shadow-md scale-110' : 'bg-gray-50 text-gray-300'}`}>
                            {val}
                          </div>
                          <button 
                            onClick={() => updateReq(time, group, val + 1)}
                            className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 hover:bg-orange-200"
                          >+</button>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8 flex gap-4">
        <button className="flex-1 bg-gray-800 text-white py-4 rounded-2xl font-black shadow-lg active:scale-95 transition-all">
          💾 設定を保存してAI解析へ進む
        </button>
      </div>
    </div>
  )
}