import { type EngineContext, categoryName } from '../context';
import { type OfferingPlacement, learnerTimeFit } from '../flow/fit';
import type { EngineOffering, EngineRequest, GeoPoint, Suggestion, TimeWindow } from '../types';
import { clamp01, formatKm, round4 } from '../util/format';
import { haversineKm } from '../util/geo';
import { formatWindow, overlapWithUnion } from '../util/time';

/** An offering as a suggestion candidate: where and when it runs, if known. */
export interface SuggestTarget {
  offering: EngineOffering;
  location: GeoPoint | null;
  areaId: string | null;
  session: TimeWindow | null;
}

/** Placed offerings use their space; the rest fall back to their target area centre. */
export function suggestTargets(ctx: EngineContext, placements: readonly OfferingPlacement[]): SuggestTarget[] {
  const placed = new Map(placements.map((p) => [p.offering.id, p]));
  return ctx.snapshot.offerings.map((offering) => {
    const pl = placed.get(offering.id);
    if (pl) return { offering, location: pl.space.location, areaId: pl.space.areaId, session: pl.session };
    const area = offering.targetAreaId ? ctx.areaById.get(offering.targetAreaId) : undefined;
    return { offering, location: area?.center ?? null, areaId: area?.id ?? null, session: null };
  });
}

/** 1 for the same category, 0.6 for the same parent (siblings or parent/child), else 0. */
export function categorySimilarity(ctx: EngineContext, a: string, b: string): number {
  if (a === b) return 1;
  const ca = ctx.categoryById.get(a);
  const cb = ctx.categoryById.get(b);
  if (!ca || !cb) return 0;
  if ((ca.parentId !== null && ca.parentId === cb.parentId) || ca.parentId === b || cb.parentId === a) return 0.6;
  return 0;
}

const popularityCache = new WeakMap<EngineContext, Map<number, Map<string, number>>>();

/** Share of requests per category inside each demand cluster, normalised to the cluster's top category. */
export function clusterPopularity(ctx: EngineContext, areaId: string): Map<string, number> {
  let byCluster = popularityCache.get(ctx);
  if (!byCluster) {
    const counts = new Map<number, Map<string, number>>();
    for (const r of ctx.snapshot.requests) {
      const c = ctx.clusterByArea.get(r.areaId) ?? -1;
      const m = counts.get(c) ?? new Map<string, number>();
      m.set(r.categoryId, (m.get(r.categoryId) ?? 0) + 1);
      counts.set(c, m);
    }
    byCluster = new Map();
    for (const [c, m] of counts) {
      const max = Math.max(1, ...m.values());
      byCluster.set(c, new Map([...m].map(([k, v]) => [k, v / max])));
    }
    popularityCache.set(ctx, byCluster);
  }
  return byCluster.get(ctx.clusterByArea.get(areaId) ?? -1) ?? new Map();
}

function offeringTimeFit(req: EngineRequest, t: SuggestTarget): number {
  if (t.session) return learnerTimeFit(req, t.session);
  if (req.windows.length === 0) return 1;
  if (t.offering.windows.length === 0) return 0.5;
  let best = 0;
  for (const w of t.offering.windows) best = Math.max(best, overlapWithUnion(w, req.windows));
  return clamp01(best / t.offering.sessionMinutes);
}

/**
 * Suggestions for a learner (README 13.8): offerings ranked by 0.4 distance + 0.3 time fit
 * + 0.2 category similarity + 0.1 popularity in the learner's demand cluster. Distance decays
 * to 0 at twice the global radius so slightly further options still rank. When fewer than
 * `count` offerings qualify, the learner's own category is suggested as an open request.
 */
export function suggestionsFor(ctx: EngineContext, req: EngineRequest, targets: readonly SuggestTarget[], count: number): Suggestion[] {
  if (count <= 0) return [];
  const pop = clusterPopularity(ctx, req.areaId);
  const reach = 2 * ctx.settings.maxRadiusKm;
  const scored: Suggestion[] = [];
  for (const t of targets) {
    const sim = categorySimilarity(ctx, req.categoryId, t.offering.categoryId);
    if (sim <= 0 || t.offering.audience !== req.audience) continue;
    const km = t.location ? haversineKm(req.location, t.location) : null;
    const dist = km === null ? 0 : clamp01(1 - km / reach);
    const time = offeringTimeFit(req, t);
    const popularity = pop.get(t.offering.categoryId) ?? 0;
    const score = 0.4 * dist + 0.3 * time + 0.2 * sim + 0.1 * popularity;
    const reasons: string[] = [];
    const cat = categoryName(ctx, t.offering.categoryId);
    if (sim === 1) reasons.push(`Same category: ${cat}`);
    else {
      const parentId = ctx.categoryById.get(t.offering.categoryId)?.parentId ?? t.offering.categoryId;
      reasons.push(`Same parent category: ${categoryName(ctx, parentId)}`);
    }
    if (km !== null) reasons.push(`${formatKm(km)} away`);
    if (t.session) {
      if (req.windows.length === 0) reasons.push(`${formatWindow(t.session)}, you are flexible on time`);
      else if (time > 0) reasons.push(`${formatWindow(t.session)} overlaps your time`);
      else reasons.push(`${formatWindow(t.session)}, outside your preferred times`);
    }
    if (popularity >= 0.5) reasons.push('Popular with learners in your demand cluster');
    scored.push({ offeringId: t.offering.id, categoryId: t.offering.categoryId, areaId: t.areaId, score: round4(score), reasons });
  }
  scored.sort((a, b) => b.score - a.score || (a.offeringId ?? '').localeCompare(b.offeringId ?? ''));
  const out = scored.slice(0, count);
  if (out.length < count) {
    const areaName = ctx.areaById.get(req.areaId)?.name ?? 'your area';
    out.push({
      offeringId: null,
      categoryId: req.categoryId,
      areaId: req.areaId,
      score: round4(0.2 + 0.1 * (pop.get(req.categoryId) ?? 0)),
      reasons: [`Your request stays open; a new ${categoryName(ctx, req.categoryId)} offering in ${areaName} can still serve it`],
    });
  }
  return out;
}
