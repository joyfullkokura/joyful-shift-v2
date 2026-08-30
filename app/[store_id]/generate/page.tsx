'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'

// --- 時間変換の道具 ---
const fToT = (f: number) => {
  const h = Math.floor(f)
  const m = Math.round((f % 1) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function GeneratePage() {
  const { store_id } = useParams()
  const [storeInfo, setStoreInfo] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<'wd' | 'we'>('wd')

  const [counts, setCounts] = useState<any>({
    wd_hd: 2, wd_kd: 2, wd_hn: 3, wd_kn: 3,
    we_hd: 3, we_kd: 2, we_hn: 4, we_kn: 4
  })

  const [slots, setSlots] = useState<any>({})

  useEffect(() => {
    const loadSettings = async () => {
      const { data } = await supabase.from('stores').select('*').eq('store_id', store_id).single()
      if (data) {
        setStoreInfo(data)
        if (data.last_settings) {
          setCounts(data.last_settings.counts || counts)
          setSlots(data.last_settings.slots || {})
        }
      }
    }
    loadSettings()
  }, [store_id])

  const changeCount = (key: string, delta: number) => {
    setCounts((prev: any) => ({ ...prev, [key]: Math.max(0, prev[key] + delta) }))
  }

  // ★重要：時間の更新（開始が終了を追い越さないように制御）
  const updateTime = (id: string, type: 'start' | 'end', val: number) => {
    setSlots((prev: any) => {
      const current = prev[id] || { start: 10, end: 18 }
      let { start, end } = current
      if (type === 'start') start = Math.min(val, end - 0.5) // 終了より前をキープ
      if (type === 'end') end = Math.max(val, start + 0.5)   // 開始より後をキープ
      return { ...prev, [id]: { start, end } }
    })
  }

  const calculateJinji = () => {
    let total = 0
    const prefix = activeTab
    const positions = ['hd', 'kd', 'hn', 'kn']
    positions.forEach(pos => {
      const count = counts[`${prefix}_${pos}`]
      for (let i = 0; i < count; i++) {
        const slot = slots[`${prefix}_${pos}_${i}`] || { start: 10, end: 18 }
        total += (slot.end - slot.start)
      }
    })
    return total
  }

  const handleSave = async () => {
    const { error } = await supabase.from('stores').update({
      last_settings: { counts, slots }
    }).eq('store_id', store_id)
    if (error) alert('保存失敗: ' + error.message)
    else alert('設定を保存しました！')
  }

  if (!storeInfo) return <div className="p-10 text-gray-400">読み込み中...</div>

  const posLabels: any = { hd: 'ホール昼', kd: 'キッチン昼', hn: 'ホール夜', kn: 'キッチン夜' }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 pb-40 text-gray-800">
      {/* ヘッダー */}
      <div className="flex justify-between items-center mb-8 bg-white p-6 rounded-[2rem] shadow-sm border border-orange-50">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <span className="text-3xl">🤖</span> シフト自動生成設定
          </h1>
          <p className="text-xs text-gray-400 font-bold ml-10">{storeInfo.name}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Daily Total Jinji</p>
          <div className="text-4xl font-black text-orange-500 tabular-nums">
            {calculateJinji().toFixed(1)}<span className="text-sm ml-1 text-gray-300">H</span>
          </div>
        </div>
      </div>

      {/* タブ */}
      <div className="flex bg-gray-100 p-1.5 rounded-2xl w-full max-w-sm mx-auto mb-10 shadow-inner">
        <button onClick={() => setActiveTab('wd')} className={`flex-1 py-3 rounded-xl font-bold transition-all ${activeTab === 'wd' ? 'bg-white text-orange-600 shadow-md' : 'text-gray-400'}`}>🚃 平日</button>
        <button onClick={() => setActiveTab('we')} className={`flex-1 py-3 rounded-xl font-bold transition-all ${activeTab === 'we' ? 'bg-white text-orange-600 shadow-md' : 'text-gray-400'}`}>🌞 金土日祝</button>
      </div>

      {/* 人数設定 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {['hd', 'kd', 'hn', 'kn'].map(pos => {
          const key = `${activeTab}_${pos}`
          return (
            <div key={pos} className="bg-white p-5 rounded-[1.5rem] border border-gray-100 shadow-sm text-center">
              <p className="text-[10px] text-gray-400 font-black mb-3 uppercase">{posLabels[pos]}</p>
              <div className="flex justify-around items-center gap-2">
                <button onClick={() => changeCount(key, -1)} className="w-8 h-8 rounded-full bg-gray-50 text-gray-400 hover:bg-gray-200 transition-colors">－</button>
                <span className="text-2xl font-black w-8">{counts[key]}</span>
                <button onClick={() => changeCount(key, 1)} className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 hover:bg-orange-200 transition-colors">＋</button>
              </div>
            </div>
          )
        })}
      </div>

      {/* バー設定セクション */}
      <div className="space-y-3">
        {['hd', 'kd', 'hn', 'kn'].map(pos => (
          Array.from({ length: counts[`${activeTab}_${pos}`] }).map((_, i) => {
            const id = `${activeTab}_${pos}_${i}`
            const { start, end } = slots[id] || { start: 10, end: 18 }
            return (
              <div key={id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-50 flex flex-col md:flex-row md:items-center gap-4">
                <div className="w-24 font-black text-gray-400 text-[10px] uppercase tracking-tighter">{pos.toUpperCase()}{i + 1}人目</div>
                
                <div className="flex-1 flex items-center gap-4">
                  <span className="text-[11px] font-bold text-gray-400 w-10 text-right">{fToT(start)}</span>
                  
                  {/* ★ 自作デュアルスライダー ★ */}
                  <div className="relative flex-1 h-6 flex items-center group">
                    {/* 背景グレーバー */}
                    <div className="absolute w-full h-1.5 bg-gray-100 rounded-full"></div>
                    {/* オレンジ色の選択範囲バー */}
                    <div 
                      className="absolute h-1.5 bg-orange-500 rounded-full shadow-[0_0_10px_rgba(249,115,22,0.3)]"
                      style={{ 
                        left: `${(start / 24) * 100}%`, 
                        width: `${((end - start) / 24) * 100}%` 
                      }}
                    ></div>
                    {/* つまみ1: 開始 (透明なrange入力を重ねる) */}
                    <input 
                      type="range" min="0" max="24" step="0.5" value={start}
                      onChange={(e) => updateTime(id, 'start', parseFloat(e.target.value))}
                      className="absolute w-full appearance-none bg-transparent pointer-events-none z-20 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-orange-500 [&::-webkit-slider-thumb]:shadow-md"
                    />
                    {/* つまみ2: 終了 */}
                    <input 
                      type="range" min="0" max="24" step="0.5" value={end}
                      onChange={(e) => updateTime(id, 'end', parseFloat(e.target.value))}
                      className="absolute w-full appearance-none bg-transparent pointer-events-none z-20 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-orange-600 [&::-webkit-slider-thumb]:shadow-md"
                    />
                  </div>

                  <span className="text-[11px] font-bold text-gray-400 w-10">{fToT(end)}</span>
                </div>
                
                <div className="bg-orange-50 px-3 py-1 rounded-full text-orange-600 font-black text-[11px] min-w-[50px] text-center">
                  {(end - start).toFixed(1)}h
                </div>
              </div>
            )
          })
        ))}
      </div>

      {/* 固定ボタン */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/90 backdrop-blur-md md:left-64 border-t border-gray-100 flex justify-center z-50">
        <button onClick={handleSave} className="max-w-xl w-full bg-gray-900 text-white py-5 rounded-[1.5rem] font-black text-lg shadow-2xl hover:bg-orange-600 transition-all transform active:scale-95 flex items-center justify-center gap-3">
          🚀 設定を保存してシフトを生成
        </button>
      </div>
    </div>
  )
}