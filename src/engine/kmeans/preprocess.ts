import type { IncomeGroup } from '../types';

/**
 * Standardises each column to zero mean and unit variance, matching scikit-learn's
 * StandardScaler: population standard deviation (ddof = 0), and a scale of 1 for
 * zero-variance columns so they become all zeros instead of NaN.
 */
export class StandardScaler {
  mean: number[] = [];
  scale: number[] = [];

  fit(rows: readonly (readonly number[])[]): this {
    const d = rows[0]?.length ?? 0;
    const n = rows.length;
    this.mean = new Array<number>(d).fill(0);
    this.scale = new Array<number>(d).fill(1);
    if (n === 0) return this;
    for (let j = 0; j < d; j++) {
      let sum = 0;
      for (const r of rows) sum += r[j] ?? 0;
      const mean = sum / n;
      let sq = 0;
      for (const r of rows) sq += ((r[j] ?? 0) - mean) ** 2;
      const std = Math.sqrt(sq / n);
      this.mean[j] = mean;
      this.scale[j] = std > 1e-12 ? std : 1;
    }
    return this;
  }

  transform(rows: readonly (readonly number[])[]): number[][] {
    return rows.map((r) => r.map((v, j) => (v - (this.mean[j] ?? 0)) / (this.scale[j] ?? 1)));
  }

  fitTransform(rows: readonly (readonly number[])[]): number[][] {
    return this.fit(rows).transform(rows);
  }
}

const INCOME_ORDINAL: Record<IncomeGroup, number> = { Low: 0, Medium: 1, High: 2 };

/** Ordinal encoding with a real order: Low 0, Medium 1, High 2. */
export function encodeIncomeGroup(group: IncomeGroup): number {
  return INCOME_ORDINAL[group];
}

export function euclidean(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2;
  return Math.sqrt(s);
}

/**
 * Mean silhouette coefficient (scikit-learn semantics). Points in singleton clusters
 * score 0. Returns 0 when there are fewer than two clusters.
 */
export function silhouetteScore(rows: readonly (readonly number[])[], labels: readonly number[]): number {
  const n = rows.length;
  const clusters = [...new Set(labels)];
  if (n < 2 || clusters.length < 2) return 0;
  const size = new Map<number, number>();
  for (const l of labels) size.set(l, (size.get(l) ?? 0) + 1);

  let total = 0;
  for (let i = 0; i < n; i++) {
    const li = labels[i] ?? 0;
    if ((size.get(li) ?? 0) <= 1) continue; // singleton: s = 0
    const sums = new Map<number, number>();
    const ri = rows[i] ?? [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const lj = labels[j] ?? 0;
      sums.set(lj, (sums.get(lj) ?? 0) + euclidean(ri, rows[j] ?? []));
    }
    const a = (sums.get(li) ?? 0) / ((size.get(li) ?? 1) - 1);
    let b = Infinity;
    for (const c of clusters) {
      if (c === li) continue;
      const mean = (sums.get(c) ?? 0) / (size.get(c) ?? 1);
      if (mean < b) b = mean;
    }
    const denom = Math.max(a, b);
    total += denom > 0 ? (b - a) / denom : 0;
  }
  return total / n;
}
