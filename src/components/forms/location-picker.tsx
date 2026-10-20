'use client';

import dynamic from 'next/dynamic';
import { useId, useState, type ReactNode } from 'react';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { cn } from '@/components/ui/cn';
import { Input } from '@/components/ui/inputs';
import { Skeleton } from '@/components/ui/skeleton';
import { latLngToPoint, pointToLatLng, type GeoPoint } from './geo';

const LocationPickerMap = dynamic(() => import('./location-picker-map'), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-60 w-full rounded-lg" />,
});

export interface LocationPickerProps {
  /** GeoJSON point, coordinates [lng, lat]. */
  value: GeoPoint | null | undefined;
  onChange: (point: GeoPoint) => void;
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  /** Map height in px; default 280. */
  height?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * Pick a point on an OpenStreetMap map (click, or drag the pin) or type the coordinates.
 * Emits GeoJSON { type: 'Point', coordinates: [lng, lat] }. Default centre: Pune, zoom 12.
 */
export function LocationPicker({ value, onChange, label = 'Location', hint, error, height = 280, disabled, className }: LocationPickerProps) {
  const id = useId();
  const current = value ? pointToLatLng(value) : null;
  // Draft text for the coordinate inputs; re-synced whenever the point changes.
  const [draft, setDraft] = useState<{ key: string; lat: string; lng: string }>({ key: '', lat: '', lng: '' });
  const key = current ? `${current.lat},${current.lng}` : '';
  const shown = draft.key === key ? draft : { key, lat: current ? String(current.lat) : '', lng: current ? String(current.lng) : '' };

  const commit = (lat: string, lng: string) => {
    setDraft({ key, lat, lng });
    const la = Number(lat);
    const ln = Number(lng);
    if (lat.trim() && lng.trim() && Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) {
      onChange(latLngToPoint({ lat: la, lng: ln }));
    }
  };

  const errId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <fieldset className={cn('m-0 flex min-w-0 flex-col gap-2 border-0 p-0', className)} disabled={disabled} aria-describedby={[hint ? hintId : '', error ? errId : ''].join(' ').trim() || undefined}>
      <legend className="mb-1.5 p-0 text-body-sm font-medium text-ink">{label}</legend>
      {hint ? (
        <p id={hintId} className="m-0 -mt-1 text-body-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      <div style={{ minHeight: height }}>
        <LocationPickerMap value={value ?? null} onChange={onChange} height={height} label="Map: click to place the pin, or drag it" disabled={disabled} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-delta text-ink-subtle">Latitude</span>
          <Input mono inputMode="decimal" value={shown.lat} placeholder="18.5204" onChange={(e) => commit(e.target.value, shown.lng)} aria-invalid={error ? true : undefined} />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-delta text-ink-subtle">Longitude</span>
          <Input mono inputMode="decimal" value={shown.lng} placeholder="73.8567" onChange={(e) => commit(shown.lat, e.target.value)} aria-invalid={error ? true : undefined} />
        </label>
      </div>
      {error ? (
        <p id={errId} className="m-0 text-body-sm text-danger-ink">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** LocationPicker bound to a PointInput field of a react-hook-form form. */
export function FormLocationPicker<T extends FieldValues, N extends FieldPath<T>, TOut = T>({
  control, name, label, hint, height, disabled, className,
}: {
  control: Control<T, unknown, TOut>;
  name: N;
  label?: ReactNode;
  hint?: ReactNode;
  height?: number;
  disabled?: boolean;
  className?: string;
}) {
  const { field, fieldState } = useController({ control, name, disabled });
  const err = fieldState.error as ({ message?: string } & { coordinates?: { message?: string } }) | undefined;
  return (
    <LocationPicker
      value={field.value as GeoPoint | null | undefined}
      onChange={(p) => {
        field.onChange(p);
        field.onBlur();
      }}
      label={label}
      hint={hint}
      height={height}
      disabled={field.disabled}
      error={err?.message ?? err?.coordinates?.message}
      className={className}
    />
  );
}
