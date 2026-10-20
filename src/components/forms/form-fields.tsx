'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';
import { useController, type Control, type FieldPath, type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';
import { errorMessage } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, RadioGroup, Select, Switch, Textarea, type RadioOption, type SelectOption } from '@/components/ui/inputs';
import { fieldErrors } from '@/lib/api';

/** Common props of every RHF-bound field: pass `control` from useForm and the field `name`. */
export interface FormFieldBaseProps<T extends FieldValues, N extends FieldPath<T>, TOut = T> {
  control: Control<T, unknown, TOut>;
  name: N;
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  className?: string;
}

type InputPassthrough = Omit<ComponentProps<typeof Input>, 'name' | 'value' | 'onChange' | 'onBlur' | 'defaultValue' | 'id' | 'disabled' | 'className'>;

/** Text / email / password / number input bound to RHF. `type="number"` stores a number (empty → undefined). */
export function FormInput<T extends FieldValues, N extends FieldPath<T>, TOut = T>({
  control, name, label, hint, required, optional, disabled, className, type = 'text', ...inputProps
}: FormFieldBaseProps<T, N, TOut> & InputPassthrough) {
  const {
    field: { ref, ...field },
    fieldState,
  } = useController({ control, name, disabled });
  const numeric = type === 'number';
  return (
    <Field label={label} hint={hint} error={fieldState.error?.message} required={required} optional={optional} className={className}>
      <Input
        {...inputProps}
        type={type}
        name={field.name}
        ref={ref}
        disabled={field.disabled}
        value={field.value === undefined || field.value === null || (numeric && Number.isNaN(field.value)) ? '' : String(field.value)}
        onChange={(e) => field.onChange(numeric ? (e.target.value === '' ? undefined : e.target.valueAsNumber) : e.target.value)}
        onBlur={field.onBlur}
      />
    </Field>
  );
}

/** Multi-line text bound to RHF. */
export function FormTextarea<T extends FieldValues, N extends FieldPath<T>, TOut = T>({
  control, name, label, hint, required, optional, disabled, className, rows, placeholder, maxLength,
}: FormFieldBaseProps<T, N, TOut> & { rows?: number; placeholder?: string; maxLength?: number }) {
  const {
    field: { ref, ...field },
    fieldState,
  } = useController({ control, name, disabled });
  return (
    <Field label={label} hint={hint} error={fieldState.error?.message} required={required} optional={optional} className={className}>
      <Textarea
        name={field.name}
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={field.disabled}
        value={(field.value as string | undefined) ?? ''}
        onChange={field.onChange}
        onBlur={field.onBlur}
      />
    </Field>
  );
}

/** Native select bound to RHF. Empty choice stores undefined; pass `parse` for numeric values. */
export function FormSelect<T extends FieldValues, N extends FieldPath<T>, TOut = T>({
  control, name, label, hint, required, optional, disabled, className, options, placeholder, parse,
}: FormFieldBaseProps<T, N, TOut> & { options: readonly SelectOption[]; placeholder?: string; parse?: (value: string) => unknown }) {
  const {
    field: { ref, ...field },
    fieldState,
  } = useController({ control, name, disabled });
  return (
    <Field label={label} hint={hint} error={fieldState.error?.message} required={required} optional={optional} className={className}>
      <Select
        name={field.name}
        ref={ref}
        options={options}
        placeholder={placeholder}
        disabled={field.disabled}
        value={field.value === undefined || field.value === null ? '' : String(field.value)}
        onChange={(e) => field.onChange(e.target.value === '' ? undefined : parse ? parse(e.target.value) : e.target.value)}
        onBlur={field.onBlur}
      />
    </Field>
  );
}

/** Checkbox bound to a boolean field; the error shows under it. */
export function FormCheckbox<T extends FieldValues, N extends FieldPath<T>, TOut = T>({
  control, name, label, hint, disabled, className, description,
}: Omit<FormFieldBaseProps<T, N, TOut>, 'required' | 'optional'> & { description?: ReactNode }) {
  const {
    field: { ref, ...field },
    fieldState,
  } = useController({ control, name, disabled });
  const errId = `${name}-error`;
  return (
    <div className={className}>
      <Checkbox
        id={`cb-${name}`}
        name={field.name}
        ref={ref}
        label={label}
        description={description ?? hint}
        disabled={field.disabled}
        checked={Boolean(field.value)}
        onChange={(e) => field.onChange(e.target.checked)}
        onBlur={field.onBlur}
        aria-invalid={fieldState.error ? true : undefined}
        aria-describedby={fieldState.error ? errId : undefined}
      />
      {fieldState.error ? (
        <p id={errId} className="m-0 mt-1.5 pl-6.5 text-body-sm text-danger-ink">
          {fieldState.error.message}
        </p>
      ) : null}
    </div>
  );
}

/** Switch bound to a boolean field. */
export function FormSwitch<T extends FieldValues, N extends FieldPath<T>, TOut = T>({
  control, name, label, hint, disabled, className,
}: Omit<FormFieldBaseProps<T, N, TOut>, 'required' | 'optional'>) {
  const {
    field: { ref, ...field },
    fieldState,
  } = useController({ control, name, disabled });
  return (
    <div className={className}>
      <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} onBlur={field.onBlur} label={label} disabled={field.disabled} ref={ref} />
      {hint ? <p className="m-0 mt-1 text-body-sm text-ink-muted">{hint}</p> : null}
      {fieldState.error ? <p className="m-0 mt-1 text-body-sm text-danger-ink">{fieldState.error.message}</p> : null}
    </div>
  );
}

/** Radio group bound to a string field. */
export function FormRadioGroup<T extends FieldValues, N extends FieldPath<T>, TOut = T>({
  control, name, label, hint, disabled, className, options, orientation,
}: Omit<FormFieldBaseProps<T, N, TOut>, 'required' | 'optional'> & { options: readonly RadioOption[]; orientation?: 'vertical' | 'horizontal' }) {
  const {
    field: { ref: _ref, ...field },
    fieldState,
  } = useController({ control, name, disabled });
  const errId = `${name}-error`;
  return (
    <div className={className}>
      <RadioGroup
        name={field.name}
        legend={label}
        options={options}
        value={(field.value as string | undefined) ?? undefined}
        onValueChange={field.onChange}
        orientation={orientation}
        disabled={field.disabled}
        invalid={Boolean(fieldState.error)}
        describedBy={fieldState.error ? errId : undefined}
      />
      {hint ? <p className="m-0 mt-1.5 text-body-sm text-ink-muted">{hint}</p> : null}
      {fieldState.error ? (
        <p id={errId} className="m-0 mt-1.5 text-body-sm text-danger-ink">
          {fieldState.error.message}
        </p>
      ) : null}
    </div>
  );
}

/** Splits "a, b ,c" into ["a", "b", "c"]. */
export function splitCommaList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A string[] field edited as comma-separated text (keeps what the user typed, stores the array). */
export function FormCommaList<T extends FieldValues, N extends FieldPath<T>, TOut = T>({
  control, name, label, hint, required, optional, disabled, className, placeholder,
}: FormFieldBaseProps<T, N, TOut> & { placeholder?: string }) {
  const {
    field: { ref, ...field },
    fieldState,
  } = useController({ control, name, disabled });
  const [text, setText] = useState(() => (Array.isArray(field.value) ? (field.value as string[]).join(', ') : ''));
  const err = fieldState.error?.message ?? (fieldState.error as unknown as Record<string, { message?: string }> | undefined)?.[0]?.message;
  return (
    <Field label={label} hint={hint} error={err} required={required} optional={optional} className={className}>
      <Input
        name={field.name}
        ref={ref}
        placeholder={placeholder}
        disabled={field.disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          field.onChange(splitCommaList(e.target.value));
        }}
        onBlur={field.onBlur}
      />
    </Field>
  );
}

/**
 * Maps an API error onto the form: 422 field errors go to their fields, anything else to `root`.
 * Returns true when at least one field error was applied.
 */
export function applyServerErrors<T extends FieldValues>(setError: UseFormSetError<T>, err: unknown): boolean {
  const fields = fieldErrors(err);
  const entries = Object.entries(fields);
  for (const [key, message] of entries) setError(key as Path<T>, { type: 'server', message });
  if (entries.length === 0) setError('root.server' as Path<T>, { type: 'server', message: errorMessage(err, 'Something went wrong. Try again.') });
  return entries.length > 0;
}
