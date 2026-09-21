'use client'
import { useParams } from 'next/navigation'

export default function ViewShiftPage() {
  const { store_id } = useParams()

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <div className="rounded-lg border border-[var(--border)] bg-white p-8 text-center shadow-sm md:p-12">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-md bg-slate-100 text-2xl text-slate-500">•</div>
        <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-subtle)]">Shift View</p>
        <h2 className="text-3xl font-bold text-[var(--text)]">確定シフト閲覧</h2>
        <p className="mx-auto mt-4 max-w-lg text-base leading-7 text-[var(--text-muted)]">
          確定したシフトはここから確認できるようにします。しばらくお待ちください。
        </p>
        <div className="mt-6 inline-flex items-center rounded-md border border-[var(--border)] bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
          {store_id} store
        </div>
      </div>
    </div>
  )
}