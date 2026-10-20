'use client';

import { StatCard } from '@/components/ui/stat-card';
import { Tag } from '@/components/ui/badge';
import { usePublicImpact, type PublicImpact } from '@/hooks/use-public-impact';
import { formatNumber } from '@/lib/format';
import type { IconName } from '@/components/ui/icon';

const HEADLINE: { key: keyof PublicImpact; label: string; icon: IconName; footnote: string }[] = [
  { key: 'learnersServed', label: 'Learners Served', icon: 'graduation-cap', footnote: 'Learners with a confirmed seat.' },
  { key: 'learningHours', label: 'Learning Hours', icon: 'clock', footnote: 'Class hours held in shared spaces.' },
  { key: 'spacesUsed', label: 'Spaces Used', icon: 'building-2', footnote: 'Idle rooms now hosting classes.' },
  { key: 'areasReached', label: 'Areas Reached', icon: 'map-pin', footnote: 'Neighbourhoods with at least one class.' },
  { key: 'sessionsScheduled', label: 'Sessions Scheduled', icon: 'calendar', footnote: 'Class sessions on the calendar.' },
  { key: 'partners', label: 'Partners', icon: 'heart-handshake', footnote: 'Space givers and course providers.' },
];

function Unavailable() {
  return (
    <p role="status" className="m-0 rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-body-sm text-ink-muted">
      Impact numbers are not available right now. Check back soon.
    </p>
  );
}

/** Six headline figures from GET /api/public/impact. */
export function ImpactNumbers() {
  const q = usePublicImpact();
  if (q.isError) return <Unavailable />;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {HEADLINE.map((h) => (
        <StatCard
          key={h.key}
          icon={h.icon}
          label={h.label}
          loading={q.isPending}
          value={q.data ? formatNumber(q.data[h.key] ?? 0) : undefined}
          footnote={h.footnote}
        />
      ))}
    </div>
  );
}

const SDGS: { goal: string; title: string; key: keyof PublicImpact; metric: string; description: string }[] = [
  { goal: 'SDG 4', title: 'Quality Education', key: 'learnersServed', metric: 'Learners served', description: 'More people reach a class close to home.' },
  { goal: 'SDG 8', title: 'Decent Work and Economic Growth', key: 'sessionsScheduled', metric: 'Sessions scheduled', description: 'Tutors and providers get a venue to teach in.' },
  { goal: 'SDG 9', title: 'Industry, Innovation and Infrastructure', key: 'spacesUsed', metric: 'Idle spaces put to use', description: 'Existing rooms do more, without new buildings.' },
  { goal: 'SDG 10', title: 'Reduced Inequalities', key: 'areasReached', metric: 'Areas reached', description: 'Classes go where demand is, including underserved areas.' },
  { goal: 'SDG 11', title: 'Sustainable Cities and Communities', key: 'learningHours', metric: 'Learning hours in neighbourhood spaces', description: 'Shorter journeys and busier community spaces.' },
  { goal: 'SDG 17', title: 'Partnerships for the Goals', key: 'partners', metric: 'Active partners', description: 'Space givers, course providers and NGOs working together.' },
];

/** The six SDG goals with their headline figures. */
export function SdgGrid() {
  const q = usePublicImpact();
  if (q.isError) return <Unavailable />;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {SDGS.map((s) => (
        <div key={s.goal} className="flex flex-col">
          <Tag attached tone="info" className="self-start">
            {s.goal}
          </Tag>
          <StatCard label={s.title} loading={q.isPending} title={s.metric} value={q.data ? formatNumber(q.data[s.key] ?? 0) : undefined} footnote={s.description} className="rounded-tl-none" />
        </div>
      ))}
    </div>
  );
}
