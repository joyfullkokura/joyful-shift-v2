'use client'

import { useEffect } from 'react'

// Small client-side registry shared by the reload banner (VersionWatcher) and
// the screens: screens report unsaved edits, and any failure can ask for an
// immediate check whether a newer deployment is out.

const CHECK_EVENT = 'joyful:version-check'
const DIRTY_EVENT = 'joyful:unsaved-changes'
const dirtyScreens = new Set<string>()

/** Asks the banner to check for a newer deployment now (e.g. after a failed save). */
export const requestVersionCheck = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHECK_EVENT))
}

export const onVersionCheckRequest = (listener: () => void) => {
  window.addEventListener(CHECK_EVENT, listener)
  return () => window.removeEventListener(CHECK_EVENT, listener)
}

export const hasUnsavedChanges = () => dirtyScreens.size > 0

export const onUnsavedChangesChange = (listener: () => void) => {
  window.addEventListener(DIRTY_EVENT, listener)
  return () => window.removeEventListener(DIRTY_EVENT, listener)
}

/** A screen reports whether it holds edits that are not saved yet. */
export const useUnsavedChanges = (key: string, isDirty: boolean) => {
  useEffect(() => {
    if (isDirty) dirtyScreens.add(key)
    else dirtyScreens.delete(key)
    window.dispatchEvent(new Event(DIRTY_EVENT))
    return () => {
      dirtyScreens.delete(key)
      window.dispatchEvent(new Event(DIRTY_EVENT))
    }
  }, [isDirty, key])
}
