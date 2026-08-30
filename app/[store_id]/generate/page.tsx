'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'

// --- 定数定義 ---
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  return `${String(h).padStart(2, '0')}:${m}`
})

interface Slot {
  start: string
  end: string
}

export default function GeneratePage() {
  const params = useParams()
  const storeId = params.store_id as string
  const [storeInfo, setStoreInfo] = useState<any>(null)
  const [wMembers, setWMembers] = useState<any[]>([])
  
  // 1. 基本設定の状態
  const [counts, setCounts] = useState({
    h_d_wd: 2, k_d_wd: 2, h_n_wd: 3, k_n_wd: 3,
    h_d_we: 3, k_d_we: 2, h_n_we: 4, k_n_we: 4
  })
  
  // 2. 勤務時間枠（バー）の状態
  // key例: "weekday-hd-0"
  const [slots, setSlots] = useState<{[key: string]: Slot}>({})
  
  const [activeTab, setActiveTab] = useState<'weekday' | 'weekend'>('weekday')
  const [isSaving, setIsSaving] = useState(false)

  // データ読み込み
  useEffect(() => {
    const init = async () => {
      // 店舗情報取得
      const { data: sData } = await supabase.from('stores').select('*').eq('store_id', storeId).single()
      if (sData) setStoreInfo(sData)
      
      // Wグループ取得
      const { data: stData } = await supabase.from('staff').select('*').eq('store_id', storeId).eq('is_employee', true)
      setWMembers(stData || [])
    }
    init()
  }, [storeId])

  // --- ヘルパー関数 ---
  const timeToFloat = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h + m / 60
  }

  // スライダーの値が変更された時
  const handleSliderChange = (key: string, type: 'start' | 'end', val: string) => {
    setSlots(prev => ({
      ...prev,
      [key]: { ... (prev[key] || { start: '10:00', end: '18:00' }), [type]: val }
    }))
  }

  // 人時計算 (ReactのuseMemoを使って爆速計算)
  const totalMH = useMemo(() => {
    let total = 0
    Object.values(slots).forEach(s => {
      const duration = timeToFloat(s.end) - timeToFloat(s.start)
      if (duration > 0) {
        // 休憩ルール: 6h超で0.75, 8h超で1.0
        const brk = duration > 8 ? 1.0 : duration > 6 ? 0.75 : 0
        total += (duration - brk)
      }
    })
    return total
  }, [slots])

  if (!storeInfo) return <div className="p-10 animate-pulse text-orange-500">Loading...</div>

  // --- スライダーコンポーネント ---
  const SlotSlider = ({ id, label }: { id: string, label: string }) => {
    const slot = slots[id] || { start: '10:00', end: '18:00' }
    return (
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm mb-3">
        <div className="flex justify-between items-center mb-4">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{label}</span>
          <span className="bg-orange-100 text-orange-600 px-3 py-1 rounded-full text-xs font-black">
            {slot.start} 〜 {slot.end}
          </span>
        </div>
        <div className="flex gap-4">
          <select 
            value={slot.start} 
            onChange={(e) => handleSliderChange(id, 'start', e.target.value)}
            className="flex-1 bg-gray-50 border-none rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-orange-500"
          >
            {TIME_OPTIONS.map(t => <option key={t} value={t}>{t} から</option>)}
          </select>
          <select 
            value={slot.end} 
            onChange={(e) => handleSliderChange(id, 'end', e.target.value)}
            className="flex-1 bg-gray-50 border-none rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-orange-500"
          >
            {TIME_OPTIONS.map(t => <option key={t} value={t}>{t} まで</option>)}
          </select>
        </div>
        {/* バーの視覚表現 */}
        <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden relative">
          <div 
            className="absolute h-full bg-gradient-to-r from-orange-400 to-orange-600"
            style={{
              left: `${(timeToFloat(slot.start) / 24) * 100}%`,
              right: `${100 - (timeToFloat(slot.end) / 24) * 100}%`
            }}
          ></div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 pb-32">
      {/* ヘッダーエリア */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">🤖 シフト自動生成 <span className="text-orange-500">V2</span></h1>
          <p className="text-gray-400 font-medium text-sm">店舗設定と勤務パターンの構築</p>
        </div>
        <div className="bg-gray-900 text-white p-6 rounded-3xl shadow-2xl flex items-center gap-6">
          <div>
            <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">概算総人時 (1日あたり)</p>
            <p className="text-3xl font-black text-orange-400">{totalMH.toFixed(1)}<span className="text-sm ml-1 text-white">h</span></p>
          </div>
          <div className="h-10 w-[1px] bg-gray-700"></div>
          <div>
            <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">目標</p>
            <p className="text-xl font-bold">{storeInfo.target_mh_per_day}h</p>
          </div>
        </div>
      </div>

      {/* 設定タブ */}
      <div className="flex bg-gray-200 p-1 rounded-2xl mb-6 w-fit">
        <button 
          onClick={() => setActiveTab('weekday')}
          className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'weekday' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
        >
          🚃 平日 (月〜木)
        </button>
        <button 
          onClick={() => setActiveTab('weekend')}
          className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'weekend' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
        >
          🌞 金土日祝
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 左側：人数設定 */}
        <div className="space-y-6">
          <section className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
            <h3 className="font-black text-gray-700 mb-4 flex items-center gap-2">👥 必要人数の設定</h3>
            <div className="grid grid-cols-2 gap-4">
              {['h_d', 'k_d', 'h_n', 'k_n'].map(pos => {
                const key = `${pos}_${activeTab === 'weekday' ? 'wd' : 'we'}` as keyof typeof counts
                const label = pos.includes('h') ? 'ホール' : 'キッチン'
                const time = pos.includes('_d') ? '昼' : '夜'
                return (
                  <div key={pos} className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">{label} {time}</label>
                    <input 
                      type="number" 
                      value={counts[key]} 
                      onChange={(e) => setCounts({...counts, [key]: parseInt(e.target.value) || 0})}
                      className="w-full bg-gray-50 border-none rounded-xl p-3 font-bold focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                )
              })}
            </div>
          </section>

          {/* 社員目標時間（Wグループ） */}
          <section className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
            <h3 className="font-black text-gray-700 mb-4">🎯 社員の月間目標時間</h3>
            <div className="space-y-3">
              {wMembers.map(m => (
                <div key={m.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-2xl">
                  <span className="font-bold text-gray-700">{m.name}</span>
                  <div className="flex items-center gap-2">
                    <input type="number" defaultValue={168} className="w-16 bg-white border-none rounded-lg p-1 text-center font-bold" />
                    <span className="text-xs text-gray-400">h</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* 右側：バー設定（スライダー） */}
        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
          <h3 className="font-black text-gray-700 mb-4 sticky top-0 bg-gray-50 py-2 z-10">🕒 勤務時間の枠作成 (バー設定)</h3>
          
          {/* ポジションごとにループ表示 */}
          {['hd', 'kd', 'hn', 'kn'].map(pos => {
            const countKey = `${pos}_${activeTab === 'weekday' ? 'wd' : 'we'}` as keyof typeof counts
            const count = counts[countKey]
            return Array.from({ length: count }).map((_, i) => (
              <SlotSlider 
                key={`${activeTab}-${pos}-${i}`} 
                id={`${activeTab}-${pos}-${i}`} 
                label={`${pos.toUpperCase()} ${i+1}人目`} 
              />
            ))
          })}
        </div>
      </div>

      {/* 固定アクションボタン */}
      <div className="fixed bottom-0 left-0 right-0 md:left-64 bg-white/80 backdrop-blur-xl border-t border-gray-100 p-4 flex gap-4 z-30">
        <button className="flex-1 bg-gray-100 text-gray-600 py-4 rounded-2xl font-black hover:bg-gray-200 transition-all">
          📁 下書きとして保存
        </button>
        <button className="flex-[2] bg-orange-600 text-white py-4 rounded-2xl font-black shadow-xl shadow-orange-200 hover:bg-orange-700 active:scale-95 transition-all">
          🚀 シフト案を生成する
        </button>
      </div>
    </div>
  )
}