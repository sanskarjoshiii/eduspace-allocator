const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10" → "Oct 2026". Falls back to the raw period when it is not YYYY-MM. */
export function formatPeriod(period: string): string {
  const [y, m] = period.split('-');
  const month = MONTHS[Number(m) - 1];
  return month && y ? `${month} ${y}` : period;
}
