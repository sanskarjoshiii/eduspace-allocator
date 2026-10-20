import Link from 'next/link';
import { SegmentBar } from '@/components/ui/progress';
import { ToastProvider } from '@/components/ui/toast';

/** Split layout for sign in and registration: calm brand panel + form. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col bg-surface-sunken lg:flex-row">
        <aside className="flex flex-col justify-between gap-6 px-4 py-6 sm:px-8 lg:w-[42%] lg:max-w-xl lg:px-12 lg:py-12">
          <Link href="/" className="self-start rounded-xs font-sans text-title text-ink no-underline">
            EduSpace
          </Link>
          <div className="flex flex-col gap-5 max-lg:hidden">
            <p className="m-0 max-w-sm text-figure-lg text-ink">Idle rooms, matched to learners. Every decision explained.</p>
            <p className="m-0 max-w-sm text-body text-ink-muted">
              Schools, colleges and community halls share their free hours. Course providers bring the classes. Learners nearby get a seat.
            </p>
            <div aria-hidden className="max-w-sm">
              <SegmentBar
                showLegend={false}
                segments={[
                  { label: 'Learners', value: 5, tone: 'accent' },
                  { label: 'Space givers', value: 3, tone: 'success' },
                  { label: 'Course providers', value: 3, tone: 'info' },
                  { label: 'Sessions', value: 2, tone: 'sky' },
                  { label: 'Idle', value: 2, tone: 'neutral' },
                ]}
              />
            </div>
          </div>
          <p className="m-0 font-mono text-delta text-ink-subtle max-lg:hidden">Smart Allocation · Demand Insights · GIS Mapping</p>
        </aside>
        <main className="flex flex-1 items-start justify-center bg-surface px-4 py-8 sm:px-8 lg:items-center lg:rounded-l-2xl lg:border-l lg:border-border lg:py-12">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
