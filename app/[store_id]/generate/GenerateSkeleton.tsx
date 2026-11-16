import { CardSkeleton, LoadingNote, SkeletonBlock, SkeletonRegion, TableSkeleton } from '@/components/Skeleton'

/** Placeholder of the generate screen (also used by its loading.tsx). */
export default function GenerateSkeleton() {
  return (
    <SkeletonRegion label="シフト生成の設定を読み込んでいます…" className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
      <SkeletonBlock className="h-20 w-full" />
      <LoadingNote />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <CardSkeleton lines={5} />
        <CardSkeleton lines={6} />
      </div>
      <TableSkeleton rows={6} columns={10} />
    </SkeletonRegion>
  )
}
