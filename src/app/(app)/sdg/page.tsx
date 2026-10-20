import type { Metadata } from 'next';
import { SdgScreen } from '@/components/impact/sdg-screen';

export const metadata: Metadata = { title: 'SDG Dashboard' };

/** The six Sustainable Development Goals with their indicators (README section 20). Every signed-in role. */
export default function SdgPage() {
  return <SdgScreen />;
}
