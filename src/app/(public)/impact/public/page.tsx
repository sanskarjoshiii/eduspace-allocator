import type { Metadata } from 'next';
import { SdgGrid } from '../../impact-numbers';

export const metadata: Metadata = { title: 'Public Impact' };

/** Read-only SDG impact for visitors. */
export default function PublicImpactPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:py-14">
      <div className="flex flex-col gap-1">
        <p className="m-0 font-mono text-label text-ink-muted uppercase">Sustainable Development Goals</p>
        <h1 className="m-0 text-title text-ink">Public Impact</h1>
        <p className="m-0 max-w-2xl text-body-sm text-ink-muted">
          How shared spaces on EduSpace contribute to six of the UN Sustainable Development Goals. Figures are live totals and contain no personal data.
        </p>
      </div>
      <SdgGrid />
    </div>
  );
}
