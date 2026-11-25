'use client'

import { useEffect, useState } from 'react'
import { addStaff, deleteStaff, getStaffPageData, saveStaffMember, saveStaffOrder, saveStaffRoster } from '@/app/actions/staff'
import StaffOrderEditor, { type OrderEditorRow } from '@/components/StaffOrderEditor'
import { ArrowUpDown } from 'lucide-react'
import { parseSkillOptions } from '@/lib/skill-options'
import { type BusinessHours, DEFAULT_BUSINESS_HOURS } from '@/lib/day-request'
import {
  completeWeeklyAvailability,
  formatWeeklyAvailability,
  parseWeeklyAvailability,
  weeklyFromWorkRanges,
  type WeeklyAvailabilityDraft,
} from '@/lib/weekly-availability'
import WeeklyAvailabilityEditor from '@/components/WeeklyAvailabilityEditor'
import { useUnsavedChanges } from '@/lib/client/app-version'
import { useParams } from 'next/navigation'
import { useAdmin } from '@/context/AdminContext'
import type { DataRow } from '@/lib/action-result'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useFlash } from '@/components/FlashMessage'
import { type StaffCategory, isStaffCategory, sortStaff } from '@/lib/staff-order'

/** One roster row as edited on this screen. Only these fields are sent back and saved. */
type RosterStaff = {
  id: string
  name: string
  rank: string | null
  main_job: string | null
  weekly_target_days: number | null
  is_employee: boolean
  memo: string | null
  skills: string | null
  work_start_1: string | null
  work_end_1: string | null
  work_start_2: string | null
  work_end_2: string | null
  parsed_conditions: unknown
  /** Saved on its own (weekday dialog), never by the bulk save. */
  weekly_availability: unknown
  /** Paper-form order; changed in the reorder mode only. */
  category: StaffCategory | null
  display_order: number | null
}

type EditableField = Exclude<keyof RosterStaff, 'id' | 'parsed_conditions' | 'weekly_availability' | 'category' | 'display_order'>

/** Fields sent by the bulk / detail save: everything editable except the weekday choices. */
const toSavePayload = (person: RosterStaff) => {
  const payload: Partial<RosterStaff> = { ...person }
  delete payload.weekly_availability
  delete payload.parsed_conditions
  delete payload.category
  delete payload.display_order
  return payload
}

const textOrNull = (value: unknown) => (typeof value === 'string' ? value : null)

const toRosterStaff = (row: DataRow): RosterStaff => ({
  id: String(row.id),
  name: typeof row.name === 'string' ? row.name : '',
  rank: textOrNull(row.rank),
  main_job: textOrNull(row.main_job),
  weekly_target_days: typeof row.weekly_target_days === 'number' ? row.weekly_target_days : null,
  is_employee: row.is_employee === true,
  memo: textOrNull(row.memo),
  // skills has been stored both as text and as an array; the screen edits it as text.
  skills: Array.isArray(row.skills) ? row.skills.filter((skill): skill is string => typeof skill === 'string').join(',') : textOrNull(row.skills),
  work_start_1: textOrNull(row.work_start_1),
  work_end_1: textOrNull(row.work_end_1),
  work_start_2: textOrNull(row.work_start_2),
  work_end_2: textOrNull(row.work_end_2),
  parsed_conditions: row.parsed_conditions,
  weekly_availability: row.weekly_availability,
  category: isStaffCategory(row.category) ? row.category : null,
  display_order: typeof row.display_order === 'number' ? row.display_order : null,
})

export default function StaffPage() {
  const params = useParams()
  const storeId = params.store_id as string
  const { isAdmin } = useAdmin()

  // --- 状態管理（State） ---
  const [staff, setStaff] = useState<RosterStaff[]>([])
  const [newName, setNewName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSaving, setIsBulkSaving] = useState(false)
  const [newStaffId, setNewStaffId] = useState<string | null>(null)
  const [isNewStaffSaving, setIsNewStaffSaving] = useState(false)
  const [skillOptions, setSkillOptions] = useState<string[]>([])
  const [suggestionTarget, setSuggestionTarget] = useState<{ personId: string; slot: 'slot1' | 'slot2' } | null>(null)
  const [staffPendingDeletion, setStaffPendingDeletion] = useState<RosterStaff | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [hours, setHours] = useState<BusinessHours>(DEFAULT_BUSINESS_HOURS)
  const [weeklyTarget, setWeeklyTarget] = useState<{ id: string; name: string; draft: WeeklyAvailabilityDraft } | null>(null)
  const [isWeeklySaving, setIsWeeklySaving] = useState(false)
  /** Roster edits not yet saved with 「全員の変更を一括保存」 (the reload banner warns about them). */
  const [hasRosterEdits, setHasRosterEdits] = useState(false)
  /** 並べ替えモード (category / display order only). */
  const [isOrdering, setIsOrdering] = useState(false)
  useUnsavedChanges('staff', hasRosterEdits)
  const { notify } = useFlash()

  // --- 1. データ読み込み（スタッフ名簿 ＋ 店舗のスキル設定） ---
  useEffect(() => {
    const fetchData = async () => {
      if (!storeId) return
      
      // Loaded on the server (admin only) so pin_hash never reaches the browser.
      const result = await getStaffPageData(storeId)
      if (!result.ok) {
        notify('名簿を読み込めませんでした: ' + result.error, 'error')
        return
      }
      setStaff(result.data.staff.map(toRosterStaff))
      setHasRosterEdits(false)
      setSkillOptions(parseSkillOptions(result.data.skillOptions))
      setHours(result.data.hours)
    }
    fetchData()
  }, [notify, storeId])

  // --- 2. 新規登録処理 ---
  const handleAddStaff = async () => {
    if (!newName.trim()) return
    setIsSubmitting(true)
    const result = await addStaff(storeId, newName)
    if (!result.ok) notify('登録できませんでした: ' + result.error, 'error')
    else {
      setStaff(result.data.staff.map(toRosterStaff))
      setNewStaffId(result.data.id)
      setNewName('')
    }
    setIsSubmitting(false)
  }

  // --- 3. 編集用ヘルパー関数 ---
  const handleUpdateField = <K extends EditableField>(id: string, field: K, value: RosterStaff[K]) => {
    setStaff(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))
    setHasRosterEdits(true)
  }

  const handleToggleSkill = (personId: string, skillName: string) => {
    setHasRosterEdits(true)
    setStaff(prev => prev.map(p => {
      if (p.id !== personId) return p
      let currentSkills = parseSkillOptions(p.skills)
      if (currentSkills.includes(skillName)) {
        currentSkills = currentSkills.filter((s: string) => s !== skillName)
      } else {
        currentSkills.push(skillName)
      }
      return { ...p, skills: currentSkills.join(',') }
    }))
  }

  const handleBulkSave = async () => {
    setIsBulkSaving(true)
    // Only editable fields of this store's existing staff are written (checked on the server).
    const result = await saveStaffRoster(storeId, staff.map(toSavePayload))
    if (!result.ok) notify('保存できませんでした: ' + result.error, 'error')
    else {
      notify('すべての変更を保存しました。')
      setHasRosterEdits(false)
    }
    setIsBulkSaving(false)
  }

  /** Runs after the in-page confirmation (ConfirmDialog). */
  const handleDeleteStaff = async (person: RosterStaff) => {
    setIsDeleting(true)
    const result = await deleteStaff(storeId, person.id)
    setIsDeleting(false)
    setStaffPendingDeletion(null)
    if (!result.ok) {
      notify('削除できませんでした: ' + result.error, 'error')
      return
    }
    setStaff(prev => prev.filter(item => item.id !== person.id))
    notify(`${person.name || 'スタッフ'}さんを名簿から削除しました。`)
  }

  const handleSaveNewStaffDetails = async () => {
    const newStaff = staff.find((person) => person.id === newStaffId)
    if (!newStaff) return

    setIsNewStaffSaving(true)
    const result = await saveStaffMember(storeId, toSavePayload(newStaff))
    if (!result.ok) {
      notify('詳細を保存できませんでした: ' + result.error, 'error')
    } else {
      setNewStaffId(null)
    }
    setIsNewStaffSaving(false)
  }

  const saveOrder = async (rows: OrderEditorRow[]): Promise<string | null> => {
    const result = await saveStaffOrder(storeId, rows)
    if (!result.ok) return result.error
    const byId = new Map(rows.map(row => [row.id, row]))
    setStaff(prev => prev.map(person => {
      const row = byId.get(person.id)
      return row ? { ...person, category: row.category, display_order: row.display_order } : person
    }))
    setIsOrdering(false)
    notify('並び順を保存しました。')
    return null
  }

  const openWeeklyEditor = (person: RosterStaff) => {
    setWeeklyTarget({
      id: person.id,
      name: person.name,
      draft: parseWeeklyAvailability(person.weekly_availability) ?? weeklyFromWorkRanges(person.work_start_1, person.work_end_1),
    })
  }

  const saveWeekly = async () => {
    if (!weeklyTarget) return
    const weekly = completeWeeklyAvailability(weeklyTarget.draft)
    if (!weekly) {
      notify('すべての曜日を選んでください。', 'error')
      return
    }
    setIsWeeklySaving(true)
    const result = await saveStaffMember(storeId, { id: weeklyTarget.id, weekly_availability: weekly })
    setIsWeeklySaving(false)
    if (!result.ok) {
      notify('保存できませんでした: ' + result.error, 'error')
      return
    }
    setStaff(prev => prev.map(person => person.id === weeklyTarget.id ? { ...person, weekly_availability: weekly } : person))
    notify(`${weeklyTarget.name}さんの出勤できる時間を保存しました。`)
    setWeeklyTarget(null)
  }

  const getWorkTimeSuggestions = (person: RosterStaff, slot: 'slot1' | 'slot2') => {
    const collected: { label: string; start: string; end: string }[] = []

    staff
      .filter((p) => p.id !== person.id)
      .forEach((p) => {
        const start = slot === 'slot1' ? p.work_start_1 : p.work_start_2
        const end = slot === 'slot1' ? p.work_end_1 : p.work_end_2

        if (!start || !end) return

        const label = `${start.slice(0, 5)} - ${end.slice(0, 5)}`
        if (!collected.some(item => item.label === label)) {
          collected.push({ label, start: start.slice(0, 5), end: end.slice(0, 5) })
        }
      })

    return collected.slice(0, 5)
  }

  const newlyAddedStaff = staff.find((person) => person.id === newStaffId)
  const hourOptions = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'))
  const minuteOptions = ['00', '15', '30', '45']

  const TimeField = ({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) => {
    const [hour, minute] = (value || '00:00').split(':')

    return (
      <div className="flex min-w-0 max-w-[112px] items-center gap-0.5">
        <select
          value={hour || '00'}
          onChange={(e) => onChange(`${e.target.value}:${minute || '00'}`)}
          className="w-[46px] rounded-md border border-slate-200 bg-white px-1.5 py-1.5 text-[11px] text-slate-700 outline-none transition-colors focus:border-slate-500"
        >
          {hourOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <span className="text-[10px] text-slate-400">:</span>
        <select
          value={minute || '00'}
          onChange={(e) => onChange(`${hour || '00'}:${e.target.value}`)}
          className="w-[46px] rounded-md border border-slate-200 bg-white px-1.5 py-1.5 text-[11px] text-slate-700 outline-none transition-colors focus:border-slate-500"
        >
          {minuteOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div className="max-w-6xl p-4 pb-32 md:p-8">
      <ConfirmDialog
        open={staffPendingDeletion !== null}
        tone="danger"
        title="スタッフを削除しますか？"
        message={`${staffPendingDeletion?.name || 'このスタッフ'}さんを名簿から削除します。この操作は取り消せません。`}
        confirmLabel="削除する"
        isProcessing={isDeleting}
        onConfirm={() => { if (staffPendingDeletion) void handleDeleteStaff(staffPendingDeletion) }}
        onCancel={() => setStaffPendingDeletion(null)}
      />
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-[var(--text)]">{storeId}店 スタッフ一覧</h1>
          {isAdmin && !isOrdering && (
            <button type="button" onClick={() => setIsOrdering(true)} disabled={hasRosterEdits}
              title={hasRosterEdits ? '先に「全員の変更を一括保存」してください' : undefined}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <ArrowUpDown size={16} aria-hidden="true" />並べ替え
            </button>
          )}
        </div>
        {isAdmin && !isOrdering && (
          <button
            onClick={handleBulkSave}
            disabled={isSaving}
            className="fixed bottom-24 right-4 z-50 rounded-md bg-slate-800 px-6 py-3 text-sm font-bold text-white shadow-sm md:bottom-8 md:right-8"
          >
            {isSaving ? '保存中...' : '全員の変更を一括保存'}
          </button>
        )}
      </div>

      {isAdmin && (
        <div className="mb-8 rounded-md border border-[var(--border)] bg-slate-50 p-5 md:p-6">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.12em] text-slate-700">New Staff</h2>
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              type="text"
              placeholder="スタッフの名前"
              className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 md:flex-1"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              onClick={handleAddStaff}
              disabled={!newName || isSubmitting}
              className="rounded-md bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-300 hover:bg-[var(--primary-strong)]"
            >
              登録
            </button>
          </div>
        </div>
      )}

      {isAdmin && newlyAddedStaff && (
        <section className="mb-8 rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm md:p-6">
          <div className="mb-5 flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">New staff</p>
              <h2 className="mt-1 text-base font-bold text-slate-800">{newlyAddedStaff.name} さんの詳細を設定</h2>
            </div>
            <span className="w-fit rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">新規登録</span>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="block text-xs font-bold text-slate-600">雇用形態
              <select value={newlyAddedStaff.is_employee ? 'employee' : 'part-time'} onChange={(e) => handleUpdateField(newlyAddedStaff.id, 'is_employee', e.target.value === 'employee')} className="mt-1.5 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 outline-none transition-colors focus:border-slate-500 focus:bg-white">
                <option value="part-time">アルバイト</option>
                <option value="employee">社員</option>
              </select>
            </label>
            <label className="block text-xs font-bold text-slate-600">担当
              <select value={newlyAddedStaff.main_job || 'ホール'} onChange={(e) => handleUpdateField(newlyAddedStaff.id, 'main_job', e.target.value)} className="mt-1.5 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 outline-none transition-colors focus:border-slate-500 focus:bg-white">
                <option value="ホール">ホール</option>
                <option value="キッチン">キッチン</option>
                <option value="共通">共通</option>
              </select>
            </label>
            <label className="block text-xs font-bold text-slate-600">ランク
              <select value={newlyAddedStaff.rank || 'B'} onChange={(e) => handleUpdateField(newlyAddedStaff.id, 'rank', e.target.value)} className="mt-1.5 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 outline-none transition-colors focus:border-slate-500 focus:bg-white">
                <option value="A">A</option><option value="B">B</option><option value="C">C</option>
              </select>
            </label>
            <label className="block text-xs font-bold text-slate-600">週の希望勤務日数
              <input type="number" min="0" value={newlyAddedStaff.weekly_target_days ?? 0} onChange={(e) => handleUpdateField(newlyAddedStaff.id, 'weekly_target_days', parseInt(e.target.value) || 0)} className="mt-1.5 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 outline-none transition-colors focus:border-slate-500 focus:bg-white" />
            </label>
          </div>

          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">出勤可能時間</p>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-600">
                  <span>枠1</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <TimeField value={newlyAddedStaff.work_start_1?.slice(0, 5) || null} onChange={(value) => handleUpdateField(newlyAddedStaff.id, 'work_start_1', value)} />
                  </div>
                  <span className="text-slate-400">〜</span>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <TimeField value={newlyAddedStaff.work_end_1?.slice(0, 5) || null} onChange={(value) => handleUpdateField(newlyAddedStaff.id, 'work_end_1', value)} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSuggestionTarget({ personId: newlyAddedStaff.id, slot: 'slot1' })}
                  className="mt-2 w-full rounded-md border border-dashed border-slate-300 bg-white px-2 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-800"
                >
                  {newlyAddedStaff.work_start_1 && newlyAddedStaff.work_end_1
                    ? `${newlyAddedStaff.work_start_1.slice(0, 5)} - ${newlyAddedStaff.work_end_1.slice(0, 5)}`
                    : '表示例を確認'}
                </button>
                {suggestionTarget?.personId === newlyAddedStaff.id && suggestionTarget?.slot === 'slot1' && (
                  <div className="mt-2 rounded-md border border-slate-200 bg-white p-2 shadow-sm">
                    {getWorkTimeSuggestions(newlyAddedStaff, 'slot1').length > 0 ? (
                      getWorkTimeSuggestions(newlyAddedStaff, 'slot1').map((option) => (
                        <button
                          key={option.label}
                          type="button"
                          onClick={() => {
                            handleUpdateField(newlyAddedStaff.id, 'work_start_1', option.start)
                            handleUpdateField(newlyAddedStaff.id, 'work_end_1', option.end)
                            setSuggestionTarget(null)
                          }}
                          className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-700 transition-colors hover:bg-slate-100"
                        >
                          {option.label}
                        </button>
                      ))
                    ) : (
                      <div className="text-xs text-slate-400">他のスタッフの時間設定がありません</div>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-600">
                  <span>枠2</span>
                  {newlyAddedStaff.work_start_2 || newlyAddedStaff.work_end_2 ? (
                    <button
                      type="button"
                      onClick={() => {
                        handleUpdateField(newlyAddedStaff.id, 'work_start_2', null)
                        handleUpdateField(newlyAddedStaff.id, 'work_end_2', null)
                      }}
                      className="text-[10px] font-bold text-slate-400 hover:text-red-500"
                    >
                      クリア
                    </button>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <TimeField value={newlyAddedStaff.work_start_2?.slice(0, 5) || null} onChange={(value) => handleUpdateField(newlyAddedStaff.id, 'work_start_2', value)} />
                  </div>
                  <span className="text-slate-400">〜</span>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <TimeField value={newlyAddedStaff.work_end_2?.slice(0, 5) || null} onChange={(value) => handleUpdateField(newlyAddedStaff.id, 'work_end_2', value)} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSuggestionTarget({ personId: newlyAddedStaff.id, slot: 'slot2' })}
                  className="mt-2 w-full rounded-md border border-dashed border-slate-300 bg-white px-2 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-800"
                >
                  {newlyAddedStaff.work_start_2 && newlyAddedStaff.work_end_2
                    ? `${newlyAddedStaff.work_start_2.slice(0, 5)} - ${newlyAddedStaff.work_end_2.slice(0, 5)}`
                    : '表示例を確認'}
                </button>
                {suggestionTarget?.personId === newlyAddedStaff.id && suggestionTarget?.slot === 'slot2' && (
                  <div className="mt-2 rounded-md border border-slate-200 bg-white p-2 shadow-sm">
                    {getWorkTimeSuggestions(newlyAddedStaff, 'slot2').length > 0 ? (
                      getWorkTimeSuggestions(newlyAddedStaff, 'slot2').map((option) => (
                        <button
                          key={option.label}
                          type="button"
                          onClick={() => {
                            handleUpdateField(newlyAddedStaff.id, 'work_start_2', option.start)
                            handleUpdateField(newlyAddedStaff.id, 'work_end_2', option.end)
                            setSuggestionTarget(null)
                          }}
                          className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-700 transition-colors hover:bg-slate-100"
                        >
                          {option.label}
                        </button>
                      ))
                    ) : (
                      <div className="text-xs text-slate-400">他のスタッフの時間設定がありません</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">スキル</p>
            <div className="mt-3 max-w-[280px] flex flex-wrap gap-1.5">
              {skillOptions.length > 0 ? skillOptions.map((option) => {
                const selected = newlyAddedStaff.skills?.split(',').includes(option)
                const skillCount = skillOptions.length
                const buttonSizeClass = skillCount > 8 ? 'px-1.5 py-1 text-[8px]' : skillCount > 5 ? 'px-2 py-1 text-[9px]' : 'px-2.5 py-1.5 text-[10px]'
                return <button key={option} type="button" onClick={() => handleToggleSkill(newlyAddedStaff.id, option)} className={`rounded-md border ${buttonSizeClass} font-bold transition-colors ${selected ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}>{option}</button>
              }) : <span className="text-xs text-slate-400">登録済みのスキル項目はありません</span>}
            </div>
          </div>

          <label className="mt-4 block text-xs font-bold text-slate-600">メモ
            <input value={newlyAddedStaff.memo || ''} onChange={(e) => handleUpdateField(newlyAddedStaff.id, 'memo', e.target.value)} placeholder="連絡事項などを入力" className="mt-1.5 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700 outline-none transition-colors focus:border-slate-500 focus:bg-white" />
          </label>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setNewStaffId(null)} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50">あとで設定する</button>
            <button type="button" onClick={handleSaveNewStaffDetails} disabled={isNewStaffSaving} className="rounded-md bg-slate-800 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-slate-700 disabled:bg-slate-300">{isNewStaffSaving ? '保存中...' : '詳細を保存'}</button>
          </div>
        </section>
      )}

      <div className="space-y-3">
        {isOrdering && (
          <StaffOrderEditor
            staff={staff.map(person => ({ id: person.id, name: person.name, category: person.category, display_order: person.display_order, is_employee: person.is_employee }))}
            onSave={saveOrder}
            onCancel={() => setIsOrdering(false)}
          />
        )}
        {!isOrdering && sortStaff(staff).map((person) => {
          const initials = person.name
            ?.split(/\s|・/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part: string) => part[0])
            .join('')
            .slice(0, 2)
            .toUpperCase() || 'N'

          const slot1Suggestions = getWorkTimeSuggestions(person, 'slot1')
          const slot2Suggestions = getWorkTimeSuggestions(person, 'slot2')
          const weeklySummary = formatWeeklyAvailability(person.weekly_availability)

          return (
            <div key={person.id} className="rounded-md border border-orange-200 bg-white p-3 shadow-sm md:p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-orange-50 text-xs font-bold text-orange-700">
                    {initials}
                  </div>

                  <div className="min-w-0 flex-1">
                    {isAdmin ? (
                      <input
                        className="w-full border-0 border-b border-orange-200 bg-transparent px-0 pb-1 text-lg font-bold text-slate-800 outline-none focus:border-orange-500"
                        value={person.name}
                        onChange={(e) => handleUpdateField(person.id, 'name', e.target.value)}
                      />
                    ) : (
                      <div className="truncate text-lg font-bold text-slate-800">{person.name}</div>
                    )}
                    <p className="mt-1 text-xs font-medium text-slate-500">区分: {person.category ?? '区分なし'}</p>
                    {(person.category === '社員') !== person.is_employee && person.category !== null && (
                      <p className="mt-0.5 text-xs font-bold text-red-700">
                        {person.is_employee ? '社員権限がありますが、区分が社員ではありません。' : '区分は社員ですが、社員権限がありません。'}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 md:gap-3">
                  <label className="inline-flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={person.is_employee || false}
                      onChange={(e) => handleUpdateField(person.id, 'is_employee', e.target.checked)}
                    />
                    社員
                  </label>

                  <div className="min-w-[120px]">
                    <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">職種</div>
                    {isAdmin ? (
                      <select
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-orange-400"
                        value={person.main_job || 'ホール'}
                        onChange={(e) => handleUpdateField(person.id, 'main_job', e.target.value)}
                      >
                        <option value="ホール">ホール</option>
                        <option value="キッチン">キッチン</option>
                        <option value="共通">共通</option>
                      </select>
                    ) : (
                      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm font-medium text-slate-700">{person.main_job || 'ー'}</div>
                    )}
                  </div>

                  <div className="min-w-[90px]">
                    <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">週希望</div>
                    {isAdmin ? (
                      <input
                        type="number"
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-orange-400"
                        value={person.weekly_target_days || 0}
                        onChange={(e) => handleUpdateField(person.id, 'weekly_target_days', parseInt(e.target.value) || 0)}
                      />
                    ) : (
                      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm font-medium text-slate-700">{person.weekly_target_days}日</div>
                    )}
                  </div>

                  <div className="min-w-[80px]">
                    <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">ランク</div>
                    {isAdmin ? (
                      <select
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm font-bold text-slate-700 outline-none focus:border-orange-400"
                        value={person.rank || 'B'}
                        onChange={(e) => handleUpdateField(person.id, 'rank', e.target.value)}
                      >
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="C">C</option>
                      </select>
                    ) : (
                      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm font-bold text-slate-700">{person.rank}</div>
                    )}
                  </div>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setStaffPendingDeletion(person)}
                      className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:border-red-300 hover:text-red-600"
                    >
                      削除
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <div className="min-w-0">
                  <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">出勤できる時間（曜日ごと）</div>
                  <div className={`text-sm ${weeklySummary ? 'font-medium text-slate-800' : 'text-slate-500'}`}>{weeklySummary ?? '未設定（下の出勤時間で作成します）'}</div>
                </div>
                {isAdmin && (
                  <button type="button" onClick={() => openWeeklyEditor(person)} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    曜日ごとに設定
                  </button>
                )}
              </div>

              <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 md:grid-cols-[1.8fr_0.95fr]">
                <div>
                  <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">出勤時間</div>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="rounded border border-slate-200 bg-slate-50 p-2">
                      <div className="mb-1 text-[9px] font-bold text-slate-500">枠1</div>
                      {isAdmin ? (
                        <div className="relative flex flex-col gap-2 text-sm text-slate-700">
                          <div className="flex items-center gap-1">
                            <div className="min-w-0 overflow-hidden">
                              <TimeField value={person.work_start_1?.slice(0, 5) || null} onChange={(value) => handleUpdateField(person.id, 'work_start_1', value)} />
                            </div>
                            <span className="text-slate-400">-</span>
                            <div className="min-w-0 overflow-hidden">
                              <TimeField value={person.work_end_1?.slice(0, 5) || null} onChange={(value) => handleUpdateField(person.id, 'work_end_1', value)} />
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setSuggestionTarget({ personId: person.id, slot: 'slot1' })}
                            className="w-full rounded border border-dashed border-slate-300 bg-white px-2 py-1.5 text-left text-xs font-medium text-slate-600 hover:border-orange-300 hover:text-orange-700"
                          >
                            {person.work_start_1 && person.work_end_1
                              ? `${person.work_start_1.slice(0, 5)} - ${person.work_end_1.slice(0, 5)}`
                              : '表示例を確認'}
                          </button>

                          {suggestionTarget?.personId === person.id && suggestionTarget?.slot === 'slot1' && (
                            <div className="w-full rounded border border-slate-200 bg-white p-2 shadow-lg">
                              {slot1Suggestions.length > 0 ? (
                                slot1Suggestions.map((option) => (
                                  <button
                                    key={option.label}
                                    type="button"
                                    onClick={() => {
                                      handleUpdateField(person.id, 'work_start_1', option.start)
                                      handleUpdateField(person.id, 'work_end_1', option.end)
                                      setSuggestionTarget(null)
                                    }}
                                    className="block w-full rounded px-2 py-1 text-left text-xs text-slate-700 hover:bg-orange-50 hover:text-orange-700"
                                  >
                                    {option.label}
                                  </button>
                                ))
                              ) : (
                                <div className="text-xs text-slate-400">他のスタッフの時間設定がありません</div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm font-medium text-slate-700">{person.work_start_1?.slice(0,5) || 'ー'} - {person.work_end_1?.slice(0,5) || 'ー'}</div>
                      )}
                    </div>

                    <div className="rounded border border-slate-200 bg-slate-50 p-2">
                      <div className="mb-1 flex items-center justify-between text-[9px] font-bold text-slate-500">
                        <span>枠2</span>
                        {isAdmin && (person.work_start_2 || person.work_end_2) && (
                          <button
                            onClick={() => { handleUpdateField(person.id, 'work_start_2', null); handleUpdateField(person.id, 'work_end_2', null); }}
                            className="text-[10px] text-slate-400 hover:text-red-500"
                          >
                            クリア
                          </button>
                        )}
                      </div>
                      {isAdmin ? (
                        <div className="relative flex flex-col gap-2 text-sm text-slate-700">
                          <div className="flex items-center gap-1">
                            <div className="min-w-0 overflow-hidden">
                              <TimeField value={person.work_start_2?.slice(0, 5) || null} onChange={(value) => handleUpdateField(person.id, 'work_start_2', value)} />
                            </div>
                            <span className="text-slate-400">-</span>
                            <div className="min-w-0 overflow-hidden">
                              <TimeField value={person.work_end_2?.slice(0, 5) || null} onChange={(value) => handleUpdateField(person.id, 'work_end_2', value)} />
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setSuggestionTarget({ personId: person.id, slot: 'slot2' })}
                            className="w-full rounded border border-dashed border-slate-300 bg-white px-2 py-1.5 text-left text-xs font-medium text-slate-600 hover:border-orange-300 hover:text-orange-700"
                          >
                            {person.work_start_2 && person.work_end_2
                              ? `${person.work_start_2.slice(0, 5)} - ${person.work_end_2.slice(0, 5)}`
                              : '表示例を確認'}
                          </button>

                          {suggestionTarget?.personId === person.id && suggestionTarget?.slot === 'slot2' && (
                            <div className="w-full rounded border border-slate-200 bg-white p-2 shadow-lg">
                              {slot2Suggestions.length > 0 ? (
                                slot2Suggestions.map((option) => (
                                  <button
                                    key={option.label}
                                    type="button"
                                    onClick={() => {
                                      handleUpdateField(person.id, 'work_start_2', option.start)
                                      handleUpdateField(person.id, 'work_end_2', option.end)
                                      setSuggestionTarget(null)
                                    }}
                                    className="block w-full rounded px-2 py-1 text-left text-xs text-slate-700 hover:bg-orange-50 hover:text-orange-700"
                                  >
                                    {option.label}
                                  </button>
                                ))
                              ) : (
                                <div className="text-xs text-slate-400">他のスタッフの時間設定がありません</div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm font-medium text-slate-700">{person.work_start_2 ? `${person.work_start_2?.slice(0,5)} - ${person.work_end_2?.slice(0,5)}` : '設定なし'}</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="max-w-[220px]">
                  <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">スキル</div>
                  {isAdmin ? (
                    <div className="flex max-w-[190px] flex-wrap gap-1.5">
                      {skillOptions.map(opt => {
                        const isSelected = person.skills?.split(',').includes(opt)
                        const skillCount = skillOptions.length
                        const buttonSizeClass = skillCount > 8 ? 'px-1.5 py-1 text-[8px]' : skillCount > 5 ? 'px-2 py-1 text-[9px]' : 'px-2.5 py-1 text-[10px]'
                        return (
                          <button
                            key={opt}
                            onClick={() => handleToggleSkill(person.id, opt)}
                            className={`rounded border ${buttonSizeClass} font-bold transition-colors ${isSelected ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'}`}
                          >
                            {opt}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="flex max-w-[190px] flex-wrap gap-1.5">
                      {person.skills?.split(',').filter(Boolean).map((s: string) => (
                        s && <span key={s} className="rounded border border-orange-200 bg-orange-50 px-1.5 py-1 text-[9px] font-bold text-orange-700">#{s}</span>
                      )) || <span className="text-sm text-slate-400">未設定</span>}
                    </div>
                  )}
                </div>
              </div>

              {isAdmin && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">メモ</div>
                  <input
                    placeholder="備考"
                    className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm text-slate-700 outline-none focus:border-orange-400"
                    value={person.memo || ''}
                    onChange={(e) => handleUpdateField(person.id, 'memo', e.target.value)}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
      {weeklyTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !isWeeklySaving) setWeeklyTarget(null) }}>
          <section role="dialog" aria-modal="true" aria-labelledby="weekly-dialog-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-md border border-slate-200 bg-white p-5 shadow-2xl">
            <h2 id="weekly-dialog-title" className="text-base font-bold text-slate-900">{weeklyTarget.name}さんの出勤できる時間</h2>
            <p className="mt-1 text-xs text-slate-500">曜日ごとに選びます。シフトの自動作成では、時間帯（枠1・枠2）よりこちらを優先します。</p>
            <div className="mt-2">
              <WeeklyAvailabilityEditor value={weeklyTarget.draft} onChange={draft => setWeeklyTarget(current => current ? { ...current, draft } : current)} hours={hours} disabled={isWeeklySaving} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setWeeklyTarget(null)} disabled={isWeeklySaving} className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">キャンセル</button>
              <button type="button" onClick={() => void saveWeekly()} disabled={isWeeklySaving} className="min-h-11 rounded-md bg-[var(--primary)] px-4 text-sm font-bold text-white hover:bg-[var(--primary-strong)] disabled:bg-slate-300">{isWeeklySaving ? '保存中...' : '保存'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
