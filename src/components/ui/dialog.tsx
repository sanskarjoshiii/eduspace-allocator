'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './button';
import { cn } from './cn';
import { IconButton } from './button';

/** Opens/closes a native <dialog> as a modal in step with `open`. */
function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return ref;
}

export interface DialogProps {
  open: boolean;
  /** Called on Esc, the close button, a backdrop click (when dismissible) and footer cancel actions. */
  onClose: () => void;
  title: ReactNode;
  /** One sentence under the title. */
  description?: ReactNode;
  /** Footer actions, right aligned: ghost Cancel, then the primary action. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** When false, Esc and backdrop clicks do nothing (e.g. while saving). */
  dismissible?: boolean;
  className?: string;
  children?: ReactNode;
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' } as const;

/**
 * Accessible modal on the native <dialog> element: showModal() makes the rest of the page
 * inert (focus stays inside), Esc closes, focus returns to the opener on close.
 */
export function Dialog({ open, onClose, title, description, footer, size = 'md', dismissible = true, className, children }: DialogProps) {
  const ref = useModal(open);
  const titleId = useId();
  const descId = useId();

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        // A click on the dialog element itself (not its content) is a backdrop click.
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
      className={cn(
        'm-auto w-[calc(100%-32px)] rounded-xl border border-border bg-surface p-0 text-ink shadow-sm backdrop:bg-backdrop/75',
        SIZES[size],
        className,
      )}
    >
      {open ? (
        <div className="flex max-h-[calc(100dvh-64px)] flex-col">
          <header className="flex items-start gap-3 px-5 pt-5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 id={titleId} className="m-0 text-title text-ink">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="m-0 text-body-sm text-ink-muted">
                  {description}
                </p>
              ) : null}
            </div>
            {dismissible ? <IconButton icon="x" label="Close" onClick={onClose} className="-mt-1 -mr-1" /> : null}
          </header>
          {children ? <div className="min-h-0 overflow-y-auto px-5 pt-4 pb-1">{children}</div> : null}
          <footer className="flex flex-wrap items-center justify-end gap-2 px-5 pt-4 pb-5">{footer}</footer>
        </div>
      ) : null}
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** May return a promise; the dialog shows a loading state and closes when it settles without throwing. */
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` for destructive actions (Cancel Allocation, Delete Space). */
  tone?: 'primary' | 'danger';
  children?: ReactNode;
}

/** Built-in confirmation (window.confirm is not allowed). */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary', children }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // The caller reports errors (toast or inline); keep the dialog open.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={run} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
}

/**
 * Promise-based confirmation. Render `dialog` once in the component:
 *   const { confirm, dialog } = useConfirm();
 *   if (await confirm({ title: 'Cancel Allocation?', tone: 'danger' })) ...
 */
export function useConfirm() {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ ...opts, resolve });
      }),
    [],
  );
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  const dialog = (
    <Dialog
      open={state !== null}
      onClose={() => close(false)}
      title={state?.title ?? ''}
      description={state?.description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            {state?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button variant={state?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)}>
            {state?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    />
  );
  return { confirm, dialog };
}

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the drawer. */
  label: string;
  side?: 'left' | 'right';
  className?: string;
  children: ReactNode;
}

/** Slide-over sheet on a native <dialog> (mobile navigation, filters). */
export function Drawer({ open, onClose, label, side = 'left', className, children }: DrawerProps) {
  const ref = useModal(open);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={cn(
        'fixed top-0 m-0 h-dvh max-h-dvh w-sidebar max-w-[85vw] border-0 bg-surface-sunken p-0 text-ink shadow-sm backdrop:bg-backdrop/75',
        side === 'left' ? 'left-0 border-r border-border' : 'right-0 left-auto border-l border-border',
        className,
      )}
    >
      {open ? children : null}
    </dialog>
  );
}
