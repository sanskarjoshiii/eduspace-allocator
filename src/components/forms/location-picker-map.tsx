'use client';

// Client-only Leaflet map for LocationPicker. Never import this directly: use LocationPicker,
// which loads it with next/dynamic and ssr:false.
import 'leaflet/dist/leaflet.css';
import L, { type Map as LeafletMap } from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { Button } from '@/components/ui/button';
import { DEFAULT_CENTER, DEFAULT_ZOOM, latLngToPoint, pointToLatLng, type GeoPoint, type LatLngLiteral } from './geo';

export interface LocationPickerMapProps {
  value: GeoPoint | null;
  onChange: (point: GeoPoint) => void;
  height: number;
  label: string;
  disabled?: boolean;
}

/** Accent dot marker as a divIcon (no image assets, so Leaflet's default icon paths never matter). */
const pinIcon = L.divIcon({
  className: 'es-pin',
  html: '<span class="block size-4 rounded-pill border-2 border-surface bg-accent-strong shadow-sm"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function ClickToPick({ onPick, disabled }: { onPick: (ll: LatLngLiteral) => void; disabled?: boolean }) {
  useMapEvents({
    click(e) {
      if (!disabled) onPick(e.latlng);
    },
  });
  return null;
}

/** Pans to the value when it changes from outside (typed coordinates) and is off screen. */
function FollowValue({ value }: { value: GeoPoint | null }) {
  const map = useMap();
  useEffect(() => {
    if (!value) return;
    const ll = pointToLatLng(value);
    if (!map.getBounds().contains(ll)) map.panTo(ll);
  }, [map, value]);
  return null;
}

export default function LocationPickerMap({ value, onChange, height, label, disabled }: LocationPickerMapProps) {
  const mapRef = useRef<LeafletMap | null>(null);
  const position = value ? pointToLatLng(value) : null;
  const [initialCenter] = useState(() => position ?? DEFAULT_CENTER);
  const handlers = useMemo(
    () => ({
      dragend(e: L.LeafletEvent) {
        onChange(latLngToPoint((e.target as L.Marker).getLatLng()));
      },
    }),
    [onChange],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-lg border border-border" role="group" aria-label={label}>
        <MapContainer
          ref={mapRef}
          center={initialCenter}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom={false}
          style={{ height, width: '100%' }}
          className="cursor-crosshair"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickToPick onPick={(ll) => onChange(latLngToPoint(ll))} disabled={disabled} />
          <FollowValue value={value} />
          {position ? (
            <Marker position={position} icon={pinIcon} draggable={!disabled} eventHandlers={handlers} keyboard title="Selected location" />
          ) : null}
        </MapContainer>
      </div>
      <div>
        <Button
          size="sm"
          icon="map-pin"
          disabled={disabled}
          onClick={() => {
            const c = mapRef.current?.getCenter();
            if (c) onChange(latLngToPoint(c));
          }}
        >
          Pin Map Centre
        </Button>
      </div>
    </div>
  );
}
