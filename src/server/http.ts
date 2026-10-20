import { NextResponse, type NextRequest } from 'next/server';
import { Types } from 'mongoose';
import { z, ZodError, type ZodType } from 'zod';
import { connectDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import type { Role } from '@/lib/domain';
import { User } from './models';
import { getSessionUser, type SessionUser } from './auth/session';

export type { SessionUser };

/** An error with an HTTP status that route handlers turn into a JSON error body. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Sign in to continue.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this.') => new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Record') => new HttpError(404, 'not_found', `${what} not found.`);
export const conflict = (message: string, details?: unknown) => new HttpError(409, 'conflict', message, details);

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse<{ data: T }> {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T): NextResponse<{ data: T }> {
  return NextResponse.json({ data }, { status: 201 });
}

export function errorResponse(err: unknown): NextResponse<ApiErrorBody> {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Some fields need attention.', details: z.flattenError(err) } },
      { status: 422 },
    );
  }
  const e = err as { name?: string; code?: number; message?: string; errors?: Record<string, { message: string }> };
  if (e?.name === 'ValidationError' && e.errors) {
    const fieldErrors = Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k, [v.message]]));
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Some fields need attention.', details: { formErrors: [], fieldErrors } } },
      { status: 422 },
    );
  }
  if (e?.code === 11000) {
    return NextResponse.json({ error: { code: 'duplicate', message: 'A record with these details already exists.' } }, { status: 409 });
  }
  logger.error('api.unhandled', { message: e?.message ?? String(err), name: e?.name });
  return NextResponse.json({ error: { code: 'internal', message: 'Something went wrong on our side. Try again.' } }, { status: 500 });
}

export async function parseBody<S extends ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest('The request body must be valid JSON.');
  }
  return schema.parse(raw);
}

export function parseQuery<S extends ZodType>(req: NextRequest | Request, schema: S): z.infer<S> {
  const url = new URL(req.url);
  const obj: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    obj[key] = all.length > 1 ? all : all[0]!;
  }
  return schema.parse(obj);
}

export function assertObjectId(id: string | undefined, what = 'Record'): Types.ObjectId {
  if (!id || !Types.ObjectId.isValid(id)) throw notFound(what);
  return new Types.ObjectId(id);
}

type Params = Record<string, string>;
export interface RouteContext<P extends Params = Params> {
  params: Promise<P>;
}
export interface AuthedContext<P extends Params = Params> {
  user: SessionUser;
  params: P;
}

/**
 * Wraps a route handler: connects to the database, requires a signed-in, active user
 * with one of `roles` (any role when omitted), and turns thrown errors into JSON.
 */
export function withAuth<P extends Params = Params>(
  opts: { roles?: readonly Role[] },
  handler: (req: NextRequest, ctx: AuthedContext<P>) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: RouteContext<P>): Promise<Response> => {
    try {
      await connectDb();
      const user = await getSessionUser();
      if (!user) throw unauthorized();
      const fresh = await User.findById(user.id).select('status role').lean();
      if (!fresh) throw unauthorized();
      if (fresh.status !== 'Active') throw forbidden('Your account is not active.');
      if (opts.roles && !opts.roles.includes(user.role)) throw forbidden();
      const params = ((await ctx?.params) ?? {}) as P;
      return await handler(req, { user, params });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Public handler wrapper: database connection and error mapping, no session. */
export function withPublic<P extends Params = Params>(handler: (req: NextRequest, ctx: { params: P }) => Promise<Response>) {
  return async (req: NextRequest, ctx: RouteContext<P>): Promise<Response> => {
    try {
      await connectDb();
      const params = ((await ctx?.params) ?? {}) as P;
      return await handler(req, { params });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Internal cron endpoints: require `Authorization: Bearer <CRON_SECRET>`. */
export function withCron(handler: (req: NextRequest) => Promise<Response>) {
  return async (req: NextRequest): Promise<Response> => {
    try {
      const header = req.headers.get('authorization') ?? '';
      if (header !== `Bearer ${getEnv().CRON_SECRET}`) throw unauthorized('Missing or invalid cron secret.');
      await connectDb();
      return await handler(req);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export const isAdmin = (user: SessionUser): boolean => user.role === 'Administrator';

/** Query filter limiting records to the user's own, unless they are an administrator. */
export function scopeToOwner(user: SessionUser, field: string): Record<string, unknown> {
  return isAdmin(user) ? {} : { [field]: new Types.ObjectId(user.id) };
}

/** Throws 403 unless the user owns the record (by `ownerId`) or is an administrator. */
export function assertOwner(user: SessionUser, ownerId: Types.ObjectId | string | null | undefined): void {
  if (isAdmin(user)) return;
  if (!ownerId || ownerId.toString() !== user.id) throw forbidden('Only the owner can change this.');
}

/** Pagination query shared by list endpoints. */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  sort: z.string().max(50).optional(),
});

export function pageMeta(total: number, page: number, pageSize: number) {
  return { total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}
