'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import { Clock, Users, Star, CalendarDays, Zap, Play } from 'lucide-react'

// 30分刻みの時間リストを生成
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  return `${String(h).padStart(2, '0')}:${m}`
})

export default function GeneratePage() {
  const params = useParams()
  const storeId = params.store_id as string
  const [activeTab, setActiveTab] = useState('weekday') // 'weekday', 'weekend', 'special'
  const [loading, setLoading] = useState(true)
  const [storeInfo, setStoreInfo] = useState<any>(null)

  // 設定データ（人数と時間枠）
  const [counts, setCounts] = useState({
    wd_hd: 2, wd_hn: 3, wd_kd: 2, wd_kn: 3,
    we_hd: 3, we_hn: 4, we_kd: 2, we_kn: 4
  })
  const [slots, setSlots] = useState<{[key: string]: [string, string]}>({})

  // 1. データ読み込み
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      // 店舗情報取得
      const { data: store } = await supabase.from('stores').select('*').eq('store_id', storeId).single()
      if (store) setStoreInfo(store)

      // 既存の設定をSupabaseから取得
      const { data: config } = await supabase.from('config_generation').select('*').eq('store_id', storeId)
      if (config) {
        const newSlots: any = {}
        const newCounts: any = { ...counts }
        config.forEach(c => {
          if (c.key.startsWith('staff_count_')) {
            newCounts[c.key.replace('staff_count_', '')] = parseInt(c.start_time)
          } else {
            newSlots[c.key] = [c.start_time, c.end_time]
          }
        })
        setSlots(newSlots)
        setCounts(newCounts)
      }
      setLoading(false)
    }
    fetchData()
  }, [storeId])

  // 2. 人時（Jinji）計算ロジック
  const totalMH = useMemo(() => {
    const calcNet = (start: string, end: string) => {
      if (!start || !end) return 0
      const s = parseInt(start.split(':')[0]) + (start.split(':')[1] === '30' ? 0.5 : 0)
      const e = parseInt(end.split(':')[0]) + (end.split(':')[1] === '30' ? 0.5 : 0)
      let diff = e - s
      if (diff < 0) diff += 24
      const brk = diff > 8 ? 1.0 : diff > 6 ? 0.75 : 0
      return Math.max(0, diff - brk)
    }

    let sum = 0
    // 現在のタブに基づいた合計を計算
    const prefix = activeTab === 'weekday' ? 'wd' : 'we'
    Object.keys(slots).forEach(key => {
      if (key.startsWith(prefix)) sum += calcNet(slots[key][0], slots[key][1])
    })
    return sum
  }, [slots, activeTab])

// 3. 保存 ＆ 生成アクション
const handleSaveAndGenerate = async () => {
    setLoading(true)
    
    // ★ 修正1: 型を明示的に指定して any エラーを防ぐ
    const saveData: { store_id: string; key: string; start_time: string; end_time: string }[] = []

    // 人数データの準備
    for (const [k, v] of Object.entries(counts)) {
      // ★ 修正2: .append ではなく .push を使う
      saveData.push({ 
        store_id: storeId, 
        key: `staff_count_${k}`, 
        start_time: v.toString(), 
        end_time: '' 
      })
    }

    // スロットデータの準備
    for (const [k, v] of Object.entries(slots)) {
      // ★ 修正2: .append ではなく .push を使う
      saveData.push({ 
        store_id: storeId, 
        key: k, 
        start_time: v[0], 
        end_time: v[1] 
      })
    }

    // Supabaseへ保存
    const { error } = await supabase.from('config_generation').upsert(saveData, { onConflict: 'store_id,key' })
    
    if (error) {
      alert('保存に失敗しました: ' + error.message)
    } else {
      alert('設定を保存しました。AIがシフト生成を開始します...')
    }
    
    setLoading(false)
  }

  // スライダーUIのコンポーネント（1人分のバー）
  const StaffSlot = ({ id, label }: { id: string, label: string }) => {
    const [start, end] = slots[id] || ['10:00', '15:00']
    
    return (
      <div className="bg-white p-4 rounded-xl border border-gray-100 mb-2 shadow-sm hover:shadow-md transition-all">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-bold text-gray-700 flex items-center gap-2">
             <Users size={14} className="text-orange-400" /> {label}
          </span>
          <div className="flex gap-2 items-center">
            <select 
              value={start} 
              onChange={(e) => setSlots({...slots, [id]: [e.target.value, end]})}
              className="text-xs border rounded p-1 bg-gray-50"
            >
              {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <span className="text-gray-300">〜</span>
            <select 
              value={end} 
              onChange={(e) => setSlots({...slots, [id]: [start, e.target.value]})}
              className="text-xs border rounded p-1 bg-gray-50"
            >
              {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        {/* バーの視覚表現 */}
        <div className="h-2 w-full bg-gray-100 rounded-full relative overflow-hidden">
          <div 
            className="absolute h-full bg-orange-400 rounded-full"
            style={{ 
              left: `${(TIME_OPTIONS.indexOf(start) / 48) * 100}%`,
              right: `${100 - (TIME_OPTIONS.indexOf(end) / 48) * 100}%`
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8 pb-32">
      {/* ヘッダーエリア */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800 flex items-center gap-2">
            <Zap className="text-orange-500 fill-orange-500" /> シフト自動生成
          </h1>
          <p className="text-gray-500 text-sm">必要な人数と時間を直感的にセット</p>
        </div>
        
        <div className="bg-gray-900 text-white p-5 rounded-2xl shadow-2xl flex items-center gap-6">
          <div>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">目標人時 (1日)</p>
            <p className="text-2xl font-black text-orange-400">{totalMH.toFixed(1)} <span className="text-xs text-white">/ {storeInfo?.target_mh_per_day}h</span></p>
          </div>
          <div className={`w-12 h-12 rounded-full border-4 flex items-center justify-center font-bold text-xs ${totalMH > (storeInfo?.target_mh_per_day || 50) ? 'border-red-500 text-red-500' : 'border-green-500 text-green-500'}`}>
            {Math.round((totalMH / (storeInfo?.target_mh_per_day || 50)) * 100)}%
          </div>
        </div>
      </div>

      {/* タブ切り替え */}
      <div className="flex bg-gray-200 p-1 rounded-2xl mb-6">
        <button onClick={() => setActiveTab('weekday')} className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'weekday' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>🚃 平日</button>
        <button onClick={() => setActiveTab('weekend')} className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'weekend' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>🌞 金土日祝</button>
        <button onClick={() => setActiveTab('special')} className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'special' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>⭐ 特定日</button>
      </div>

      {/* 設定コンテンツ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 左側：人数設定 */}
        <section>
          <div className="flex items-center gap-2 mb-4 text-gray-800">
            <Users size={20} /> <h2 className="font-black">必要人数の設定</h2>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm grid grid-cols-2 gap-4">
            {['hd', 'kd', 'hn', 'kn'].map(pos => (
              <div key={pos} className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase">{pos.toUpperCase()} 必要人数</label>
                <input 
                  type="number" 
                  value={counts[`${activeTab === 'weekday' ? 'wd' : 'we'}_${pos}` as keyof typeof counts]}
                  onChange={(e) => setCounts({...counts, [`${activeTab === 'weekday' ? 'wd' : 'we'}_${pos}`]: parseInt(e.target.value)})}
                  className="w-full text-2xl font-black p-3 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-orange-500 transition-all"
                />
              </div>
            ))}
          </div>
        </section>

        {/* 右側：時間枠（バー）設定 */}
        <section>
          <div className="flex items-center gap-2 mb-4 text-gray-800">
            <Clock size={20} /> <h2 className="font-black">勤務時間の調整</h2>
          </div>
          <div className="max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
            {['hd', 'kd', 'hn', 'kn'].map(pos => {
              const count = counts[`${activeTab === 'weekday' ? 'wd' : 'we'}_${pos}` as keyof typeof counts]
              return Array.from({ length: count }).map((_, i) => (
                <StaffSlot key={`${activeTab}_${pos}_${i}`} id={`${activeTab === 'weekday' ? 'wd' : 'we'}_${pos}_${i}`} label={`${pos.toUpperCase()} ${i+1}人目`} />
              ))
            })}
          </div>
        </section>
      </div>

      {/* 固定フッターボタン */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/80 backdrop-blur-xl border-t border-gray-100 z-50 md:left-64">
        <button 
          onClick={handleSaveAndGenerate}
          disabled={loading}
          className="w-full max-w-4xl mx-auto flex items-center justify-center gap-3 bg-orange-600 text-white py-5 rounded-[2rem] font-black text-xl shadow-2xl shadow-orange-200 hover:bg-orange-700 active:scale-95 transition-all"
        >
          {loading ? <span className="animate-spin">🌀</span> : <Zap size={24} fill="white" />}
          設定を保存してシフトを自動生成
        </button>
      </div>
    </div>
  )
}