/** Renders rows as a plain-text table with a header rule. Numbers are right-aligned with en-IN grouping. */
export function formatTable(headers: string[], rows: (string | number)[][]): string {
  const cells = rows.map((r) => r.map((c) => (typeof c === 'number' ? c.toLocaleString('en-IN') : c)));
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => (r[i] ?? '').length)));
  const numeric = headers.map((_, i) => rows.length > 0 && rows.every((r) => typeof r[i] === 'number'));
  const line = (r: string[]) => r.map((c, i) => (numeric[i] ? c.padStart(widths[i]!) : c.padEnd(widths[i]!))).join('  ').trimEnd();
  return [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...cells.map(line)].join('\n');
}
