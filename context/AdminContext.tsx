'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, startTransition, ReactNode } from 'react'

export type CurrentStaff = {
  id: string
  name: string
  is_employee: boolean
  pin_hash?: string | null
  expiresAt?: string
}

type StoredStaff = CurrentStaff & {
  expiresAt: string
}

interface AdminContextType {
  currentStaff: CurrentStaff | null
  isHydrated: boolean
  isEmployee: boolean
  isAdmin: boolean
  login: (staff: CurrentStaff) => void
  logout: () => void
}

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000
const STORAGE_KEY_PREFIX = 'joyful_current_staff_'
const AdminContext = createContext<AdminContextType | undefined>(undefined)

const isStoredStaff = (value: unknown): value is StoredStaff => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredStaff>
  return typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.is_employee === 'boolean' &&
    typeof candidate.expiresAt === 'string' &&
    !Number.isNaN(Date.parse(candidate.expiresAt))
}

export function AdminProvider({ children, storeId }: { children: ReactNode; storeId: string }) {
  const [currentStaff, setCurrentStaff] = useState<CurrentStaff | null>(null)
  const [hydratedStoreId, setHydratedStoreId] = useState<string | null>(null)

  useEffect(() => {
    let restoredStaff: CurrentStaff | null = null
    const storageKey = `${STORAGE_KEY_PREFIX}${storeId}`
    try {
      const savedValue = localStorage.getItem(storageKey)
      if (savedValue) {
        const parsed: unknown = JSON.parse(savedValue)
        if (isStoredStaff(parsed) && new Date(parsed.expiresAt).getTime() > Date.now()) {
          restoredStaff = parsed
        } else {
          localStorage.removeItem(storageKey)
        }
      }
    } catch {
      try {
        localStorage.removeItem(storageKey)
      } catch {
        restoredStaff = null
      }
    }
    startTransition(() => {
      setCurrentStaff(restoredStaff)
      setHydratedStoreId(storeId)
    })
  }, [storeId])

  const login = useCallback((staff: CurrentStaff) => {
    const authenticatedStaff: StoredStaff = {
      ...staff,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
    }
    setCurrentStaff(authenticatedStaff)
    try {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${storeId}`, JSON.stringify(authenticatedStaff))
    } catch {
      // Keep the in-memory session available when browser storage is blocked.
    }
  }, [storeId])

  const logout = useCallback(() => {
    setCurrentStaff(null)
    try {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${storeId}`)
    } catch {
      // Clearing in-memory state is sufficient for the current page session.
    }
  }, [storeId])

  const isEmployee = currentStaff?.is_employee === true
  const isHydrated = hydratedStoreId === storeId
  const value = useMemo(() => ({
    currentStaff,
    isHydrated,
    isEmployee,
    isAdmin: isEmployee,
    login,
    logout,
  }), [currentStaff, isHydrated, isEmployee, login, logout])

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

export function useAdmin() {
  const context = useContext(AdminContext)
  if (!context) throw new Error('useAdmin must be used within an AdminProvider')
  return context
}