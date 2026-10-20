import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './icon';

/** Shared control look: h-control-md, border-control, xs shadow, focus ring from the base layer. */
export const controlClasses =
  'w-full min-w-0 rounded-md border border-border-control bg-surface px-2.5 text-body text-ink shadow-xs transition-colors duration-120 ease-out ' +
  'placeholder:text-ink-subtle disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger read-only:bg-surface-sunken';

export interface InputProps extends Omit<ComponentProps<'input'>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  /** Monospace for codes, times and numbers. */
  mono?: boolean;
}

export function Input({ className, size = 'md', mono, type = 'text', ...rest }: InputProps) {
  return (
    <input
      type={type}
      {...rest}
      className={cn(
        controlClasses,
        size === 'sm' ? 'h-control-sm text-body-sm' : size === 'lg' ? 'h-control-lg' : 'h-control-md',
        mono && 'font-mono tabular-nums',
        className,
      )}
    />
  );
}

export function Textarea({ className, rows = 4, ...rest }: ComponentProps<'textarea'>) {
  return <textarea rows={rows} {...rest} className={cn(controlClasses, 'min-h-20 py-2 leading-5', className)} />;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentProps<'select'>, 'size'> {
  options?: readonly SelectOption[];
  /** Adds a first empty option with this text (value ""). */
  placeholder?: string;
  size?: 'sm' | 'md';
}

/** Native select restyled; pass `options` or <option> children. */
export function Select({ options, placeholder, className, size = 'md', children, ...rest }: SelectProps) {
  return (
    <span className={cn('relative block min-w-0', className)}>
      <select
        {...rest}
        className={cn(controlClasses, 'cursor-pointer appearance-none pr-8', size === 'sm' ? 'h-control-sm text-body-sm' : 'h-control-md')}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <Icon name="chevron-down" size={16} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-muted" />
    </span>
  );
}

export interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
}

/** Native checkbox with label and optional description. */
export function Checkbox({ label, description, className, id, ...rest }: CheckboxProps) {
  return (
    <label htmlFor={id} className={cn('flex cursor-pointer items-start gap-2.5 text-body text-ink has-disabled:cursor-not-allowed has-disabled:opacity-50', className)}>
      <input id={id} type="checkbox" {...rest} className="mt-0.5 size-4 flex-none cursor-pointer accent-accent-strong disabled:cursor-not-allowed" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>{label}</span>
        {description ? <span className="text-body-sm text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}

export interface SwitchProps extends Omit<ComponentProps<'button'>, 'onChange' | 'value' | 'children'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Visible label; also the accessible name. */
  label?: ReactNode;
}

/** On/off toggle (role="switch"). Controlled. */
export function Switch({ checked, onCheckedChange, label, className, disabled, id, ...rest }: SwitchProps) {
  const button = (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      {...rest}
      className={cn(
        'relative inline-flex h-5 w-9 flex-none cursor-pointer items-center rounded-pill border border-transparent transition-colors duration-120 ease-out',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent-strong' : 'bg-border-strong',
        !label && className,
      )}
    >
      <span
        aria-hidden
        className={cn('block size-4 rounded-pill bg-surface shadow-xs transition-transform duration-120 ease-out', checked ? 'translate-x-4.25' : 'translate-x-0.25')}
      />
    </button>
  );
  if (!label) return button;
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2.5 text-body text-ink', className)}>
      {button}
      <span>{label}</span>
    </label>
  );
}

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Group name for the native radios. */
  name: string;
  /** Legend; required for accessibility (use `hideLegend` to hide it visually). */
  legend: ReactNode;
  hideLegend?: boolean;
  options: readonly RadioOption[];
  value: string | undefined;
  onValueChange: (value: string) => void;
  orientation?: 'vertical' | 'horizontal';
  /** Error message id to link via aria-describedby. */
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Native radios in a fieldset. Controlled. */
export function RadioGroup({ name, legend, hideLegend, options, value, onValueChange, orientation = 'vertical', describedBy, invalid, disabled, className }: RadioGroupProps) {
  return (
    <fieldset className={cn('m-0 min-w-0 border-0 p-0', className)} aria-describedby={describedBy} aria-invalid={invalid || undefined} disabled={disabled}>
      <legend className={cn('mb-1.5 p-0 text-body-sm font-medium text-ink', hideLegend && 'sr-only')}>{legend}</legend>
      <div className={cn('flex gap-2.5', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap gap-x-5')}>
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-start gap-2.5 text-body text-ink has-disabled:cursor-not-allowed has-disabled:opacity-50">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={o.disabled}
              onChange={() => onValueChange(o.value)}
              className="mt-0.5 size-4 flex-none cursor-pointer accent-accent-strong"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span>{o.label}</span>
              {o.description ? <span className="text-body-sm text-ink-muted">{o.description}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export interface SearchFieldProps extends Omit<ComponentProps<'input'>, 'type' | 'size'> {
  id: string;
  /** Keyboard hint shown on the right, e.g. "⌘K". Wire the shortcut in the page. */
  shortcut?: string;
  /** Accessible name; defaults to "Search". */
  label?: string;
  size?: 'sm' | 'md';
}

/** Compact mono search input with a leading icon and an optional keyboard hint. */
export function SearchField({ id, placeholder = 'Search', shortcut, label = 'Search', className, size = 'md', ...rest }: SearchFieldProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-text items-center gap-2 rounded-md border border-border-control bg-surface px-2.5 font-mono text-data text-ink-subtle shadow-xs',
        'focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus',
        size === 'sm' ? 'h-control-sm' : 'h-control-md',
        className,
      )}
    >
      <Icon name="search" size={16} />
      <input
        id={id}
        type="search"
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        {...rest}
        className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-ink outline-none placeholder:text-ink-subtle focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </label>
  );
}

/** Keyboard key hint. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('font-mono text-delta font-normal text-ink-subtle', className)}>{children}</kbd>;
}
