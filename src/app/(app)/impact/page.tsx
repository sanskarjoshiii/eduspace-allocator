import type { Metadata } from 'next';
import { ImpactScreen } from '@/components/impact/impact-screen';

export const metadata: Metadata = { title: 'Social Impact' };

/** Social impact metrics and monthly history (PLAN 7.6). Every signed-in role. */
export default function ImpactPage() {
  return <ImpactScreen />;
}
