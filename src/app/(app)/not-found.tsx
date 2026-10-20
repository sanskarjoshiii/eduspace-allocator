import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/layout';

export default function AppNotFound() {
  return (
    <div className="flex flex-col">
      <PageHeader title="Page Not Found" description="The page or record you opened does not exist or was removed." />
      <EmptyState
        icon="compass"
        description="Check the link, or go back to your dashboard."
        action={
          <Button href="/dashboard" icon="house">
            Go to Dashboard
          </Button>
        }
      />
    </div>
  );
}
