// Browser-side fetch client. Every API returns { data } on success or { error } on failure.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> } | unknown,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  let body: { data?: T; error?: { code: string; message: string; details?: unknown } } = {};
  try {
    body = await res.json();
  } catch {
    // empty or non-JSON body
  }
  if (!res.ok || body.error) {
    throw new ApiError(res.status, body.error?.code ?? 'http_error', body.error?.message ?? `Request failed (${res.status}).`, body.error?.details);
  }
  return body.data as T;
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | boolean | undefined | null>): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  return handle<T>(await fetch(url, { credentials: 'same-origin', cache: 'no-store' }));
}

export async function apiSend<T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return handle<T>(
    await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/** Field errors from a 422 response, keyed by field path, for react-hook-form setError. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const d = err.details as { fieldErrors?: Record<string, string[]> } | undefined;
  return Object.fromEntries(Object.entries(d?.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? 'Invalid value']));
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}
