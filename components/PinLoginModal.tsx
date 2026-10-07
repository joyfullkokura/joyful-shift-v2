'use client'

import { useEffect, useState } from 'react'
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

const PIN_LENGTH = 4
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

async function hashPin(pin: string): Promise<string> {
  const encodedPin = new TextEncoder().encode(pin)
  const digest = await crypto.subtle.digest('SHA-256', encodedPin)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export default function PinLoginModal({ staff, storeId, mode: requestedMode, onClose, onSuccess }: PinLoginModalProps) {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [stage, setStage] = useState<PinStage>(() => requestedMode === 'change' ? 'current' : 'pin')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState('')
  const mode = requestedMode ?? (staff.pin_hash ? 'login' : 'setup')

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const resetPin = () => {
    setPin('')
    setConfirmPin('')
    setStage('pin')
    setError('')
    setIsProcessing(false)
  }

  const handlePinComplete = async (nextPin: string) => {
    if (isProcessing || nextPin.length !== PIN_LENGTH) return
    setIsProcessing(true)
    setError('')

    try {
      const pinHash = await hashPin(nextPin)
      if (mode === 'setup' && stage === 'pin') {
        setPin(nextPin)
        setStage('confirm')
        setIsProcessing(false)
        return
      }

      if (mode === 'change' && stage === 'current') {
        if (pinHash !== staff.pin_hash) {
          setError('現在の暗証番号が一致しませんでした。もう一度入力してください。')
          resetPin()
          return
        }
        setPin('')
        setStage('new')
        setIsProcessing(false)
        return
      }

      if (mode === 'change' && stage === 'new') {
        setPin(nextPin)
        setStage('confirm')
        setIsProcessing(false)
        return
      }

      if (mode === 'setup' && stage === 'confirm') {
        if (nextPin !== pin) {
          setError('暗証番号が一致しませんでした。もう一度入力してください。')
          resetPin()
          return
        }
        const { error: updateError } = await supabase.from('staff').update({ pin_hash: pinHash }).eq('id', staff.id).eq('store_id', storeId)
        if (updateError) throw updateError
        onSuccess({ ...staff, pin_hash: pinHash })
        return
      }

      if (mode === 'change' && stage === 'confirm') {
        if (nextPin !== pin) {
          setError('新しい暗証番号が一致しませんでした。もう一度入力してください。')
          resetPin()
          return
        }
        const { error: updateError } = await supabase.from('staff').update({ pin_hash: pinHash }).eq('id', staff.id).eq('store_id', storeId)
        if (updateError) throw updateError
        onSuccess({ ...staff, pin_hash: pinHash })
        return
      }

      if (pinHash !== staff.pin_hash) {
        setError('PINが一致しませんでした。4桁をもう一度入力してください。')
        resetPin()
        return
      }
      onSuccess(staff)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '認証に失敗しました。')
      resetPin()
    }
  }

  const handleDigit = (digit: string) => {
    if (isProcessing || stage === 'confirm' || (stage === 'pin' && pin.length >= PIN_LENGTH)) return
    const nextPin = `${pin}${digit}`
    setPin(nextPin)
    if (nextPin.length === PIN_LENGTH) void handlePinComplete(nextPin)
  }

  const handleDelete = () => {
    if (isProcessing || stage === 'confirm') return
    setPin(current => current.slice(0, -1))
    setError('')
  }

  const handleConfirmDigit = (digit: string) => {
    if (isProcessing || confirmPin.length >= PIN_LENGTH) return
    const nextPin = `${confirmPin}${digit}`
    setConfirmPin(nextPin)
    if (nextPin.length === PIN_LENGTH) void handlePinComplete(nextPin)
  }

  const handleConfirmDelete = () => {
    if (isProcessing) return
    setConfirmPin(current => current.slice(0, -1))
    setError('')
  }

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
            <p className="mt-1 text-xs text-slate-500">{mode === 'setup' ? '初回設定です。4桁の暗証番号を設定してください。' : mode === 'change' ? '現在の暗証番号を確認してから新しい暗証番号を設定してください。' : '登録済みの暗証番号を入力してください。'}</p>
          </div>

          <div className="mt-5 flex items-center justify-center gap-3" aria-label="入力状態">
            {Array.from({ length: PIN_LENGTH }, (_, index) => {
              const value = stage === 'pin' || stage === 'current' || stage === 'new' ? pin[index] : confirmPin[index]
              return <span key={index} className={`flex h-11 w-11 items-center justify-center rounded-full border text-xl font-semibold ${value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-300'}`}>{value ? '●' : '○'}</span>
            })}
          </div>

          <div className="mt-3 min-h-6 text-center text-xs font-medium text-slate-600">
            {mode === 'setup' && stage === 'pin' && '1番目の暗証番号を入力してください。'}
            {mode === 'setup' && stage === 'confirm' && '同じ暗証番号をもう一度入力してください。'}
            {mode === 'change' && stage === 'current' && '現在の暗証番号を入力してください。'}
            {mode === 'change' && stage === 'new' && '新しい暗証番号を入力してください。'}
            {mode === 'change' && stage === 'confirm' && '新しい暗証番号をもう一度入力してください。'}
            {mode === 'login' && '4桁を入力すると自動で認証されます。'}
          </div>

          {error && <p role="alert" className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-center text-xs text-rose-700">{error}</p>}

          <div className="mt-4 grid grid-cols-3 gap-2">
            {DIGITS.map(digit => (
              <button
                key={digit}
                type="button"
                onClick={() => stage === 'confirm' ? handleConfirmDigit(digit) : handleDigit(digit)}
                disabled={isProcessing || (stage === 'confirm' ? confirmPin.length >= PIN_LENGTH : pin.length >= PIN_LENGTH)}
                className="h-14 rounded-md border border-slate-200 bg-white text-lg font-semibold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {digit}
              </button>
            ))}
            <button type="button" onClick={stage === 'confirm' ? handleConfirmDelete : handleDelete} disabled={isProcessing || (stage === 'confirm' ? confirmPin.length === 0 : pin.length === 0)} className="h-14 rounded-md border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50">
              <span className="inline-flex items-center gap-1"><LockKeyhole size={15} />削除</span>
            </button>
          </div>

          <div className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-500">
            {isProcessing ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" /> : <><Check size={14} />安全なWeb Cryptoでハッシュ化します</>}
          </div>
        </div>
      </section>
    </div>
  )
}
