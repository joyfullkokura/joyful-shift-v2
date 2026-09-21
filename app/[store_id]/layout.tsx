'use client'

import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { useState, useEffect, ReactNode } from 'react'
import { House, CalendarDays, Eye, Users, Sparkles, ClipboardList, ShieldCheck, Store } from 'lucide-react'
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

  const navItems = [
    { name: 'ホーム', href: `/${storeId}`, icon: House },
    { name: '休み希望', href: `/${storeId}/requests`, icon: CalendarDays },
    { name: 'シフト閲覧', href: `/${storeId}/view`, icon: Eye },
  ]

  return (
    <div className="flex min-h-screen bg-[var(--background)] text-[var(--text)]">
      <aside className="fixed left-0 top-0 z-40 hidden h-full w-[268px] flex-col border-r border-[var(--border)] bg-white p-6 shadow-sm md:flex">
        <div className="mb-8 flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--text)] text-white">
            <Store size={18} />
          </div>
          <div>
            <p className="text-lg font-bold leading-none text-[var(--text)]">Joyful Shift</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-subtle)]">{storeName || storeId}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-bold transition-colors ${isActive ? 'bg-[var(--surface-strong)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface-subtle)]'}`}
              >
                <Icon size={16} />
                {item.name}
              </Link>
            )
          })}

          {isAdmin && (
            <div className="mt-8 border-t border-[var(--border)] pt-5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-subtle)]">Manager Menu</p>
              <div className="space-y-1.5">
                <Link href={`/${storeId}/staff`} className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-bold transition-colors ${pathname.includes('/staff') ? 'bg-[var(--surface-strong)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface-subtle)]'}`}>
                  <Users size={16} />
                  従業員名簿
                </Link>
                <Link href={`/${storeId}/generate`} className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-bold transition-colors ${pathname.includes('/generate') ? 'bg-[var(--surface-strong)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface-subtle)]'}`}>
                  <Sparkles size={16} />
                  シフト自動生成
                </Link>
                <Link href={`/${storeId}/cleaning`} className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-bold transition-colors ${pathname.includes('/cleaning') ? 'bg-[var(--surface-strong)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface-subtle)]'}`}>
                  <ClipboardList size={16} />
                  清掃記録
                </Link>
              </div>
            </div>
          )}
        </nav>

        <div className="mt-auto rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
          <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-subtle)]">管理者パスワード</label>
          <input
            type="password"
            placeholder="****"
            className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {isAdmin && (
            <div className="mt-3 flex items-center gap-2 rounded-md bg-[#ecfdf5] px-2.5 py-2 text-[10px] font-bold text-[#065f46]">
              <ShieldCheck size={12} />
              ADMIN AUTHENTICATED
            </div>
          )}
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border)] bg-white/95 p-2 pb-6 shadow-sm md:hidden">
        <div className="mx-auto flex max-w-md items-center justify-around">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return (
              <Link key={item.href} href={item.href} className="flex min-w-[76px] flex-col items-center gap-1">
                <Icon size={18} className={isActive ? 'text-[var(--text)]' : 'text-[var(--text-subtle)]'} />
                <span className={`text-[10px] font-bold ${isActive ? 'text-[var(--text)]' : 'text-[var(--text-subtle)]'}`}>{item.name}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      <main className="w-full flex-1 overflow-visible pb-24 md:ml-[268px] md:pb-10">{children}</main>
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