'use client'

import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { useState, useEffect, ReactNode } from 'react'
import { AdminProvider, useAdmin } from '@/context/AdminContext'
import { supabase } from '@/lib/supabase'

function StoreLayoutContent({ children }: { children: ReactNode }) {
  const params = useParams()
  const pathname = usePathname()
  const storeId = params.store_id as string
  const { isAdmin, setIsAdmin } = useAdmin()
  const [password, setPassword] = useState('')
  const [storeName, setStoreName] = useState('')
  
  useEffect(() => {
    const checkAuth = async () => {
      if (!storeId) return
      const { data } = await supabase
        .from('stores')
        .select('name, admin_pw')
        .eq('store_id', storeId)
        .single()

      if (data) {
        setStoreName(data.name)
        if (password === data.admin_pw) setIsAdmin(true)
        else setIsAdmin(false)
      }
    }
    checkAuth()
  }, [password, storeId, setIsAdmin])

  // 従業員も使う基本メニュー
  const navItems = [
    { name: 'ホーム', href: `/${storeId}`, icon: '🏠' },
    { name: '休み希望', href: `/${storeId}/requests`, icon: '📅' },
    { name: 'シフト閲覧', href: `/${storeId}/view`, icon: '📊' },
  ]

  return (
    <div className="flex min-h-screen bg-gray-50 text-gray-900 font-sans">
      {/* --- 【PC用】サイドバー（md以上で表示） --- */}
      <aside className="w-64 bg-orange-600 text-white p-6 shadow-xl hidden md:flex flex-col fixed h-full z-40">
        <h2 className="text-xl font-bold mb-1 flex items-center gap-2">🏪 Joyful Shift V2</h2>
        <p className="text-orange-100 text-[10px] font-bold mb-8 uppercase tracking-widest">{storeName || storeId}</p>

        <nav className="space-y-4 flex-1">
          {navItems.map((item) => (
            <Link 
              key={item.href} 
              href={item.href} 
              className={`block p-2 rounded transition-all ${pathname === item.href ? 'bg-orange-700 font-bold shadow-inner' : 'hover:bg-orange-500'}`}
            >
              {item.icon} {item.name}
            </Link>
          ))}

          {/* --- 管理者専用メニュー（パスワード認証時のみ出現） --- */}
          {isAdmin && (
            <div className="pt-6 mt-6 border-t border-orange-400/50 space-y-2">
              <p className="text-[10px] text-orange-200 font-black uppercase tracking-widest mb-4">Manager Menu</p>
              
              <Link 
                href={`/${storeId}/staff`} 
                className={`block p-2 rounded transition-all ${pathname.includes('/staff') ? 'bg-orange-700 font-bold shadow-inner' : 'hover:bg-orange-500'}`}
              >
                👥 従業員名簿
              </Link>
              
              <Link 
                href={`/${storeId}/generate`} 
                className={`block p-2 rounded transition-all ${pathname.includes('/generate') ? 'bg-orange-700 font-bold shadow-inner' : 'hover:bg-orange-500'}`}
              >
                🤖 シフト自動生成
              </Link>

              <Link 
                href={`/${storeId}/cleaning`} 
                className={`block p-2 rounded transition-all ${pathname.includes('/cleaning') ? 'bg-orange-700 font-bold shadow-inner' : 'hover:bg-orange-500'}`}
              >
                🧹 清掃記録
              </Link>
            </div>
          )}
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
            <div className="flex items-center gap-2 mt-3 text-white bg-green-500/80 p-2 rounded-lg">
              <span className="text-[10px] font-black italic">ADMIN AUTHENTICATED</span>
            </div>
          )}
        </div>
      </aside>

      {/* --- 【スマホ用】ボトムナビ（生成メニューは出さない） --- */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-gray-200 flex justify-around items-center p-2 pb-6 z-50">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link key={item.href} href={item.href} className="flex flex-col items-center gap-1 min-w-[64px]">
              <span className={`text-xl transition-all ${isActive ? 'scale-125' : 'opacity-50'}`}>{item.icon}</span>
              <span className={`text-[10px] font-bold ${isActive ? 'text-orange-600' : 'text-gray-400'}`}>{item.name}</span>
            </Link>
          )
        })}
      </nav>

      {/* メインコンテンツエリア */}
      <main className="flex-1 md:ml-64 w-full max-w-full overflow-x-hidden px-0 md:px-10 pb-24 md:pb-10">
        {children}
      </main>
    </div>
  )
}

export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <AdminProvider>
      <StoreLayoutContent>{children}</StoreLayoutContent>
    </AdminProvider>
  )
}