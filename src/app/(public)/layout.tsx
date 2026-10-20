import Link from 'next/link';
import { auth } from '@/auth';
import { Button } from '@/components/ui/button';

/** Public pages: wordmark header with sign-in actions, and a footer. No auth required. */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const signedIn = Boolean(session?.user?.role);
  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken">
      <header className="border-b border-border">
        <div className="mx-auto flex h-header max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="rounded-xs font-sans text-title text-ink no-underline">
            EduSpace
          </Link>
          <nav aria-label="Site" className="flex items-center gap-2">
            <Link href="/impact/public" className="rounded-xs px-2 font-mono text-control text-ink-muted no-underline hover:text-ink max-sm:hidden">
              Impact
            </Link>
            {signedIn ? (
              <Button href="/dashboard" variant="primary" size="sm" iconRight="arrow-up-right">
                Go to Dashboard
              </Button>
            ) : (
              <>
                <Button href="/login" variant="ghost" size="sm">
                  Sign In
                </Button>
                <Button href="/register" variant="primary" size="sm">
                  Register
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-body-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>
            <span className="font-medium text-ink">EduSpace</span> · Idle rooms, matched to learners.
          </span>
          <nav aria-label="Footer" className="flex gap-4 font-mono text-delta">
            <Link href="/impact/public" className="text-ink-muted no-underline hover:text-ink">
              Public Impact
            </Link>
            <Link href="/login" className="text-ink-muted no-underline hover:text-ink">
              Sign In
            </Link>
            <Link href="/register" className="text-ink-muted no-underline hover:text-ink">
              Register
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
