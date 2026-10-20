import { describe, expect, it } from 'vitest';
import { buildCohorts, targetBatchSize } from '@/engine/kmeans/cohorts';
import { areaFeatureRows, clusterAreas, labelClusters } from '@/engine/kmeans/demand';
import { kmeans } from '@/engine/kmeans/kmeans';
import type { EngineArea } from '@/engine/types';
import { baseSnapshot, offering, request, settings, southPuneSnapshot } from './fixtures';

describe('kmeans', () => {
  const blobs = [
    [0, 0],
    [0.2, 0.1],
    [0.1, 0.3],
    [10, 10],
    [10.2, 9.9],
    [9.8, 10.1],
  ];

  it('separates obvious blobs', () => {
    const res = kmeans(blobs, 2, { seed: 42, nInit: 10 });
    expect(new Set(res.labels.slice(0, 3)).size).toBe(1);
    expect(new Set(res.labels.slice(3)).size).toBe(1);
    expect(res.labels[0]).not.toBe(res.labels[3]);
    expect(res.inertia).toBeLessThan(1);
  });

  it('is deterministic for a seed', () => {
    const a = kmeans(blobs, 3, { seed: 7, nInit: 5 });
    const b = kmeans(blobs, 3, { seed: 7, nInit: 5 });
    expect(a).toEqual(b);
  });

  it('gives each point its own cluster when k >= n', () => {
    expect(kmeans([[1], [2]], 5, { seed: 1, nInit: 1 }).labels).toEqual([0, 1]);
  });
});

describe('labelClusters', () => {
  it('labels by demand index, whatever the cluster numbering', () => {
    const indices = [0.4, 2.1, -1.3, 0.9];
    const labels = labelClusters(indices);
    expect(labels).toEqual(['Medium', 'High', 'Emerging', 'Medium']);
    // Permute cluster ids: the label follows the centroid, not the number.
    const perm = [2, 0, 3, 1];
    const permuted = labelClusters(perm.map((p) => indices[p]!));
    perm.forEach((p, i) => expect(permuted[i]).toBe(labels[p]));
  });

  it('uses High and Emerging for two clusters', () => {
    expect(labelClusters([-1, 3])).toEqual(['Emerging', 'High']);
  });
});

describe('clusterAreas', () => {
  function areas(n: number): EngineArea[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `a${i}`,
      name: `Area ${i}`,
      center: { lng: 73.8 + i * 0.01, lat: 18.5 },
      population: 100000 + (i % 3) * 50000,
      studentCount: 20000 + (i % 4) * 3000,
      literacyRate: 80 + (i % 5),
      incomeScore: 30 + (i % 3) * 25,
      incomeGroup: (['Low', 'Medium', 'High'] as const)[i % 3]!,
    }));
  }

  it('picks k < number of areas and labels High demand where requests are dense', () => {
    const list = areas(8);
    const reqs = Array.from({ length: 40 }, (_, i) => request({ id: `q${i}`, areaId: i < 30 ? 'a0' : 'a3' }));
    const res = clusterAreas(baseSnapshot({ areas: list, requests: reqs }), settings());
    expect(res.k).toBeGreaterThanOrEqual(2);
    expect(res.k).toBeLessThan(8);
    expect(res.areaDemand).toHaveLength(8);
    expect(res.areaDemand.find((a) => a.areaId === 'a0')?.level).toBe('High');
    expect(new Set(res.areaDemand.map((a) => a.level))).toContain('Emerging');
    expect(res.silhouette).toBeGreaterThanOrEqual(-1);
    expect(res.silhouette).toBeLessThanOrEqual(1);
  });

  it('labels directly with two or fewer areas', () => {
    const list = areas(2);
    const res = clusterAreas(baseSnapshot({ areas: list, requests: [request({ areaId: 'a1' })] }), settings());
    expect(res.areaDemand.find((a) => a.areaId === 'a1')?.level).toBe('High');
    expect(res.areaDemand.find((a) => a.areaId === 'a0')?.level).toBe('Emerging');
  });

  it('computes request density per 1,000 students and unmet demand', () => {
    const snap = southPuneSnapshot();
    const rows = areaFeatureRows(snap);
    const katrajReqs = snap.requests.filter((r) => r.areaId === 'katraj').length;
    expect(rows[0]![5]).toBeCloseTo((katrajReqs / 42000) * 1000, 10);
    expect(rows[0]![6]).toBe(katrajReqs + 5);
  });
});

describe('buildCohorts', () => {
  it('never exceeds the target batch size and covers every request once', () => {
    const reqs = Array.from({ length: 47 }, (_, i) =>
      request({ id: `c${i}`, location: { lng: 73.8 + (i % 5) * 0.002, lat: 18.5 + Math.floor(i / 5) * 0.002 } }),
    );
    const snap = baseSnapshot({
      requests: reqs,
      offerings: [offering({ id: 'x', batchSize: 10 }), offering({ id: 'y', batchSize: 8 }), offering({ id: 'z', batchSize: 12 })],
    });
    expect(targetBatchSize(snap, 'coding')).toBe(10);
    const cohorts = buildCohorts(snap, settings());
    for (const c of cohorts) expect(c.requestIds.length).toBeLessThanOrEqual(10);
    const ids = cohorts.flatMap((c) => c.requestIds).sort();
    expect(ids).toEqual(reqs.map((r) => r.id).sort());
  });

  it('splits coincident points into batch-sized chunks', () => {
    const reqs = Array.from({ length: 31 }, (_, i) => request({ id: `p${i}` }));
    const cohorts = buildCohorts(baseSnapshot({ requests: reqs }), settings());
    expect(cohorts.every((c) => c.requestIds.length <= 15)).toBe(true);
    expect(cohorts.reduce((s, c) => s + c.requestIds.length, 0)).toBe(31);
  });
});
