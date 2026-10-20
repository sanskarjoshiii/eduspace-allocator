import { vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/server/auth/session';

/**
 * Test-only session control. Each test file that calls route handlers must declare:
 *
 *   vi.mock('@/server/auth/session', () => import('../helpers/session-mock'));
 *
 * and then call `actAs(user)` (or `actAs(null)` for signed out) before invoking a handler.
 */
export { actAs } from './session-mock';

/** Builds a NextRequest for a route handler. */
export function req(method: string, path: string, body?: unknown, headers?: Record<string, string>): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Route context with already-resolved params, as Next 16 passes them. */
export function ctx<P extends Record<string, string>>(params: P = {} as P) {
  return { params: Promise.resolve(params) };
}

/** Reads `{ data }` or `{ error }` from a handler response. */
export async function json<T = unknown>(res: Response): Promise<{ status: number; data: T; error?: { code: string; message: string } }> {
  const body = (await res.json()) as { data: T; error?: { code: string; message: string } };
  return { status: res.status, data: body.data, error: body.error };
}

export type { SessionUser };
export const _vi = vi;
