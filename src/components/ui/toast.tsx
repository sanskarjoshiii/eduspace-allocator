'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './button';
import { cn } from './cn';
import { TONE_FILL } from './tone';

export type ToastTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger';

export interface ToastOptions {
  tone?: ToastTone;
  /** Optional second line. */
  description?: string;
  /** Milliseconds; default 4000. */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, 'tone'>> {
  id: number;
  message: string;
  description?: string;
}

export interface ToastApi {
  /** Short status message such as "Saved". */
  toast: (message: string, options?: ToastOptions) => void;
  success: (message: string, options?: Omit<ToastOptions, 'tone'>) => void;
  error: (message: string, options?: Omit<ToastOptions, 'tone'>) => void;
  dismiss: (id: number) => void;
}

const noop: ToastApi = { toast: () => {}, success: () => {}, error: () => {}, dismiss: () => {} };
const ToastContext = createContext<ToastApi | null>(null);

/** Access the toast API. Outside a ToastProvider it is a no-op. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? noop;
}

const DOT: Record<ToastTone, string> = {
  neutral: TONE_FILL.neutral,
  success: TONE_FILL.success,
  info: TONE_FILL.info,
  warning: TONE_FILL.warning,
  danger: TONE_FILL.danger,
};

/** Mount once near the root of a layout. Toasts stack bottom-right (bottom-centre on phones). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (message: string, options: ToastOptions = {}) => {
      seq.current += 1;
      const id = seq.current;
      setItems((list) => [...list.slice(-3), { id, message, description: options.description, tone: options.tone ?? 'neutral' }]);
      window.setTimeout(() => dismiss(id), options.duration ?? 4000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (m, o) => toast(m, { ...o, tone: 'success' }),
      error: (m, o) => toast(m, { ...o, tone: 'danger', duration: o?.duration ?? 6000 }),
      dismiss,
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border border-border bg-surface py-2.5 pr-1.5 pl-3 text-ink shadow-sm"
          >
            <span aria-hidden className={cn('mt-1.5 size-2 flex-none rounded-pill', DOT[t.tone])} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
              <p className="m-0 text-body font-medium">{t.message}</p>
              {t.description ? <p className="m-0 text-body-sm text-ink-muted">{t.description}</p> : null}
            </div>
            <IconButton icon="x" label="Dismiss" onClick={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
