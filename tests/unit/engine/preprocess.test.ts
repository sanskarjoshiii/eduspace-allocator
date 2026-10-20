import { describe, expect, it } from 'vitest';
import { StandardScaler, encodeIncomeGroup, silhouetteScore } from '@/engine/kmeans/preprocess';

// Expected values follow scikit-learn semantics: StandardScaler uses the population
// standard deviation (ddof = 0) and scale 1 for zero-variance columns; silhouette_score
// gives singleton-cluster points s = 0. Values were computed by hand from the definitions.

describe('StandardScaler', () => {
  it('scales with population std and leaves zero-variance columns at 0', () => {
    const scaler = new StandardScaler().fit([
      [1, 2],
      [3, 2],
      [5, 2],
    ]);
    expect(scaler.mean).toEqual([3, 2]);
    expect(scaler.scale[0]).toBeCloseTo(Math.sqrt(8 / 3), 10); // 1.632993...
    expect(scaler.scale[1]).toBe(1);
    const out = scaler.transform([
      [1, 2],
      [3, 2],
      [5, 2],
    ]);
    expect(out[0]![0]).toBeCloseTo(-1.224744871, 8);
    expect(out[1]![0]).toBeCloseTo(0, 10);
    expect(out[2]![0]).toBeCloseTo(1.224744871, 8);
    expect(out.map((r) => r[1])).toEqual([0, 0, 0]);
  });

  it('fitTransform output has mean 0 and population variance 1', () => {
    const out = new StandardScaler().fitTransform([[10], [20], [30], [40]]);
    const col = out.map((r) => r[0]!);
    const mean = col.reduce((a, b) => a + b, 0) / col.length;
    const variance = col.reduce((a, b) => a + (b - mean) ** 2, 0) / col.length;
    expect(mean).toBeCloseTo(0, 12);
    expect(variance).toBeCloseTo(1, 12);
  });
});

describe('encodeIncomeGroup', () => {
  it('is ordinal Low 0, Medium 1, High 2', () => {
    expect(['Low', 'Medium', 'High'].map((g) => encodeIncomeGroup(g as 'Low'))).toEqual([0, 1, 2]);
  });
});

describe('silhouetteScore', () => {
  it('matches the hand-computed value for two clean clusters', () => {
    // s = [9.5/10.5, 8.5/9.5, 8.5/9.5, 9.5/10.5] -> mean 0.899749...
    expect(silhouetteScore([[0], [1], [10], [11]], [0, 0, 1, 1])).toBeCloseTo(0.8997493734, 8);
  });

  it('gives singleton clusters a score of 0', () => {
    // s = [0.9, 8/9, 0] -> mean 0.596296...
    expect(silhouetteScore([[0], [1], [10]], [0, 0, 1])).toBeCloseTo(0.5962962963, 8);
  });

  it('returns 0 with fewer than two clusters', () => {
    expect(silhouetteScore([[0], [1]], [0, 0])).toBe(0);
  });
});
