'use client';

import { useId } from 'react';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Button, EmptyState, IconButton, Input, Select } from '@/components/ui';
import type { FacilityTypeOption } from '@/components/spaces/lookup-helpers';

export interface RequirementRow {
  facilityTypeId: string;
  minQuantity: number;
}

type RowError = { message?: string; facilityTypeId?: { message?: string }; minQuantity?: { message?: string } };

/** Per-row problems: missing type, duplicate type, minimum below one. */
export function requirementRowProblems(rows: readonly RequirementRow[]): Record<number, string> {
  const out: Record<number, string> = {};
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    if (!r.facilityTypeId) out[i] = 'Choose a facility type.';
    else if (seen.has(r.facilityTypeId)) out[i] = 'This facility type is already listed.';
    else if (!Number.isFinite(r.minQuantity) || r.minQuantity < 1) out[i] = 'The minimum must be at least 1.';
    if (r.facilityTypeId) seen.add(r.facilityTypeId);
  });
  return out;
}

/** Facilities a course needs: facility type + minimum working quantity. Bound to `requirements`. */
export function FormRequirementsEditor<T extends FieldValues, N extends FieldPath<T>, TOut = T>({
  control, name, facilityTypes, disabled,
}: {
  control: Control<T, unknown, TOut>;
  name: N;
  facilityTypes: readonly FacilityTypeOption[];
  disabled?: boolean;
}) {
  const id = useId();
  const { field, fieldState } = useController({ control, name, disabled });
  const rows = (field.value as RequirementRow[] | undefined) ?? [];
  const local = requirementRowProblems(rows);
  const err = fieldState.error as (Record<string, RowError | undefined> & { message?: string; root?: { message?: string } }) | undefined;
  const options = facilityTypes.map((f) => ({ value: f.id, label: f.unit ? `${f.name} (${f.unit})` : f.name }));
  const set = (next: RequirementRow[]) => field.onChange(next);
  const update = (i: number, patch: Partial<RequirementRow>) => set(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const unused = facilityTypes.find((f) => !rows.some((r) => r.facilityTypeId === f.id));
  const listError = err?.message ?? err?.root?.message;

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={disabled} onBlur={field.onBlur}>
      <legend className="mb-1 p-0 text-body-sm font-medium text-ink">Requirements</legend>
      <p className="m-0 -mt-1 text-body-sm text-ink-muted">Smart Allocation only places this course in spaces with at least these working facilities.</p>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong">
          <EmptyState icon="list-checks" description="No requirements. Any space with enough seats can host this course." size="compact" />
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          <li aria-hidden className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-2 font-mono text-delta text-ink-subtle max-sm:hidden">
            <span>Facility</span>
            <span>Minimum</span>
            <span className="w-control-md" />
          </li>
          {rows.map((r, i) => {
            const e = err?.[i];
            const msg = local[i] ?? e?.message ?? e?.minQuantity?.message ?? e?.facilityTypeId?.message;
            const errId = `${id}-row-${i}`;
            const described = msg ? { 'aria-invalid': true as const, 'aria-describedby': errId } : {};
            return (
              <li key={i} className="flex flex-col gap-1.5">
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] items-center gap-2">
                  <Select
                    aria-label={`Requirement ${i + 1} facility`}
                    placeholder="Choose a facility"
                    options={options.map((o) => ({ ...o, disabled: o.value !== r.facilityTypeId && rows.some((x) => x.facilityTypeId === o.value) }))}
                    value={r.facilityTypeId}
                    onChange={(ev) => update(i, { facilityTypeId: ev.target.value })}
                    {...described}
                  />
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    mono
                    aria-label={`Requirement ${i + 1} minimum quantity`}
                    value={Number.isFinite(r.minQuantity) ? String(r.minQuantity) : ''}
                    onChange={(ev) => update(i, { minQuantity: ev.target.value === '' ? Number.NaN : Math.trunc(Number(ev.target.value)) })}
                    {...described}
                  />
                  <IconButton icon="trash-2" label={`Remove requirement ${i + 1}`} size="md" onClick={() => set(rows.filter((_, j) => j !== i))} />
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
        <Button size="sm" icon="plus" disabled={disabled || !unused} onClick={() => set([...rows, { facilityTypeId: unused?.id ?? '', minQuantity: 1 }])}>
          Add Requirement
        </Button>
        {listError ? <p className="m-0 text-body-sm text-danger-ink">{listError}</p> : null}
      </div>
    </fieldset>
  );
}
