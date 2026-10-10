'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, KeyRound, LockKeyhole, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { CurrentStaff } from '@/context/AdminContext'

type PinLoginMode = 'setup' | 'login' | 'change'
type PinStage = 'pin' | 'confirm' | 'current' | 'new' | 'profile'

type PinLoginModalProps = {
  staff: CurrentStaff
  storeId: string
  mode?: PinLoginMode
  onClose: () => void
  onSuccess: (staff: CurrentStaff) => void
}

const MIN_PIN_LENGTH = 4
const MAX_PIN_LENGTH = 8
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
const EMPLOYMENT_TYPES = ['学生アルバイト', 'パート', 'フリーター', '契約社員', '社員']
const TIME_OPTIONS = Array.from({ length: 31 }, (_, index) => {
  const totalMinutes = 9 * 60 + index * 30
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
})

function AvailabilityRange({ label, description, start, end, onStartChange, onEndChange }: {
  label: string
  description: string
  start: string
  end: string
  onStartChange: (value: string) => void
  onEndChange: (value: string) => void
}) {
  return <fieldset className="rounded-md border border-slate-200 p-3">
    <legend className="px-1 text-xs font-medium text-slate-700">{label}</legend>
    <p className="-mt-1 text-[11px] text-slate-500">{description}（任意）</p>
    <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <select aria-label={`${label}の開始時刻`} value={start} onChange={event => onStartChange(event.target.value)} className="h-10 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-slate-500">
        <option value="">開始</option>
        {TIME_OPTIONS.map(time => <option key={time} value={time}>{time}</option>)}
      </select>
      <span className="text-xs text-slate-400">〜</span>
      <select aria-label={`${label}の終了時刻`} value={end} onChange={event => onEndChange(event.target.value)} className="h-10 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-slate-500">
        <option value="">終了</option>
        {TIME_OPTIONS.map(time => <option key={time} value={time}>{time}</option>)}
      </select>
    </div>
  </fieldset>
}

async function hashPin(pin: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export default function PinLoginModal({ staff, storeId, mode: requestedMode, onClose, onSuccess }: PinLoginModalProps) {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [stage, setStage] = useState<PinStage>(() => requestedMode === 'change' ? 'current' : 'pin')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState('')
  const [resetRequestMessage, setResetRequestMessage] = useState('')
  const [targetWorkDays, setTargetWorkDays] = useState('3')
  const [employmentType, setEmploymentType] = useState(staff.is_employee ? '社員' : '学生アルバイト')
  const [mainJob, setMainJob] = useState('ホール')
  const [workStart1, setWorkStart1] = useState('')
  const [workEnd1, setWorkEnd1] = useState('')
  const [workStart2, setWorkStart2] = useState('')
  const [workEnd2, setWorkEnd2] = useState('')
  const mode = requestedMode ?? (staff.pin_hash ? 'login' : 'setup')

  const resetPin = useCallback(() => {
    setPin('')
    setConfirmPin('')
    setStage(requestedMode === 'change' ? 'current' : 'pin')
    setError('')
    setIsProcessing(false)
  }, [requestedMode])

  const submitCurrent = useCallback(async () => {
    const value = stage === 'confirm' ? confirmPin : pin
    if (isProcessing || value.length < MIN_PIN_LENGTH || value.length > MAX_PIN_LENGTH) {
      setError(`${MIN_PIN_LENGTH}〜${MAX_PIN_LENGTH}桁の暗証番号を入力してください。`)
      return
    }
    setIsProcessing(true)
    setError('')

    try {
      if (stage === 'current') {
        const currentHash = await hashPin(value)
        if (currentHash !== staff.pin_hash) {
          setError('現在の暗証番号が一致しませんでした。もう一度入力してください。')
          resetPin()
          return
        }
        setPin('')
        setStage('new')
        setIsProcessing(false)
        return
      }

      if (stage === 'new' || stage === 'pin') {
        if (mode === 'login') {
          const pinHash = await hashPin(value)
          if (pinHash !== staff.pin_hash) {
            if (value.length === MAX_PIN_LENGTH) {
              setError('暗証番号が一致しませんでした。もう一度入力してください。')
              resetPin()
            } else {
              setIsProcessing(false)
            }
            return
          }
          onSuccess(staff)
          return
        }
        setConfirmPin('')
        setStage('confirm')
        setIsProcessing(false)
        return
      }

      if (stage === 'confirm') {
        if (confirmPin !== pin) {
          setError('暗証番号が一致しませんでした。もう一度入力してください。')
          resetPin()
          return
        }
        if (mode === 'setup') {
          setStage('profile')
          setIsProcessing(false)
          return
        }
        const pinHash = await hashPin(pin)
        const { error: updateError } = await supabase.from('staff').update({ pin_hash: pinHash }).eq('id', staff.id).eq('store_id', storeId)
        if (updateError) throw updateError
        onSuccess({ ...staff, pin_hash: pinHash })
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '認証に失敗しました。')
      resetPin()
    }
  }, [confirmPin, isProcessing, mode, onSuccess, pin, resetPin, staff, stage, storeId])

  const completeInitialSetup = useCallback(async () => {
    if (isProcessing) return
    const hasIncompletePrimaryRange = Boolean(workStart1) !== Boolean(workEnd1)
    const hasIncompleteSecondaryRange = Boolean(workStart2) !== Boolean(workEnd2)
    if (hasIncompletePrimaryRange || hasIncompleteSecondaryRange) {
      setError('出勤可能時間帯は、開始時刻と終了時刻をセットで選択してください。')
      return
    }
    if ((workStart1 && workStart1 >= workEnd1) || (workStart2 && workStart2 >= workEnd2)) {
      setError('終了時刻は開始時刻より後の時刻を選択してください。')
      return
    }
    setIsProcessing(true)
    setError('')
    try {
      const pinHash = await hashPin(pin)
      const { error: updateError } = await supabase
        .from('staff')
        .update({
          pin_hash: pinHash,
          weekly_target_days: Number(targetWorkDays),
          main_job: mainJob,
          employment_type: employmentType,
          is_employee: employmentType === '社員',
          work_start_1: workStart1 || null,
          work_end_1: workEnd1 || null,
          work_start_2: workStart2 || null,
          work_end_2: workEnd2 || null,
        })
        .eq('id', staff.id)
        .eq('store_id', storeId)
      if (updateError) throw updateError
      onSuccess({ ...staff, pin_hash: pinHash, is_employee: employmentType === '社員' })
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '基本勤務条件を登録できませんでした。')
      setIsProcessing(false)
    }
  }, [employmentType, isProcessing, mainJob, onSuccess, pin, staff, storeId, targetWorkDays, workEnd1, workEnd2, workStart1, workStart2])

  const addDigit = useCallback((digit: string) => {
    if (isProcessing) return
    if (stage === 'confirm') {
      if (confirmPin.length < MAX_PIN_LENGTH) setConfirmPin(current => `${current}${digit}`)
    } else if (pin.length < MAX_PIN_LENGTH) {
      setPin(current => `${current}${digit}`)
    }
    setError('')
  }, [confirmPin.length, isProcessing, pin.length, stage])

  useEffect(() => {
    if (mode !== 'login' || stage !== 'pin' || pin.length < MIN_PIN_LENGTH || isProcessing) return
    let isCurrent = true

    const authenticate = async () => {
      const pinHash = await hashPin(pin)
      if (!isCurrent) return
      if (pinHash === staff.pin_hash) {
        onSuccess(staff)
        return
      }
      if (pin.length === MAX_PIN_LENGTH) {
        setError('暗証番号が一致しませんでした。もう一度入力してください。')
        setPin('')
      }
    }

    void authenticate()
    return () => { isCurrent = false }
  }, [isProcessing, mode, onSuccess, pin, staff, stage])

  const requestPinReset = useCallback(async () => {
    if (!window.confirm('社員に暗証番号のリセットを申請しますか？')) return
    setError('')
    setResetRequestMessage('')
    setIsProcessing(true)
    try {
      const { error: updateError } = await supabase
        .from('staff')
        .update({ pin_reset_requested: true })
        .eq('id', staff.id)
        .eq('store_id', storeId)
      if (updateError) throw updateError
      setResetRequestMessage('申請を送信しました。社員の承認をお待ちください。')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'リセット申請を送信できませんでした。')
    } finally {
      setIsProcessing(false)
    }
  }, [staff.id, storeId])

  const deleteDigit = useCallback(() => {
    if (isProcessing) return
    if (stage === 'confirm') setConfirmPin(current => current.slice(0, -1))
    else setPin(current => current.slice(0, -1))
    setError('')
  }, [isProcessing, stage])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        if (stage === 'profile') return
        event.preventDefault()
        deleteDigit()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (stage === 'profile') void completeInitialSetup()
        else void submitCurrent()
      } else if (/^[0-9]$/.test(event.key)) {
        if (stage === 'profile') return
        event.preventDefault()
        addDigit(event.key)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addDigit, completeInitialSetup, deleteDigit, onClose, stage, submitCurrent])

  const activePin = stage === 'confirm' ? confirmPin : pin
  const displayLabel = stage === 'confirm' ? '再入力状態' : stage === 'current' ? '現在の暗証番号' : stage === 'new' ? '新しい暗証番号' : '暗証番号'
  const statusLabel = mode === 'login'
    ? '4〜8桁を入力すると自動的に認証されます。'
    : stage === 'current'
      ? '現在の暗証番号を入力してEnterを押してください。'
      : stage === 'confirm'
        ? '設定した暗証番号をもう一度入力してください。'
        : stage === 'new'
          ? '新しい暗証番号を入力してEnterを押してください。'
          : '4〜8桁を入力してEnterを押してください。'

  const isProfileStep = stage === 'profile'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="pin-login-title" className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white"><KeyRound size={18} /></div>
            <div>
              <h2 id="pin-login-title" className="text-lg font-semibold text-slate-900">{isProfileStep ? '基本勤務条件の登録' : mode === 'setup' ? '暗証番号を設定' : mode === 'change' ? '暗証番号を変更' : '暗証番号を入力'}</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" aria-label="閉じる"><X size={18} /></button>
        </div>

        <div className="p-5">
          {isProfileStep ? (
            <div>
              <p className="text-sm text-slate-600">シフト作成の基準となる希望条件を教えてください（後から変更可能）</p>
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">週の希望勤務日数</span>
                  <select value={targetWorkDays} onChange={event => setTargetWorkDays(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500">
                    {[1, 2, 3, 4, 5, 6].map(days => <option key={days} value={days}>週{days}日</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">雇用区分</span>
                  <select value={employmentType} onChange={event => setEmploymentType(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500">
                    {EMPLOYMENT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">メイン職種</span>
                  <select value={mainJob} onChange={event => setMainJob(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500">
                    <option value="ホール">ホール</option>
                    <option value="キッチン">キッチン</option>
                    <option value="共通">共通</option>
                  </select>
                </label>
                <AvailabilityRange label="出勤可能時間帯 1（基本）" description="普段出勤できる時間帯" start={workStart1} end={workEnd1} onStartChange={setWorkStart1} onEndChange={setWorkEnd1} />
                <AvailabilityRange label="出勤可能時間帯 2（サブ）" description="他に誰もいなければ出てもよい時間帯" start={workStart2} end={workEnd2} onStartChange={setWorkStart2} onEndChange={setWorkEnd2} />
              </div>
              {error && <p role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-center text-xs text-rose-700">{error}</p>}
              <div className="mt-5 flex justify-end">
                <button type="button" onClick={() => void completeInitialSetup()} disabled={isProcessing} className="rounded-md bg-slate-800 px-4 py-2.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50">登録を完了してはじめる</button>
              </div>
            </div>
          ) : <>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4 text-center">
            <p className="text-sm font-semibold text-slate-900">{staff.name}さん</p>
            <p className="mt-1 text-xs text-slate-500">{mode === 'setup' ? '初回設定です。4〜8桁の暗証番号を設定してください。' : mode === 'change' ? '現在の暗証番号を確認してから新しい暗証番号を設定してください。' : '登録済みの暗証番号を入力してください。'}</p>
          </div>

          <div className="mt-5 flex items-center justify-center gap-3" aria-label={displayLabel}>
            {Array.from({ length: MAX_PIN_LENGTH }, (_, index) => {
              const value = activePin[index]
              return <span key={index} className={`h-3 w-3 rounded-full border ${value ? 'border-slate-900 bg-slate-900' : 'border-slate-300 bg-white'}`} />
            })}
          </div>
          <p className="mt-3 min-h-5 text-center text-xs font-medium text-slate-600">{statusLabel}</p>
          {error && <p role="alert" className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-center text-xs text-rose-700">{error}</p>}
          {resetRequestMessage && <p role="status" className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-700">{resetRequestMessage}</p>}

          <div className="mt-4 grid grid-cols-3 gap-2">
            {DIGITS.map(digit => (
              <button key={digit} type="button" onClick={() => addDigit(digit)} disabled={isProcessing || (stage === 'confirm' ? confirmPin.length >= MAX_PIN_LENGTH : pin.length >= MAX_PIN_LENGTH)} className="h-14 rounded-md border border-slate-200 bg-white text-lg font-semibold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{digit}</button>
            ))}
            <button type="button" onClick={deleteDigit} disabled={isProcessing || activePin.length === 0} className="h-14 rounded-md border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"><span className="inline-flex items-center gap-1"><LockKeyhole size={15} />削除</span></button>
          </div>

          <div className="mt-5 flex justify-center gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">キャンセル</button>
            <button type="button" onClick={() => void submitCurrent()} disabled={isProcessing || activePin.length < MIN_PIN_LENGTH} className="rounded-md bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{stage === 'confirm' ? '確認' : '次へ進む'}</button>
          </div>
          {mode === 'login' && (
            <button type="button" onClick={() => void requestPinReset()} disabled={isProcessing} className="mt-4 w-full text-center text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
              暗証番号を忘れた場合は、社員にリセットを申請
            </button>
          )}
          <div className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-500">{isProcessing ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" /> : <><Check size={14} />安全なWeb Cryptoでハッシュ化します</>}</div>
          </>}
        </div>
      </section>
    </div>
  )
}
