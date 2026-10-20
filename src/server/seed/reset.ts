import mongoose from 'mongoose';

/** Atlas (or any SRV) hosts are treated as production: --reset needs --yes-really there. */
export function looksLikeProduction(uri: string): boolean {
  return /^mongodb\+srv:\/\//i.test(uri) || /\.mongodb\.net\b/i.test(uri);
}

/** Host and database of a connection string, with credentials removed, for log lines. */
export function describeUri(uri: string): { host: string; database: string } {
  try {
    const url = new URL(uri);
    const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'test';
    return { host: url.host, database };
  } catch {
    // Multi-host strings (a,b,c) are not valid URLs; strip credentials by hand.
    const withoutCreds = uri.replace(/\/\/[^@/]*@/, '//');
    const match = /^mongodb(?:\+srv)?:\/\/([^/?]+)\/?([^?]*)/i.exec(withoutCreds);
    return { host: match?.[1] ?? 'unknown', database: match?.[2] || 'test' };
  }
}

/** Collection names owned by the registered EduSpace models. */
export function eduSpaceCollections(): string[] {
  return mongoose
    .modelNames()
    .map((name) => mongoose.model(name).collection.collectionName)
    .sort();
}

/** Drops every EduSpace collection that exists in the connected database. Returns the dropped names. */
export async function dropEduSpaceCollections(): Promise<string[]> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Not connected to MongoDB');
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const dropped: string[] = [];
  for (const name of eduSpaceCollections()) {
    if (!existing.has(name)) continue;
    await db.dropCollection(name);
    dropped.push(name);
  }
  return dropped;
}
