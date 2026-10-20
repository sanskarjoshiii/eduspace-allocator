/**
 * Seeded pseudo-random numbers for the seed generator. mulberry32 is tiny, fast and
 * good enough for synthetic data; the same seed always yields the same sequence.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.next();
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Integer in [min, max] that is a multiple of `step`. */
  step(min: number, max: number, step: number): number {
    return this.int(Math.ceil(min / step), Math.floor(max / step)) * step;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on an empty list');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Picks one item with probability proportional to its weight. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (const item of items) {
      r -= Math.max(0, weight(item));
      if (r < 0) return item;
    }
    return items[items.length - 1]!;
  }

  /** A shuffled copy (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** `count` distinct items (or all of them when there are fewer). */
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, Math.max(0, count));
  }
}

/** Splits `total` across `parts` buckets as evenly as possible, each at least `min`. */
export function spread(total: number, parts: number, min = 1): number[] {
  if (parts <= 0) return [];
  const t = Math.max(total, parts * min);
  const base = Math.floor(t / parts);
  const extra = t - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}
