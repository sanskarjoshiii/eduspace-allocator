import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));

import { Types } from 'mongoose';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeUser } from '../helpers/factories';
import { AuditLog } from '@/server/models';
import { audit } from '@/server/services/audit';
import { GET as auditGET } from '@/app/api/audit-logs/route';
import type { SessionUser } from '@/server/auth/session';
import type { AuditPage } from '@/server/services/audit-query';

let admin: SessionUser;
let sg: SessionUser;
let provider: SessionUser;
let learner: SessionUser;

beforeAll(async () => {
  admin = await makeUser('Administrator', { name: 'Root Admin' });
  sg = await makeUser('SpaceGiver', { name: 'Sita' });
  provider = await makeUser('CourseProvider', { name: 'Ravi' });
  learner = await makeUser('Learner');
  await audit({ actor: sg, action: 'create', entity: 'Space', entityId: new Types.ObjectId() });
  await audit({ actor: provider, action: 'create', entity: 'CourseOffering', entityId: new Types.ObjectId(), diff: { title: 'Python', passwordHash: 'x' } });
  // An admin override on the Space Giver's allocation: their own activity via ownerUserId.
  await audit({ actor: admin, action: 'override', entity: 'Allocation', ownerUserId: sg.id });
  // A system action with no owner.
  await audit({ actor: null, action: 'engine', entity: 'AllocationRun' });
  await AuditLog.collection.updateOne({ entity: 'AllocationRun' }, { $set: { createdAt: new Date('2026-01-01T00:00:00Z') } });
});

describe('GET /api/audit-logs', () => {
  it('shows the Administrator everything, newest first, with actor names and roles', async () => {
    actAs(admin);
    const res = await json<AuditPage>(await auditGET(req('GET', '/api/audit-logs'), ctx()));
    expect(res.status).toBe(200);
    expect(res.data.total).toBe(4);
    expect(res.data.items.at(-1)!.actor).toEqual({ id: null, name: 'System', role: 'System' });
    const offering = res.data.items.find((i) => i.entity === 'CourseOffering')!;
    expect(offering.actor).toMatchObject({ name: 'Ravi', role: 'CourseProvider' });
    expect(offering.diff).toEqual({ title: 'Python', passwordHash: '[redacted]' });
  });

  it('filters by entity, action, actor and date range, and pages', async () => {
    actAs(admin);
    const byEntity = await json<AuditPage>(await auditGET(req('GET', '/api/audit-logs?entity=Space'), ctx()));
    expect(byEntity.data.total).toBe(1);
    const byAction = await json<AuditPage>(await auditGET(req('GET', '/api/audit-logs?action=override'), ctx()));
    expect(byAction.data.items[0]!.entity).toBe('Allocation');
    const byActor = await json<AuditPage>(await auditGET(req('GET', `/api/audit-logs?actorId=${provider.id}`), ctx()));
    expect(byActor.data.total).toBe(1);
    const range = await json<AuditPage>(await auditGET(req('GET', '/api/audit-logs?from=2025-12-01&to=2026-02-01'), ctx()));
    expect(range.data.items.map((i) => i.entity)).toEqual(['AllocationRun']);
    const paged = await json<AuditPage>(await auditGET(req('GET', '/api/audit-logs?page=2&pageSize=3'), ctx()));
    expect(paged.data).toMatchObject({ page: 2, pages: 2 });
    expect(paged.data.items).toHaveLength(1);
    expect((await auditGET(req('GET', '/api/audit-logs?from=2026-03-01&to=2026-01-01'), ctx())).status).toBe(422);
  });

  it('shows Space Givers and Course Providers only their own activity', async () => {
    actAs(sg);
    const mine = await json<AuditPage>(await auditGET(req('GET', '/api/audit-logs?facets=1'), ctx()));
    expect(mine.data.items.map((i) => i.entity).sort()).toEqual(['Allocation', 'Space']);
    expect((mine.data as AuditPage & { facets: { entities: string[] } }).facets.entities).toEqual(['Allocation', 'Space']);
    actAs(provider);
    const prov = await json<AuditPage>(await auditGET(req('GET', '/api/audit-logs'), ctx()));
    expect(prov.data.items.map((i) => i.entity)).toEqual(['CourseOffering']);
  });

  it('returns 403 when a non-admin asks for someone else\'s activity, and for learners', async () => {
    actAs(sg);
    expect((await auditGET(req('GET', `/api/audit-logs?actorId=${provider.id}`), ctx())).status).toBe(403);
    expect((await auditGET(req('GET', `/api/audit-logs?actorId=${sg.id}`), ctx())).status).toBe(200);
    actAs(learner);
    expect((await auditGET(req('GET', '/api/audit-logs'), ctx())).status).toBe(403);
    actAs(null);
    expect((await auditGET(req('GET', '/api/audit-logs'), ctx())).status).toBe(401);
  });
});
