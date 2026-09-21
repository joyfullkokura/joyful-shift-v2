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
      if (data) setStaff([...staff, data[0]])
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

              <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 md:grid-cols-[1.1fr_1.5fr]">
                <div>
                  <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">出勤時間</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded border border-slate-200 bg-slate-50 p-2">
                      <div className="mb-1 text-[9px] font-bold text-slate-500">枠1</div>
                      {isAdmin ? (
                        <div className="relative flex flex-col gap-2 text-sm text-slate-700">
                          <div className="flex items-center gap-1">
                            <input type="time" value={person.work_start_1?.slice(0,5) || ''} onChange={(e) => handleUpdateField(person.id, 'work_start_1', e.target.value)} className="w-[92px] rounded border border-slate-200 bg-white px-1 py-1 outline-none focus:border-orange-400"/>
                            <span>-</span>
                            <input type="time" value={person.work_end_1?.slice(0,5) || ''} onChange={(e) => handleUpdateField(person.id, 'work_end_1', e.target.value)} className="w-[92px] rounded border border-slate-200 bg-white px-1 py-1 outline-none focus:border-orange-400"/>
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
                            <input type="time" value={person.work_start_2?.slice(0,5) || ''} onChange={(e) => handleUpdateField(person.id, 'work_start_2', e.target.value)} className="w-[92px] rounded border border-slate-200 bg-white px-1 py-1 outline-none focus:border-orange-400"/>
                            <span>-</span>
                            <input type="time" value={person.work_end_2?.slice(0,5) || ''} onChange={(e) => handleUpdateField(person.id, 'work_end_2', e.target.value)} className="w-[92px] rounded border border-slate-200 bg-white px-1 py-1 outline-none focus:border-orange-400"/>
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

                <div>
                  <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">スキル</div>
                  {isAdmin ? (
                    <div className="flex flex-wrap gap-2">
                      {skillOptions.map(opt => {
                        const isSelected = person.skills?.split(',').includes(opt)
                        return (
                          <button
                            key={opt}
                            onClick={() => handleToggleSkill(person.id, opt)}
                            className={`rounded border px-2.5 py-1 text-[10px] font-bold transition-colors ${isSelected ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'}`}
                          >
                            {opt}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {person.skills?.split(',').filter(Boolean).map((s: string) => (
                        s && <span key={s} className="rounded border border-orange-200 bg-orange-50 px-2 py-1 text-[10px] font-bold text-orange-700">#{s}</span>
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