'use client';

import { useId } from 'react';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Button, EmptyState, IconButton, Input, Select } from '@/components/ui';
import type { FacilityTypeOption } from './lookup-helpers';

export interface FacilityRow {
  facilityTypeId: string;
  quantity: number;
  workingQuantity: number;
}

type RowError = { message?: string; facilityTypeId?: { message?: string }; quantity?: { message?: string }; workingQuantity?: { message?: string } };

/** Per-row problems found in the browser: working quantity above quantity, a type listed twice, no type. */
export function facilityRowProblems(rows: readonly FacilityRow[]): Record<number, string> {
  const out: Record<number, string> = {};
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    if (!r.facilityTypeId) out[i] = 'Choose a facility type.';
    else if (seen.has(r.facilityTypeId)) out[i] = 'This facility type is already listed.';
    else if (!Number.isFinite(r.quantity) || r.quantity < 0) out[i] = 'Enter a quantity of 0 or more.';
    else if (!Number.isFinite(r.workingQuantity) || r.workingQuantity < 0) out[i] = 'Enter a working quantity of 0 or more.';
    else if (r.workingQuantity > r.quantity) out[i] = 'Working quantity cannot exceed quantity.';
    if (r.facilityTypeId && !seen.has(r.facilityTypeId)) seen.set(r.facilityTypeId, i);
  });
  return out;
}

const toInt = (v: string) => (v === '' ? Number.NaN : Math.trunc(Number(v)));

/** Facilities of a space: type, quantity, working quantity. Bound to a `facilities` array field. */
export function FormFacilitiesEditor<T extends FieldValues, N extends FieldPath<T>, TOut = T>({
  control, name, facilityTypes, disabled,
}: {
  control: Control<T, unknown, TOut>;
  name: N;
  facilityTypes: readonly FacilityTypeOption[];
  disabled?: boolean;
}) {
  const id = useId();
  const { field, fieldState } = useController({ control, name, disabled });
  const rows = ((field.value as FacilityRow[] | undefined) ?? []).map((r) => ({ ...r }));
  const local = facilityRowProblems(rows);
  const err = fieldState.error as (Record<string, RowError | undefined> & { message?: string; root?: { message?: string } }) | undefined;
  const options = facilityTypes.map((f) => ({ value: f.id, label: f.unit ? `${f.name} (${f.unit})` : f.name }));

  const set = (next: FacilityRow[]) => field.onChange(next);
  const update = (i: number, patch: Partial<FacilityRow>) => set(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const unused = facilityTypes.find((f) => !rows.some((r) => r.facilityTypeId === f.id));

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={disabled} onBlur={field.onBlur}>
      <legend className="mb-1 p-0 text-body-sm font-medium text-ink">Facilities</legend>
      <p className="m-0 -mt-1 text-body-sm text-ink-muted">List what the space has and how many are in working order today.</p>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong">
          <EmptyState icon="list-checks" description="No facilities yet. Add the equipment learners can use here." size="compact" />
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          <li aria-hidden className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 font-mono text-delta text-ink-subtle max-sm:hidden">
            <span>Facility</span>
            <span>Quantity</span>
            <span>Working</span>
            <span className="w-control-md" />
          </li>
          {rows.map((r, i) => {
            const e = err?.[i];
            const msg = local[i] ?? e?.message ?? e?.workingQuantity?.message ?? e?.quantity?.message ?? e?.facilityTypeId?.message;
            const errId = `${id}-row-${i}`;
            const described = msg ? { 'aria-invalid': true as const, 'aria-describedby': errId } : {};
            return (
              <li key={i} className="flex flex-col gap-1.5">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div className="col-span-3 min-w-0 sm:col-span-1">
                    <Select
                      aria-label={`Facility ${i + 1} type`}
                      placeholder="Choose a facility"
                      options={options.map((o) => ({ ...o, disabled: o.value !== r.facilityTypeId && rows.some((x) => x.facilityTypeId === o.value) }))}
                      value={r.facilityTypeId}
                      onChange={(ev) => update(i, { facilityTypeId: ev.target.value })}
                      {...described}
                    />
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    mono
                    aria-label={`Facility ${i + 1} quantity`}
                    value={Number.isFinite(r.quantity) ? String(r.quantity) : ''}
                    onChange={(ev) => update(i, { quantity: toInt(ev.target.value) })}
                    {...described}
                  />
                  <Input
                    type="number"
                    min={0}
                    max={Number.isFinite(r.quantity) ? r.quantity : undefined}
                    step={1}
                    inputMode="numeric"
                    mono
                    aria-label={`Facility ${i + 1} working quantity`}
                    value={Number.isFinite(r.workingQuantity) ? String(r.workingQuantity) : ''}
                    onChange={(ev) => update(i, { workingQuantity: toInt(ev.target.value) })}
                    {...described}
                  />
                  <IconButton icon="trash-2" label={`Remove facility ${i + 1}`} size="md" onClick={() => set(rows.filter((_, j) => j !== i))} />
                </div>
                {msg ? (
                  <p id={errId} className="m-0 text-body-sm text-danger-ink">
                    {msg}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          icon="plus"
          disabled={disabled || !unused}
          onClick={() => set([...rows, { facilityTypeId: unused?.id ?? '', quantity: 1, workingQuantity: 1 }])}
        >
          Add Facility
        </Button>
        {err?.message ?? err?.root?.message ? <p className="m-0 text-body-sm text-danger-ink">{err?.message ?? err?.root?.message}</p> : null}
      </div>
    </fieldset>
  );
}
