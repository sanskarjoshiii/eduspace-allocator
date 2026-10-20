/** Binary min-heap of (key, node) pairs. */
class MinHeap {
  private keys: number[] = [];
  private nodes: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, node: number): void {
    const k = this.keys;
    const nd = this.nodes;
    let i = k.length;
    k.push(key);
    nd.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((k[parent] ?? 0) <= key) break;
      k[i] = k[parent] ?? 0;
      nd[i] = nd[parent] ?? 0;
      i = parent;
    }
    k[i] = key;
    nd[i] = node;
  }

  /** Removes the minimum; returns [key, node]. Caller checks size first. */
  pop(): [number, number] {
    const k = this.keys;
    const nd = this.nodes;
    const topKey = k[0] ?? 0;
    const topNode = nd[0] ?? 0;
    const lastKey = k.pop() ?? 0;
    const lastNode = nd.pop() ?? 0;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && (k[r] ?? 0) < (k[l] ?? 0) ? r : l;
        if ((k[c] ?? 0) >= lastKey) break;
        k[i] = k[c] ?? 0;
        nd[i] = nd[c] ?? 0;
        i = c;
      }
      k[i] = lastKey;
      nd[i] = lastNode;
    }
    return [topKey, topNode];
  }
}

/**
 * Min-cost flow by successive shortest paths with Johnson potentials and Dijkstra.
 * Edge costs must be non-negative (true for the learner graph), so potentials start at 0.
 */
export class MinCostFlow {
  private readonly n: number;
  private to: number[] = [];
  private cap: number[] = [];
  private cost: number[] = [];
  private adj: number[][];

  constructor(nodeCount: number) {
    this.n = nodeCount;
    this.adj = Array.from({ length: nodeCount }, () => []);
  }

  /** Adds a directed edge; returns its id for `flowOn`. */
  addEdge(from: number, to: number, capacity: number, cost: number): number {
    if (cost < 0) throw new Error('MinCostFlow: negative edge cost');
    const id = this.to.length;
    this.to.push(to, from);
    this.cap.push(capacity, 0);
    this.cost.push(cost, -cost);
    this.adj[from]?.push(id);
    this.adj[to]?.push(id + 1);
    return id;
  }

  /** Flow currently on edge `id` (the residual capacity of its reverse edge). */
  flowOn(id: number): number {
    return this.cap[id + 1] ?? 0;
  }

  /** Pushes up to `maxFlow` units from s to t at minimum cost. */
  run(s: number, t: number, maxFlow = Infinity): { flow: number; cost: number } {
    const n = this.n;
    const potential = new Float64Array(n);
    const dist = new Float64Array(n);
    const prevEdge = new Int32Array(n);
    let flow = 0;
    let total = 0;
    while (flow < maxFlow) {
      dist.fill(Infinity);
      prevEdge.fill(-1);
      dist[s] = 0;
      const heap = new MinHeap();
      heap.push(0, s);
      while (heap.size > 0) {
        const [d, u] = heap.pop();
        if (d > (dist[u] ?? Infinity)) continue;
        const pu = potential[u] ?? 0;
        for (const e of this.adj[u] ?? []) {
          if ((this.cap[e] ?? 0) <= 0) continue;
          const v = this.to[e] ?? 0;
          const nd = d + (this.cost[e] ?? 0) + pu - (potential[v] ?? 0);
          if (nd < (dist[v] ?? Infinity) - 1e-9) {
            dist[v] = nd;
            prevEdge[v] = e;
            heap.push(nd, v);
          }
        }
      }
      const dt = dist[t] ?? Infinity;
      if (!Number.isFinite(dt)) break;
      // Capping at dist[t] keeps reduced costs non-negative (as in AtCoder Library's dual update).
      for (let v = 0; v < n; v++) potential[v] = (potential[v] ?? 0) + Math.min(dist[v] ?? Infinity, dt);

      let push = maxFlow - flow;
      for (let v = t; v !== s; ) {
        const e = prevEdge[v] ?? -1;
        push = Math.min(push, this.cap[e] ?? 0);
        v = this.to[e ^ 1] ?? s;
      }
      for (let v = t; v !== s; ) {
        const e = prevEdge[v] ?? -1;
        this.cap[e] = (this.cap[e] ?? 0) - push;
        this.cap[e ^ 1] = (this.cap[e ^ 1] ?? 0) + push;
        total += push * (this.cost[e] ?? 0);
        v = this.to[e ^ 1] ?? s;
      }
      flow += push;
    }
    return { flow, cost: total };
  }
}
