import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));

import { actAs, ctx, json, req } from '../helpers/auth';
import { makeUser } from '../helpers/factories';
import { AuditLog } from '@/server/models';
import { DEFAULT_SETTINGS, activeWeights, getSettings } from '@/server/services/settings';
import { GET as settingsGET, PATCH as settingsPATCH } from '@/app/api/settings/route';
import type { SessionUser } from '@/server/auth/session';
import type { SettingsView } from '@/app/api/settings/settings-admin';

let admin: SessionUser;
let others: SessionUser[];
const patch = (body: unknown) => settingsPATCH(req('PATCH', '/api/settings', body), ctx());

beforeAll(async () => {
  admin = await makeUser('Administrator');
  others = [await makeUser('Learner'), await makeUser('SpaceGiver'), await makeUser('CourseProvider')];
});

describe('GET /api/settings', () => {
  it('returns values, defaults, descriptions and presets to the Administrator', async () => {
    actAs(admin);
    const res = await json<SettingsView>(await settingsGET(req('GET', '/api/settings'), ctx()));
    expect(res.status).toBe(200);
    expect(res.data.values).toEqual(DEFAULT_SETTINGS);
    expect(res.data.descriptions.alertMinAreas).toContain('(N)');
    expect(res.data.presets.map((p) => p.label)).toEqual(['Balanced', 'Accessibility first', 'Maximum reach', 'Cost efficient']);
    expect(Object.values(res.data.activeWeights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('is Administrator only', async () => {
    for (const u of others) {
      actAs(u);
      expect((await settingsGET(req('GET', '/api/settings'), ctx())).status).toBe(403);
      expect((await patch({ maxRadiusKm: 5 })).status).toBe(403);
    }
    actAs(null);
    expect((await settingsGET(req('GET', '/api/settings'), ctx())).status).toBe(401);
  });
});

describe('PATCH /api/settings', () => {
  const balanced = DEFAULT_SETTINGS.strategies.balanced;

  it('rejects invalid weights', async () => {
    actAs(admin);
    expect((await patch({ strategies: { balanced: { ...balanced, distance: -0.1 } } })).status).toBe(422);
    const zero = { distance: 0, time: 0, facility: 0, capacity: 0, cost: 0, demand: 0, utilisation: 0 };
    expect((await patch({ strategies: { balanced: zero }, normalise: true })).status).toBe(422);
    const res = await json(await patch({ strategies: { balanced: { ...balanced, distance: 0.5 } } }));
    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('validation_failed');
    expect((await patch({ strategies: { balanced: { distance: 1 } } })).status).toBe(422); // incomplete set
    expect(await AuditLog.countDocuments({ entity: 'SystemSetting' })).toBe(0);
  });

  it('rejects kMin above kMax, including against the stored value', async () => {
    actAs(admin);
    expect((await patch({ kMin: 5, kMax: 3 })).status).toBe(422);
    expect((await patch({ kMin: 7 })).status).toBe(422); // stored kMax is 6
    expect((await patch({ maxRadiusKm: 0 })).status).toBe(422);
    expect((await patch({ strategy: 'fastest' })).status).toBe(422);
  });

  it('normalises a weight set on request', async () => {
    actAs(admin);
    const res = await json<{ changed: string[]; settings: SettingsView }>(
      await patch({ strategies: { reach: { distance: 1, time: 1, facility: 1, capacity: 1, cost: 0, demand: 1, utilisation: 0 } }, normalise: true }),
    );
    expect(res.status).toBe(200);
    expect(res.data.changed).toEqual(['strategies']);
    const reach = (await getSettings()).strategies.reach;
    expect(reach.distance).toBeCloseTo(0.2, 6);
    expect(Object.values(reach).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    // Untouched strategies are kept.
    expect((await getSettings()).strategies.balanced).toEqual(balanced);
  });

  it('a weight change takes effect for the next run without a redeploy, and is audited with the diff', async () => {
    actAs(admin);
    const next = { distance: 0.5, time: 0.1, facility: 0.1, capacity: 0.1, cost: 0.1, demand: 0.05, utilisation: 0.05 };
    const res = await json<{ changed: string[] }>(await patch({ strategy: 'cost', strategies: { cost: next }, alertMinAreas: 4 }));
    expect(res.status).toBe(200);
    expect(res.data.changed.sort()).toEqual(['alertMinAreas', 'strategies', 'strategy']);
    const s = await getSettings();
    expect(s.strategy).toBe('cost');
    expect((await activeWeights(s)).distance).toBeCloseTo(0.5, 6);
    expect(s.alertMinAreas).toBe(4);

    const entry = await AuditLog.findOne({ entity: 'SystemSetting' }).sort({ createdAt: -1 }).lean();
    const diff = entry!.diff as Record<string, { from: unknown; to: unknown }>;
    expect(diff.strategy).toEqual({ from: 'balanced', to: 'cost' });
    expect(diff.alertMinAreas).toEqual({ from: 3, to: 4 });
    expect(entry!.actorId!.toString()).toBe(admin.id);
  });

  it('does not audit a no-op change', async () => {
    actAs(admin);
    const before = await AuditLog.countDocuments({ entity: 'SystemSetting' });
    const res = await json<{ changed: string[] }>(await patch({ alertMinAreas: 4 }));
    expect(res.data.changed).toEqual([]);
    expect(await AuditLog.countDocuments({ entity: 'SystemSetting' })).toBe(before);
  });
});
