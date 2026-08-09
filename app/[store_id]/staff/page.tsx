'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation' // 追加：URLを読み取る道具

export default function StaffPage() {
  const params = useParams()
  const storeId = params.store_id as string // URLから KOKURA や WAJIRO を取得
  const [staff, setStaff] = useState<any[]>([])
// --- ここを追加 ---
const [newName, setNewName] = useState('') // 入力中の名前を覚える箱
const [isSubmitting, setIsSubmitting] = useState(false) // 送信中かどうかを管理
  useEffect(() => {
    const fetchStaff = async () => {
      // ★ 修正ポイント： .eq() を使ってフィルタリングする
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .eq('store_id', storeId) // 「store_id列が今の店舗IDと一致する人」という条件
      
      if (error) {
        console.error('Error fetching staff:', error)
      } else {
        setStaff(data || [])
      }
    }

    if (storeId) {
      fetchStaff()
    }
  }, [storeId]) // storeIdが変わるたびに実行
// メンバーの登録フォーム
const handleAddStaff = async () => {
  if (!newName.trim()) return // 名前が空（スペースのみも含む）なら何もしない
  
  setIsSubmitting(true) // 「登録中...」状態にしてボタンを無効化する

  // Supabaseにデータを送る
  const { data, error } = await supabase
    .from('staff') // 'staff'テーブルに対して
    .insert([
      { 
        name: newName,      // 入力された名前
        store_id: storeId,  // ★重要：今開いている店舗ID（KOKURA等）を紐付ける
        main_job: '未設定',   // 初期値を入れておく
        rank: 'B'           // 初期値を入れておく
      }
    ])
    .select() // 追加したデータを結果として返してもらう命令

  if (error) {
    alert('登録に失敗しました: ' + error.message) // エラーが出たら画面に通知
  } else {
    // 成功したら、今のスタッフ一覧（staff）の末尾に、新しく増えた人(data[0])を追加して画面を更新する
    if (data) {
      setStaff([...staff, data[0]]) 
    }
    setNewName('') // 入力欄を空っぽに戻す
  }

  setIsSubmitting(false) // 「登録中」状態を解除する
}
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6 text-orange-600">
        👥 {storeId}店 スタッフ一覧
      </h1>
      {/* スタッフ追加フォーム */}
      <div className="bg-orange-50 p-6 rounded-2xl mb-8 border border-orange-200">
        <h2 className="text-sm font-bold text-orange-700 mb-4">🆕 新規スタッフ登録</h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="スタッフの名前"
            className="flex-1 p-3 rounded-xl border-none shadow-inner focus:ring-2 focus:ring-orange-500 outline-none"
            value={newName}
            onChange={(e) => setNewName(e.target.value)} // 文字を打つたびに newName を更新する
          />
          <button
            onClick={handleAddStaff} // ボタンを押した時に実行する関数（次で作ります）
            disabled={!newName || isSubmitting}
            className="bg-orange-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-orange-700 disabled:opacity-50 transition-all shadow-md"
          >
            {isSubmitting ? '登録中...' : '登録'}
          </button>
        </div>
      </div>
      <div className="grid gap-4">
        {staff.length === 0 ? (
          <p className="text-gray-500">この店舗にはスタッフが登録されていません。</p>
        ) : (
          staff.map((person) => (
            <div key={person.id} className="bg-white px-4 py-2 rounded-xl shadow-sm border border-gray-100 hover:border-orange-300 transition-all mb-2 text-sm">
              
              {/* 1行目：名前・区分・職種・日数・ランクを横に並べる */}
              <div className="flex items-center gap-4">
                {/* 名前と社員区分 */}
                <div className="w-40 flex-shrink-0 flex items-center gap-2">
                  <span className="font-bold text-gray-800 text-base truncate">{person.name}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${person.is_employee ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                    {person.is_employee ? '正' : 'ア'}
                  </span>
                </div>

                {/* メイン職種 */}
                <div className="w-24">
                  <span className="text-gray-400 text-[9px] block">職種</span>
                  <span className="font-medium">{person.main_job || 'ー'}</span>
                </div>

                {/* 週希望日数 */}
                <div className="w-20">
                  <span className="text-gray-400 text-[9px] block">週希望</span>
                  <span className="font-medium">{person.weekly_target_days}日</span>
                </div>

                {/* 可能グループ（タグ） */}
                <div className="flex-1 overflow-hidden">
                  <span className="text-gray-400 text-[9px] block">可能グループ</span>
                  <div className="flex gap-1 truncate">
                    {person.possible_groups?.split(',').map((g: string) => (
                      <span key={g} className="bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded text-[9px] border border-gray-100">{g}</span>
                    )) || <span className="text-gray-300 text-[10px]">ー</span>}
                  </div>
                </div>

                {/* ランク */}
                <div className="w-12 text-center">
                  <span className="text-gray-400 text-[9px] block">ランク</span>
                  <span className="font-black text-gray-700">{person.rank}</span>
                </div>
              </div>

              {/* 2行目：時間・スキル・備考をコンパクトに並べる（少し薄い色で） */}
              <div className="flex items-center gap-4 mt-1 pt-1 border-t border-gray-50">
                {/* 勤務時間 */}
                <div className="w-64 text-gray-500 text-[11px] flex gap-2">
                  <span className="bg-orange-50 text-orange-600 px-2 rounded">
                    枠1: {person.work_start_1?.slice(0,5)}-{person.work_end_1?.slice(0,5)}
                  </span>
                  {person.work_start_2 && (
                    <span className="bg-orange-50 text-orange-600 px-2 rounded">
                      枠2: {person.work_start_2?.slice(0,5)}-{person.work_end_2?.slice(0,5)}
                    </span>
                  )}
                </div>

                {/* スキル */}
                <div className="flex-1 flex gap-1 truncate">
                  {person.skills?.split(',').map((s: string) => (
                    <span key={s} className="text-orange-400 text-[10px]">#{s}</span>
                  ))}
                </div>

                {/* 備考（短く表示） */}
                <div className="w-48 text-right truncate italic text-gray-400 text-[11px]">
                  {person.memo}
                </div>
              </div>

            </div>
          ))
        )}
      </div>
    </div>
  )
}