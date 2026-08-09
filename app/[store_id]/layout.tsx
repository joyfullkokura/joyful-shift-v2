'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState, useEffect, ReactNode, use } from 'react'
import { AdminProvider, useAdmin } from '@/context/AdminContext'
import { supabase } from '@/lib/supabase'

// 実際の表示部分を切り出したコンポーネント
function StoreLayoutContent({ children }: { children: ReactNode }) {
  const params = useParams()
  const storeId = params.store_id as string
  const { isAdmin, setIsAdmin } = useAdmin()
  const [password, setPassword] = useState('')
  const [storeName, setStoreName] = useState('')

  // 1. 店舗名とパスワードのチェック
  useEffect(() => {
    const checkAuth = async () => {
      if (!storeId) return

      const { data, error } = await supabase
        .from('stores')
        .select('name, admin_pw')
        .eq('store_id', storeId)
        .single()

      if (data) {
        setStoreName(data.name)
        // パスワードが一致したら管理モードON
        if (password === data.admin_pw) {
          setIsAdmin(true)
        } else {
          setIsAdmin(false)
        }
      }
    }
    checkAuth()
  }, [password, storeId, setIsAdmin])

  return (
    <div className="flex min-h-screen bg-gray-50 text-gray-900 font-sans">
      {/* サイドバー：もとのオレンジ色を継承 */}
      <aside className="w-64 bg-orange-600 text-white p-6 shadow-xl hidden md:flex flex-col fixed h-full">
        <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
          🏪 Joyful Shift V2
        </h2>
        <p className="text-orange-100 text-[10px] font-bold mb-8 uppercase tracking-widest">
          {storeName || storeId}
        </p>

        <nav className="space-y-4 flex-1">
          <Link href={`/${storeId}`} className="block hover:bg-orange-500 p-2 rounded transition-all">🏠 ホーム</Link>
          <Link href={`/${storeId}/staff`} className="block hover:bg-orange-500 p-2 rounded transition-all">👥 従業員名簿</Link>
          <Link href={`/${storeId}/requests`} className="block hover:bg-orange-500 p-2 rounded transition-all">📅 休み希望入力</Link>
          <Link href={`/${storeId}/view`} className="block hover:bg-orange-500 p-2 rounded transition-all">📊 確定シフト閲覧</Link>
        </nav>
        
        {/* パスワード入力エリア */}
        <div className="mt-auto pt-6 border-t border-orange-400">
          <label className="text-[10px] text-orange-200 uppercase tracking-widest block mb-2 font-bold">管理者パスワード</label>
          <input
            type="password"
            placeholder="****"
            className="w-full bg-orange-700 border-none rounded-xl p-3 text-sm text-white placeholder-orange-300 focus:ring-2 focus:ring-white outline-none shadow-inner"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {isAdmin && (
            <div className="flex items-center gap-2 mt-3 text-white bg-orange-500/50 p-2 rounded-lg animate-pulse">
              <span className="text-xs font-black">🔓 ADMIN MODE</span>
            </div>
          )}
        </div>
      </aside>

      {/* メインコンテンツエリア：サイドバーの幅だけ左に余白を開ける */}
      <main className="flex-1 md:ml-64 p-4 md:p-10">
        {children}
      </main>
    </div>
  )
}

// ページ全体を AdminProvider で包んでエクスポート
export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <AdminProvider>
      <StoreLayoutContent>{children}</StoreLayoutContent>
    </AdminProvider>
  )
}