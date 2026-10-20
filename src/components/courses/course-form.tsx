'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { Alert, Button, Field, PageHeader, Panel, PanelGrid, Select, useConfirm, useToast } from '@/components/ui';
import { FormInput, FormSelect, FormTextarea, applyServerErrors } from '@/components/forms';
import { categoryTreeOptions, lookupCategories, lookupFacilityTypes } from '@/components/spaces/lookup-helpers';
import { CoverUploader } from '@/components/spaces/photo-uploader';
import { courseKeys } from '@/components/spaces/space-keys';
import { useLookups } from '@/hooks/use-lookups';
import { ApiError, apiGet, apiSend, type Paged } from '@/lib/api';
import { CourseInput } from '@/schemas/course';
import type { CourseDto } from '@/server/dto/course';
import { CourseOfferings } from './course-offerings';
import { FormRequirementsEditor } from './requirements-editor';

type FormIn = z.input<typeof CourseInput>;
type FormOut = z.output<typeof CourseInput>;

interface UserRow { id: string; name: string; email: string }

function toDefaults(c?: CourseDto): FormIn {
  if (!c) return { title: '', description: '', categoryId: '', requirements: [], coverUrl: '' };
  return { title: c.title, description: c.description, categoryId: c.categoryId, requirements: c.requirements, coverUrl: c.coverUrl };
}

/** Create or edit a course (provider owner or Administrator). */
export function CourseForm({ course, isAdmin }: { course?: CourseDto; isAdmin: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const lookups = useLookups();
  const categories = useMemo(() => categoryTreeOptions(lookupCategories(lookups.data)), [lookups.data]);
  const facilityTypes = lookupFacilityTypes(lookups.data);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const editing = Boolean(course);

  const providers = useQuery({
    queryKey: ['users', { role: 'CourseProvider', status: 'Active' }],
    queryFn: () => apiGet<Paged<UserRow>>('/api/users', { role: 'CourseProvider', status: 'Active', pageSize: 200 }),
    enabled: isAdmin && !editing,
  });

  const { control, handleSubmit, setError, getValues, formState } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(CourseInput),
    defaultValues: toDefaults(course),
    mode: 'onTouched',
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = editing
        ? await apiSend<CourseDto>('PATCH', `/api/courses/${course!.id}`, { ...values, providerUserId: undefined })
        : await apiSend<CourseDto>('POST', '/api/courses', values);
      await qc.invalidateQueries({ queryKey: courseKeys.all });
      toast.success('Course saved');
      router.push(editing ? '/courses' : `/courses/${saved.id}`);
    } catch (err) {
      applyServerErrors(setError, err);
    }
  }, () => {
    if (!getValues('categoryId')) setError('categoryId', { type: 'required', message: 'Choose a category.' });
  });

  const remove = useMutation({
    mutationFn: () => apiSend('DELETE', `/api/courses/${course!.id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: courseKeys.all });
      toast.success('Course deleted');
      router.push('/courses');
    },
    onError: (err) =>
      setDeleteError(
        err instanceof ApiError && err.status === 409
          ? 'This course has offerings. Delete its draft offerings or cancel the others first; past offerings keep the course on record.'
          : err instanceof Error
            ? err.message
            : 'The course could not be deleted. Try again.',
      ),
  });

  const onDelete = async () => {
    setDeleteError(null);
    if (await confirm({ title: 'Delete Course?', description: `${course?.title ?? 'This course'} will be removed. This cannot be undone.`, confirmLabel: 'Delete Course', tone: 'danger' })) {
      remove.mutate();
    }
  };

  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;

  return (
    <>
      {dialog}
      <PageHeader
        title={editing ? course!.title : 'Add Course'}
        description={editing ? 'Update the course details and the facilities it needs.' : 'Describe a course once, then schedule it as offerings.'}
        actions={
          editing ? (
            <>
              <Button icon="plus" href={`/offerings/new?courseId=${course!.id}`}>Add Offering</Button>
              <Button variant="danger" icon="trash-2" onClick={onDelete} loading={remove.isPending}>Delete Course</Button>
            </>
          ) : undefined
        }
      />
      <form onSubmit={onSubmit} noValidate className="flex flex-col">
        {rootError || deleteError ? (
          <div className="flex flex-col gap-2 px-4 pt-4 lg:px-6">
            {rootError ? <Alert tone="danger">{rootError}</Alert> : null}
            {deleteError ? <Alert tone="warning" title="Course Not Deleted">{deleteError}</Alert> : null}
          </div>
        ) : null}
        <PanelGrid columns={1}>
          <Panel title="Details" description="What the course teaches and who runs it.">
            <div className="grid gap-4 md:grid-cols-2">
              <FormInput control={control} name="title" label="Title" required autoComplete="off" />
              <FormSelect
                control={control}
                name="categoryId"
                label="Category"
                required
                placeholder={lookups.isPending ? 'Loading categories' : 'Choose a category'}
                options={categories.map((c) => ({ value: c.value, label: c.label }))}
              />
              <FormTextarea control={control} name="description" label="Description" optional rows={4} maxLength={4000} className="md:col-span-2" />
              {isAdmin && !editing ? (
                <Controller
                  control={control}
                  name="providerUserId"
                  render={({ field, fieldState }) => (
                    <Field label="Course Provider" optional hint="Who runs this course. Leave blank to own it yourself." error={fieldState.error?.message}>
                      <Select
                        placeholder={providers.isPending ? 'Loading course providers' : 'Choose a course provider'}
                        options={(providers.data?.items ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value || undefined)}
                        onBlur={field.onBlur}
                      />
                    </Field>
                  )}
                />
              ) : null}
            </div>
          </Panel>
          <Panel title="Requirements" description="Facilities a space must have in working order.">
            <FormRequirementsEditor control={control} name="requirements" facilityTypes={facilityTypes} />
          </Panel>
          <Panel title="Cover Image" description="Shown on the course card in the catalogue.">
            <Controller
              control={control}
              name="coverUrl"
              render={({ field, fieldState }) => (
                <div className="flex flex-col gap-2">
                  <CoverUploader value={field.value ?? ''} onChange={field.onChange} />
                  {fieldState.error?.message ? <p className="m-0 text-body-sm text-danger-ink">{fieldState.error.message}</p> : null}
                </div>
              )}
            />
          </Panel>
          {course ? <CourseOfferings courseId={course.id} /> : null}
        </PanelGrid>
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-4 py-3 lg:px-6">
          {Object.keys(formState.errors).length > 0 && formState.isSubmitted ? (
            <p className="m-0 mr-auto text-body-sm text-danger-ink">Some fields need attention.</p>
          ) : null}
          <Button variant="ghost" href="/courses">Cancel</Button>
          <Button variant="primary" type="submit" icon="check" loading={formState.isSubmitting}>
            {editing ? 'Save Course' : 'Add Course'}
          </Button>
        </div>
      </form>
    </>
  );
}
