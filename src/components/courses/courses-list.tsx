'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, DataTable, EmptyState, PageHeader, Panel, Select, Tag, type DataTableColumn } from '@/components/ui';
import { categoryTreeOptions, lookupCategories } from '@/components/spaces/lookup-helpers';
import { courseKeys } from '@/components/spaces/space-keys';
import { useLookups } from '@/hooks/use-lookups';
import { apiGet, type Paged } from '@/lib/api';
import type { Role } from '@/lib/domain';
import { formatDate, formatNumber } from '@/lib/format';
import type { CourseDto } from '@/server/dto/course';
import { OfferingsCount } from './course-offerings';

const PAGE_SIZE = 20;

/** /courses: own courses (Course Provider), all courses (Administrator), catalogue (others). */
export function CoursesList({ role }: { role: Role }) {
  const provider = role === 'CourseProvider';
  const admin = role === 'Administrator';
  const canCreate = provider || admin;
  const lookups = useLookups();
  const categories = useMemo(() => categoryTreeOptions(lookupCategories(lookups.data)), [lookups.data]);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const params = { page, pageSize: PAGE_SIZE, q, categoryId, mine: provider ? 1 : undefined };
  const query = useQuery({
    queryKey: courseKeys.list(params),
    queryFn: () => apiGet<Paged<CourseDto>>('/api/courses', params),
    placeholderData: keepPreviousData,
  });

  const columns: DataTableColumn<CourseDto>[] = [
    { key: 'title', header: 'Course', cell: (c) => <span className="font-medium text-ink">{c.title}</span> },
    { key: 'categoryName', header: 'Category', hideBelow: 'sm', cell: (c) => (c.categoryName ? <Tag tone="accent">{c.categoryName}</Tag> : '—') },
    ...(provider ? [] : [{ key: 'providerName', header: 'Course Provider', hideBelow: 'md' as const, cell: (c: CourseDto) => c.providerName ?? '—' }]),
    { key: 'requirements', header: 'Requirements', align: 'end', hideBelow: 'lg', cell: (c) => formatNumber(c.requirements.length) },
    { key: 'offerings', header: 'Offerings', align: 'end', cell: (c) => <OfferingsCount courseId={c.id} /> },
    { key: 'updatedAt', header: 'Updated', hideBelow: 'md', cell: (c) => <span className="font-mono tabular-nums">{formatDate(c.updatedAt)}</span> },
  ];

  const filtered = Boolean(q || categoryId);
  return (
    <>
      <PageHeader
        title={provider ? 'My Courses' : admin ? 'Courses' : 'Course Catalogue'}
        description={provider ? 'Courses you teach and how many offerings each one has.' : admin ? 'Every course in the catalogue, by provider and category.' : 'Courses offered by EduSpace partners.'}
        actions={canCreate ? <Button variant="primary" icon="plus" href="/courses/new">Add Course</Button> : undefined}
      />
      <Panel title={provider ? 'Courses' : 'All Courses'} description="Search by title, filter by category and open a course.">
        <DataTable
          caption="Courses"
          columns={columns}
          rows={query.data?.items ?? []}
          rowKey={(c) => c.id}
          rowHref={(c) => `/courses/${c.id}`}
          searchable
          searchPlaceholder="Search courses"
          itemLabel="courses"
          toolbar={
            <Select
              size="sm"
              aria-label="Category"
              className="w-52"
              placeholder="All categories"
              options={categories.map((c) => ({ value: c.value, label: c.label }))}
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
            />
          }
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          empty={
            <EmptyState
              icon="book-open"
              description={filtered ? 'No courses match these filters.' : provider ? 'No courses yet. Add a course, then schedule it as an offering.' : 'No courses in the catalogue yet.'}
              action={
                categoryId ? (
                  <Button size="sm" onClick={() => setCategoryId('')}>Clear Filter</Button>
                ) : canCreate && !filtered ? (
                  <Button size="sm" icon="plus" href="/courses/new">Add Course</Button>
                ) : undefined
              }
              size="compact"
            />
          }
          server={{
            page,
            pageSize: PAGE_SIZE,
            total: query.data?.total ?? 0,
            onPageChange: setPage,
            onSearch: (text) => {
              setQ(text);
              setPage(1);
            },
          }}
        />
      </Panel>
    </>
  );
}
