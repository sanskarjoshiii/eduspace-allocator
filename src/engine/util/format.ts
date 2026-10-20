/** "3.1 km" — always one decimal. */
export function formatKm(km: number): string {
  return `${km.toFixed(1)} km`;
}

/** A configured limit such as "5 km" or "7.5 km" (trailing zero dropped). */
export function formatLimitKm(km: number): string {
  return `${Number(km.toFixed(1))} km`;
}

/** "₹450" or "₹450.50". */
export function formatRupees(amount: number): string {
  const r = Math.round(amount * 100) / 100;
  return `₹${Number.isInteger(r) ? String(r) : r.toFixed(2)}`;
}

export function formatScore(score: number): string {
  return score.toFixed(2);
}

/** Clamp to [0, 1]; NaN becomes 0. */
export function clamp01(x: number): number {
  if (!(x > 0)) return 0;
  return x > 1 ? 1 : x;
}

/** Round to 4 decimals so stored scores are stable and readable. */
export function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
