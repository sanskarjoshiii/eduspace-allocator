import { mulberry32 } from '../util/prng';

export interface KMeansOptions {
  seed: number;
  /** Number of k-means++ initialisations; the lowest inertia wins. */
  nInit: number;
  maxIter?: number;
}

export interface KMeansResult {
  labels: number[];
  centroids: number[][];
  inertia: number;
}

function sqDist(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2;
  return s;
}

function kmeansPlusPlus(rows: readonly number[][], k: number, rand: () => number): number[][] {
  const n = rows.length;
  const first = rows[Math.floor(rand() * n)] ?? rows[0] ?? [];
  const centres: number[][] = [first.slice()];
  const d2 = rows.map((r) => sqDist(r, first));
  while (centres.length < k) {
    let total = 0;
    for (const v of d2) total += v;
    let idx = 0;
    if (total <= 0) {
      idx = Math.floor(rand() * n);
    } else {
      let target = rand() * total;
      for (idx = 0; idx < n - 1; idx++) {
        target -= d2[idx] ?? 0;
        if (target <= 0) break;
      }
    }
    const c = (rows[idx] ?? first).slice();
    centres.push(c);
    for (let i = 0; i < n; i++) {
      const d = sqDist(rows[i] ?? [], c);
      if (d < (d2[i] ?? 0)) d2[i] = d;
    }
  }
  return centres;
}

function lloyd(rows: readonly number[][], init: number[][], maxIter: number): KMeansResult {
  const n = rows.length;
  const k = init.length;
  const dim = rows[0]?.length ?? 0;
  let centroids = init.map((c) => c.slice());
  const labels = new Array<number>(n).fill(-1);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const r = rows[i] ?? [];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = sqDist(r, centroids[c] ?? []);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        changed = true;
      }
    }
    if (!changed && iter > 0) break;

    const sums = Array.from({ length: k }, () => new Array<number>(dim).fill(0));
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      const l = labels[i] ?? 0;
      counts[l] = (counts[l] ?? 0) + 1;
      const s = sums[l] ?? [];
      const r = rows[i] ?? [];
      for (let j = 0; j < dim; j++) s[j] = (s[j] ?? 0) + (r[j] ?? 0);
    }
    const next = sums.map((s, c) => {
      const cnt = counts[c] ?? 0;
      return cnt > 0 ? s.map((v) => v / cnt) : (centroids[c] ?? []).slice();
    });
    // Empty cluster: move its centre to the point farthest from its own centre.
    for (let c = 0; c < k; c++) {
      if ((counts[c] ?? 0) > 0) continue;
      let far = 0;
      let farD = -1;
      for (let i = 0; i < n; i++) {
        const d = sqDist(rows[i] ?? [], next[labels[i] ?? 0] ?? []);
        if (d > farD) {
          farD = d;
          far = i;
        }
      }
      next[c] = (rows[far] ?? []).slice();
      labels[far] = c;
      changed = true;
    }
    centroids = next;
  }

  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += sqDist(rows[i] ?? [], centroids[labels[i] ?? 0] ?? []);
  return { labels, centroids, inertia };
}

/**
 * Deterministic K-Means: k-means++ seeding from a seeded PRNG, Lloyd iterations,
 * `nInit` restarts keeping the lowest inertia. When k >= n each point is its own cluster.
 */
export function kmeans(rows: readonly number[][], k: number, opts: KMeansOptions): KMeansResult {
  const n = rows.length;
  if (n === 0) return { labels: [], centroids: [], inertia: 0 };
  if (k >= n) {
    return { labels: rows.map((_, i) => i), centroids: rows.map((r) => r.slice()), inertia: 0 };
  }
  const kk = Math.max(1, Math.floor(k));
  const rand = mulberry32(opts.seed);
  const maxIter = opts.maxIter ?? 100;
  let best: KMeansResult | null = null;
  for (let t = 0; t < Math.max(1, opts.nInit); t++) {
    const res = lloyd(rows, kmeansPlusPlus(rows, kk, rand), maxIter);
    if (best === null || res.inertia < best.inertia - 1e-12) best = res;
  }
  return best as KMeansResult;
}
