import { LoadingNote, SkeletonBlock, SkeletonRegion, TableSkeleton } from '@/components/Skeleton'

/** Shown at once while moving to this screen. */
export default function ViewLoading() {
  return (
    <SkeletonRegion label="確定シフトを読み込んでいます…" className="mx-auto max-w-6xl space-y-4 p-4 md:p-8">
      <SkeletonBlock className="h-8 w-48" />
      <LoadingNote label="確定シフトを読み込んでいます…" />
      <TableSkeleton rows={8} columns={12} />
    </SkeletonRegion>
  )
}
