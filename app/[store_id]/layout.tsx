'use client'

import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, ReactNode } from 'react'
import { ArrowRight, CalendarDays, Eye, House, LogOut, Sparkles, Store, Users, ClipboardList, UserPlus, X } from 'lucide-react'
import { AdminProvider, CurrentStaff, useAdmin } from '@/context/AdminContext'
import PinLoginModal from '@/components/PinLoginModal'
import { supabase } from '@/lib/supabase'

type NewStaffRequestDetails = {
  name: string
  employment_type: string
  main_job: string
  weekly_target_days: number
}

const hashPin = async (pin: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

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
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false)
  const [isRegistrationModalOpen, setIsRegistrationModalOpen] = useState(false)
  const [newStaffName, setNewStaffName] = useState('')
  const [newStaffEmploymentType, setNewStaffEmploymentType] = useState('アルバイト')
  const [newStaffMainJob, setNewStaffMainJob] = useState('ホール')
  const [newStaffWorkDays, setNewStaffWorkDays] = useState('3')
  const [newStaffPin, setNewStaffPin] = useState('')
  const [registrationError, setRegistrationError] = useState('')
  const [registrationMessage, setRegistrationMessage] = useState('')
  const [isSubmittingRegistration, setIsSubmittingRegistration] = useState(false)

  useEffect(() => {
    let isCurrent = true
    const loadStore = async () => {
      if (!storeId) return
      const [storeResult, staffResult, pendingNewStaffResult] = await Promise.all([
        supabase.from('stores').select('name').eq('store_id', storeId).maybeSingle(),
        supabase.from('staff').select('id, name, is_employee, pin_hash').eq('store_id', storeId).order('name'),
        supabase.from('staff_requests').select('staff_id').eq('store_id', storeId).eq('type', 'new_staff').eq('status', 'pending'),
      ])
      if (!isCurrent) return
      if (storeResult.data?.name) setStoreName(storeResult.data.name)
      if (staffResult.error || pendingNewStaffResult.error) setLoadError('スタッフ一覧を読み込めませんでした。時間をおいて再度お試しください。')
      else {
        const pendingStaffIds = new Set((pendingNewStaffResult.data || []).map(request => String(request.staff_id)))
        setMembers((staffResult.data || []).map(staff => ({
          id: String(staff.id),
          name: String(staff.name),
          is_employee: Boolean(staff.is_employee),
          pin_hash: typeof staff.pin_hash === 'string' ? staff.pin_hash : null,
        })).filter(staff => !pendingStaffIds.has(staff.id)).sort((left, right) =>
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

  useEffect(() => {
    let isCurrent = true
    const loadUnreadNotifications = async () => {
      if (!currentStaff?.id) {
        if (isCurrent) setHasUnreadNotifications(false)
        return
      }
      const query = isEmployee
        ? supabase
          .from('staff_requests')
          .select('id', { count: 'exact', head: true })
          .eq('store_id', storeId)
          .eq('status', 'pending')
        : supabase
          .from('staff_requests')
          .select('id', { count: 'exact', head: true })
          .eq('store_id', storeId)
          .eq('staff_id', currentStaff.id)
          .eq('is_read_by_staff', false)
          .neq('status', 'pending')
      const { count, error } = await query
      if (!isCurrent || error) return
      setHasUnreadNotifications((count || 0) > 0)
    }
    const refreshUnreadNotifications = () => { void loadUnreadNotifications() }
    void loadUnreadNotifications()
    window.addEventListener('staff-request-updated', refreshUnreadNotifications)
    return () => {
      isCurrent = false
      window.removeEventListener('staff-request-updated', refreshUnreadNotifications)
    }
  }, [currentStaff?.id, isEmployee, storeId])

  const restrictedPath = /^\/[^/]+\/(staff|generate|cleaning)(\/|$)/.test(pathname)
  useEffect(() => {
    if (isHydrated && currentStaff && !isEmployee && restrictedPath) {
      router.replace(`/${encodeURIComponent(storeId)}`)
    }
  }, [currentStaff, isEmployee, isHydrated, restrictedPath, router, storeId])

  const submitNewStaffRegistration = async () => {
    const name = newStaffName.trim()
    if (!name) {
      setRegistrationError('お名前を入力してください。')
      return
    }
    if (!/^\d{4,8}$/.test(newStaffPin)) {
      setRegistrationError('暗証番号は4〜8桁の数字で入力してください。')
      return
    }
    setIsSubmittingRegistration(true)
    setRegistrationError('')
    try {
      const pinHash = await hashPin(newStaffPin)
      const { data: staff, error: staffError } = await supabase
        .from('staff')
        .insert({
          store_id: storeId,
          name,
          pin_hash: pinHash,
          is_employee: false,
          main_job: newStaffMainJob,
          weekly_target_days: Number(newStaffWorkDays),
        })
        .select('id')
        .single()
      if (staffError) throw staffError
      const details: NewStaffRequestDetails = {
        name,
        employment_type: newStaffEmploymentType,
        main_job: newStaffMainJob,
        weekly_target_days: Number(newStaffWorkDays),
      }
      const { error: requestError } = await supabase
        .from('staff_requests')
        .insert({
          store_id: storeId,
          staff_id: staff.id,
          type: 'new_staff',
          details,
          status: 'pending',
        })
      if (requestError) {
        await supabase.from('staff').delete().eq('id', staff.id).eq('store_id', storeId)
        throw requestError
      }
      setRegistrationMessage('店長へ登録申請を送信しました。承認後にログインが可能になります。')
      setNewStaffName('')
      setNewStaffPin('')
      window.dispatchEvent(new Event('staff-request-updated'))
    } catch (caughtError) {
      setRegistrationError(caughtError instanceof Error ? caughtError.message : '登録申請を送信できませんでした。')
    } finally {
      setIsSubmittingRegistration(false)
    }
  }

  const openRegistrationModal = () => {
    setRegistrationError('')
    setRegistrationMessage('')
    setIsRegistrationModalOpen(true)
  }

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
          <div className="mt-6 border-t border-slate-200 pt-5">
            <button type="button" onClick={openRegistrationModal} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"><UserPlus size={16} className="text-slate-500" />新規スタッフ登録（初めての方）</button>
          </div>
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
          {isRegistrationModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setIsRegistrationModalOpen(false) }}>
              <section role="dialog" aria-modal="true" aria-labelledby="new-staff-registration-title" className="w-full max-w-md rounded-md border border-slate-200 bg-white shadow-2xl">
                <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
                  <div><h2 id="new-staff-registration-title" className="text-sm font-semibold text-slate-800">新規スタッフ登録</h2><p className="mt-1 text-xs text-slate-500">店長の承認後にログインできるようになります。</p></div>
                  <button type="button" onClick={() => setIsRegistrationModalOpen(false)} className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100" aria-label="閉じる"><X size={18} /></button>
                </div>
                {registrationMessage ? (
                  <div className="p-5"><p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">{registrationMessage}</p><div className="mt-5 flex justify-end"><button type="button" onClick={() => setIsRegistrationModalOpen(false)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50">閉じる</button></div></div>
                ) : (
                  <div className="space-y-4 p-5">
                    <label className="block"><span className="text-xs font-medium text-slate-700">お名前</span><input value={newStaffName} onChange={event => setNewStaffName(event.target.value)} autoComplete="name" className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500" /></label>
                    <label className="block"><span className="text-xs font-medium text-slate-700">雇用区分</span><select value={newStaffEmploymentType} onChange={event => setNewStaffEmploymentType(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500"><option value="アルバイト">アルバイト</option><option value="パート">パート</option><option value="社員">社員</option></select><span className="mt-1 block text-xs text-slate-500">社員を選んだ場合も、店長の承認まではスタッフ権限で登録されます。</span></label>
                    <label className="block"><span className="text-xs font-medium text-slate-700">メイン職種</span><select value={newStaffMainJob} onChange={event => setNewStaffMainJob(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500"><option value="ホール">ホール</option><option value="キッチン">キッチン</option><option value="共通">共通</option></select></label>
                    <label className="block"><span className="text-xs font-medium text-slate-700">週の希望勤務日数</span><select value={newStaffWorkDays} onChange={event => setNewStaffWorkDays(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500">{[1, 2, 3, 4, 5, 6].map(days => <option key={days} value={days}>週{days}日</option>)}</select></label>
                    <label className="block"><span className="text-xs font-medium text-slate-700">暗証番号</span><input type="password" inputMode="numeric" pattern="[0-9]*" value={newStaffPin} onChange={event => setNewStaffPin(event.target.value.replace(/\D/g, '').slice(0, 8))} autoComplete="new-password" className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500" /><span className="mt-1 block text-xs text-slate-500">4〜8桁の数字</span></label>
                    {registrationError && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{registrationError}</p>}
                    <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={() => setIsRegistrationModalOpen(false)} disabled={isSubmittingRegistration} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50">キャンセル</button><button type="button" onClick={() => void submitNewStaffRegistration()} disabled={isSubmittingRegistration} className="rounded-md bg-slate-800 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50">登録を申請する</button></div>
                  </div>
                )}
              </section>
            </div>
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
  const isNavItemActive = (href: string) => pathname === href || (href === `/${storeId}` && pathname === `/${storeId}/`)

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
            const isActive = isNavItemActive(item.href)
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
            const isActive = isNavItemActive(item.href)
            const showNotificationDot = item.href === `/${storeId}` && hasUnreadNotifications
            return <Link key={item.href} href={item.href} className="flex min-h-9 flex-col items-center justify-center gap-0.5"><span className="relative"><Icon size={16} className={isActive ? 'text-slate-900' : 'text-slate-400'} />{showNotificationDot && <span aria-label="未読通知あり" className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />}</span><span className={`text-[9px] leading-tight font-medium ${isActive ? 'text-slate-900' : 'text-slate-500'}`}>{item.name}</span></Link>
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
