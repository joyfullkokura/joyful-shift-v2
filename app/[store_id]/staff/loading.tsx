import { CardSkeleton, LoadingNote, SkeletonBlock, SkeletonRegion } from '@/components/Skeleton'

/** Shown at once while moving to this screen. */
export default function StaffLoading() {
  return (
    <SkeletonRegion label="名簿を読み込んでいます…" className="mx-auto max-w-6xl space-y-4 p-4 md:p-8">
      <SkeletonBlock className="h-8 w-48" />
      <LoadingNote label="名簿を読み込んでいます…" />
      <CardSkeleton lines={4} />
      <CardSkeleton lines={4} />
    </SkeletonRegion>
  )
}
