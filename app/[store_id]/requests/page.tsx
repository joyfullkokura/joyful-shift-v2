'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'

export default function RequestsPage() {
  const params = useParams()
  const storeId = params.store_id as string
  const [staff, setStaff] = useState<any[]>([])
  const [selectedStaff, setSelectedStaff] = useState<any>(null)

  // 1. 店舗のスタッフ一覧を読み込む
  useEffect(() => {
    const fetchStaff = async () => {
      const { data } = await supabase
        .from('staff')
        .select('id, name') // 本人確認用なのでIDと名前だけでOK
        .eq('store_id', storeId)
        .order('name')
      setStaff(data || [])
    }
    if (storeId) fetchStaff()
  }, [storeId])

  // --- A. まだ誰か選んでいない時の画面（簡易ログイン） ---
  if (!selectedStaff) {
    return (
      <div className="p-8 max-w-md mx-auto min-h-screen">
        <h1 className="text-2xl font-bold mb-2 text-orange-600 text-center">📅 休み希望入力</h1>
        <p className="text-gray-400 mb-8 text-center text-sm">あなたの名前をタップしてください</p>
        
        <div className="grid gap-3">
          {staff.map((person) => (
            <button
              key={person.id}
              onClick={() => setSelectedStaff(person)}
              className="w-full bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:border-orange-500 hover:bg-orange-50 transition-all font-bold text-gray-700 text-lg flex justify-between items-center"
            >
              {person.name}
              <span className="text-orange-300">→</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // --- B. 名前が選ばれた後の画面（ここにカレンダーを作ります） ---
  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="bg-white p-6 rounded-3xl shadow-lg border border-orange-100">
        <h1 className="text-2xl font-black text-gray-800 mb-1">
          {selectedStaff.name} <span className="text-sm font-normal text-gray-400">さんの入力</span>
        </h1>
        <button 
          onClick={() => setSelectedStaff(null)} 
          className="text-xs text-orange-400 underline mb-8"
        >
          違う人の場合はこちら
        </button>

        {/* 次回：ここにカレンダーを表示するコードを書きます */}
        <div className="py-20 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 text-gray-400 text-center">
          <p className="text-sm font-bold">準備中...</p>
          <p className="text-[10px]">ここにカレンダーが表示されます</p>
        </div>
      </div>
    </div>
  )
}