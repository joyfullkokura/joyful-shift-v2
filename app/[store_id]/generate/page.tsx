'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'

// --- 便利な道具：時間を数字に変換 ---
const tToF = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}
const fToT = (f: number) => {
  const h = Math.floor(f)
  const m = (f % 1) * 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// 30分刻みの選択肢
const TIME_STEPS = Array.from({ length: 49 }, (_, i) => i * 0.5)

export default function GeneratePage() {
  const { store_id } = useParams()
  const [storeInfo, setStoreInfo] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<'wd' | 'we'>('wd') // wd: 平日, we: 休日

  // --- 人数設定の状態 ---
  const [counts, setCounts] = useState<any>({
    wd_hd: 2, wd_kd: 2, wd_hn: 3, wd_kn: 3,
    we_hd: 3, we_kd: 2, we_hn: 4, we_kn: 4
  })

  // --- 枠時間の設定状態 ---
  const [slots, setSlots] = useState<any>({})

  // 1. データの読み込み
  useEffect(() => {
    const loadSettings = async () => {
      const { data } = await supabase.from('stores').select('*').eq('store_id', store_id).single()
      if (data) {
        setStoreInfo(data)
        // もし過去の保存データがあれば復元（なければ初期値を生成）
        if (data.last_settings) {
          setCounts(data.last_settings.counts)
          setSlots(data.last_settings.slots)
        }
      }
    }
    loadSettings()
  }, [store_id])

  // 人数変更ボタン
  const changeCount = (key: string, delta: number) => {
    setCounts((prev: any) => ({ ...prev, [key]: Math.max(0, prev[key] + delta) }))
  }

  // 時間変更（スライダー風）
  const updateSlot = (key: string, index: number, field: 'start' | 'end', val: number) => {
    const id = `${key}_${index}`
    const current = slots[id] || { start: 10.0, end: 18.0 }
    setSlots((prev: any) => ({
      ...prev,
      [id]: { ...current, [field]: val }
    }))
  }

  // 合計人時（Jinji）の計算
  const calculateJinji = () => {
    let total = 0
    const prefix = activeTab === 'wd' ? 'wd' : 'we'
    // 各ポジションの人数分だけ時間を足す
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

  // 保存 ＋ 生成
  const handleSaveAndGenerate = async () => {
    const { error } = await supabase.from('stores').update({
      last_settings: { counts, slots }
    }).eq('store_id', store_id)

    if (error) alert('保存失敗: ' + error.message)
    else alert('設定を保存しました！AI生成（FastAPI連携）を開始します。')
  }

  if (!storeInfo) return <div className="p-10 text-gray-400">読み込み中...</div>

  const currentPrefix = activeTab

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 pb-32">
      {/* ヘッダー：人時メーター */}
      <div className="flex justify-between items-center mb-8 bg-white p-6 rounded-3xl shadow-sm border border-orange-100">
        <div>
          <h1 className="text-2xl font-black text-gray-800">🤖 シフト自動生成設定</h1>
          <p className="text-xs text-gray-400 font-bold tracking-widest">{storeInfo.name}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-gray-400 font-bold uppercase">現在の日別合計人時</p>
          <div className="text-3xl font-black text-orange-500">
            {calculateJinji().toFixed(1)}<span className="text-sm ml-1 text-gray-300">H</span>
          </div>
        </div>
      </div>

      {/* タブ切り替え */}
      <div className="flex bg-gray-200 p-1 rounded-2xl w-full max-w-sm mx-auto mb-8">
        <button onClick={() => setActiveTab('wd')} className={`flex-1 py-3 rounded-xl font-bold transition-all ${activeTab === 'wd' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}>🚃 平日</button>
        <button onClick={() => setActiveTab('we')} className={`flex-1 py-3 rounded-xl font-bold transition-all ${activeTab === 'we' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}>🌞 金土日祝</button>
      </div>

      {/* 人数設定セクション */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {['hd', 'kd', 'hn', 'kn'].map(pos => {
          const key = `${currentPrefix}_${pos}`
          const label = pos === 'hd' ? 'ホール昼' : pos === 'kd' ? 'キッチン昼' : pos === 'hn' ? 'ホール夜' : 'キッチン夜'
          return (
            <div key={pos} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
              <p className="text-[10px] text-gray-400 font-bold mb-2">{label}</p>
              <div className="flex justify-between items-center">
                <button onClick={() => changeCount(key, -1)} className="w-8 h-8 rounded-full bg-gray-100">-</button>
                <span className="text-xl font-black">{counts[key]}</span>
                <button onClick={() => changeCount(key, 1)} className="w-8 h-8 rounded-full bg-orange-100 text-orange-600">+</button>
              </div>
            </div>
          )
        })}
      </div>

      {/* バー（スライダー）設定セクション */}
      <div className="space-y-4">
        {['hd', 'kd', 'hn', 'kn'].map(pos => (
          Array.from({ length: counts[`${currentPrefix}_${pos}`] }).map((_, i) => {
            const id = `${currentPrefix}_${pos}_${i}`
            const slot = slots[id] || { start: 10, end: 18 }
            const label = `${pos.toUpperCase()}${i + 1}人目`
            return (
              <div key={id} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-50 flex flex-col md:flex-row md:items-center gap-4">
                <div className="w-24 font-bold text-gray-500 text-xs">{label}</div>
                <div className="flex-1 flex items-center gap-4">
                  <span className="text-xs font-mono w-10 text-right">{fToT(slot.start)}</span>
                  {/* Next.js/Reactでのバー操作：2つのスライダー */}
                  <div className="flex-1 flex gap-2">
                    <input type="range" min="0" max="24" step="0.5" value={slot.start} onChange={(e) => updateSlot(currentPrefix, i, 'start', parseFloat(e.target.value))} className="flex-1 accent-orange-500" />
                    <input type="range" min="0" max="24" step="0.5" value={slot.end} onChange={(e) => updateSlot(currentPrefix, i, 'end', parseFloat(e.target.value))} className="flex-1 accent-orange-600" />
                  </div>
                  <span className="text-xs font-mono w-10">{fToT(slot.end)}</span>
                </div>
                <div className="text-orange-500 font-black text-xs w-12">{(slot.end - slot.start).toFixed(1)}h</div>
              </div>
            )
          })
        ))}
      </div>

      {/* 巨大な生成ボタン */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-md md:left-64 border-t border-gray-100">
        <button onClick={handleSaveAndGenerate} className="max-w-5xl mx-auto w-full bg-gray-900 text-white py-5 rounded-2xl font-black text-lg shadow-xl hover:bg-orange-600 transition-all active:scale-95">
          🚀 設定を保存してシフトを生成する
        </button>
      </div>
    </div>
  )
}