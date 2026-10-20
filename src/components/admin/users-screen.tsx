'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Button, DataTable, EmptyState, PageHeader, Panel, PanelGrid, Select, StatusBadge, UserChip, useToast, type DataTableColumn,
} from '@/components/ui';
import { useMe } from '@/hooks/use-me';
import { apiGet, apiSend, type Paged } from '@/lib/api';
import { ROLE_LABEL, ROLES, USER_STATUSES, type Role, type UserStatus } from '@/lib/domain';
import { formatDate, formatDateTime } from '@/lib/format';
import type { UserDto } from '@/server/dto/user';
import { ActionConfirm } from './action-confirm';
import { AddUserDialog } from './add-user-dialog';

export const userKeys = { all: ['users'] as const };

const PAGE_SIZE = 20;

type UserAction = 'approve' | 'suspend' | 'activate';

const ACTION_COPY: Record<UserAction, { title: string; confirm: string; tone: 'primary' | 'danger'; done: string; status: 'Active' | 'Suspended' }> = {
  approve: { title: 'Approve Account?', confirm: 'Approve', tone: 'primary', done: 'Account approved', status: 'Active' },
  suspend: { title: 'Suspend Account?', confirm: 'Suspend', tone: 'danger', done: 'Account suspended', status: 'Suspended' },
  activate: { title: 'Activate Account?', confirm: 'Activate', tone: 'primary', done: 'Account activated', status: 'Active' },
};

function describe(action: UserAction, u: UserDto): string {
  if (action === 'approve') return `${u.name} can sign in and start using EduSpace as a ${ROLE_LABEL[u.role]}.`;
  if (action === 'suspend') return `${u.name} will be signed out of every action until you activate the account again.`;
  return `${u.name} can sign in again.`;
}

export function UsersScreen() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useMe();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<{ action: UserAction; user: UserDto } | null>(null);

  const query = useQuery({
    queryKey: [...userKeys.all, { page, q, role, status }],
    queryFn: () => apiGet<Paged<UserDto>>('/api/users', { page, pageSize: PAGE_SIZE, q, role, status }),
    placeholderData: keepPreviousData,
  });

  const columns: DataTableColumn<UserDto>[] = [
    {
      key: 'name',
      header: 'User',
      cell: (u) => <UserChip name={u.name} meta={u.email} />,
    },
    { key: 'role', header: 'Role', hideBelow: 'sm', cell: (u) => ROLE_LABEL[u.role] },
    { key: 'status', header: 'Status', cell: (u) => <StatusBadge status={u.status} /> },
    {
      key: 'lastLoginAt',
      header: 'Last Sign-In',
      hideBelow: 'lg',
      cell: (u) => <span className="font-mono text-data">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</span>,
    },
    { key: 'createdAt', header: 'Joined', hideBelow: 'md', cell: (u) => <span className="font-mono text-data">{formatDate(u.createdAt)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      cell: (u) => {
        const self = me.data?.id === u.id;
        if (u.status === 'PendingApproval') {
          return (
            <Button size="sm" icon="check" onClick={() => setPending({ action: 'approve', user: u })}>
              Approve
            </Button>
          );
        }
        if (u.status === 'Suspended') {
          return (
            <Button size="sm" onClick={() => setPending({ action: 'activate', user: u })}>
              Activate
            </Button>
          );
        }
        return (
          <Button size="sm" variant="danger" onClick={() => setPending({ action: 'suspend', user: u })} title={self ? 'You cannot suspend your own account' : undefined}>
            Suspend
          </Button>
        );
      },
    },
  ];

  const toolbar = (
    <div className="flex flex-wrap gap-2">
      <Select
        size="sm"
        aria-label="Filter by role"
        value={role}
        onChange={(e) => {
          setRole(e.target.value as Role | '');
          setPage(1);
        }}
        options={[{ value: '', label: 'All roles' }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))]}
      />
      <Select
        size="sm"
        aria-label="Filter by status"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value as UserStatus | '');
          setPage(1);
        }}
        options={[
          { value: '', label: 'All statuses' },
          ...USER_STATUSES.map((s) => ({ value: s, label: s === 'PendingApproval' ? 'Pending approval' : s })),
        ]}
      />
    </div>
  );

  const filtered = Boolean(q || role || status);
  const copy = pending ? ACTION_COPY[pending.action] : null;

  return (
    <>
      <PageHeader
        title="Users"
        description="Every account on EduSpace. Approve new partners, suspend or reactivate access and add accounts."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add User
          </Button>
        }
      />
      <PanelGrid columns={1}>
        <Panel title="All Users" description="Search by name or email and filter by role or status." icon="users">
          <DataTable
            caption="Users"
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(u) => u.id}
            searchable
            searchPlaceholder="Search name or email"
            toolbar={toolbar}
            itemLabel="users"
            loading={query.isPending}
            error={query.error}
            onRetry={() => query.refetch()}
            empty={
              filtered ? (
                <EmptyState
                  icon="search"
                  size="compact"
                  description="No users match these filters."
                  action={
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setRole('');
                        setStatus('');
                        setPage(1);
                      }}
                    >
                      Clear Filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState icon="users" size="compact" description="No users yet. Add the first account." action={<Button icon="plus" onClick={() => setAdding(true)}>Add User</Button>} />
              )
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
      </PanelGrid>

      <AddUserDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={async (name) => {
          await queryClient.invalidateQueries({ queryKey: userKeys.all });
          toast.success('User added', { description: name });
        }}
      />
      <ActionConfirm
        open={pending !== null}
        onClose={() => setPending(null)}
        title={copy?.title ?? ''}
        description={pending ? describe(pending.action, pending.user) : undefined}
        confirmLabel={copy?.confirm ?? 'Confirm'}
        tone={copy?.tone ?? 'primary'}
        action={async () => {
          if (!pending || !copy) return;
          await apiSend('PATCH', `/api/users/${pending.user.id}`, { status: copy.status });
          await queryClient.invalidateQueries({ queryKey: userKeys.all });
          toast.success(copy.done, { description: pending.user.name });
        }}
      />
    </>
  );
}
