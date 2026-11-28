import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Server Actions of the 休み希望 screen against an in-memory table store: the
// session (社員・店長 or アルバイト) and the clock are set per test. Nothing here
// touches Supabase.

type Row = Record<string, unknown>
type Filter = (row: Row) => boolean

const tables: Record<string, Row[]> = {}
let session: { id: string; name: string; is_employee: boolean } = { id: 'p1', name: 'アルバイト', is_employee: false }

/** Just enough of the supabase-js query builder for app/actions/requests.ts. */
const fakeClient = {
  from(table: string) {
    const filters: Filter[] = []
    let mode: 'select' | 'update' | 'delete' | 'upsert' = 'select'
    let payload: Row | Row[] = {}
    let conflictKeys: string[] = []
    const rows = () => (tables[table] ??= [])
    const run = (): { data: unknown; error: null } => {
      const matches = (row: Row) => filters.every(filter => filter(row))
      if (mode === 'select') return { data: rows().filter(matches).map(row => ({ ...row })), error: null }
      if (mode === 'update') {
        rows().filter(matches).forEach(row => Object.assign(row, payload))
        return { data: null, error: null }
      }
      if (mode === 'delete') {
        tables[table] = rows().filter(row => !matches(row))
        return { data: null, error: null }
      }
      for (const incoming of Array.isArray(payload) ? payload : [payload]) {
        const existing = rows().find(row => conflictKeys.every(key => row[key] === incoming[key]))
        if (existing) Object.assign(existing, incoming)
        else rows().push({ ...incoming })
      }
      return { data: null, error: null }
    }
    const builder = {
      select: () => builder,
      update: (fields: Row) => { mode = 'update'; payload = fields; return builder },
      delete: () => { mode = 'delete'; return builder },
      upsert: (value: Row | Row[], options: { onConflict: string }) => {
        mode = 'upsert'; payload = value; conflictKeys = options.onConflict.split(',')
        return builder
      },
      eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return builder },
      gte: (column: string, value: string) => { filters.push(row => String(row[column]) >= value); return builder },
      lt: (column: string, value: string) => { filters.push(row => String(row[column]) < value); return builder },
      in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return builder },
      maybeSingle: async () => {
        const { data } = run()
        return { data: Array.isArray(data) ? data[0] ?? null : null, error: null }
      },
      then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve(run()).then(resolve),
    }
    return builder
  },
}

vi.mock('@/lib/server/supabase-admin', () => ({ getAdminClient: () => fakeClient }))
vi.mock('@/lib/server/dal', () => {
  class AuthorizationError extends Error {
    constructor(readonly reason: 'unauthenticated' | 'forbidden') { super(reason) }
  }
  return {
    AuthorizationError,
    requireSession: async () => session,
    requireAdmin: async () => {
      if (!session.is_employee) throw new AuthorizationError('forbidden')
      return session
    },
  }
})

const { clearMonthRequestDeadline, saveMyMonthRequests, saveRequestDeadline, getRequestsPageMonth } = await import('@/app/actions/requests')

const STORE = 'TEST'
const MONTH = '2026-12-01'
const PART_TIMER = { id: 'p1', name: 'アルバイト', is_employee: false }
const EMPLOYEE = { id: 'e1', name: '社員', is_employee: true }
const offOn = (date: string) => ({ date, kind: 'off' as const, start: null, end: null, memo: '' })
const requestsOf = (staffId: string) => (tables.shift_requests ?? []).filter(row => row.staff_id === staffId).map(row => row.date).sort()

/** Deadline: 前月20日 21:00, i.e. 2026-11-20 21:00 JST for December. */
const setMonthly = (day: number | null, time = '21:00:00') => {
  tables.stores = [{ store_id: STORE, request_deadline_day: day, request_deadline_time: time, open_time: '09:00', close_time: '24:00' }]
}
const setNow = (jst: string) => vi.setSystemTime(new Date(`${jst}+09:00`))

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  setMonthly(20)
  vi.useFakeTimers({ toFake: ['Date'] })
  session = PART_TIMER
})
afterEach(() => { vi.useRealTimers() })

describe('提出期限 lock on saving the month', () => {
  it('before the deadline a part-timer can save and withdraw', async () => {
    setNow('2026-11-20T21:00:00')
    expect(await saveMyMonthRequests(STORE, MONTH, [offOn('2026-12-05'), offOn('2026-12-06')])).toEqual({ ok: true, data: null })
    expect(requestsOf('p1')).toEqual(['2026-12-05', '2026-12-06'])
    // Withdrawing a day = saving the month without it.
    expect((await saveMyMonthRequests(STORE, MONTH, [offOn('2026-12-05')])).ok).toBe(true)
    expect(requestsOf('p1')).toEqual(['2026-12-05'])
  })

  it('after the deadline a part-timer cannot save, change or withdraw', async () => {
    setNow('2026-11-20T21:00:00')
    await saveMyMonthRequests(STORE, MONTH, [offOn('2026-12-05')])
    setNow('2026-11-20T21:00:01')
    const saved = await saveMyMonthRequests(STORE, MONTH, [offOn('2026-12-05'), offOn('2026-12-07')])
    expect(saved).toEqual({ ok: false, error: '提出期限を過ぎたため閲覧のみです。変更は店長に相談してください。' })
    expect((await saveMyMonthRequests(STORE, MONTH, [])).ok).toBe(false)
    expect(requestsOf('p1')).toEqual(['2026-12-05'])
  })

  it('社員・店長 can still save after the deadline', async () => {
    session = EMPLOYEE
    setNow('2026-11-28T10:00:00')
    expect((await saveMyMonthRequests(STORE, MONTH, [offOn('2026-12-24')])).ok).toBe(true)
    expect(requestsOf('e1')).toEqual(['2026-12-24'])
  })

  it('moving the deadline later opens the month again (monthly setting and this month only)', async () => {
    setNow('2026-11-22T12:00:00')
    expect((await saveMyMonthRequests(STORE, MONTH, [offOn('2026-12-05')])).ok).toBe(false)

    session = EMPLOYEE
    expect((await saveRequestDeadline(STORE, MONTH, { scope: 'month', day: 25, time: '21:00' })).ok).toBe(true)
    session = PART_TIMER
    expect((await saveMyMonthRequests(STORE, MONTH, [offOn('2026-12-05')])).ok).toBe(true)

    // Back to the monthly setting (20日): closed again; then the monthly setting moves to 末日.
    session = EMPLOYEE
    expect((await clearMonthRequestDeadline(STORE, MONTH)).ok).toBe(true)
    session = PART_TIMER
    expect((await saveMyMonthRequests(STORE, MONTH, [])).ok).toBe(false)
    session = EMPLOYEE
    expect((await saveRequestDeadline(STORE, MONTH, { scope: 'monthly', day: 31, time: '23:59' })).ok).toBe(true)
    session = PART_TIMER
    expect((await saveMyMonthRequests(STORE, MONTH, [])).ok).toBe(true)
    expect(requestsOf('p1')).toEqual([])
  })

  it('a store without a deadline never locks', async () => {
    setMonthly(null)
    setNow('2026-11-30T23:59:00')
    expect((await saveMyMonthRequests(STORE, MONTH, [offOn('2026-12-05')])).ok).toBe(true)
  })
})

describe('changing the 提出期限', () => {
  it('a part-timer cannot change it (monthly or this month only, or clear it)', async () => {
    setNow('2026-11-10T12:00:00')
    const forbidden = { ok: false, error: 'この操作を行う権限がありません。' }
    expect(await saveRequestDeadline(STORE, MONTH, { scope: 'monthly', day: 25, time: '21:00' })).toEqual(forbidden)
    expect(await saveRequestDeadline(STORE, MONTH, { scope: 'month', day: 25, time: '21:00' })).toEqual(forbidden)
    expect(await clearMonthRequestDeadline(STORE, MONTH)).toEqual(forbidden)
    expect(tables.stores[0].request_deadline_day).toBe(20)
    expect(tables.store_request_deadline_overrides ?? []).toEqual([])
  })

  it('records who changed it; this month only does not touch other months', async () => {
    session = EMPLOYEE
    setNow('2026-11-10T12:00:00')
    const result = await saveRequestDeadline(STORE, MONTH, { scope: 'month', day: 31, time: '18:15' })
    // November has 30 days: clamped to 11/30.
    expect(result).toEqual({ ok: true, data: { deadline: { at: new Date('2026-11-30T18:15:00+09:00').toISOString(), source: 'override' }, monthly: { day: 20, time: '21:00' } } })
    expect(tables.store_request_deadline_overrides).toMatchObject([{ store_id: STORE, target_month: MONTH, updated_by: 'e1' }])

    const january = await getRequestsPageMonth(STORE, '2027-01-01')
    expect(january.ok && january.data.deadline).toEqual({ at: new Date('2026-12-20T21:00:00+09:00').toISOString(), source: 'monthly' })

    await saveRequestDeadline(STORE, MONTH, { scope: 'monthly', day: 15, time: '12:00' })
    expect(tables.stores[0]).toMatchObject({ request_deadline_day: 15, request_deadline_time: '12:00', request_deadline_updated_by: 'e1' })
  })

  it('rejects days and times outside the choices', async () => {
    session = EMPLOYEE
    expect((await saveRequestDeadline(STORE, MONTH, { scope: 'monthly', day: 32, time: '21:00' })).ok).toBe(false)
    expect((await saveRequestDeadline(STORE, MONTH, { scope: 'monthly', day: 20, time: '21:10' })).ok).toBe(false)
    expect((await saveRequestDeadline(STORE, '2026-12-02', { scope: 'month', day: 20, time: '21:00' })).ok).toBe(false)
  })
})
