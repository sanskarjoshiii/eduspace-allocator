import mongoose, { type ClientSession } from 'mongoose';
import { getEnv } from './env';
import { logger } from './logger';

interface Cache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
  supportsTransactions: boolean | null;
}

// Survive hot reloads and serverless re-invocations: one connection per process.
const globalCache = globalThis as unknown as { __mongoose?: Cache };
const cache: Cache = globalCache.__mongoose ?? { conn: null, promise: null, supportsTransactions: null };
globalCache.__mongoose = cache;

export async function connectDb(uri?: string): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    const target = uri ?? getEnv().MONGODB_URI;
    mongoose.set('strictQuery', true);
    cache.promise = mongoose
      .connect(target, { bufferCommands: false, maxPoolSize: 10, serverSelectionTimeoutMS: 10_000 })
      .catch((err: unknown) => {
        cache.promise = null;
        logger.error('db.connect_failed', { message: err instanceof Error ? err.message : String(err) });
        throw err;
      });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}

export async function disconnectDb(): Promise<void> {
  if (cache.conn) await cache.conn.disconnect();
  cache.conn = null;
  cache.promise = null;
  cache.supportsTransactions = null;
}

/** True when the server is a replica set or sharded cluster (Atlas), where transactions work. */
export async function supportsTransactions(): Promise<boolean> {
  if (cache.supportsTransactions !== null) return cache.supportsTransactions;
  const conn = await connectDb();
  const db = conn.connection.db;
  if (!db) return false;
  const hello = (await db.admin().command({ hello: 1 })) as { setName?: string; msg?: string };
  cache.supportsTransactions = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  return cache.supportsTransactions;
}

/**
 * Runs `fn` inside a transaction when the deployment supports it. On a standalone
 * server (local dev) it runs without one, so callers must keep writes idempotent.
 */
export async function withTransaction<T>(fn: (session: ClientSession | null) => Promise<T>): Promise<T> {
  await connectDb();
  if (!(await supportsTransactions())) return fn(null);
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}

export async function dbHealth(): Promise<{ ok: boolean; state: string; transactions: boolean }> {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  try {
    const conn = await connectDb();
    await conn.connection.db?.admin().command({ ping: 1 });
    return { ok: true, state: states[conn.connection.readyState] ?? 'unknown', transactions: await supportsTransactions() };
  } catch {
    return { ok: false, state: 'disconnected', transactions: false };
  }
}
