import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { UiKitGallery } from '@/components/ui/ui-kit-gallery';

export const metadata: Metadata = { title: 'UI Kit' };

/** Living component gallery for developers and visual QA. Administrator only. */
export default async function UiKitPage() {
  const session = await auth();
  if (session?.user?.role !== 'Administrator') redirect('/dashboard?denied=1');
  return <UiKitGallery />;
}
