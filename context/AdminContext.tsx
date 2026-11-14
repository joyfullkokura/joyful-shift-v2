'use client'
import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react'
import type { SessionStaff } from '@/lib/auth-types'
import { logout as logoutAction } from '@/app/actions/auth'

// The session lives in a signed httpOnly cookie issued by the server. This
// context only mirrors it for rendering; isAdmin here is a UI hint, and every
// privileged operation is authorised again on the server.
export type CurrentStaff = SessionStaff

interface AdminContextType {
  currentStaff: CurrentStaff | null
  isHydrated: boolean
  isEmployee: boolean
  isAdmin: boolean
  login: (staff: CurrentStaff) => void
  logout: () => Promise<void>
}

const LEGACY_STORAGE_KEY_PREFIX = 'joyful_current_staff_'
const AdminContext = createContext<AdminContextType | undefined>(undefined)

export function AdminProvider({ children, storeId, initialStaff }: { children: ReactNode; storeId: string; initialStaff: CurrentStaff | null }) {
  const [currentStaff, setCurrentStaff] = useState<CurrentStaff | null>(initialStaff)

  const login = useCallback((staff: CurrentStaff) => {
    setCurrentStaff(staff)
    try {
      // Drop the pre-cookie localStorage session, which is no longer trusted.
      localStorage.removeItem(`${LEGACY_STORAGE_KEY_PREFIX}${storeId}`)
    } catch {
      // Storage may be blocked; nothing depends on it any more.
    }
  }, [storeId])

  const logout = useCallback(async () => {
    try {
      localStorage.removeItem(`${LEGACY_STORAGE_KEY_PREFIX}${storeId}`)
    } catch {
      // Storage may be blocked; nothing depends on it any more.
    }
    // Deleting the cookie makes Next.js re-render the layout, which then
    // supplies the login member list; clear local state afterwards.
    await logoutAction(storeId)
    setCurrentStaff(null)
  }, [storeId])

  const isEmployee = currentStaff?.is_employee === true
  const value = useMemo(() => ({
    currentStaff,
    isHydrated: true,
    isEmployee,
    isAdmin: isEmployee,
    login,
    logout,
  }), [currentStaff, isEmployee, login, logout])

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

export function useAdmin() {
  const context = useContext(AdminContext)
  if (!context) throw new Error('useAdmin must be used within an AdminProvider')
  return context
}
