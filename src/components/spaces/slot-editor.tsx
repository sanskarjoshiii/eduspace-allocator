'use client';

import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Switch } from '@/components/ui';
import { WindowEditor, type WeeklyWindow } from '@/components/forms';
import { formatWindow } from '@/lib/format';

export interface SlotRow extends WeeklyWindow {
  id?: string;
  isBlocked?: boolean;
}

function rowMessages(err: unknown): Record<number, string | undefined> {
  const out: Record<number, string | undefined> = {};
  if (!err || typeof err !== 'object') return out;
  for (const [k, v] of Object.entries(err as Record<string, unknown>)) {
    const i = Number(k);
    if (!Number.isInteger(i) || !v || typeof v !== 'object') continue;
    const row = v as Record<string, { message?: string } | undefined> & { message?: string };
    out[i] = row.message ?? row.endTime?.message ?? row.startTime?.message ?? row.dayOfWeek?.message;
  }
  return out;
}

/**
 * Weekly slots of a space: the shared WindowEditor for day and times, plus a "Blocked" switch per slot.
 * WindowEditor keeps extra fields on each row, so slot ids and blocked flags survive edits.
 */
export function FormSlotEditor<T extends FieldValues, N extends FieldPath<T>, TOut = T>({
  control, name, disabled,
}: {
  control: Control<T, unknown, TOut>;
  name: N;
  disabled?: boolean;
}) {
  const { field, fieldState } = useController({ control, name, disabled });
  const slots = (field.value as SlotRow[] | undefined) ?? [];
  const err = fieldState.error as (Record<string, unknown> & { message?: string; root?: { message?: string } }) | undefined;

  return (
    <div className="flex flex-col gap-4">
      <WindowEditor
        label="Weekly Slots"
        hint="The days and times the space can host classes. Slots on the same day cannot overlap."
        value={slots}
        onChange={(next) => field.onChange(next as SlotRow[])}
        onBlur={field.onBlur}
        rowErrors={rowMessages(err)}
        error={err?.message ?? err?.root?.message}
        newWindow={{ dayOfWeek: 6, startTime: '10:00', endTime: '13:00' }}
        max={100}
        disabled={field.disabled}
      />
      {slots.length > 0 ? (
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={field.disabled}>
          <legend className="mb-1 p-0 text-body-sm font-medium text-ink">Blocked Slots</legend>
          <p className="m-0 -mt-1 text-body-sm text-ink-muted">A blocked slot stays on your schedule but Smart Allocation will not book it.</p>
          <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-lg border border-border p-0">
            {slots.map((s, i) => (
              <li key={s.id ?? `new-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="font-mono text-data tabular-nums text-ink">{formatWindow(s)}</span>
                <Switch
                  checked={Boolean(s.isBlocked)}
                  onCheckedChange={(v) => field.onChange(slots.map((x, j) => (j === i ? { ...x, isBlocked: v } : x)))}
                  label="Blocked"
                  aria-label={`Block ${formatWindow(s)}`}
                />
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
    </div>
  );
}
