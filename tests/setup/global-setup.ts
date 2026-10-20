import { existsSync } from 'node:fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

let replSet: MongoMemoryReplSet | undefined;

// Reuse a locally installed mongod when present (saves a ~500 MB download).
const LOCAL_MONGOD = 'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe';

export async function setup(project: TestProject): Promise<void> {
  if (!process.env.MONGOMS_SYSTEM_BINARY && existsSync(LOCAL_MONGOD)) {
    process.env.MONGOMS_SYSTEM_BINARY = LOCAL_MONGOD;
  }
  // A single-node replica set, so publish-in-a-transaction is exercised in tests.
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  project.provide('mongoUri', replSet.getUri());
}

export async function teardown(): Promise<void> {
  await replSet?.stop();
}
