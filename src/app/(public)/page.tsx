import type { Metadata } from 'next';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { ImpactNumbers } from './impact-numbers';

export const metadata: Metadata = {
  title: { absolute: 'EduSpace · Idle rooms, matched to learners' },
};

const AUDIENCES: { title: string; icon: IconName; body: string }[] = [
  {
    title: 'For Learners',
    icon: 'graduation-cap',
    body: 'Tell us the course, times and area that suit you. You get an offer for a class nearby, and you decide whether to accept it.',
  },
  {
    title: 'For Space Givers',
    icon: 'school',
    body: 'List the rooms, labs and halls you have free, with the hours and rules that work for you. Approve each class before it is booked.',
  },
  {
    title: 'For Course Providers',
    icon: 'presentation',
    body: 'Add your courses and the times you can teach. EduSpace finds a suitable room close to the learners who asked for it.',
  },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'Register Your Side', body: 'Learners send a request; space givers add spaces and free slots; providers add courses and offerings.' },
  { title: 'Smart Allocation Matches', body: 'EduSpace groups nearby demand and matches it to the best-fitting space and time, and explains why.' },
  { title: 'Approve and Confirm', body: 'The space giver approves, the provider confirms, and learners receive an offer to accept or decline.' },
  { title: 'Class Scheduled', body: 'Sessions go on everyone’s calendar, with the place, time and map in one view.' },
];

export default function LandingPage() {
  return (
    <>
      <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pt-12 pb-10 sm:px-6 lg:pt-20">
        <p className="m-0 font-mono text-label text-ink-muted uppercase">Shared spaces for local learning</p>
        <h1 className="m-0 max-w-3xl text-figure-xl text-ink">Idle rooms, matched to learners. Every decision explained.</h1>
        <p className="m-0 max-w-2xl text-body text-ink-muted">
          EduSpace connects schools, colleges and community halls that have free hours with course providers and learners nearby, so more classes happen
          in rooms that would otherwise sit empty.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button href="/impact/public" icon="heart-handshake">
            See Our Impact
          </Button>
          <Button href="/login" variant="ghost">
            Sign In
          </Button>
        </div>
      </section>

      <section aria-labelledby="audiences" className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <h2 id="audiences" className="sr-only">
          Who EduSpace is for
        </h2>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
          {AUDIENCES.map((a) => (
            <div key={a.title} className="flex flex-col gap-3 bg-surface p-5 lg:p-6">
              <span className="grid size-10 place-items-center rounded-md bg-surface-tint text-ink">
                <Icon name={a.icon} size={18} />
              </span>
              <h3 className="m-0 text-heading text-ink">{a.title}</h3>
              <p className="m-0 text-body-sm text-ink-muted">{a.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="how" className="border-y border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6">
          <div className="flex flex-col gap-1">
            <h2 id="how" className="m-0 text-title text-ink">
              How It Works
            </h2>
            <p className="m-0 text-body-sm text-ink-muted">Four steps from a free room to a scheduled class.</p>
          </div>
          <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-sunken p-4">
                <span className="font-mono text-label text-accent-ink tabular-nums">STEP {i + 1}</span>
                <h3 className="m-0 text-heading text-ink">{s.title}</h3>
                <p className="m-0 text-body-sm text-ink-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="impact" className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <h2 id="impact" className="m-0 text-title text-ink">
              Impact So Far
            </h2>
            <p className="m-0 text-body-sm text-ink-muted">Live totals across every city on EduSpace.</p>
          </div>
          <Button href="/impact/public" variant="ghost" size="sm" iconRight="arrow-up-right">
            View SDG Impact
          </Button>
        </div>
        <ImpactNumbers />
      </section>
    </>
  );
}
