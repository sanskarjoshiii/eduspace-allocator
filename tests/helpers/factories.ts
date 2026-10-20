import bcrypt from 'bcryptjs';
import { connectDb } from '@/lib/db';
import type { Role } from '@/lib/domain';
import { Area, CourseCategory, FacilityType, LearnerProfile, Partner, User } from '@/server/models';
import type { SessionUser } from '@/server/auth/session';

let counter = 0;
const next = () => ++counter;

/** Creates a user with the profile or partner record their role needs. Returns a SessionUser. */
export async function makeUser(role: Role, overrides: { name?: string; email?: string; areaId?: string } = {}): Promise<SessionUser> {
  await connectDb();
  const n = next();
  const email = overrides.email ?? `${role.toLowerCase()}${n}@test.local`;
  const name = overrides.name ?? `${role} ${n}`;
  const user = await User.create({ email, name, role, passwordHash: await bcrypt.hash('Password-123', 4) });
  let ownerRefId: string | null = null;
  if (role === 'Learner') {
    const p = await LearnerProfile.create({
      userId: user._id, name, ageBand: '18-24', contactPhone: '+91 98200 0000' + (n % 10), contactEmail: email,
      areaId: overrides.areaId ?? null, consentAt: new Date(),
    });
    ownerRefId = p._id.toString();
  } else if (role === 'SpaceGiver' || role === 'CourseProvider') {
    const p = await Partner.create({ userId: user._id, type: role === 'SpaceGiver' ? 'SpaceGiverOrg' : 'ProviderOrg', name: `${name} Org` });
    ownerRefId = p._id.toString();
  }
  user.ownerRefId = ownerRefId as never;
  await user.save();
  return { id: user._id.toString(), email, name, role, ownerRefId, status: 'Active' };
}

/** Kothrud-like default area unless overridden. */
export async function makeArea(overrides: Partial<{ name: string; lng: number; lat: number; incomeGroup: 'Low' | 'Medium' | 'High' }> = {}) {
  await connectDb();
  const n = next();
  return Area.create({
    name: overrides.name ?? `Area ${n}`,
    center: { type: 'Point', coordinates: [overrides.lng ?? 73.8077, overrides.lat ?? 18.5074] },
    population: 50_000 + n * 1000,
    studentCount: 8_000 + n * 100,
    literacyRate: 85,
    incomeScore: 55,
    incomeGroup: overrides.incomeGroup ?? 'Medium',
  });
}

export async function makeCategory(name?: string, parentId: string | null = null) {
  await connectDb();
  return CourseCategory.create({ name: name ?? `Category ${next()}`, parentId });
}

export async function makeFacilityType(name?: string) {
  await connectDb();
  return FacilityType.create({ name: name ?? `Facility ${next()}`, unit: 'units' });
}
