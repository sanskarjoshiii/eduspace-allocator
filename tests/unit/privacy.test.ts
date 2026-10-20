import { describe, expect, it } from 'vitest';
import { learnerViewFor, stageFromEnrollment, visibleLearnerPoint, type LearnerSource, type Viewer } from '@/server/dto/privacy';

const src: LearnerSource = {
  requestId: 'r1',
  learnerUserId: 'learner1',
  name: 'Asha Patil',
  ageBand: '18-24',
  contactPhone: '+91 98200 11111',
  contactEmail: 'asha@test.local',
  accessibilityNeeds: ['Wheelchair access'],
  areaId: 'a1',
  areaName: 'Kothrud',
  areaCenter: [73.8077, 18.5074],
  location: [73.81234, 18.50987],
  categoryName: 'Guitar',
  windows: [{ dayOfWeek: 6, startTime: '10:00', endTime: '12:00' }],
  startMonth: '2026-12',
  durationMonths: 3,
  status: 'Matched',
};

const self: Viewer = { id: 'learner1', role: 'Learner' };
const otherLearner: Viewer = { id: 'learner2', role: 'Learner' };
const admin: Viewer = { id: 'admin1', role: 'Administrator' };
const provider: Viewer = { id: 'prov1', role: 'CourseProvider' };
const giver: Viewer = { id: 'giver1', role: 'SpaceGiver' };

const leaksExact = (v: unknown) => JSON.stringify(v).includes('73.81234') || JSON.stringify(v).includes('18.50987');

describe('stageFromEnrollment', () => {
  it('maps enrollment statuses to disclosure stages', () => {
    expect(stageFromEnrollment('Accepted')).toBe('accepted');
    for (const s of ['Proposed', 'Offered', 'Waitlisted']) expect(stageFromEnrollment(s)).toBe('proposed');
    for (const s of ['Declined', 'Expired', 'Cancelled', null, undefined, 'Nonsense']) expect(stageFromEnrollment(s)).toBe('beforeMatching');
  });
});

describe('learnerViewFor', () => {
  it('gives the learner and administrators the full record, including the exact point', () => {
    for (const viewer of [self, admin]) {
      for (const stage of ['beforeMatching', 'proposed', 'accepted'] as const) {
        const v = learnerViewFor(viewer, src, stage, 'none');
        expect(v?.visibility).toBe('full');
        expect(v && 'location' in v ? v.location : null).toEqual([73.81234, 18.50987]);
      }
    }
  });

  it('shows no individual learner before matching or without a relation', () => {
    for (const viewer of [provider, giver, otherLearner]) {
      expect(learnerViewFor(viewer, src, 'beforeMatching', 'provider')).toBeNull();
      expect(learnerViewFor(viewer, src, 'beforeMatching', 'spaceGiver')).toBeNull();
      expect(learnerViewFor(viewer, src, 'accepted', 'none')).toBeNull();
      expect(learnerViewFor(viewer, src, 'proposed', 'none')).toBeNull();
    }
  });

  it('proposed stage: a cohort entry with area centre and windows only', () => {
    for (const [viewer, rel] of [[provider, 'provider'], [giver, 'spaceGiver']] as const) {
      const v = learnerViewFor(viewer, src, 'proposed', rel);
      expect(v).toEqual({ visibility: 'cohort', requestId: 'r1', areaName: 'Kothrud', areaCenter: [73.8077, 18.5074], windows: src.windows });
      expect(leaksExact(v)).toBe(false);
    }
  });

  it('accepted stage: the provider gets identity and contact, never the exact point', () => {
    const v = learnerViewFor(provider, src, 'accepted', 'provider');
    expect(v?.visibility).toBe('provider-accepted');
    expect(v).toMatchObject({ name: 'Asha Patil', contactPhone: '+91 98200 11111', contactEmail: 'asha@test.local', areaCenter: [73.8077, 18.5074] });
    expect(v).not.toHaveProperty('location');
    expect(v).not.toHaveProperty('learnerUserId');
    expect(leaksExact(v)).toBe(false);
  });

  it('accepted stage: the space giver gets a roster name only, never contact details', () => {
    const v = learnerViewFor(giver, src, 'accepted', 'spaceGiver');
    expect(v).toEqual({ visibility: 'roster', requestId: 'r1', name: 'Asha Patil' });
  });

  it('a mismatched role and relation discloses nothing at the accepted stage', () => {
    expect(learnerViewFor(giver, src, 'accepted', 'provider')).toBeNull();
    expect(learnerViewFor(provider, src, 'accepted', 'spaceGiver')).toBeNull();
    expect(learnerViewFor(otherLearner, src, 'accepted', 'provider')).toBeNull();
  });
});

describe('visibleLearnerPoint', () => {
  it('returns the exact point only to the learner and administrators', () => {
    const exact: [number, number] = [73.81234, 18.50987];
    const centre: [number, number] = [73.8077, 18.5074];
    expect(visibleLearnerPoint(self, 'learner1', exact, centre)).toEqual(exact);
    expect(visibleLearnerPoint(admin, 'learner1', exact, centre)).toEqual(exact);
    for (const viewer of [provider, giver, otherLearner]) expect(visibleLearnerPoint(viewer, 'learner1', exact, centre)).toEqual(centre);
  });
});
