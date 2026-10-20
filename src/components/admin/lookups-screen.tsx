'use client';

import { useState } from 'react';
import { Button, PageHeader, PanelGrid, TabPanel, Tabs } from '@/components/ui';
import { AreasTab } from './areas-tab';
import { CategoriesTab } from './categories-tab';
import { FacilityTypesTab } from './facility-types-tab';

type LookupTab = 'facility-types' | 'categories' | 'areas';

const TABS: { value: LookupTab; label: string; add: string }[] = [
  { value: 'facility-types', label: 'Facility Types', add: 'Add Facility Type' },
  { value: 'categories', label: 'Course Categories', add: 'Add Category' },
  { value: 'areas', label: 'Areas', add: 'Add Area' },
];

/** Lookup administration (PLAN 2.1): facility types, course categories and areas. */
export function LookupsScreen() {
  const [tab, setTab] = useState<LookupTab>('facility-types');
  const [creating, setCreating] = useState<LookupTab | null>(null);
  const current = TABS.find((t) => t.value === tab) ?? TABS[0]!;

  return (
    <>
      <PageHeader
        title="Lookups"
        description="Facility types, course categories and areas used across registration, matching and Demand Insights."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(tab)}>
            {current.add}
          </Button>
        }
      />
      <div className="border-b border-border px-4 pt-3 lg:px-6">
        <Tabs id="lookup-tabs" label="Lookup type" items={TABS} value={tab} onValueChange={(v) => setTab(v as LookupTab)} />
      </div>
      <PanelGrid columns={1}>
        <TabPanel id="lookup-tabs" value="facility-types" active={tab}>
          <FacilityTypesTab creating={creating === 'facility-types'} onCreatingChange={(o) => setCreating(o ? 'facility-types' : null)} />
        </TabPanel>
        <TabPanel id="lookup-tabs" value="categories" active={tab}>
          <CategoriesTab creating={creating === 'categories'} onCreatingChange={(o) => setCreating(o ? 'categories' : null)} />
        </TabPanel>
        <TabPanel id="lookup-tabs" value="areas" active={tab}>
          <AreasTab creating={creating === 'areas'} onCreatingChange={(o) => setCreating(o ? 'areas' : null)} />
        </TabPanel>
      </PanelGrid>
    </>
  );
}
