import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn';

/** Props a Field hands to its control so label, hint and error are wired for assistive tech. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
}

export interface FieldProps {
  label: ReactNode;
  /** One sentence under the control in ink-muted. */
  hint?: ReactNode;
  /** Error message (e.g. RHF fieldState.error?.message). */
  error?: string;
  required?: boolean;
  /** Mark "Optional" next to the label. */
  optional?: boolean;
  /** Control id; generated when omitted. */
  id?: string;
  className?: string;
  /** A single control element (cloned with id/aria props) or a render function. */
  children: ReactElement<FieldControlProps> | ((props: FieldControlProps) => ReactNode);
}

export function Label({ htmlFor, children, className }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('text-body-sm font-medium text-ink', className)}>
      {children}
    </label>
  );
}

export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="m-0 text-body-sm text-danger-ink">
      {children}
    </p>
  );
}

/** Label + control + hint + error with ids wired (aria-describedby / aria-invalid). */
export function Field({ label, hint, error, required, optional, id, className, children }: FieldProps) {
  const auto = useId();
  const controlId = id ?? `f${auto}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const controlProps: FieldControlProps = {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    'aria-required': required || undefined,
  };
  const control =
    typeof children === 'function' ? children(controlProps) : isValidElement(children) ? cloneElement(children, controlProps) : children;

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={controlId}>
          {label}
          {required ? (
            <span aria-hidden className="ml-0.5 text-danger-ink">
              *
            </span>
          ) : null}
        </Label>
        {optional ? <span className="font-mono text-delta text-ink-subtle">Optional</span> : null}
      </div>
      {control}
      {hint ? (
        <p id={hintId} className="m-0 text-body-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}
