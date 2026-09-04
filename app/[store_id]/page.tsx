'use client'
import { useParams } from 'next/navigation'

export default function HomePage() {
  const { store_id } = useParams()

  return (
    <div className="p-6 max-w-md mx-auto">
      <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-orange-50 text-center">
        <h1 className="text-3xl font-black text-gray-800 mb-2">🏪 {store_id}店</h1>
        <p className="text-orange-500 font-bold text-sm mb-8">Joyful Shift V2 へようこそ</p>
        
        <div className="space-y-4 text-left">
          <div className="bg-orange-50 p-4 rounded-2xl">
            <p className="text-xs text-orange-700 font-bold mb-1">📢 お知らせ</p>
            <p className="text-sm text-gray-600">10月分の休み希望を受け付けています。下の「📅 休み希望」から入力してください！</p>
          </div>
          
          <div className="p-4 border border-gray-100 rounded-2xl">
            <p className="text-xs text-gray-400 font-bold mb-2">使い方ガイド</p>
            <ul className="text-xs text-gray-500 space-y-2">
              <li>・このページは現在準備中です。</li>
              <li>・確定したシフトは「📊 シフト閲覧」から確認できます。</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}