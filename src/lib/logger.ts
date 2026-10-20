type Level = 'debug' | 'info' | 'warn' | 'error';

const SECRET_KEYS = /pass(word)?|secret|token|authorization|cookie|apikey|api_key|hash/i;

/** Drops values whose keys look secret, so logs never carry credentials. */
function scrub(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : v;
  return out;
}

function write(level: Level, event: string, meta?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'test' && level === 'debug') return;
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...scrub(meta) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, meta?: Record<string, unknown>) => write('debug', event, meta),
  info: (event: string, meta?: Record<string, unknown>) => write('info', event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => write('warn', event, meta),
  error: (event: string, meta?: Record<string, unknown>) => write('error', event, meta),
};
