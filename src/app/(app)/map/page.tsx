import type { Metadata } from 'next';
import { MapExplorer } from '@/components/gis/map-explorer';

export const metadata: Metadata = { title: 'GIS Map' };

/** GIS map for every role (PLAN 6.5, 6.6). Layers and scoping come from GET /api/map. */
export default function MapPage() {
  return <MapExplorer />;
}
