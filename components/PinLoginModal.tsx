'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, KeyRound, LockKeyhole, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { CurrentStaff } from '@/context/AdminContext'

type PinLoginMode = 'setup' | 'login' | 'change'
type PinStage = 'pin' | 'confirm' | 'current' | 'new'

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
            setError('暗証番号が一致しませんでした。もう一度入力してください。')
            resetPin()
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

  const addDigit = useCallback((digit: string) => {
    if (isProcessing) return
    if (stage === 'confirm') {
      if (confirmPin.length < MAX_PIN_LENGTH) setConfirmPin(current => `${current}${digit}`)
    } else if (pin.length < MAX_PIN_LENGTH) {
      setPin(current => `${current}${digit}`)
    }
    setError('')
  }, [confirmPin.length, isProcessing, pin.length, stage])

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
        event.preventDefault()
        deleteDigit()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        void submitCurrent()
      } else if (/^[0-9]$/.test(event.key)) {
        event.preventDefault()
        addDigit(event.key)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addDigit, deleteDigit, onClose, submitCurrent])

  const activePin = stage === 'confirm' ? confirmPin : pin
  const displayLabel = stage === 'confirm' ? '再入力状態' : stage === 'current' ? '現在の暗証番号' : stage === 'new' ? '新しい暗証番号' : '暗証番号'
  const statusLabel = mode === 'login'
    ? '4〜8桁を入力してEnterを押してください。'
    : stage === 'current'
      ? '現在の暗証番号を入力してEnterを押してください。'
      : stage === 'confirm'
        ? '設定した暗証番号をもう一度入力してください。'
        : stage === 'new'
          ? '新しい暗証番号を入力してEnterを押してください。'
          : '4〜8桁を入力してEnterを押してください。'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="pin-login-title" className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white"><KeyRound size={18} /></div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Staff authentication</p>
              <h2 id="pin-login-title" className="mt-0.5 text-lg font-semibold text-slate-900">{mode === 'setup' ? '暗証番号を設定' : mode === 'change' ? '暗証番号を変更' : '暗証番号を入力'}</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" aria-label="閉じる"><X size={18} /></button>
        </div>

        <div className="p-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-center">
            <p className="text-sm font-semibold text-slate-900">{staff.name}さん</p>
            <p className="mt-1 text-xs text-slate-500">{mode === 'setup' ? '初回設定です。4〜8桁の暗証番号を設定してください。' : mode === 'change' ? '現在の暗証番号を確認してから新しい暗証番号を設定してください。' : '登録済みの暗証番号を入力してください。'}</p>
          </div>

          <div className="mt-5 flex items-center justify-center gap-3" aria-label={displayLabel}>
            {Array.from({ length: MAX_PIN_LENGTH }, (_, index) => {
              const value = activePin[index]
              return <span key={index} className={`flex h-11 w-11 items-center justify-center rounded-full border text-xl font-semibold ${value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-300'}`}>{value ? '●' : '○'}</span>
            })}
          </div>
          <p className="mt-3 min-h-5 text-center text-xs font-medium text-slate-600">{statusLabel}</p>
          {error && <p role="alert" className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-center text-xs text-rose-700">{error}</p>}

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
          <p className="mt-4 text-center text-[11px] leading-5 text-slate-500">※暗証番号を忘れた場合は、社員にリセットを依頼してください</p>
          <div className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-500">{isProcessing ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" /> : <><Check size={14} />安全なWeb Cryptoでハッシュ化します</>}</div>
        </div>
      </section>
    </div>
  )
}
