'use client';

import { useId, useMemo, type ReactNode } from 'react';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Button, IconButton } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { EmptyState } from '@/components/ui/feedback';
import { Select } from '@/components/ui/inputs';
import { DAY_LONG, DAY_SHORT } from '@/lib/domain';
import { findWindowProblems, timeOptions, type WeeklyWindow } from './window-utils';

export interface WindowEditorProps {
  value: WeeklyWindow[];
  onChange: (next: WeeklyWindow[]) => void;
  /** Group label, e.g. "Available Slots". */
  label?: ReactNode;
  hint?: ReactNode;
  /** Server/schema errors per row (index -> message); shown when there is no local problem. */
  rowErrors?: Record<number, string | undefined>;
  /** Error for the whole list (e.g. "Add at least one slot"). */
  error?: string;
  /** Minutes between time options; default 30. */
  step?: number;
  /** Window added by "Add Slot". */
  newWindow?: WeeklyWindow;
  max?: number;
  disabled?: boolean;
  onBlur?: () => void;
  className?: string;
}

const DAY_OPTIONS = DAY_SHORT.map((d, i) => ({ value: String(i), label: DAY_LONG[i] ?? d }));

/** Edits weekly windows: day (Sun–Sat), 24-hour start and end, add/remove, overlap errors. */
export function WindowEditor({
  value, onChange, label = 'Weekly Slots', hint, rowErrors, error, step = 30,
  newWindow = { dayOfWeek: 6, startTime: '10:00', endTime: '13:00' }, max = 21, disabled, onBlur, className,
}: WindowEditorProps) {
  const id = useId();
  const times = useMemo(() => timeOptions(step).map((t) => ({ value: t, label: t })), [step]);
  const problems = useMemo(() => findWindowProblems(value), [value]);

  const update = (i: number, patch: Partial<WeeklyWindow>) => onChange(value.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = () => onChange([...value, { ...newWindow }]);

  // Keep values that are not on the step grid selectable.
  const optionsFor = (t: string) => (times.some((o) => o.value === t) || !t ? times : [{ value: t, label: t }, ...times]);

  return (
    <fieldset className={cn('m-0 flex min-w-0 flex-col gap-3 border-0 p-0', className)} disabled={disabled} onBlur={onBlur}>
      <legend className="mb-1 p-0 text-body-sm font-medium text-ink">{label}</legend>
      {hint ? <p className="m-0 -mt-1 text-body-sm text-ink-muted">{hint}</p> : null}

      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong">
          <EmptyState icon="calendar" description="No slots yet. Add the days and times this is available." size="compact" />
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          <li aria-hidden className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 font-mono text-delta text-ink-subtle max-sm:hidden">
            <span>Day</span>
            <span>Start</span>
            <span>End</span>
            <span className="w-control-md" />
          </li>
          {value.map((w, i) => {
            const msg = problems[i] ?? rowErrors?.[i];
            const errId = `${id}-row-${i}-error`;
            return (
              <li key={i} className="flex flex-col gap-1.5">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div className="col-span-3 min-w-0 sm:col-span-1">
                    <Select
                      aria-label={`Slot ${i + 1} day`}
                      options={DAY_OPTIONS}
                      value={String(w.dayOfWeek)}
                      onChange={(e) => update(i, { dayOfWeek: Number(e.target.value) })}
                      aria-invalid={msg ? true : undefined}
                      aria-describedby={msg ? errId : undefined}
                    />
                  </div>
                  <div className="min-w-0">
                    <Select
                      aria-label={`Slot ${i + 1} start time`}
                      options={optionsFor(w.startTime)}
                      value={w.startTime}
                      onChange={(e) => update(i, { startTime: e.target.value })}
                      className="font-mono tabular-nums"
                      aria-invalid={msg ? true : undefined}
                      aria-describedby={msg ? errId : undefined}
                    />
                  </div>
                  <div className="min-w-0">
                    <Select
                      aria-label={`Slot ${i + 1} end time`}
                      options={optionsFor(w.endTime)}
                      value={w.endTime}
                      onChange={(e) => update(i, { endTime: e.target.value })}
                      className="font-mono tabular-nums"
                      aria-invalid={msg ? true : undefined}
                      aria-describedby={msg ? errId : undefined}
                    />
                  </div>
                  <IconButton icon="trash-2" label={`Remove slot ${i + 1}`} size="md" onClick={() => remove(i)} />
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
        <Button size="sm" icon="plus" onClick={add} disabled={disabled || value.length >= max}>
          Add Slot
        </Button>
        {error ? <p className="m-0 text-body-sm text-danger-ink">{error}</p> : null}
      </div>
    </fieldset>
  );
}

/** Extracts row-level messages from an RHF array error ({ [i]: { endTime: { message } } }). */
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

/** WindowEditor bound to a `WindowInput[]` field of a react-hook-form form. */
export function FormWindowEditor<T extends FieldValues, N extends FieldPath<T>, TOut = T>({
  control, name, label, hint, step, disabled, className,
}: {
  control: Control<T, unknown, TOut>;
  name: N;
  label?: ReactNode;
  hint?: ReactNode;
  step?: number;
  disabled?: boolean;
  className?: string;
}) {
  const { field, fieldState } = useController({ control, name, disabled });
  const err = fieldState.error as (Record<string, unknown> & { message?: string; root?: { message?: string } }) | undefined;
  return (
    <WindowEditor
      value={(field.value as WeeklyWindow[] | undefined) ?? []}
      onChange={field.onChange}
      onBlur={field.onBlur}
      label={label}
      hint={hint}
      step={step}
      disabled={field.disabled}
      rowErrors={rowMessages(err)}
      error={err?.message ?? err?.root?.message}
      className={className}
    />
  );
}
