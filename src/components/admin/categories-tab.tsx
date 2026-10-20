'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { applyServerErrors, FormInput, FormSelect } from '@/components/forms';
import {
  Alert, Badge, Button, Dialog, EmptyState, ErrorState, IconButton, Panel, SearchField, Skeleton, useToast,
} from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api';
import { lookupKeys } from '@/hooks/use-lookups';
import { CategoryInput } from '@/schemas/lookups';
import type { CategoryDto } from '@/server/dto/lookup';
import { ActionConfirm } from './action-confirm';
import { deleteErrorMessage } from './admin-utils';
import { useReportSubmitting } from './use-report-submitting';

export const categoryKeys = { all: ['categories'] as const };

interface TreeNode {
  category: CategoryDto;
  depth: number;
  childCount: number;
}

/** Depth-first order with depth, so the list reads as a tree. Orphans (unknown parent) sit at the top level. */
function flattenTree(items: CategoryDto[]): TreeNode[] {
  const ids = new Set(items.map((c) => c.id));
  const byParent = new Map<string | null, CategoryDto[]>();
  for (const c of items) {
    const parent = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), c]);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'en-IN'));
  const out: TreeNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const c of byParent.get(parent) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ category: c, depth, childCount: byParent.get(c.id)?.length ?? 0 });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The category and everything below it (cannot be chosen as its parent). */
function descendantsOf(id: string, items: CategoryDto[]): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of items) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

export function CategoriesTab({ creating, onCreatingChange }: { creating: boolean; onCreatingChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<CategoryDto | null>(null);
  const [deleting, setDeleting] = useState<CategoryDto | null>(null);
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: categoryKeys.all,
    queryFn: () => apiGet<{ items: CategoryDto[]; total: number }>('/api/categories'),
  });
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const tree = useMemo(() => flattenTree(items), [items]);
  const names = useMemo(() => new Map(items.map((c) => [c.id, c.name])), [items]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? tree.filter((n) => n.category.name.toLowerCase().includes(q)) : tree;
  }, [tree, search]);

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: categoryKeys.all }),
    queryClient.invalidateQueries({ queryKey: lookupKeys.all }),
  ]);

  let body;
  if (query.isPending) {
    body = (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  } else if (query.isError) {
    body = <ErrorState error={query.error} onRetry={() => query.refetch()} size="compact" />;
  } else if (tree.length === 0) {
    body = (
      <EmptyState
        icon="book-open"
        size="compact"
        description="No course categories yet. Add one so courses and requests can be grouped."
        action={<Button icon="plus" onClick={() => onCreatingChange(true)}>Add Category</Button>}
      />
    );
  } else {
    body = (
      <ul aria-label="Course categories" className="m-0 list-none overflow-hidden rounded-lg border border-border p-0">
        {visible.length === 0 ? (
          <li className="px-4 py-6 text-center text-body-sm text-ink-muted">No categories match “{search}”.</li>
        ) : (
          visible.map(({ category: c, depth, childCount }) => (
            <li
              key={c.id}
              className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-surface-sunken"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: `calc(var(--spacing) * ${Math.min(depth, 6) * 5})` }}>
                {depth > 0 ? <span aria-hidden className="h-px w-3 flex-none bg-border-strong" /> : null}
                <span className={depth === 0 ? 'truncate font-medium text-ink' : 'truncate text-ink'}>{c.name}</span>
                {depth > 0 && c.parentId ? <span className="sr-only truncate text-body-sm text-ink-subtle sm:not-sr-only">in {names.get(c.parentId)}</span> : null}
                {childCount > 0 ? <Badge tone="neutral">{childCount} sub</Badge> : null}
              </div>
              <div className="flex flex-none gap-1">
                <IconButton icon="pencil" label={`Edit ${c.name}`} onClick={() => setEditing(c)} />
                <IconButton icon="trash-2" label={`Delete ${c.name}`} onClick={() => setDeleting(c)} />
              </div>
            </li>
          ))
        )}
      </ul>
    );
  }

  return (
    <Panel title="Course Categories" description="Group similar courses under a parent so Smart Allocation can suggest close alternatives." icon="book-open">
      <div className="flex flex-col gap-3">
        {tree.length > 0 ? (
          <SearchField id="category-search" placeholder="Search categories" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-80" />
        ) : null}
        {body}
      </div>
      <CategoryDialog
        open={creating || editing !== null}
        item={editing}
        categories={items}
        onClose={() => {
          setEditing(null);
          onCreatingChange(false);
        }}
        onSaved={async (name, isNew) => {
          await invalidate();
          toast.success(isNew ? 'Category added' : 'Category saved', { description: name });
        }}
      />
      <ActionConfirm
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete Category?"
        description={deleting ? `${deleting.name} will be removed. This cannot be undone.` : undefined}
        confirmLabel="Delete"
        tone="danger"
        formatError={(err) => deleteErrorMessage(err, 'category')}
        action={async () => {
          if (!deleting) return;
          await apiSend('DELETE', `/api/categories/${deleting.id}`);
          await invalidate();
          toast.success('Category deleted');
        }}
      />
    </Panel>
  );
}

function CategoryDialog({
  open, item, categories, onClose, onSaved,
}: {
  open: boolean;
  item: CategoryDto | null;
  categories: CategoryDto[];
  onClose: () => void;
  onSaved: (name: string, isNew: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={item ? 'Edit Category' : 'Add Category'}
      description="A parent groups similar categories, for example Coding under Technology."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="category-form" loading={busy}>
            {item ? 'Save Category' : 'Add Category'}
          </Button>
        </>
      }
    >
      {open ? <CategoryFields key={item?.id ?? 'new'} item={item} categories={categories} onClose={onClose} onSaved={onSaved} onBusyChange={setBusy} /> : null}
    </Dialog>
  );
}

function CategoryFields({
  item, categories, onClose, onSaved, onBusyChange,
}: {
  item: CategoryDto | null;
  categories: CategoryDto[];
  onClose: () => void;
  onSaved: (name: string, isNew: boolean) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const { control, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(CategoryInput),
    defaultValues: { name: item?.name ?? '', parentId: item?.parentId ?? undefined },
  });
  useReportSubmitting(formState.isSubmitting, onBusyChange);
  const blocked = item ? descendantsOf(item.id, categories) : new Set<string>();
  const options = flattenTree(categories)
    .filter((n) => !blocked.has(n.category.id))
    .map((n) => ({ value: n.category.id, label: `${'— '.repeat(n.depth)}${n.category.name}` }));

  const onSubmit = handleSubmit(async (v) => {
    const body = { name: v.name, parentId: v.parentId ?? null };
    try {
      if (item) await apiSend('PATCH', `/api/categories/${item.id}`, body);
      else await apiSend('POST', '/api/categories', body);
      await onSaved(v.name, !item);
      onClose();
    } catch (err) {
      applyServerErrors(setError, err);
    }
  });
  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;
  return (
    <form id="category-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {rootError ? <Alert tone="danger">{rootError}</Alert> : null}
      <FormInput control={control} name="name" label="Name" placeholder="Coding" required />
      <FormSelect control={control} name="parentId" label="Parent Category" placeholder="None (top level)" options={options} optional />
    </form>
  );
}
