'use client'
import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { useParams } from 'next/navigation'
import PinLoginModal from '@/components/PinLoginModal'
import { useAdmin } from '@/context/AdminContext'

export default function HomePage() {
  const { store_id } = useParams<{ store_id: string }>()
  const { currentStaff, login } = useAdmin()
  const [isChangingPin, setIsChangingPin] = useState(false)

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="border-b border-[var(--border)] bg-[var(--surface-subtle)] p-6 md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-subtle)]">Store Overview</p>
              <h1 className="text-3xl font-bold text-[var(--text)] md:text-4xl">{store_id}店</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-md border border-[var(--border)] bg-white px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-subtle)]">今月の進捗</p>
                <p className="mt-2 text-2xl font-bold text-[var(--text)]">84%</p>
              </div>
              {currentStaff?.pin_hash && (
                <button type="button" onClick={() => setIsChangingPin(true)} className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 py-3 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-subtle)]">
                  <KeyRound size={15} />暗証番号を変更
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-6 md:grid-cols-[1.4fr_1fr] md:p-8">
          <section className="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] p-5">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-subtle)]">お知らせ</p>
            <p className="text-base font-medium leading-7 text-[var(--text-muted)]">
              10月分の休み希望を受け付けています。休み希望から入力してください。
            </p>
          </section>

          <section className="rounded-md border border-[var(--border)] bg-white p-5">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-subtle)]">今月の目標</p>
            <ul className="space-y-3 text-sm text-[var(--text-muted)]">
              <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[var(--text)]" />シフト確定まで進める</li>
              <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[var(--primary)]" />従業員の希望を確認</li>
              <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[var(--text-subtle)]" />月末にレビューを実施</li>
            </ul>
          </section>

          <section className="rounded-md border border-[var(--border)] bg-white p-5 md:col-span-2">
            <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-subtle)]">使い方ガイド</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
                <p className="text-sm font-bold text-[var(--text)]">1. 休み希望を入力</p>
                <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">日ごとの希望とメモを登録して、従業員の予定を整理します。</p>
              </div>
              <div className="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
                <p className="text-sm font-bold text-[var(--text)]">2. シフトを確認</p>
                <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">生成した内容や予定をシフト閲覧でチェックして、調整します。</p>
              </div>
            </div>
          </section>
        </div>
      </div>
      {isChangingPin && currentStaff && (
        <PinLoginModal
          staff={currentStaff}
          storeId={store_id}
          mode="change"
          onClose={() => setIsChangingPin(false)}
          onSuccess={updatedStaff => {
            login(updatedStaff)
            setIsChangingPin(false)
          }}
        />
      )}
    </div>
  )
}