import type { ReactNode } from 'react';
import { ALLOCATION_LABEL, STATUS_TONE, type AllocationStatus } from '@/lib/domain';
import { cn } from './cn';
import { renderIcon, type IconInput } from './icon';
import { TONE_TINT, type Tone } from './tone';

export interface BadgeProps {
  tone?: Tone;
  /** Adds a leading dot for live or changing states. */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

/** The status of one record, in a word, on a tinted ground. Never without a word. */
export function Badge({ tone = 'neutral', dot = false, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5.5 items-center gap-1.5 rounded-sm px-2 font-mono text-delta leading-none whitespace-nowrap',
        TONE_TINT[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className="size-1.5 rounded-pill bg-current" /> : null}
      {children}
    </span>
  );
}

/** Human label for a status value: allocation statuses use ALLOCATION_LABEL; camel case is split. */
export function statusLabel(status: string): string {
  if (status in ALLOCATION_LABEL) return ALLOCATION_LABEL[status as AllocationStatus];
  if (status === 'PendingApproval') return 'Pending approval';
  // "NeedsReallocation" -> "Needs reallocation"
  const words = status.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
  return words.map((w, i) => (i === 0 ? w : w.toLowerCase())).join(' ');
}

export interface StatusBadgeProps {
  /** A status value from src/lib/domain.ts, e.g. "Offered", "ApprovedBySpace", "High". */
  status: string;
  /** Override the tone from STATUS_TONE (e.g. facility issue "Open" is warning). */
  tone?: Tone;
  /** Override the label. */
  label?: string;
  dot?: boolean;
  className?: string;
}

/** Badge whose tone and word come from the domain status vocabulary. */
export function StatusBadge({ status, tone, label, dot, className }: StatusBadgeProps) {
  return (
    <Badge tone={tone ?? STATUS_TONE[status] ?? 'neutral'} dot={dot ?? status === 'Running'} className={className}>
      {label ?? statusLabel(status)}
    </Badge>
  );
}

export interface TagProps {
  tone?: Tone;
  icon?: IconInput;
  /** Sits on top of a card like a folder tab; the card drops its top-left radius. */
  attached?: boolean;
  className?: string;
  children: ReactNode;
}

/** Uppercase mono label naming the category of a whole card (demand level, course category). */
export function Tag({ tone = 'accent', icon, attached = false, className, children }: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-label uppercase leading-none whitespace-nowrap',
        attached ? 'h-6.5 rounded-t-md rounded-b-none px-2.5' : 'h-6 rounded-sm px-2',
        TONE_TINT[tone],
        className,
      )}
    >
      {renderIcon(icon, 14)}
      {children}
    </span>
  );
}
