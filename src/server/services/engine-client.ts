import { engine } from '@/engine';
import type { EngineClient } from '@/engine/types';

/**
 * The Smart Allocation engine, as the worker and services see it. One seam so tests
 * can replace the engine with vi.mock('@/server/services/engine-client').
 * The browser never calls the engine; only server code reaches this module.
 */
export function getEngine(): EngineClient {
  return engine;
}
