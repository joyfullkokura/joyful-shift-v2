// Rule-based reading of fixed phrases in old memo-only requests
// ("休み", "18時以降", "15時まで", "10時から14時まで" ...). Anything else returns
// null so that the manager decides; there is no guessing and no AI. Pure.

import type { BusinessHours, DayRequest } from '@/lib/day-request'

const TIME = String.raw`(\d{1,2}(?::\d{2}|時(?:半|\d{1,2}分?)?)?)`
const OK = String.raw`(?:OK|可|可能|出勤可能?|入れます|出れます|出られます|大丈夫です?)?`
const POLITE = String.raw`(?:希望|で|です|でお願いします|お願いします)?`

const OFF = new RegExp(String.raw`^(?:休|休み|お休み|公休|有給|有休|×|✕|✖|X|不可|出勤不可|終日不可|NG)${POLITE}$`, 'i')
const ANY = new RegExp(String.raw`^(?:終日|終日OK|終日可|終日可能|いつでも|いつでもOK|何時でも|何時でもOK)${POLITE}$`, 'i')
const FROM = new RegExp(String.raw`^${TIME}(?:以降|以後|から|より|〜)${OK}${POLITE}$`, 'i')
const UNTIL = new RegExp(String.raw`^(?:〜${TIME}(?:まで|迄)?|${TIME}(?:まで|迄))${OK}${POLITE}$`, 'i')
const RANGE = new RegExp(String.raw`^${TIME}(?:から|より|〜)${TIME}(?:まで|迄)?${OK}${POLITE}$`, 'i')

/** Full-width digits / letters, spaces, sentence endings and the many tilde / dash forms. */
const normalize = (memo: string) =>
  memo.normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[。.、,!！]+$/u, '')
    .replace(/[~〜～\-‐−–—]/gu, '〜')

const tokenMinutes = (token: string): number | null => {
  const match = /^(\d{1,2})(?::(\d{2})|時(?:(半)|(\d{1,2})分?)?)?$/.exec(token)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = match[2] !== undefined ? Number(match[2]) : match[3] ? 30 : match[4] !== undefined ? Number(match[4]) : 0
  if (hours > 24 || minutes >= 60 || (hours === 24 && minutes > 0)) return null
  return hours * 60 + minutes
}

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/**
 * Reads a memo that consists of exactly one fixed phrase. Times outside the
 * business hours are clamped to them ("8時から" = from opening).
 */
export const parseRequestPhrase = (memo: string, hours: BusinessHours): DayRequest | null => {
  const text = normalize(memo)
  if (!text) return null
  if (OFF.test(text)) return { kind: 'off', start: null, end: null }
  if (ANY.test(text)) return { kind: 'any', start: null, end: null }

  const range = RANGE.exec(text)
  if (range) {
    const start = tokenMinutes(range[1])
    const end = tokenMinutes(range[2])
    if (start === null || end === null) return null
    const clampedStart = Math.max(start, hours.open)
    const clampedEnd = Math.min(end, hours.close)
    return clampedStart < clampedEnd ? { kind: 'range', start: clock(clampedStart), end: clock(clampedEnd) } : null
  }

  const from = FROM.exec(text)
  if (from) {
    const start = tokenMinutes(from[1])
    if (start === null || start >= hours.close) return null
    return { kind: 'from', start: clock(Math.max(start, hours.open)), end: null }
  }

  const until = UNTIL.exec(text)
  if (until) {
    const end = tokenMinutes(until[1] ?? until[2])
    if (end === null || end <= hours.open) return null
    return { kind: 'until', start: null, end: clock(Math.min(end, hours.close)) }
  }
  return null
}
