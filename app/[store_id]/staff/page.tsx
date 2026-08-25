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

  return (
    <div className="p-8 pb-32">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-orange-600">
          👥 {storeId}店 スタッフ一覧
        </h1>
        {isAdmin && (
          <button
            onClick={handleBulkSave}
            disabled={isSaving}
            className="fixed bottom-8 right-8 bg-green-600 text-white px-8 py-4 rounded-2xl font-bold shadow-2xl hover:bg-green-700 z-50 transition-all flex items-center gap-2"
          >
            {isSaving ? '💾 保存中...' : '💾 全員の変更を一括保存'}
          </button>
        )}
      </div>

      {isAdmin && (
        <div className="bg-orange-50 p-6 rounded-2xl mb-8 border border-orange-200">
          <h2 className="text-sm font-bold text-orange-700 mb-4">🆕 新規スタッフ登録</h2>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="スタッフの名前"
              className="flex-1 p-3 rounded-xl border-none shadow-inner outline-none focus:ring-2 focus:ring-orange-500"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              onClick={handleAddStaff}
              disabled={!newName || isSubmitting}
              className="bg-orange-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-orange-700 shadow-md"
            >
              登録
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        {staff.map((person) => (
          <div key={person.id} className={`bg-white px-4 py-2 rounded-xl shadow-sm border transition-all mb-2 text-sm ${isAdmin ? 'border-orange-200 bg-orange-50/30' : 'border-gray-100'}`}>
            
            {/* 1行目：基本情報 */}
            <div className="flex items-center gap-4">
              <div className="w-40 flex-shrink-0 flex items-center gap-2">
                {isAdmin ? (
                  <input
                    className="w-full border-b border-orange-300 bg-transparent focus:border-orange-600 outline-none font-bold"
                    value={person.name}
                    onChange={(e) => handleUpdateField(person.id, 'name', e.target.value)}
                  />
                ) : (
                  <span className="font-bold text-gray-800 text-base truncate">{person.name}</span>
                )}
                
                {isAdmin ? (
                  <input 
                    type="checkbox" 
                    checked={person.is_employee || false} 
                    onChange={(e) => handleUpdateField(person.id, 'is_employee', e.target.checked)}
                  />
                ) : (
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${person.is_employee ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                    {person.is_employee ? '正' : 'ア'}
                  </span>
                )}
              </div>

              <div className="w-24">
                <span className="text-gray-400 text-[9px] block">職種</span>
                {isAdmin ? (
                  <select 
                    className="bg-transparent border-b border-orange-300 outline-none w-full"
                    value={person.main_job || 'ホール'}
                    onChange={(e) => handleUpdateField(person.id, 'main_job', e.target.value)}
                  >
                    <option value="ホール">ホール</option>
                    <option value="キッチン">キッチン</option>
                    <option value="共通">共通</option>
                  </select>
                ) : (
                  <span className="font-medium">{person.main_job || 'ー'}</span>
                )}
              </div>

              <div className="w-20">
                <span className="text-gray-400 text-[9px] block">週希望</span>
                {isAdmin ? (
                  <input
                    type="number"
                    className="w-full bg-transparent border-b border-orange-300 outline-none"
                    value={person.weekly_target_days || 0}
                    onChange={(e) => handleUpdateField(person.id, 'weekly_target_days', parseInt(e.target.value) || 0)}
                  />
                ) : (
                  <span className="font-medium">{person.weekly_target_days}日</span>
                )}
              </div>

              <div className="flex-1 overflow-hidden text-ellipsis">
                <span className="text-gray-400 text-[9px] block">可能グループ</span>
                <div className="flex gap-1 truncate">
                  {person.possible_groups?.split(',').filter(Boolean).map((g: string) => (
                    <span key={g} className="bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded text-[9px] border border-gray-100">{g}</span>
                  )) || <span className="text-gray-300 text-[10px]">ー</span>}
                </div>
              </div>

              <div className="w-12 text-center">
                <span className="text-gray-400 text-[9px] block">ランク</span>
                {isAdmin ? (
                  <select 
                    className="bg-transparent border-b border-orange-300 outline-none font-bold"
                    value={person.rank || 'B'}
                    onChange={(e) => handleUpdateField(person.id, 'rank', e.target.value)}
                  >
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                  </select>
                ) : (
                  <span className="font-black text-gray-700">{person.rank}</span>
                )}
              </div>
            </div>

            {/* 2行目：時間・スキル・備考 */}
            <div className="flex items-center gap-4 mt-1 pt-1 border-t border-gray-50">
              <div className="w-[320px] text-gray-500 text-[11px] flex flex-col gap-0.5">
                {/* 枠1 */}
                <div className="flex items-center gap-1">
                  <span className="opacity-50 text-[8px] w-6">枠1:</span>
                  {isAdmin ? (
                    <div className="flex gap-1 items-center">
                      <input type="time" value={person.work_start_1?.slice(0,5) || ''} onChange={(e) => handleUpdateField(person.id, 'work_start_1', e.target.value)} className="bg-transparent border-b border-orange-200 focus:border-orange-500 outline-none"/>
                      <span>-</span>
                      <input type="time" value={person.work_end_1?.slice(0,5) || ''} onChange={(e) => handleUpdateField(person.id, 'work_end_1', e.target.value)} className="bg-transparent border-b border-orange-200 focus:border-orange-500 outline-none"/>
                    </div>
                  ) : (
                    <span className="bg-orange-50 text-orange-600 px-2 rounded">{person.work_start_1?.slice(0,5) || 'ー'}-{person.work_end_1?.slice(0,5) || 'ー'}</span>
                  )}
                </div>

                {/* 枠2 */}
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="opacity-50 text-[8px] w-6">枠2:</span>
                  {isAdmin ? (
                    <div className="flex gap-1 items-center">
                      <input type="time" value={person.work_start_2?.slice(0,5) || ''} onChange={(e) => handleUpdateField(person.id, 'work_start_2', e.target.value)} className="bg-transparent border-b border-orange-200 focus:border-orange-500 outline-none"/>
                      <span>-</span>
                      <input type="time" value={person.work_end_2?.slice(0,5) || ''} onChange={(e) => handleUpdateField(person.id, 'work_end_2', e.target.value)} className="bg-transparent border-b border-orange-200 focus:border-orange-500 outline-none"/>
                      {(person.work_start_2 || person.work_end_2) && (
                        <button onClick={() => { handleUpdateField(person.id, 'work_start_2', null); handleUpdateField(person.id, 'work_end_2', null); }} className="text-gray-400 hover:text-red-500 ml-1 text-[10px]">✕</button>
                      )}
                    </div>
                  ) : (
                    person.work_start_2 ? (
                      <span className="bg-orange-50 text-orange-600 px-2 rounded">{person.work_start_2?.slice(0,5)}-{person.work_end_2?.slice(0,5)}</span>
                    ) : (
                      <span className="text-gray-300 text-[10px]">設定なし</span>
                    )
                  )}
                </div>
              </div>

              {/* スキル選択エリア */}
              <div className="flex-1 overflow-hidden flex flex-wrap gap-1">
                {isAdmin ? (
                  skillOptions.map(opt => {
                    const isSelected = person.skills?.split(',').includes(opt)
                    return (
                      <button
                        key={opt}
                        onClick={() => handleToggleSkill(person.id, opt)}
                        className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all ${isSelected ? 'bg-orange-500 text-white shadow-sm' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                      >
                        {opt}
                      </button>
                    )
                  })
                ) : (
                  person.skills?.split(',').filter(Boolean).map((s: string) => (
                    s && <span key={s} className="text-orange-500 font-bold text-[10px]">#{s}</span>
                  ))
                )}
              </div>

              {isAdmin ? (
                <input
                  placeholder="備考"
                  className="w-48 bg-transparent border-b border-orange-200 text-[11px] outline-none"
                  value={person.memo || ''}
                  onChange={(e) => handleUpdateField(person.id, 'memo', e.target.value)}
                />
              ) : (
                <div className="w-48 text-right truncate italic text-gray-400 text-[11px]">{person.memo}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}