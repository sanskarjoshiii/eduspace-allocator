import type { MapData } from '@/components/map/map-types';
import type { DemandLevel } from '@/lib/domain';
import type { AreaDemandDto } from '@/server/dto/insight';

/** Maps the per-area API rows into the MapView demand layer (area centres only, never learners). */
export function toDemandMapData(areas: AreaDemandDto[]): MapData {
  return {
    demand: areas
      .filter((a): a is AreaDemandDto & { demandLevel: DemandLevel } => a.demandLevel !== null)
      .map((a) => ({
        areaId: a.areaId,
        areaName: a.areaName,
        centre: { type: 'Point' as const, coordinates: a.areaCenter },
        openRequests: a.openRequests,
        level: a.demandLevel,
      })),
  };
}
