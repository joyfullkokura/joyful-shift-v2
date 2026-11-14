// Client-side fetchers for admin-only Route Handlers. The session cookie is
// sent automatically (same origin); the server re-checks admin rights.

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)

const getJson = async (path: string): Promise<unknown> => {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Request failed: ${response.status}`)
  return response.json()
}

export const fetchStoreStaff = async (storeId: string, order: 'name' | 'created_at'): Promise<Row[]> => {
  const body = await getJson(`/api/stores/${encodeURIComponent(storeId)}/staff?order=${order}`)
  const staff = isRow(body) ? body.staff : null
  return Array.isArray(staff) ? staff.filter(isRow) : []
}

export const fetchStoreSettings = async (storeId: string): Promise<Row | null> => {
  const body = await getJson(`/api/stores/${encodeURIComponent(storeId)}/settings`)
  return isRow(body) && isRow(body.store) ? body.store : null
}
