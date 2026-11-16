import type { ReactNode } from 'react'

// Loading placeholders shared by every screen: slate-100 blocks in the shape of
// what is about to appear, a faint shimmer (none with prefers-reduced-motion,
// see .skeleton-block in globals.css) and a small text for screen readers and
// for anyone who wonders what is happening. Server-safe (no hooks).

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton-block rounded-md ${className}`} />
}

export function LoadingNote({ label = '読み込んでいます…' }: { label?: string }) {
  return <p className="text-xs font-medium text-slate-500">{label}</p>
}

/** Wraps placeholders so assistive technology announces one busy region. */
export function SkeletonRegion({ label = '読み込んでいます…', children, className = '' }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** A month calendar: weekday header and 5 rows of 7 day cells. */
export function CalendarSkeleton({ cellClassName = 'h-16' }: { cellClassName?: string }) {
  return (
    <div className="grid grid-cols-7 gap-1" aria-hidden="true">
      {Array.from({ length: 7 }, (_, index) => <SkeletonBlock key={`h-${index}`} className="mx-auto mb-1 h-3 w-4" />)}
      {Array.from({ length: 35 }, (_, index) => <SkeletonBlock key={index} className={cellClassName} />)}
    </div>
  )
}

/** A table: a name column and day columns, a few rows. */
export function TableSkeleton({ rows = 6, columns = 10 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-1.5 overflow-hidden rounded-md border border-slate-200 bg-white p-2" aria-hidden="true">
      {Array.from({ length: rows + 1 }, (_, row) => (
        <div key={row} className="flex gap-1.5">
          <SkeletonBlock className={`h-6 w-24 shrink-0 ${row === 0 ? 'opacity-70' : ''}`} />
          {Array.from({ length: columns }, (_, column) => <SkeletonBlock key={column} className="h-6 w-9 shrink-0" />)}
        </div>
      ))}
    </div>
  )
}

/** A card with a heading line and a few text lines. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-white p-4" aria-hidden="true">
      <SkeletonBlock className="h-4 w-1/3" />
      {Array.from({ length: lines }, (_, index) => <SkeletonBlock key={index} className={`h-3 ${index % 2 ? 'w-2/3' : 'w-full'}`} />)}
    </div>
  )
}
