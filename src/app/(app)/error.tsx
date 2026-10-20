'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/layout';

/** Segment error boundary for the signed-in app. `retry` re-fetches and re-renders the segment (Next 16.3+). */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Digest only: messages from server components are already redacted by Next.
    const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
    console.error('page.error', digest ?? '');
  }, [error]);

  return (
    <div className="flex flex-col">
      <PageHeader title="Something Went Wrong" description="This page could not load. Your data is safe." />
      <ErrorState
        message="We could not load this page. Try again, and if it keeps happening, contact your Administrator."
        onRetry={retry}
      />
    </div>
  );
}
