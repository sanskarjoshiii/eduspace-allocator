'use client';

import { notFound } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, PageHeader, Panel, PanelGrid, Skeleton, SkeletonText } from '@/components/ui';
import { useMe } from '@/hooks/use-me';
import { ApiError, apiGet } from '@/lib/api';
import type { SpaceDto } from '@/server/dto/space';
import { SpaceDetail } from './space-detail';
import { SpaceForm } from './space-form';
import { spaceKeys } from './space-keys';

export function DetailSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-2 border-b border-border px-4 py-4 lg:px-6 lg:py-5">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <PanelGrid columns={2}>
        {[0, 1, 2, 3].map((i) => (
          <Panel key={i}>
            <SkeletonText lines={4} />
          </Panel>
        ))}
      </PanelGrid>
    </>
  );
}

/** /spaces/[id]: the edit form for the owner and Administrators, a read-only detail for everyone else. */
export function SpaceScreen({ id }: { id: string }) {
  const me = useMe();
  const q = useQuery({ queryKey: spaceKeys.detail(id), queryFn: () => apiGet<SpaceDto>(`/api/spaces/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 });

  if (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 422)) notFound();
  if (q.isPending || me.isPending) return <DetailSkeleton />;
  if (q.error) {
    return (
      <>
        <PageHeader title="Space" />
        <ErrorState error={q.error} onRetry={() => q.refetch()} className="m-6" />
      </>
    );
  }
  const space = q.data;
  if (space.canEdit && space.visibility === 'full') return <SpaceForm key={space.updatedAt ?? space.id} space={space} isAdmin={me.data?.role === 'Administrator'} />;
  return <SpaceDetail space={space} />;
}
