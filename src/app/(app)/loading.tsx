import { LoadingLabel, Skeleton, SkeletonText } from '@/components/ui/skeleton';

/** Skeleton shaped like the standard page: title row, KPI trays, two panels. */
export default function Loading() {
  return (
    <div aria-busy className="flex flex-col">
      <LoadingLabel>Loading page</LoadingLabel>
      <div className="flex flex-col gap-2 border-b border-border px-4 py-4 lg:px-6 lg:py-5">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-3 border-b border-border p-4 sm:grid-cols-2 lg:p-6 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-surface-sunken px-1 pb-1">
            <div className="flex h-10 items-center px-2.5">
              <Skeleton className="h-3 w-28" />
            </div>
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
              <Skeleton className="h-7.5 w-24" />
              <Skeleton className="h-3.5 w-40" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-px bg-border lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-4 bg-surface p-4 lg:p-6">
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3.5 w-64 max-w-full" />
            </div>
            <Skeleton className="h-40 w-full rounded-lg" />
            <SkeletonText lines={3} />
          </div>
        ))}
      </div>
    </div>
  );
}
