'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useUnsavedChanges } from '@/lib/client/app-version'
import { STAFF_CATEGORIES, STAFF_CATEGORY_LABELS, type StaffCategory, isStaffCategory, sortStaff } from '@/lib/staff-order'

export type OrderEditorStaff = { id: string; name: string; category: StaffCategory | null; display_order: number | null; is_employee: boolean }
export type OrderEditorRow = { id: string; category: StaffCategory | null; display_order: number | null }

type GroupKey = StaffCategory | 'none'
const GROUP_KEYS: GroupKey[] = [...STAFF_CATEGORIES, 'none']
const groupLabel = (key: GroupKey) => (key === 'none' ? '区分なし' : STAFF_CATEGORY_LABELS[key])

const toGroups = (staff: OrderEditorStaff[]): Record<GroupKey, string[]> => {
  const groups = Object.fromEntries(GROUP_KEYS.map(key => [key, [] as string[]])) as Record<GroupKey, string[]>
  for (const person of sortStaff(staff)) groups[person.category ?? 'none'].push(person.id)
  return groups
}

/**
 * Roster 並べ替えモード: one list per category, ↑↓ moves inside the category,
 * changing the category moves the person to its end. Saved all at once
 * (category and display order only); until then the reload banner warns.
 */
export default function StaffOrderEditor({ staff, onSave, onCancel }: {
  staff: OrderEditorStaff[]
  /** Resolves to an error message, or null when saved. */
  onSave: (rows: OrderEditorRow[]) => Promise<string | null>
  onCancel: () => void
}) {
  const initial = useMemo(() => toGroups(staff), [staff])
  const [groups, setGroups] = useState(initial)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const byId = useMemo(() => new Map(staff.map(person => [person.id, person])), [staff])
  const isDirty = JSON.stringify(groups) !== JSON.stringify(initial)
  useUnsavedChanges('staff-order', isDirty)

  const move = (key: GroupKey, index: number, delta: -1 | 1) => {
    setGroups(current => {
      const list = [...current[key]]
      const target = index + delta
      if (target < 0 || target >= list.length) return current
      ;[list[index], list[target]] = [list[target], list[index]]
      return { ...current, [key]: list }
    })
  }

  const changeCategory = (id: string, from: GroupKey, to: GroupKey) => {
    if (from === to) return
    setGroups(current => ({ ...current, [from]: current[from].filter(item => item !== id), [to]: [...current[to], id] }))
  }

  const save = async () => {
    setIsSaving(true)
    setError('')
    const rows: OrderEditorRow[] = GROUP_KEYS.flatMap(key => groups[key].map((id, index) => ({
      id,
      category: key === 'none' ? null : key,
      display_order: key === 'none' ? null : index + 1,
    })))
    const message = await onSave(rows)
    setIsSaving(false)
    if (message) setError(message)
  }

  return (
    <section aria-labelledby="staff-order-title" className="mb-8 rounded-md border border-slate-300 bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="staff-order-title" className="text-lg font-bold text-slate-900">並べ替え</h2>
          <p className="mt-1 text-sm text-slate-600">紙の休日申込表と同じ順番です。区分を変えるとその区分の最後に移ります。名簿・ログイン画面・休み希望・Excel・シフト表がこの順になります。</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={isSaving}
            className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">やめる</button>
          <button type="button" onClick={() => void save()} disabled={isSaving || !isDirty}
            className="min-h-11 rounded-md bg-[var(--primary)] px-4 text-sm font-bold text-white hover:bg-[var(--primary-strong)] disabled:bg-slate-300 disabled:text-slate-500">
            {isSaving ? '保存中...' : 'まとめて保存'}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p>}

      <div className="mt-4 space-y-5">
        {GROUP_KEYS.map(key => {
          const ids = groups[key]
          if (key === 'none' && ids.length === 0) return null
          return (
            <div key={key}>
              <h3 className="mb-1.5 text-sm font-bold text-slate-700">{groupLabel(key)} <span className="font-medium text-slate-500">{ids.length}名</span></h3>
              {ids.length === 0
                ? <p className="rounded-md border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">まだいません</p>
                : (
                  <ol className="overflow-hidden rounded-md border border-slate-200">
                    {ids.map((id, index) => {
                      const person = byId.get(id)
                      if (!person) return null
                      return (
                        <li key={id} className="flex min-h-14 items-center gap-2 border-t border-slate-200 bg-white px-3 py-1.5 first:border-t-0">
                          <span className="w-6 shrink-0 text-right text-sm font-bold tabular-nums text-slate-500">{index + 1}</span>
                          <span className="min-w-0 flex-1 truncate text-base font-bold text-slate-900">{person.name}</span>
                          <select aria-label={`${person.name}さんの区分`} value={key} disabled={isSaving}
                            onChange={event => {
                              const value = event.target.value
                              changeCategory(id, key, value === 'none' ? 'none' : isStaffCategory(value) ? value : key)
                            }}
                            className="min-h-12 w-24 shrink-0 rounded-md border border-slate-300 bg-white px-2 text-sm font-bold text-slate-800 outline-none focus:border-slate-500 sm:w-auto">
                            {STAFF_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                            <option value="none">区分なし</option>
                          </select>
                          <button type="button" onClick={() => move(key, index, -1)} disabled={isSaving || index === 0} aria-label={`${person.name}さんを上へ`}
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-30">
                            <ArrowUp size={20} aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => move(key, index, 1)} disabled={isSaving || index === ids.length - 1} aria-label={`${person.name}さんを下へ`}
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-30">
                            <ArrowDown size={20} aria-hidden="true" />
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
