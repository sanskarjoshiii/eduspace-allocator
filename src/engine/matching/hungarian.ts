/** A weighted edge between left node `left` and right node `right`. Weight must be >= 0. */
export interface MatchEdge {
  left: number;
  right: number;
  weight: number;
}

/**
 * Maximum-weight bipartite matching via the Hungarian (Kuhn–Munkres) algorithm on a
 * rectangular matrix, O(n² m). Missing edges get weight 0 and are dropped from the result,
 * so with non-negative weights this equals the maximum-weight (not necessarily perfect)
 * matching. Returns `match[left] = right` or -1.
 */
export function maxWeightMatching(nLeft: number, nRight: number, edges: readonly MatchEdge[]): number[] {
  const result = new Array<number>(nLeft).fill(-1);
  if (nLeft === 0 || nRight === 0 || edges.length === 0) return result;

  const n = nLeft;
  const m = Math.max(nRight, nLeft); // pad with dummy columns so rows <= columns
  const cost = new Float64Array(n * m); // minimise -weight; non-edges cost 0
  const hasEdge = new Uint8Array(n * m);
  for (const e of edges) {
    if (e.left < 0 || e.left >= nLeft || e.right < 0 || e.right >= nRight || !(e.weight >= 0)) continue;
    const idx = e.left * m + e.right;
    if (!hasEdge[idx] || -e.weight < (cost[idx] ?? 0)) cost[idx] = -e.weight;
    hasEdge[idx] = 1;
  }

  // Classic potentials formulation with 1-based indices (row 0 / column 0 are sentinels).
  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1);
  const way = new Int32Array(m + 1);
  const minv = new Float64Array(m + 1);
  const used = new Uint8Array(m + 1);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(Infinity);
    used.fill(0);
    do {
      used[j0] = 1;
      const i0 = p[j0] ?? 0;
      const ui0 = u[i0] ?? 0;
      const rowBase = (i0 - 1) * m;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = (cost[rowBase + j - 1] ?? 0) - ui0 - (v[j] ?? 0);
        if (cur < (minv[j] ?? Infinity)) {
          minv[j] = cur;
          way[j] = j0;
        }
        if ((minv[j] ?? Infinity) < delta) {
          delta = minv[j] ?? Infinity;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          const pj = p[j] ?? 0;
          u[pj] = (u[pj] ?? 0) + delta;
          v[j] = (v[j] ?? 0) - delta;
        } else {
          minv[j] = (minv[j] ?? 0) - delta;
        }
      }
      j0 = j1;
    } while ((p[j0] ?? 0) !== 0);
    do {
      const j1 = way[j0] ?? 0;
      p[j0] = p[j1] ?? 0;
      j0 = j1;
    } while (j0 !== 0);
  }

  for (let j = 1; j <= m; j++) {
    const row = (p[j] ?? 0) - 1;
    const col = j - 1;
    if (row >= 0 && col < nRight && hasEdge[row * m + col]) result[row] = col;
  }
  return result;
}

/** Greedy best-edge-first matching; used only as a comparison in tests and reporting. */
export function greedyMatching(nLeft: number, nRight: number, edges: readonly MatchEdge[]): number[] {
  const result = new Array<number>(nLeft).fill(-1);
  const takenRight = new Uint8Array(nRight);
  const sorted = [...edges].sort((a, b) => b.weight - a.weight || a.left - b.left || a.right - b.right);
  for (const e of sorted) {
    if (result[e.left] !== -1 || takenRight[e.right]) continue;
    result[e.left] = e.right;
    takenRight[e.right] = 1;
  }
  return result;
}

export function matchingWeight(match: readonly number[], edges: readonly MatchEdge[]): number {
  const w = new Map<string, number>();
  for (const e of edges) w.set(`${e.left}:${e.right}`, Math.max(w.get(`${e.left}:${e.right}`) ?? 0, e.weight));
  let total = 0;
  match.forEach((r, l) => {
    if (r >= 0) total += w.get(`${l}:${r}`) ?? 0;
  });
  return total;
}
