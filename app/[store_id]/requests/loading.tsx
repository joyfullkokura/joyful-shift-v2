import { CalendarSkeleton, LoadingNote, SkeletonBlock, SkeletonRegion, TableSkeleton } from '@/components/Skeleton'

/** Shown at once while the server loads the 休み希望 month. Mirrors the screen's layout. */
export default function RequestsLoading() {
  return (
    <SkeletonRegion label="休み希望を読み込んでいます…" className="mx-auto max-w-[1600px] p-4 md:p-8">
      <div className="mx-auto mb-8 max-w-md space-y-3 rounded-md border border-[var(--border)] bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <SkeletonBlock className="h-7 w-48" />
            <SkeletonBlock className="h-4 w-24" />
          </div>
          <div className="flex gap-1.5">
            <SkeletonBlock className="h-12 w-12" />
            <SkeletonBlock className="h-12 w-12" />
          </div>
        </div>
        <LoadingNote />
        <CalendarSkeleton />
        <SkeletonBlock className="h-14 w-full" />
      </div>
      <div className="mt-8 space-y-3 border-t border-slate-200 pt-6">
        <SkeletonBlock className="h-5 w-40" />
        <TableSkeleton rows={8} columns={12} />
      </div>
    </SkeletonRegion>
  )
}
