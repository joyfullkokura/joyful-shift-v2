'use client'
import { useParams } from 'next/navigation'

export default function ViewShiftPage() {
  const { store_id } = useParams()

  return (
    <div className="p-6 max-w-md mx-auto text-center">
      <div className="py-20 bg-white rounded-[2.5rem] shadow-sm border border-gray-100">
        <span className="text-6xl mb-4 block">🤖</span>
        <h2 className="text-xl font-black text-gray-800 mb-2">確定シフト閲覧</h2>
        <p className="text-gray-400 text-sm px-10">
          確定したシフトはここから確認できるようにします。しばらくお待ちください！
        </p>
      </div>
    </div>
  )
}