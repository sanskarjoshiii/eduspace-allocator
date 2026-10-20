import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { Icon, renderIcon, type IconInput } from './icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const base =
  'inline-flex items-center justify-center rounded-md border border-transparent font-mono leading-none whitespace-nowrap select-none ' +
  'cursor-pointer transition-colors duration-120 ease-out disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent-strong text-on-accent shadow-primary hover:not-disabled:bg-accent-strong-hover',
  secondary: 'bg-surface text-ink border-border-strong shadow-xs hover:not-disabled:bg-surface-sunken',
  ghost: 'bg-transparent text-ink-muted hover:not-disabled:bg-surface-tint hover:not-disabled:text-ink',
  danger: 'bg-surface text-danger-ink border-border-strong shadow-xs hover:not-disabled:bg-danger-tint',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-control-sm px-2.5 gap-1 text-delta',
  md: 'h-control-md px-3.5 gap-1.5 text-control',
};

export function buttonClasses({ variant = 'secondary', size = 'md', className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(base, variants[variant], sizes[size], className);
}

interface ButtonOwnProps {
  /** `primary` once per view; `secondary` for everything else; `ghost` for dismissive actions; `danger` for destructive ones. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon: a lucide name or a node. */
  icon?: IconInput;
  iconRight?: IconInput;
  /** Shows a spinner in place of the icon and disables the button. */
  loading?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
  className?: string;
  children?: ReactNode;
}

export type ButtonAsButtonProps = ButtonOwnProps & Omit<ComponentProps<'button'>, keyof ButtonOwnProps> & { href?: undefined };
export type ButtonAsLinkProps = ButtonOwnProps &
  Omit<ComponentProps<typeof Link>, keyof ButtonOwnProps | 'href'> & { href: string; disabled?: boolean };
export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

function Content({ icon, iconRight, loading, size, children }: Pick<ButtonOwnProps, 'icon' | 'iconRight' | 'loading' | 'size' | 'children'>) {
  const s = size === 'sm' ? 14 : 16;
  return (
    <>
      {loading ? <Icon name="loader-circle" size={s} className="animate-spin" /> : renderIcon(icon, s)}
      {children}
      {renderIcon(iconRight, s)}
    </>
  );
}

/**
 * Runs one action, in mono Title Case. Pass `href` to render a Next Link styled as a button.
 * React 19: `ref` is a regular prop and reaches the element.
 */
export function Button(props: ButtonProps) {
  const { variant = 'secondary', size = 'md', icon, iconRight, loading = false, block = false, className, children } = props;
  const cls = cn(buttonClasses({ variant, size }), block && 'w-full', className);
  const content = (
    <Content icon={icon} iconRight={iconRight} loading={loading} size={size}>
      {children}
    </Content>
  );

  if (props.href !== undefined) {
    const { variant: _v, size: _s, icon: _i, iconRight: _ir, loading: _l, block: _b, className: _c, children: _ch, disabled, href, ...rest } =
      props;
    return (
      <Link
        href={href}
        {...rest}
        className={cls}
        aria-disabled={disabled || loading || undefined}
        tabIndex={disabled ? -1 : rest.tabIndex}
      >
        {content}
      </Link>
    );
  }

  const { variant: _v, size: _s, icon: _i, iconRight: _ir, loading: _l, block: _b, className: _c, children: _ch, type = 'button', disabled, ...rest } =
    props;
  return (
    <button type={type} {...rest} disabled={disabled || loading} aria-busy={loading || undefined} className={cls}>
      {content}
    </button>
  );
}

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon: IconInput;
  /** Accessible name, also shown as the native tooltip. Required. */
  label: string;
  size?: ButtonSize;
}

/** Square borderless button for obvious secondary actions (tray eyebrows, toolbars). */
export function IconButton({ icon, label, size = 'sm', className, type = 'button', title, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      {...rest}
      className={cn(
        'inline-grid flex-none cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-ink-muted transition-colors duration-120 ease-out',
        'hover:not-disabled:bg-surface-tint hover:not-disabled:text-ink disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'size-control-sm' : 'size-control-md',
        className,
      )}
    >
      {renderIcon(icon, 16)}
    </button>
  );
}

export interface ActionTileProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon: IconInput;
  label: string;
  /** Optional one-line description under the label. */
  description?: string;
  /** Selected state for chooser use (sets aria-pressed). */
  selected?: boolean;
}

/** Large icon-over-label button for the 2–4 most common tasks, or a chooser option. */
export function ActionTile({ icon, label, description, selected, className, type = 'button', ...rest }: ActionTileProps) {
  return (
    <button
      type={type}
      aria-pressed={selected === undefined ? undefined : selected}
      {...rest}
      className={cn(
        'flex min-h-18 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-border-strong bg-surface p-3 text-center text-body-sm text-ink shadow-xs',
        'transition-colors duration-120 ease-out hover:not-disabled:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50',
        selected && 'border-accent-strong bg-accent-tint hover:not-disabled:bg-accent-tint',
        className,
      )}
    >
      <span className={cn(selected ? 'text-accent-ink' : 'text-ink')}>{renderIcon(icon, 18)}</span>
      <span className="font-medium">{label}</span>
      {description ? <span className="text-body-sm text-ink-muted">{description}</span> : null}
    </button>
  );
}
