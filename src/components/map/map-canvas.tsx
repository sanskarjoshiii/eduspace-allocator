'use client';

// Leaflet canvas for MapView. Client only: import MapView (next/dynamic, ssr:false) instead.
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { DEFAULT_CENTER, DEFAULT_ZOOM, pointToLatLng, pointToTuple, type GeoPoint } from '@/components/forms/geo';
import { useThemeColors } from '@/hooks/use-css-colors';
import { formatKm, formatNumber } from '@/lib/format';
import type { MapData } from './map-types';
import { demandColor, demandRadius, escapeHtml, SPACE_STATUS_LABEL, spaceColor } from './map-utils';

export interface MapCanvasProps {
  /** Already filtered layers. */
  data: Required<Omit<MapData, 'categories'>>;
  height: number;
  center?: GeoPoint;
  zoom?: number;
  label: string;
}

/** Leaflet chrome restyled with tokens (important: leaflet.css is unlayered and would win otherwise). */
export const LEAFLET_THEME =
  '[&_.leaflet-popup-content-wrapper]:rounded-lg! [&_.leaflet-popup-content-wrapper]:border [&_.leaflet-popup-content-wrapper]:border-border [&_.leaflet-popup-content-wrapper]:bg-surface! [&_.leaflet-popup-content-wrapper]:text-ink! [&_.leaflet-popup-content-wrapper]:shadow-sm! ' +
  '[&_.leaflet-popup-tip]:bg-surface! [&_.leaflet-popup-content]:m-3! [&_.leaflet-popup-content]:font-sans [&_.leaflet-popup-content]:text-body-sm ' +
  '[&_a.leaflet-popup-close-button]:text-ink-subtle! [&_.leaflet-tooltip]:rounded-md! [&_.leaflet-tooltip]:border-border! [&_.leaflet-tooltip]:bg-surface! [&_.leaflet-tooltip]:text-ink! [&_.leaflet-tooltip]:shadow-sm! ' +
  '[&_.leaflet-control-attribution]:bg-surface/85! [&_.leaflet-control-attribution]:text-ink-subtle! [&_.leaflet-control-attribution_a]:text-ink-muted! ' +
  '[&_.leaflet-bar]:border-border! [&_.leaflet-bar]:shadow-xs! [&_.leaflet-bar_a]:border-border! [&_.leaflet-bar_a]:bg-surface! [&_.leaflet-bar_a]:text-ink! [&_.leaflet-bar_a:hover]:bg-surface-sunken! ' +
  'dark:[&_.leaflet-tile-pane]:[filter:invert(1)_hue-rotate(180deg)_brightness(0.9)_contrast(0.9)]';

const offerIcon = L.divIcon({
  className: 'es-offer',
  html: '<span class="block size-3.5 rotate-45 rounded-xs border-2 border-surface bg-info shadow-sm"></span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function hoursIcon(hours: number): L.DivIcon {
  return L.divIcon({
    className: 'es-hours',
    html: `<span class="absolute bottom-1.5 left-0 inline-flex h-5.5 -translate-x-1/2 items-center whitespace-nowrap rounded-sm border border-border bg-warning-tint px-1.5 font-mono text-delta text-warning-ink shadow-xs">${escapeHtml(
      formatNumber(hours),
    )} h idle</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

/** Fits the view to every point once, the first time there is data. */
function FitOnce({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    done.current = true;
    if (points.length === 1) map.setView(points[0]!, Math.max(map.getZoom(), 13));
    else map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 14 });
  }, [map, points]);
  return null;
}

function PopupBody({ title, lines }: { title: string; lines: (string | undefined | false)[] }) {
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <strong className="text-body-sm font-medium text-ink">{title}</strong>
      {lines.filter(Boolean).map((l, i) => (
        <span key={i} className="text-body-sm text-ink-muted">
          {l}
        </span>
      ))}
    </div>
  );
}

export default function MapCanvas({ data, height, center, zoom = DEFAULT_ZOOM, label }: MapCanvasProps) {
  const { colors } = useThemeColors();
  const maxDemand = useMemo(() => Math.max(0, ...data.demand.map((d) => d.openRequests)), [data.demand]);
  const points = useMemo(
    () => [
      ...data.spaces.map((s) => pointToTuple(s.location)),
      ...data.demand.map((d) => pointToTuple(d.centre)),
      ...data.offers.map((o) => pointToTuple(o.location)),
    ],
    [data.spaces, data.demand, data.offers],
  );

  return (
    <div role="region" aria-label={label} className={`overflow-hidden rounded-lg border border-border ${LEAFLET_THEME}`}>
      <MapContainer center={center ? pointToLatLng(center) : DEFAULT_CENTER} zoom={zoom} scrollWheelZoom={false} style={{ height, width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {center ? null : <FitOnce points={points} />}

        {data.demand.map((d) => (
          <CircleMarker
            key={`demand-${d.areaId}-${d.category ?? ''}`}
            center={pointToLatLng(d.centre)}
            radius={demandRadius(d.openRequests, maxDemand)}
            pathOptions={{ color: demandColor(d.level, colors), fillColor: demandColor(d.level, colors), fillOpacity: 0.25, weight: 1.5, opacity: 0.8 }}
          >
            <Popup>
              <PopupBody
                title={`${d.areaName} (area centre)`}
                lines={[`${d.level} demand`, `${formatNumber(d.openRequests)} open requests`, d.category && `Category: ${d.category}`]}
              />
            </Popup>
          </CircleMarker>
        ))}

        {data.allocations.map((a) => (
          <Polyline
            key={`alloc-${a.id}`}
            positions={[pointToTuple(a.from), pointToTuple(a.to)]}
            pathOptions={{ color: colors.info, weight: 2, opacity: 0.85 }}
          >
            <Tooltip sticky>
              {[a.courseTitle, a.spaceName && a.areaName ? `${a.spaceName} → ${a.areaName}` : a.spaceName, a.learners !== undefined ? `${formatNumber(a.learners)} learners` : undefined]
                .filter(Boolean)
                .join(' · ') || 'Allocation'}
            </Tooltip>
          </Polyline>
        ))}

        {data.spaces.map((s) => (
          <CircleMarker
            key={`space-${s.id}`}
            center={pointToLatLng(s.location)}
            radius={7}
            pathOptions={{ color: colors.surface, weight: 2, fillColor: spaceColor(s.status, colors), fillOpacity: 1 }}
          >
            <Popup>
              <PopupBody title={s.name} lines={[SPACE_STATUS_LABEL[s.status], `${formatNumber(s.seats)} seats`, s.areaName && `Area: ${s.areaName}`]} />
              {s.href ? (
                <a href={s.href} className="mt-1.5 inline-block font-mono text-delta text-accent-ink">
                  Open Space
                </a>
              ) : null}
            </Popup>
          </CircleMarker>
        ))}

        {data.offers.map((o) => (
          <Marker key={`offer-${o.id}`} position={pointToLatLng(o.location)} icon={offerIcon} title={o.title}>
            <Popup>
              <PopupBody title={o.title} lines={[o.spaceName, o.schedule, o.distanceKm !== undefined && `${formatKm(o.distanceKm)} away`, o.category]} />
              {o.href ? (
                <a href={o.href} className="mt-1.5 inline-block font-mono text-delta text-accent-ink">
                  View Offer
                </a>
              ) : null}
            </Popup>
          </Marker>
        ))}

        {data.unusedHours.map((u) => (
          <Marker key={`hours-${u.spaceId}`} position={pointToLatLng(u.location)} icon={hoursIcon(u.hours)} title={`${u.name}: ${u.hours} idle hours per week`} keyboard={false} />
        ))}
      </MapContainer>
    </div>
  );
}
