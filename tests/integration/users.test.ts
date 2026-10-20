import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectDb } from '@/lib/db';
import { resetEnvCache } from '@/lib/env';
import { AuditLog, Partner, User } from '@/server/models';
import { GET as listUsers, POST as createUser } from '@/app/api/users/route';
import { GET as getUser, PATCH as patchUser } from '@/app/api/users/[id]/route';
import { GET as getMe } from '@/app/api/me/route';
import { POST as signUpload } from '@/app/api/uploads/sign/route';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeUser } from '../helpers/factories';
import type { SessionUser } from '@/server/auth/session';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));

let admin: SessionUser;
let learner: SessionUser;
let provider: SessionUser;

type UserRes = { id: string; email: string; role: string; status: string; name: string };

beforeAll(async () => {
  await connectDb();
  await User.syncIndexes();
  admin = await makeUser('Administrator');
  learner = await makeUser('Learner', { name: 'Meera Joshi' });
  provider = await makeUser('CourseProvider');
});

describe('users (administrator)', () => {
  it('is administrator-only (401 / 403)', async () => {
    actAs(null);
    expect((await listUsers(req('GET', '/api/users'), ctx())).status).toBe(401);
    for (const u of [learner, provider]) {
      actAs(u);
      expect((await listUsers(req('GET', '/api/users'), ctx())).status).toBe(403);
      expect((await createUser(req('POST', '/api/users', {}), ctx())).status).toBe(403);
      expect((await patchUser(req('PATCH', '/x', { status: 'Suspended' }), ctx({ id: admin.id }))).status).toBe(403);
    }
  });

  it('lists with filters and never returns password hashes', async () => {
    actAs(admin);
    const res = await json<{ items: UserRes[]; total: number; pages: number }>(await listUsers(req('GET', '/api/users?role=Learner&q=meera'), ctx()));
    expect(res.status).toBe(200);
    expect(res.data.items.map((u) => u.id)).toEqual([learner.id]);
    const all = await listUsers(req('GET', '/api/users?pageSize=200'), ctx());
    const text = await all.text();
    expect(text).not.toMatch(/passwordHash|\$2[aby]\$/);
    const one = await getUser(req('GET', '/x'), ctx({ id: learner.id }));
    expect(await one.text()).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('creates an Administrator and a provider with a partner; duplicate email 409', async () => {
    actAs(admin);
    const created = await json<{ user: UserRes }>(
      await createUser(req('POST', '/api/users', { role: 'Administrator', name: 'Second Admin', email: 'admin2@test.local', password: 'Password-123' }), ctx()),
    );
    expect(created.status).toBe(201);
    expect(created.data.user.role).toBe('Administrator');
    expect(await AuditLog.countDocuments({ entity: 'User', action: 'create', entityId: created.data.user.id, actorId: admin.id })).toBe(1);

    const prov = await json<{ user: UserRes; partner: { id: string; type: string } }>(
      await createUser(
        req('POST', '/api/users', { role: 'CourseProvider', name: 'Tutor', email: 'tutor@test.local', password: 'Password-123', partnerType: 'IndividualTutor' }),
        ctx(),
      ),
    );
    expect(prov.data.partner.type).toBe('IndividualTutor');
    expect(await Partner.countDocuments({ userId: prov.data.user.id })).toBe(1);

    const dup = await createUser(req('POST', '/api/users', { role: 'Administrator', name: 'Dup', email: 'ADMIN2@test.local', password: 'Password-123' }), ctx());
    expect(dup.status).toBe(409);
  });

  it('suspends, reactivates and approves accounts; cannot suspend yourself', async () => {
    actAs(admin);
    const suspended = await json<UserRes>(await patchUser(req('PATCH', '/x', { status: 'Suspended' }), ctx({ id: learner.id })));
    expect(suspended.data.status).toBe('Suspended');
    expect(await AuditLog.countDocuments({ entity: 'User', action: 'suspend', entityId: learner.id })).toBe(1);
    // A suspended user is locked out.
    actAs(learner);
    expect((await getMe(req('GET', '/api/me'), ctx())).status).toBe(403);

    actAs(admin);
    expect((await json<UserRes>(await patchUser(req('PATCH', '/x', { status: 'Active' }), ctx({ id: learner.id })))).data.status).toBe('Active');

    await User.updateOne({ _id: provider.id }, { $set: { status: 'PendingApproval' } });
    expect((await json<UserRes>(await patchUser(req('PATCH', '/x', { status: 'Active' }), ctx({ id: provider.id })))).data.status).toBe('Active');
    expect(await AuditLog.countDocuments({ entity: 'User', action: 'approve', entityId: provider.id })).toBe(1);

    expect((await patchUser(req('PATCH', '/x', { status: 'Suspended' }), ctx({ id: admin.id }))).status).toBe(422);
    expect((await patchUser(req('PATCH', '/x', { status: 'PendingApproval' }), ctx({ id: learner.id }))).status).toBe(422);
    const renamed = await json<UserRes>(await patchUser(req('PATCH', '/x', { name: 'Meera J' }), ctx({ id: learner.id })));
    expect(renamed.data.name).toBe('Meera J');
  });
});

describe('POST /api/uploads/sign', () => {
  const saved = { ...process.env };
  afterAll(() => {
    for (const k of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetEnvCache();
  });

  it('401 signed out; 503 when Cloudinary is not configured', async () => {
    actAs(null);
    expect((await signUpload(req('POST', '/api/uploads/sign', { kind: 'space-photo' }), ctx())).status).toBe(401);
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    resetEnvCache();
    actAs(provider);
    const res = await json(await signUpload(req('POST', '/api/uploads/sign', { kind: 'space-photo' }), ctx()));
    expect(res.status).toBe(503);
    expect(res.error?.message).toMatch(/not configured/);
  });

  it('returns signed parameters without the secret; rejects unknown kinds', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
    process.env.CLOUDINARY_API_KEY = '123456789';
    process.env.CLOUDINARY_API_SECRET = 'super-secret-value';
    resetEnvCache();
    actAs(learner);
    const res = await signUpload(req('POST', '/api/uploads/sign', { kind: 'course-cover' }), ctx());
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain('super-secret-value');
    const { data } = JSON.parse(text) as { data: { cloudName: string; apiKey: string; timestamp: number; signature: string; folder: string } };
    expect(data.cloudName).toBe('demo-cloud');
    expect(data.apiKey).toBe('123456789');
    const expected = createHash('sha1').update(`folder=${data.folder}&timestamp=${data.timestamp}super-secret-value`).digest('hex');
    expect(data.signature).toBe(expected);
    expect((await signUpload(req('POST', '/api/uploads/sign', { kind: 'virus' }), ctx())).status).toBe(422);
  });
});
