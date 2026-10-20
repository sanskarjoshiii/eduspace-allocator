'use client';

import { useState, type ReactNode } from 'react';
import { Alert, ConfirmDialog } from '@/components/ui';
import { errorMessage } from '@/components/ui';

export interface ActionConfirmProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  /** Runs the action. A thrown error keeps the dialog open and shows the message inside it. */
  action: () => Promise<unknown>;
  /** Turns an API error into the sentence shown in the dialog. */
  formatError?: (err: unknown) => string;
}

/** ConfirmDialog that shows the API's error inline (409 references, "cannot suspend yourself"). */
export function ActionConfirm({ open, onClose, title, description, confirmLabel, tone = 'primary', action, formatError }: ActionConfirmProps) {
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setError(null);
    onClose();
  };
  return (
    <ConfirmDialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={tone}
      onConfirm={async () => {
        setError(null);
        try {
          await action();
        } catch (err) {
          setError(formatError ? formatError(err) : errorMessage(err, 'That did not work. Try again in a moment.'));
          throw err;
        }
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </ConfirmDialog>
  );
}
