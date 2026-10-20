'use client';

import { useEffect } from 'react';

/** Reports a form's submitting state to the dialog that owns the submit button (it lives in the footer, outside the form). */
export function useReportSubmitting(isSubmitting: boolean, onChange?: (submitting: boolean) => void): void {
  useEffect(() => {
    onChange?.(isSubmitting);
  }, [isSubmitting, onChange]);
}
