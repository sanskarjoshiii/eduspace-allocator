'use client';

import Image from 'next/image';
import { notFound } from 'next/navigation';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, KeyValueList, PageHeader, Panel, PanelGrid, Tag } from '@/components/ui';
import { lookupFacilityTypes, nameMap } from '@/components/spaces/lookup-helpers';
import { DetailSkeleton } from '@/components/spaces/space-screen';
import { courseKeys } from '@/components/spaces/space-keys';
import { useLookups } from '@/hooks/use-lookups';
import { useMe } from '@/hooks/use-me';
import { ApiError, apiGet } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import type { CourseDto } from '@/server/dto/course';
import { CourseForm } from './course-form';
import { CourseOfferings } from './course-offerings';

function CourseDetail({ course }: { course: CourseDto }) {
  const lookups = useLookups();
  const facilityNames = useMemo(() => nameMap(lookupFacilityTypes(lookups.data)), [lookups.data]);
  return (
    <>
      <PageHeader
        title={course.title}
        description={course.description || 'A course in the EduSpace catalogue.'}
        meta={course.categoryName ? <Tag tone="accent">{course.categoryName}</Tag> : undefined}
      />
      <PanelGrid columns={2}>
        <Panel title="Overview" description="Who runs the course and what it covers.">
          <div className="flex flex-col gap-4">
            {course.coverUrl ? (
              <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-lg border border-border bg-surface-sunken">
                <Image src={course.coverUrl} alt={`${course.title} cover`} fill unoptimized className="object-cover" sizes="448px" />
              </div>
            ) : null}
            <KeyValueList
              items={[
                { label: 'Course provider', value: course.providerName ?? '—' },
                { label: 'Category', value: course.categoryName ?? '—' },
              ]}
            />
          </div>
        </Panel>
        <Panel title="Requirements" description="Facilities a space needs to host this course.">
          {course.requirements.length === 0 ? (
            <EmptyState icon="list-checks" description="No special facilities needed." size="compact" />
          ) : (
            <KeyValueList
              items={course.requirements.map((r) => ({ label: facilityNames[r.facilityTypeId] ?? 'Facility', value: `At least ${formatNumber(r.minQuantity)}`, mono: true }))}
            />
          )}
        </Panel>
      </PanelGrid>
      <CourseOfferings courseId={course.id} />
    </>
  );
}

/** /courses/[id]: edit for the owner and Administrators, read-only otherwise. */
export function CourseScreen({ id }: { id: string }) {
  const me = useMe();
  const q = useQuery({ queryKey: courseKeys.detail(id), queryFn: () => apiGet<CourseDto>(`/api/courses/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 });
  if (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 422)) notFound();
  if (q.isPending || me.isPending) return <DetailSkeleton />;
  if (q.error) {
    return (
      <>
        <PageHeader title="Course" />
        <ErrorState error={q.error} onRetry={() => q.refetch()} className="m-6" />
      </>
    );
  }
  if (q.data.canEdit) return <CourseForm key={q.data.updatedAt ?? q.data.id} course={q.data} isAdmin={me.data?.role === 'Administrator'} />;
  return <CourseDetail course={q.data} />;
}
