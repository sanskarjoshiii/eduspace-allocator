'use client';

import { formatKm, formatScore } from '@/lib/format';
import { CriterionRow, EmptyState, Panel, PanelGrid, ScoreBar, type CriterionStatus } from '@/components/ui';
import { humanize, type AllocationDetailDto } from './allocation-hooks';

function scoreStatus(score: number): CriterionStatus {
  if (score >= 0.6) return 'pass';
  if (score > 0) return 'partial';
  return 'fail';
}

/** "Why This Space" and "Why Not the Others" (PLAN 6.7). Wording: compatibility score, never probability. */
export function ExplainPanel({ allocation }: { allocation: AllocationDetailDto }) {
  const a = allocation;
  return (
    <PanelGrid columns={2}>
      <Panel id="why-this-space" title="Why This Space" description="Every hard check passed, and how each criterion contributed to the compatibility score.">
        <ScoreBar score={a.score} className="mb-4" />
        <h3 className="m-0 mb-1 font-mono text-label text-ink-muted uppercase">Hard Checks</h3>
        {a.constraints.length ? (
          <div className="mb-5">
            {a.constraints.map((c) => (
              <CriterionRow key={c.constraint} name={humanize(c.constraint)} status={c.passed ? 'pass' : 'fail'} detail={c.detail} />
            ))}
          </div>
        ) : (
          <p className="m-0 mb-5 text-body-sm text-ink-muted">No hard checks were recorded for this allocation.</p>
        )}
        <h3 className="m-0 mb-1 font-mono text-label text-ink-muted uppercase">Score Breakdown</h3>
        {a.breakdown.length ? (
          a.breakdown.map((b) => (
            <CriterionRow
              key={b.criterion}
              name={humanize(b.criterion)}
              status={scoreStatus(b.score)}
              score={b.score}
              detail={
                <div className="flex flex-col gap-1.5">
                  {b.detail ? <span>{b.detail}</span> : null}
                  <span className="font-mono text-data">
                    Weight {formatScore(b.weight)} · adds {formatScore(b.weighted)}
                  </span>
                  <ScoreBar score={b.score} size="sm" showLabel={false} label={`${humanize(b.criterion)} sub-score`} className="max-w-60" />
                </div>
              }
            />
          ))
        ) : (
          <p className="m-0 text-body-sm text-ink-muted">No score breakdown was recorded for this allocation.</p>
        )}
      </Panel>
      <Panel id="why-not-others" title="Why Not the Others" description="Nearby spaces Smart Allocation considered and the reason each lost.">
        {a.rejectedAlternatives.length ? (
          a.rejectedAlternatives.map((alt, i) =>
            alt.failedConstraint ? (
              <CriterionRow
                key={`${alt.spaceId}-${i}`}
                name={alt.spaceName}
                status="fail"
                firstFailure
                detail={
                  <>
                    {humanize(alt.failedConstraint)}: {alt.reason}
                    {alt.distanceKm !== null ? <span className="font-mono text-data"> · {formatKm(alt.distanceKm)}</span> : null}
                  </>
                }
              />
            ) : (
              <CriterionRow
                key={`${alt.spaceId}-${i}`}
                name={alt.spaceName}
                status="partial"
                score={alt.score}
                detail={
                  <>
                    {alt.score !== null ? (
                      <span className="font-mono text-data">
                        Scored {formatScore(alt.score)} against {formatScore(a.score)}
                      </span>
                    ) : null}
                    {alt.reason ? <span>{alt.score !== null ? '. ' : ''}{alt.reason}</span> : null}
                    {alt.sessionLabel ? <span className="font-mono text-data"> · {alt.sessionLabel}</span> : null}
                    {alt.distanceKm !== null ? <span className="font-mono text-data"> · {formatKm(alt.distanceKm)}</span> : null}
                  </>
                }
              />
            ),
          )
        ) : (
          <EmptyState size="compact" icon="building-2" description="No other space came close. This was the only one that fits." />
        )}
      </Panel>
    </PanelGrid>
  );
}
