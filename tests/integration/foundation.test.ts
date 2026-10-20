import { describe, expect, it } from 'vitest';
import { connectDb, supportsTransactions, withTransaction } from '@/lib/db';
import { Area, User } from '@/server/models';
import { makeArea, makeUser } from '../helpers/factories';
import { getSettings, updateSettings, DEFAULT_SETTINGS } from '@/server/services/settings';

describe('foundation', () => {
  it('connects to a replica set that supports transactions', async () => {
    await connectDb();
    expect(await supportsTransactions()).toBe(true);
  });

  it('rejects an invalid role and enforces unique email', async () => {
    await connectDb();
    await expect(User.create({ email: 'x@test.local', name: 'X', role: 'Hacker', passwordHash: 'h' })).rejects.toThrow();
    await makeUser('Learner', { email: 'dup@test.local' });
    await User.syncIndexes();
    await expect(makeUser('Learner', { email: 'dup@test.local' })).rejects.toThrow();
  });

  it('finds the nearest area with a 2dsphere query', async () => {
    await makeArea({ name: 'Kothrud', lng: 73.8077, lat: 18.5074 });
    await makeArea({ name: 'Viman Nagar', lng: 73.9143, lat: 18.5679 });
    await Area.syncIndexes();
    const nearest = await Area.findOne({
      center: { $near: { $geometry: { type: 'Point', coordinates: [73.81, 18.505] } } },
    }).lean();
    expect(nearest?.name).toBe('Kothrud');
  });

  it('rolls back a failed transaction', async () => {
    await expect(
      withTransaction(async (session) => {
        await Area.create([{ name: 'Rollback', center: { type: 'Point', coordinates: [73.8, 18.5] }, population: 1, studentCount: 1, literacyRate: 1, incomeScore: 1, incomeGroup: 'Low' }], { session: session ?? undefined });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await Area.countDocuments({ name: 'Rollback' })).toBe(0);
  });

  it('settings fall back to defaults and changes take effect', async () => {
    await connectDb();
    expect((await getSettings()).maxRadiusKm).toBe(DEFAULT_SETTINGS.maxRadiusKm);
    await updateSettings({ maxRadiusKm: 7 }, null);
    expect((await getSettings()).maxRadiusKm).toBe(7);
  });
});
