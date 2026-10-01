'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, startTransition, ReactNode } from 'react'

export type CurrentStaff = {
  id: string
  name: string
  is_employee: boolean
}

interface AdminContextType {
  currentStaff: CurrentStaff | null
  isHydrated: boolean
  isEmployee: boolean
  isAdmin: boolean
  login: (staff: CurrentStaff) => void
  logout: () => void
}

const AdminContext = createContext<AdminContextType | undefined>(undefined)

export function AdminProvider({ children, storeId }: { children: ReactNode; storeId: string }) {
  const [currentStaff, setCurrentStaff] = useState<CurrentStaff | null>(null)
  const [hydratedStoreId, setHydratedStoreId] = useState<string | null>(null)

  useEffect(() => {
    let restoredStaff: CurrentStaff | null = null
    try {
      const savedValue = localStorage.getItem(`joyful_current_staff_${storeId}`)
      if (savedValue) {
        const parsed = JSON.parse(savedValue) as Partial<CurrentStaff>
        if (typeof parsed.id === 'string' && typeof parsed.name === 'string' && typeof parsed.is_employee === 'boolean') {
          restoredStaff = { id: parsed.id, name: parsed.name, is_employee: parsed.is_employee }
        }
      }
    } catch {
      try {
        localStorage.removeItem(`joyful_current_staff_${storeId}`)
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
    setCurrentStaff(staff)
    try {
      localStorage.setItem(`joyful_current_staff_${storeId}`, JSON.stringify(staff))
    } catch {
      // Keep the in-memory session available when browser storage is blocked.
    }
  }, [storeId])

  const logout = useCallback(() => {
    setCurrentStaff(null)
    try {
      localStorage.removeItem(`joyful_current_staff_${storeId}`)
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

  return (
    <AdminContext.Provider value={value}>
      {children}
    </AdminContext.Provider>
  )
}

export function useAdmin() {
  const context = useContext(AdminContext)
  if (!context) throw new Error('useAdmin must be used within an AdminProvider')
  return context
}