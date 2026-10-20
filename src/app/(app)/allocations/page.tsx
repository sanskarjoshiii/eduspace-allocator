import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ALLOCATION_STATUSES } from '@/lib/domain';
import { AllocationsList, type AllocationFilters } from '@/components/allocations/allocations-list';

export const metadata: Metadata = { title: 'Allocations' };

const ID = /^[a-f0-9]{24}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Role-scoped allocation list: Allocation Results (admin), Allocations (space giver), Assigned Spaces (provider). */
export default async function AllocationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  const role = session?.user?.role;
  if (!role) redirect('/login');
  const sp = await searchParams;
  const pick = (k: string) => {
    const v = first(sp[k]);
    return v && ID.test(v) ? v : undefined;
  };
  const filters: AllocationFilters = {
    status: (ALLOCATION_STATUSES as readonly string[]).includes(first(sp.status) ?? '') ? first(sp.status) : undefined,
    runId: pick('runId'),
    offeringId: pick('offeringId'),
    spaceId: pick('spaceId'),
  };
  return <AllocationsList key={JSON.stringify(filters)} role={role} initialFilters={filters} />;
}
