import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));
const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_msg: { to: string; subject: string; text: string }): Promise<boolean> => {
    throw new Error('smtp down');
  }),
}));
vi.mock('@/server/notifications/email', () => ({ sendEmail }));

import { Types } from 'mongoose';
import { actAs, ctx, json, req } from '../helpers/auth';
import { makeUser } from '../helpers/factories';
import { AuditLog, Notification, User } from '@/server/models';
import { notify } from '@/server/notifications/notify';
import { updateSettings } from '@/server/services/settings';
import { GET as listGET } from '@/app/api/notifications/route';
import { GET as countGET } from '@/app/api/notifications/unread-count/route';
import { POST as readPOST } from '@/app/api/notifications/[id]/read/route';
import { POST as readAllPOST } from '@/app/api/notifications/read-all/route';
import { GET as tplGET, PATCH as tplPATCH } from '@/app/api/notification-templates/route';
import type { SessionUser } from '@/server/auth/session';
import type { NotificationDto, TemplateDto } from '@/server/dto/notification';

let learner: SessionUser;
let other: SessionUser;
let admin: SessionUser;
let provider: SessionUser;

beforeAll(async () => {
  learner = await makeUser('Learner');
  other = await makeUser('Learner');
  admin = await makeUser('Administrator');
  provider = await makeUser('CourseProvider');
});

describe('notification inbox', () => {
  it('lists own notifications newest first, filters unread, and counts unread', async () => {
    await notify({ type: 'request.received', userIds: [learner.id], vars: { categoryName: 'Python' } });
    await new Promise((r) => setTimeout(r, 5));
    await notify({ type: 'request.received', userIds: [learner.id], vars: { categoryName: 'Spoken English' }, href: '/requests' });
    await notify({ type: 'request.received', userIds: [other.id], vars: { categoryName: 'Art' } });

    actAs(learner);
    const res = await json<{ items: NotificationDto[]; total: number; unread: number }>(await listGET(req('GET', '/api/notifications'), ctx()));
    expect(res.status).toBe(200);
    expect(res.data.total).toBe(2);
    expect(res.data.items[0]!.message).toContain('Spoken English');
    expect(res.data.items[0]!.href).toBe('/requests');
    expect(res.data.items.every((n) => !n.message.includes('Art'))).toBe(true);
    expect(Object.keys(res.data.items[0]!).sort()).toEqual(['createdAt', 'href', 'id', 'isRead', 'message', 'relatedId', 'relatedType', 'title', 'type']);

    const count = await json<{ count: number }>(await countGET(req('GET', '/api/notifications/unread-count'), ctx()));
    expect(count.data.count).toBe(2);
  });

  it('marks one read, rejects someone else\'s, then marks all read', async () => {
    actAs(learner);
    const list = await json<{ items: NotificationDto[] }>(await listGET(req('GET', '/api/notifications?unread=1'), ctx()));
    const first = list.data.items[0]!;
    const read = await json<NotificationDto>(await readPOST(req('POST', `/api/notifications/${first.id}/read`), ctx({ id: first.id })));
    expect(read.status).toBe(200);
    expect(read.data.isRead).toBe(true);

    const othersNote = await Notification.findOne({ userId: new Types.ObjectId(other.id) }).lean();
    const forbidden = await readPOST(req('POST', '/x'), ctx({ id: othersNote!._id.toString() }));
    expect(forbidden.status).toBe(404);
    expect((await Notification.findById(othersNote!._id).lean())!.isRead).toBe(false);

    const unreadOnly = await json<{ items: NotificationDto[] }>(await listGET(req('GET', '/api/notifications?unread=1'), ctx()));
    expect(unreadOnly.data.items).toHaveLength(1);

    const all = await json<{ updated: number }>(await readAllPOST(req('POST', '/api/notifications/read-all'), ctx()));
    expect(all.data.updated).toBe(1);
    expect((await json<{ count: number }>(await countGET(req('GET', '/x'), ctx()))).data.count).toBe(0);
  });

  it('administrators see the system alerts addressed to them', async () => {
    await notify({ type: 'run.failed', userIds: [admin.id], vars: { runRef: '#12', error: 'timeout', retryNote: 'Retry scheduled.' } });
    actAs(admin);
    const res = await json<{ items: NotificationDto[] }>(await listGET(req('GET', '/api/notifications'), ctx()));
    expect(res.data.items.map((n) => n.title)).toContain('Allocation run failed');
  });

  it('requires sign-in', async () => {
    actAs(null);
    expect((await listGET(req('GET', '/api/notifications'), ctx())).status).toBe(401);
    expect((await countGET(req('GET', '/x'), ctx())).status).toBe(401);
  });
});

describe('notification templates', () => {
  it('is Administrator only', async () => {
    for (const u of [learner, provider]) {
      actAs(u);
      expect((await tplGET(req('GET', '/api/notification-templates'), ctx())).status).toBe(403);
      expect((await tplPATCH(req('PATCH', '/x', { type: 'offer.sent', role: 'Learner', titleTemplate: 'x', bodyTemplate: 'y' }), ctx())).status).toBe(403);
    }
  });

  it('lists defaults with placeholders', async () => {
    actAs(admin);
    const res = await json<{ items: TemplateDto[] }>(await tplGET(req('GET', '/api/notification-templates'), ctx()));
    const offer = res.data.items.find((t) => t.type === 'offer.sent' && t.role === 'Learner')!;
    expect(offer.customised).toBe(false);
    expect(offer.placeholders).toEqual(['courseTitle', 'spaceName', 'distance', 'session', 'expiresAt']);
  });

  it('editing a template changes new messages without a redeploy, and is audited', async () => {
    actAs(admin);
    const res = await json<TemplateDto>(
      await tplPATCH(
        req('PATCH', '/api/notification-templates', {
          type: 'request.received', role: 'Learner', titleTemplate: 'Got it, {{recipientName}}', bodyTemplate: 'We are matching your {{categoryName}} request now.',
        }),
        ctx(),
      ),
    );
    expect(res.status).toBe(200);
    expect(res.data.customised).toBe(true);
    expect(res.data.defaultTemplate?.titleTemplate).toBe('Request received');

    await notify({ type: 'request.received', userIds: [learner.id], vars: { categoryName: 'Guitar' } });
    const latest = await Notification.findOne({ userId: new Types.ObjectId(learner.id) }).sort({ createdAt: -1 }).lean();
    expect(latest!.title).toBe(`Got it, ${learner.name}`);
    expect(latest!.message).toBe('We are matching your Guitar request now.');
    expect(await AuditLog.countDocuments({ entity: 'NotificationTemplate', actorId: new Types.ObjectId(admin.id) })).toBe(1);
  });

  it('rejects an invalid template body with 422', async () => {
    actAs(admin);
    const res = await tplPATCH(req('PATCH', '/x', { type: 'not.a.type', role: 'Learner', titleTemplate: '', bodyTemplate: 'x' }), ctx());
    expect(res.status).toBe(422);
  });
});

describe('email channel', () => {
  it('a failing email never blocks the in-app notification', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'EduSpace <noreply@test.local>';
    await updateSettings({ emailEnabled: true }, null);
    await User.updateOne({ _id: learner.id }, { $set: { emailNotifications: true } });
    sendEmail.mockClear();

    const n = await notify({ type: 'offer.sent', userIds: [learner.id], vars: { courseTitle: 'Python Basics', spaceName: 'Sunrise Plaza', distance: '1.2 km', session: 'Mon 18:00–20:00', expiresAt: 'Fri 18:00' } });
    expect(n).toBe(1);
    expect(await Notification.countDocuments({ userId: new Types.ObjectId(learner.id), type: 'offer.sent' })).toBe(1);
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
  });

  it('sends no email when the feature flag is off', async () => {
    await updateSettings({ emailEnabled: false }, null);
    sendEmail.mockClear();
    await notify({ type: 'offer.expiring', userIds: [learner.id], vars: { courseTitle: 'Python Basics', expiresAt: 'Fri 18:00' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await Notification.countDocuments({ userId: new Types.ObjectId(learner.id), type: 'offer.expiring' })).toBe(1);
  });
});
