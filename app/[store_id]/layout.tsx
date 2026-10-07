'use client'

import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, ReactNode } from 'react'
import { ArrowRight, CalendarDays, Eye, House, LogOut, Sparkles, Store, Users, ClipboardList } from 'lucide-react'
import { AdminProvider, CurrentStaff, useAdmin } from '@/context/AdminContext'
import PinLoginModal from '@/components/PinLoginModal'
import { supabase } from '@/lib/supabase'

function StoreLayoutContent({ children }: { children: ReactNode }) {
  const params = useParams()
  const pathname = usePathname()
  const storeId = params.store_id as string
  const router = useRouter()
  const { currentStaff, isHydrated, isEmployee, login, logout } = useAdmin()
  const [storeName, setStoreName] = useState('')
  const [members, setMembers] = useState<CurrentStaff[]>([])
  const [selectedStaff, setSelectedStaff] = useState<CurrentStaff | null>(null)
  const [isLoadingMembers, setIsLoadingMembers] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let isCurrent = true
    const loadStore = async () => {
      if (!storeId) return
      const [storeResult, staffResult] = await Promise.all([
        supabase.from('stores').select('name').eq('store_id', storeId).maybeSingle(),
        supabase.from('staff').select('id, name, is_employee, pin_hash').eq('store_id', storeId).order('name'),
      ])
      if (!isCurrent) return
      if (storeResult.data?.name) setStoreName(storeResult.data.name)
      if (staffResult.error) setLoadError('スタッフ一覧を読み込めませんでした。時間をおいて再度お試しください。')
      else {
        setMembers((staffResult.data || []).map(staff => ({
          id: String(staff.id),
          name: String(staff.name),
          is_employee: Boolean(staff.is_employee),
          pin_hash: typeof staff.pin_hash === 'string' ? staff.pin_hash : null,
        })).sort((left, right) =>
          Number(right.is_employee) - Number(left.is_employee) || left.name.localeCompare(right.name, 'ja')
        ))
      }
      setIsLoadingMembers(false)
    }
    void loadStore().catch(() => {
      if (!isCurrent) return
      setLoadError('店舗情報を読み込めませんでした。')
      setIsLoadingMembers(false)
    })
    return () => {
      isCurrent = false
    }
  }, [storeId])

  const restrictedPath = /^\/[^/]+\/(staff|generate|cleaning)(\/|$)/.test(pathname)
  useEffect(() => {
    if (isHydrated && currentStaff && !isEmployee && restrictedPath) {
      router.replace(`/${encodeURIComponent(storeId)}`)
    }
  }, [currentStaff, isEmployee, isHydrated, restrictedPath, router, storeId])

  if (!isHydrated || isLoadingMembers) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">読み込み中...</div>
  }

  if (!currentStaff) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <section className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm md:p-9">
          <div className="mb-8 flex items-center gap-3 border-b border-slate-200 pb-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white"><Store size={18} /></div>
            <div>
              <p className="text-xs font-medium uppercase text-slate-500">Joyful Shift</p>
              <h1 className="text-xl font-semibold text-slate-900">{storeName || `${storeId}店`}</h1>
            </div>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">お名前を選択してください</h2>
          <p className="mt-1 text-sm text-slate-500">選択すると、この端末でログインします。</p>
          {loadError && <p role="alert" className="mt-5 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{loadError}</p>}
          {!loadError && members.length === 0 ? (
            <p className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-600">登録されているスタッフがいません。</p>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {members.map(member => (
                <button key={member.id} type="button" onClick={() => setSelectedStaff(member)} className="flex min-h-14 items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-3 text-left text-sm font-medium text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50">
                  <span className="truncate">{member.name}</span><ArrowRight size={15} className="shrink-0 text-slate-400" />
                </button>
              ))}
            </div>
          )}
          {selectedStaff && (
            <PinLoginModal
              staff={selectedStaff}
              storeId={storeId}
              onClose={() => setSelectedStaff(null)}
              onSuccess={authenticatedStaff => {
                login(authenticatedStaff)
                setSelectedStaff(null)
              }}
            />
          )}
        </section>
      </main>
    )
  }

  if (!isEmployee && restrictedPath) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><div role="status" className="rounded-lg border border-slate-200 bg-white p-6 text-center"><p className="font-semibold text-slate-900">この機能を利用する権限がありません</p><p className="mt-2 text-sm text-slate-500">ホームへ移動しています...</p></div></div>
  }

  const navItems = [
    { name: 'ホーム', href: `/${storeId}`, icon: House },
    { name: '休み希望', href: `/${storeId}/requests`, icon: CalendarDays },
    { name: '確定シフト', href: `/${storeId}/view`, icon: Eye },
    ...(isEmployee ? [
      { name: '従業員名簿', href: `/${storeId}/staff`, icon: Users },
      { name: 'シフト自動生成', href: `/${storeId}/generate`, icon: Sparkles },
      { name: '清掃記録', href: `/${storeId}/cleaning`, icon: ClipboardList },
    ] : []),
  ]

  return (
    <div className="flex min-h-screen bg-[var(--background)] text-[var(--text)]">
      <aside className="fixed left-0 top-0 z-40 hidden h-full w-[268px] flex-col border-r border-slate-200 bg-white p-6 shadow-sm md:flex">
        <div className="mb-8 flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white"><Store size={18} /></div>
          <div className="min-w-0">
            <p className="text-lg font-bold leading-none text-slate-900">Joyful Shift</p>
            <p className="mt-1 truncate text-[10px] font-medium text-slate-500">{storeName || storeId}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1.5">
          {navItems.map(item => {
            const Icon = item.icon
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Icon size={16} />{item.name}</Link>
          })}
        </nav>
        <div className="mt-6 border-t border-slate-200 pt-4">
          <p className="truncate text-sm font-semibold text-slate-900">{currentStaff.name}</p>
          <p className="mt-0.5 text-xs text-slate-500">{isEmployee ? '社員' : 'アルバイト'}</p>
          <button type="button" onClick={logout} className="mt-3 inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"><LogOut size={14} />名前変更・ログアウト</button>
        </div>
      </aside>

      <main className="w-full flex-1 overflow-visible pb-24 md:ml-[268px] md:pb-10">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 md:hidden">
          <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-900">{currentStaff.name}</p><p className="text-[10px] text-slate-500">{isEmployee ? '社員' : 'アルバイト'}</p></div>
          <button type="button" onClick={logout} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600"><LogOut size={13} />名前変更</button>
        </div>
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 p-2 pb-6 shadow-sm md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-3 gap-y-2">
          {navItems.map(item => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return <Link key={item.href} href={item.href} className="flex min-h-9 flex-col items-center justify-center gap-0.5"><Icon size={16} className={isActive ? 'text-slate-900' : 'text-slate-400'} /><span className={`text-[9px] leading-tight font-medium ${isActive ? 'text-slate-900' : 'text-slate-500'}`}>{item.name}</span></Link>
          })}
        </div>
      </nav>
    </div>
  )
}

export default function StoreLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ store_id: string }>()
  return (
    <AdminProvider storeId={params.store_id}>
      <StoreLayoutContent>{children}</StoreLayoutContent>
    </AdminProvider>
  )
}