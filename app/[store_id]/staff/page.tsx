'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import { useAdmin } from '@/context/AdminContext'

export default function StaffPage() {
  const params = useParams()
  const storeId = params.store_id as string
  const { isAdmin } = useAdmin()

  // --- 状態管理（State） ---
  const [staff, setStaff] = useState<any[]>([])
  const [newName, setNewName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSaving, setIsBulkSaving] = useState(false)
  const [newStaffId, setNewStaffId] = useState<string | null>(null)
  const [isNewStaffSaving, setIsNewStaffSaving] = useState(false)
  const [skillOptions, setSkillOptions] = useState<string[]>([])
  const [suggestionTarget, setSuggestionTarget] = useState<{ personId: string; slot: 'slot1' | 'slot2' } | null>(null)

  // --- 1. データ読み込み（スタッフ名簿 ＋ 店舗のスキル設定） ---
  useEffect(() => {
    const fetchData = async () => {
      if (!storeId) return
      
      const { data: staffData } = await supabase
        .from('staff')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: true })
      setStaff(staffData || [])

      const { data: storeData } = await supabase
        .from('stores')
        .select('skill_options')
        .eq('store_id', storeId)
        .single()
      
      if (storeData?.skill_options) {
        setSkillOptions(storeData.skill_options.split(','))
      }
    }
    fetchData()
  }, [storeId])

  // --- 2. 新規登録処理 ---
  const handleAddStaff = async () => {
    if (!newName.trim()) return
    setIsSubmitting(true)
    const { data, error } = await supabase
      .from('staff')
      .insert([{ 
        name: newName, 
        store_id: storeId, 
        main_job: 'ホール', 
        rank: 'B',
        weekly_target_days: 3,
        work_start_2: null, // 初期値は空
        work_end_2: null
      }])
      .select()

    if (error) alert('登録失敗: ' + error.message)
    else {
      if (data?.[0]) {
        setStaff([...staff, data[0]])
        setNewStaffId(data[0].id)
      }
      setNewName('')
    }
    setIsSubmitting(false)
  }

  // --- 3. 編集用ヘルパー関数 ---
  const handleUpdateField = (id: string, field: string, value: any) => {
    setStaff(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  const handleToggleSkill = (personId: string, skillName: string) => {
    setStaff(prev => prev.map(p => {
      if (p.id !== personId) return p
      let currentSkills = p.skills ? p.skills.split(',').filter((s: string) => s !== "") : []
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
    const { error } = await supabase.from('staff').upsert(staff)
    if (error) alert('保存失敗: ' + error.message)
    else alert('すべての変更を保存しました！')
    setIsBulkSaving(false)
  }

  const handleDeleteStaff = async (id: string) => {
    const { error } = await supabase.from('staff').delete().eq('id', id)
    if (error) {
      alert('削除失敗: ' + error.message)
      return
    }
    setStaff(prev => prev.filter(person => person.id !== id))
  }

  const handleSaveNewStaffDetails = async () => {
    const newStaff = staff.find((person) => person.id === newStaffId)
    if (!newStaff) return

    setIsNewStaffSaving(true)
    const { error } = await supabase.from('staff').upsert(newStaff)
    if (error) {
      alert('詳細の保存に失敗しました: ' + error.message)
    } else {
      setNewStaffId(null)
    }
    setIsNewStaffSaving(false)
  }

  const getWorkTimeSuggestions = (person: any, slot: 'slot1' | 'slot2') => {
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
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-bold text-[var(--text)]">{storeId}店 スタッフ一覧</h1>
        {isAdmin && (
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
                {suggestionTarget?.personId === newlyAddedStaff.id && suggestionTarget.slot === 'slot1' && (
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
                {suggestionTarget?.personId === newlyAddedStaff.id && suggestionTarget.slot === 'slot2' && (
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
        {staff.map((person) => {
          const initials = person.name
            ?.split(/\s|・/)
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part[0])
            .join('')
            .slice(0, 2)
            .toUpperCase() || 'N'

          const slot1Suggestions = getWorkTimeSuggestions(person, 'slot1')
          const slot2Suggestions = getWorkTimeSuggestions(person, 'slot2')

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
                      onClick={() => handleDeleteStaff(person.id)}
                      className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:border-red-300 hover:text-red-600"
                    >
                      削除
                    </button>
                  )}
                </div>
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

                          {suggestionTarget?.personId === person.id && suggestionTarget.slot === 'slot1' && (
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

                          {suggestionTarget?.personId === person.id && suggestionTarget.slot === 'slot2' && (
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
    </div>
  )
}
