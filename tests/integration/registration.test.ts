import { beforeAll, describe, expect, it, vi } from 'vitest';
import { connectDb } from '@/lib/db';
import { AuditLog, LearnerProfile, Notification, Partner, User } from '@/server/models';
import { updateSettings } from '@/server/services/settings';
import { MENUS } from '@/server/auth/menu';
import { POST as register } from '@/app/api/auth/register/route';
import { GET as getMe, PATCH as patchMe } from '@/app/api/me/route';
import { GET as getMenu } from '@/app/api/me/menu/route';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeArea, makeUser } from '../helpers/factories';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));

const learnerBody = (email: string, extra: Record<string, unknown> = {}) => ({
  role: 'Learner',
  name: 'Asha Patil',
  email,
  password: 'Password-123',
  ageBand: '18-24',
  consent: true,
  contactPhone: '+91 98200 11111',
  ...extra,
});

describe('POST /api/auth/register', () => {
  let adminId: string;
  beforeAll(async () => {
    await connectDb();
    await User.syncIndexes();
    adminId = (await makeUser('Administrator')).id;
  });

  it('registers a learner with profile, consent, audit and an admin notification; never returns the hash', async () => {
    actAs(null);
    const area = await makeArea({ name: 'Reg Area' });
    const res = await register(req('POST', '/api/auth/register', learnerBody('Asha@Example.com', { areaId: String(area._id) })), ctx());
    const body = await json<{ user: { id: string; email: string; status: string; role: string; ownerRefId: string }; profile: { id: string; consentAt: string; areaId: string; contactEmail: string } }>(res);
    expect(body.status).toBe(201);
    expect(JSON.stringify(body.data)).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect(body.data.user.email).toBe('asha@example.com');
    expect(body.data.user.status).toBe('Active');
    expect(body.data.user.ownerRefId).toBe(body.data.profile.id);
    expect(body.data.profile.consentAt).toBeTruthy();
    expect(body.data.profile.areaId).toBe(String(area._id));
    expect(body.data.profile.contactEmail).toBe('asha@example.com');

    const stored = await User.findById(body.data.user.id).select('+passwordHash').lean();
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(await LearnerProfile.countDocuments({ userId: body.data.user.id })).toBe(1);
    expect(await AuditLog.countDocuments({ entity: 'User', action: 'create', entityId: body.data.user.id })).toBe(1);
    const note = await Notification.findOne({ userId: adminId, type: 'account.created' }).lean();
    expect(note?.message).toContain('Asha Patil');
  });

  it('rejects a learner without consent (422)', async () => {
    const res = await register(req('POST', '/api/auth/register', learnerBody('noconsent@test.local', { consent: false })), ctx());
    const body = await json(res);
    expect(body.status).toBe(422);
    expect(await User.countDocuments({ email: 'noconsent@test.local' })).toBe(0);
  });

  it('rejects self-registration as Administrator (422)', async () => {
    const res = await register(
      req('POST', '/api/auth/register', { role: 'Administrator', name: 'Evil', email: 'evil@test.local', password: 'Password-123' }),
      ctx(),
    );
    expect(res.status).toBe(422);
    expect(await User.countDocuments({ email: 'evil@test.local' })).toBe(0);
  });

  it('returns 409 for a duplicate email', async () => {
    await register(req('POST', '/api/auth/register', learnerBody('dupe@test.local')), ctx());
    const res = await register(req('POST', '/api/auth/register', learnerBody('DUPE@test.local')), ctx());
    expect(res.status).toBe(409);
  });

  it('creates a Partner for a space giver; Active by default, PendingApproval when approval is required', async () => {
    const body = {
      role: 'SpaceGiver',
      name: 'Ravi Kulkarni',
      email: 'sg1@test.local',
      password: 'Password-123',
      partnerType: 'SpaceGiverOrg',
      organisationName: 'Kothrud Community Hall',
    };
    const first = await json<{ user: { status: string; ownerRefId: string }; partner: { id: string; name: string; type: string } }>(
      await register(req('POST', '/api/auth/register', body), ctx()),
    );
    expect(first.status).toBe(201);
    expect(first.data.user.status).toBe('Active');
    expect(first.data.partner.name).toBe('Kothrud Community Hall');
    expect(first.data.user.ownerRefId).toBe(first.data.partner.id);
    expect(await Partner.countDocuments({ _id: first.data.partner.id })).toBe(1);

    await updateSettings({ requirePartnerApproval: true }, null);
    const second = await json<{ user: { status: string } }>(
      await register(req('POST', '/api/auth/register', { ...body, email: 'cp1@test.local', role: 'CourseProvider', partnerType: 'IndividualTutor', organisationName: undefined }), ctx()),
    );
    expect(second.data.user.status).toBe('PendingApproval');
    const learner = await json<{ user: { status: string } }>(await register(req('POST', '/api/auth/register', learnerBody('l2@test.local')), ctx()));
    expect(learner.data.user.status).toBe('Active');
    const note = await Notification.findOne({ userId: adminId, type: 'account.created', message: /waiting for your approval/ }).lean();
    expect(note).toBeTruthy();
    await updateSettings({ requirePartnerApproval: false }, null);
  });

  it('rejects a space giver registering as an individual tutor', async () => {
    const res = await register(
      req('POST', '/api/auth/register', { role: 'SpaceGiver', name: 'Solo', email: 'solo@test.local', password: 'Password-123', partnerType: 'IndividualTutor' }),
      ctx(),
    );
    expect(res.status).toBe(422);
  });
});

describe('/api/me', () => {
  it('requires sign-in (401)', async () => {
    actAs(null);
    expect((await getMe(req('GET', '/api/me'), ctx())).status).toBe(401);
    expect((await getMenu(req('GET', '/api/me/menu'), ctx())).status).toBe(401);
  });

  it('returns the user and profile, and updates them', async () => {
    const learner = await makeUser('Learner');
    actAs(learner);
    const me = await json<{ user: { id: string; role: string }; profile: { ageBand: string } }>(await getMe(req('GET', '/api/me'), ctx()));
    expect(me.status).toBe(200);
    expect(me.data.user.id).toBe(learner.id);
    expect(me.data.profile.ageBand).toBe('18-24');
    expect(JSON.stringify(me.data)).not.toContain('passwordHash');

    const area = await makeArea();
    const res = await json<{ user: { name: string; emailNotifications: boolean }; profile: { contactPhone: string; areaId: string; accessibilityNeeds: string[] } }>(
      await patchMe(
        req('PATCH', '/api/me', { name: 'New Name', emailNotifications: true, contactPhone: '123', areaId: String(area._id), accessibilityNeeds: ['Wheelchair access'] }),
        ctx(),
      ),
    );
    expect(res.status).toBe(200);
    expect(res.data.user.name).toBe('New Name');
    expect(res.data.user.emailNotifications).toBe(true);
    expect(res.data.profile.contactPhone).toBe('123');
    expect(res.data.profile.areaId).toBe(String(area._id));
    expect(res.data.profile.accessibilityNeeds).toEqual(['Wheelchair access']);
    expect(await AuditLog.countDocuments({ entity: 'User', action: 'update', entityId: learner.id })).toBe(1);
  });

  it('returns the partner for a provider and the role menu', async () => {
    const provider = await makeUser('CourseProvider');
    actAs(provider);
    const me = await json<{ partner: { type: string } }>(await getMe(req('GET', '/api/me'), ctx()));
    expect(me.data.partner.type).toBe('ProviderOrg');
    const menu = await json<{ items: unknown[] }>(await getMenu(req('GET', '/api/me/menu'), ctx()));
    expect(menu.data.items).toEqual(MENUS.CourseProvider);
    // A provider has no learner fields.
    expect((await patchMe(req('PATCH', '/api/me', { accessibilityNeeds: ['x'] }), ctx())).status).toBe(422);
  });
});
