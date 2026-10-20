'use client';

// Developer gallery rendered at /ui-kit (Administrator only). Not exported from the barrel.
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { BarChart, LineChart } from '@/components/charts';
import {
  FormCheckbox, FormCommaList, FormInput, FormLocationPicker, FormRadioGroup, FormSelect, FormSwitch, FormTextarea, FormWindowEditor,
} from '@/components/forms';
import { MapView, type MapData } from '@/components/map';
import { DEMAND_LEVELS } from '@/lib/domain';
import { formatInr } from '@/lib/format';
import { noOverlap, PointInput, WindowInput } from '@/schemas/common';
import {
  ActionTile, Alert, Badge, Breadcrumb, Button, Checkbox, ConfirmDialog, CriterionRow, DataTable, Delta, Dialog, Divider, EmptyState,
  ErrorState, Field, IconButton, Input, KeyValueList, Kbd, PageHeader, Panel, PanelGrid, Progress, RadioGroup, ScoreBar, SearchField,
  SegmentBar, Select, Skeleton, SkeletonText, StatCard, StatusBadge, Switch, TabPanel, Tabs, Tag, Textarea, Timeline, Tooltip, UserChip,
  useConfirm, useToast, type DataTableColumn,
} from '.';
import { NavItem } from './navigation';

interface Row {
  id: string;
  name: string;
  area: string;
  seats: number;
  filled: number;
  rent: number;
  status: string;
}

const ROWS: Row[] = Array.from({ length: 23 }, (_, i) => ({
  id: String(i + 1),
  name: ['Kothrud Community Hall', 'Model Colony School Lab', 'Aundh NGO Centre', 'Baner College Room 4'][i % 4]! + (i > 3 ? ` ${i}` : ''),
  area: ['Kothrud', 'Shivajinagar', 'Aundh', 'Baner'][i % 4]!,
  seats: 20 + ((i * 7) % 30),
  filled: (i * 5) % 20,
  rent: 500 + i * 250,
  status: ['Proposed', 'ApprovedBySpace', 'ConfirmedByProvider', 'NeedsReallocation', 'Scheduled'][i % 5]!,
}));

const COLUMNS: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Space', sortable: true },
  { key: 'area', header: 'Area', sortable: true, hideBelow: 'sm' },
  {
    key: 'seats', header: 'Seats', align: 'end', sortable: true, width: '160px', sortValue: (r) => r.filled / r.seats,
    cell: (r) => <Progress size="sm" value={r.filled} max={r.seats} label={`${r.filled} of ${r.seats} seats`} startLabel={r.filled} endLabel={r.seats} />,
  },
  { key: 'rent', header: 'Rent', align: 'end', sortable: true, cell: (r) => formatInr(r.rent), hideBelow: 'md' },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
];

const TREND = ['01 Sep', '08 Sep', '15 Sep', '22 Sep', '29 Sep', '06 Oct', '13 Oct', '20 Oct'].map((week, i) => ({
  week, requests: [120, 138, 131, 162, 190, 214, 236, 250][i]!, offers: [80, 92, 101, 110, 140, 150, 171, 180][i]!,
}));
const BY_CAT = [
  { category: 'Music', offered: 120, accepted: 90, waitlisted: 12, expired: 6 },
  { category: 'Dance', offered: 80, accepted: 64, waitlisted: 10, expired: 4 },
  { category: 'Study', offered: 210, accepted: 170, waitlisted: 30, expired: 9 },
  { category: 'Arts', offered: 60, accepted: 41, waitlisted: 5, expired: 3 },
];

const pt = (lng: number, lat: number) => ({ type: 'Point' as const, coordinates: [lng, lat] as [number, number] });
const MAP: MapData = {
  spaces: [
    { id: 's1', name: 'Kothrud Community Hall', status: 'available', location: pt(73.8077, 18.5074), seats: 40, areaName: 'Kothrud', categories: ['Music'] },
    { id: 's2', name: 'Model Colony School Lab', status: 'booked', location: pt(73.8359, 18.5308), seats: 30, areaName: 'Shivajinagar', categories: ['Study'] },
    { id: 's3', name: 'Aundh NGO Centre', status: 'inactive', location: pt(73.8076, 18.5590), seats: 25, areaName: 'Aundh', categories: ['Arts'] },
  ],
  allocations: [{ id: 'a1', from: pt(73.8359, 18.5308), to: pt(73.8567, 18.5204), spaceName: 'Model Colony School Lab', areaName: 'Shivajinagar', courseTitle: 'Spoken English', learners: 18, category: 'Study' }],
  demand: [
    { areaId: 'd1', areaName: 'Shivajinagar', centre: pt(73.8567, 18.5204), openRequests: 42, level: 'High', category: 'Study' },
    { areaId: 'd2', areaName: 'Baner', centre: pt(73.7868, 18.559), openRequests: 18, level: 'Medium', category: 'Music' },
    { areaId: 'd3', areaName: 'Hadapsar', centre: pt(73.9259, 18.5089), openRequests: 7, level: 'Emerging', category: 'Arts' },
  ],
  offers: [{ id: 'o1', title: 'Tabla for Beginners', location: pt(73.8077, 18.5074), spaceName: 'Kothrud Community Hall', schedule: 'Sat 10:00–13:00', distanceKm: 2.4, category: 'Music' }],
  unusedHours: [{ spaceId: 's1', name: 'Kothrud Community Hall', location: pt(73.8077, 18.5074), hours: 14 }],
};

const DemoSchema = z
  .object({
    title: z.string().trim().min(3, 'Use at least 3 characters'),
    seats: z.number({ error: 'Enter a number' }).int().min(1, 'At least 1 seat'),
    level: z.enum(DEMAND_LEVELS, { error: 'Choose a level' }),
    notes: z.string().max(200).optional(),
    approval: z.enum(['auto', 'manual']),
    accessible: z.boolean(),
    tags: z.array(z.string()).max(5),
    agree: z.literal(true, { error: 'Tick to continue' }),
    windows: z.array(WindowInput).min(1, 'Add at least one slot').refine(noOverlap, 'Slots on the same day must not overlap'),
    location: PointInput.nullable().refine((v) => v !== null, 'Pick a location'),
  });

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Panel title={title} description={description}>
      <div className="flex flex-col gap-4">{children}</div>
    </Panel>
  );
}

const Row_ = ({ children }: { children: React.ReactNode }) => <div className="flex flex-wrap items-center gap-3">{children}</div>;

export function UiKitGallery() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState('all');
  const [sw, setSw] = useState(true);
  const [radio, setRadio] = useState('balanced');
  const [tableState, setTableState] = useState<'data' | 'loading' | 'empty' | 'error'>('data');

  const form = useForm({
    resolver: zodResolver(DemoSchema),
    defaultValues: { title: '', approval: 'manual', accessible: false, tags: [], windows: [{ dayOfWeek: 6, startTime: '10:00', endTime: '13:00' }], location: null, notes: '' },
  });

  return (
    <div className="flex flex-col">
      <PageHeader
        title="UI Kit"
        description="Every design-system component in every state, for developers and visual QA."
        meta={<Badge tone="info">Administrator only</Badge>}
        actions={
          <>
            <Button icon="download">Secondary</Button>
            <Button variant="primary" icon="play">
              Primary Action
            </Button>
          </>
        }
      />
      <PanelGrid columns={2}>
        <Section title="Buttons" description="Primary once per view; secondary elsewhere; ghost for dismissive; danger for destructive.">
          <Row_>
            <Button variant="primary">Run Allocation</Button>
            <Button icon="plus">Add Space</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="danger" icon="trash-2">
              Delete Space
            </Button>
          </Row_>
          <Row_>
            <Button size="sm" icon="download">
              Download
            </Button>
            <Button size="sm" loading>
              Saving
            </Button>
            <Button size="sm" disabled>
              Disabled
            </Button>
            <Button size="sm" href="/ui-kit" iconRight="arrow-up-right">
              Link Button
            </Button>
          </Row_>
          <Row_>
            <IconButton icon="download" label="Download report" />
            <IconButton icon="plus" label="Add" size="md" />
            <Tooltip content="Opens the filter panel">
              <IconButton icon="filter" label="Filter" />
            </Tooltip>
            <Kbd>⌘K</Kbd>
          </Row_>
          <div className="grid grid-cols-3 gap-2">
            <ActionTile icon="search" label="Find Courses" />
            <ActionTile icon="ticket" label="My Offers" selected />
            <ActionTile icon="pencil" label="Update Request" disabled />
          </div>
        </Section>

        <Section title="Badges and Tags" description="Status words with tone from STATUS_TONE; tags name a card's category.">
          <Row_>
            {['Offered', 'Accepted', 'Waitlisted', 'Expired', 'Declined', 'Proposed', 'ApprovedBySpace', 'ConfirmedByProvider', 'NeedsReallocation', 'Running', 'Failed'].map(
              (s) => (
                <StatusBadge key={s} status={s} />
              ),
            )}
            <StatusBadge status="Open" tone="warning" label="Open issue" />
            <Badge>Neutral</Badge>
          </Row_>
          <Row_>
            <Tag tone="accent">High</Tag>
            <Tag tone="info">Medium</Tag>
            <Tag tone="success" icon="map-pin">
              Emerging
            </Tag>
            <Tag tone="neutral" attached>
              Attached
            </Tag>
          </Row_>
          <Row_>
            <Delta value={12.4} />
            <Delta value={-3.2} />
            <Delta value={0} />
            <Delta value={-0.6} suffix=" km" invert />
            <Delta value={14} suffix="" digits={0} />
          </Row_>
        </Section>

        <Section title="Stat Cards" description="Tray with eyebrow, one figure, delta and footnote.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatCard
              icon="inbox"
              label="Open Requests"
              value="1,284"
              delta={12.4}
              footnote={
                <>
                  <strong>212</strong> more requests than last week.
                </>
              }
              action={<IconButton icon="download" label="Download" />}
            />
            <StatCard icon="clock" label="Loading" loading />
            <StatCard label="Seats Offered" title="Current offerings">
              <Progress value={18} max={24} label="Seats filled" startLabel="18 seats filled" endLabel="24 seats" />
            </StatCard>
            <StatCard label="Hero Figure" value={formatInr(120000)} size="xl" delta={-2.1} footnote="Rent paid to space givers this month." />
          </div>
        </Section>

        <Section title="Progress and Segments" description="Capacity bars and share-of-whole bars.">
          <Progress value={18} max={24} label="Seats filled" startLabel="18 seats filled" endLabel="24 seats" />
          <Progress value={24} max={24} tone="success" label="Full" startLabel="24 seats filled" endLabel="Full" />
          <Progress value={3} max={10} tone="info" size="sm" label="Small" />
          <SegmentBar
            segments={[
              { label: 'Booked', value: 42, tone: 'accent' },
              { label: 'Held', value: 18, tone: 'success' },
              { label: 'Planned', value: 12, tone: 'info' },
              { label: 'Idle', value: 28, tone: 'neutral' },
            ]}
          />
          <ScoreBar score={0.82} />
          <ScoreBar score={0.41} size="sm" />
        </Section>

        <Section title="Explanations" description="CriterionRow per check, in engine order.">
          <div>
            <CriterionRow name="Distance" status="pass" detail="2.4 km from the cohort centre, limit 5 km" score={0.86} />
            <CriterionRow name="Capacity" status="partial" detail="24 seats for 28 learners" score={0.6} />
            <CriterionRow name="Accessibility" status="fail" detail="No step-free entrance; 3 learners need one" firstFailure />
          </div>
        </Section>

        <Section title="Navigation" description="Rail items, breadcrumb, tabs and search.">
          <div className="flex max-w-60 flex-col gap-0.5 rounded-lg bg-surface-sunken p-2">
            <NavItem href="/ui-kit" label="Dashboard" icon="house" />
            <NavItem href="/ui-kit" label="Allocations" icon="list-checks" active badge={3} />
            <NavItem href="/ui-kit" label="Users" sub />
          </div>
          <Breadcrumb items={[{ label: 'Space Registry', href: '/spaces' }, 'Kothrud Community Hall']} />
          <SearchField id="kit-search" placeholder="Search areas" shortcut="⌘F" />
          <Tabs
            id="kit-tabs"
            label="Request filter"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: 'all', label: 'All', count: 42 },
              { value: 'open', label: 'Open', count: 12 },
              { value: 'closed', label: 'Closed' },
              { value: 'off', label: 'Disabled', disabled: true },
            ]}
          />
          <TabPanel id="kit-tabs" value={tab} active={tab} className="text-body-sm text-ink-muted">
            Showing the “{tab}” tab.
          </TabPanel>
        </Section>

        <Section title="Primitives" description="Inputs at h-control-md with border-control and the focus ring.">
          <Field label="Space name" hint="As shown to providers.">
            <Input placeholder="Kothrud Community Hall" />
          </Field>
          <Field label="Rent per hour" error="Enter a positive amount">
            <Input mono defaultValue="-200" />
          </Field>
          <Field label="Area">
            <Select placeholder="Choose an area" options={[{ value: 'k', label: 'Kothrud' }, { value: 'a', label: 'Aundh' }]} />
          </Field>
          <Field label="Notes" optional>
            <Textarea placeholder="Anything providers should know" />
          </Field>
          <Checkbox id="kit-cb" label="Step-free entrance" description="Ramp or lift to the room." defaultChecked />
          <Switch checked={sw} onCheckedChange={setSw} label="Auto-approve classes" />
          <RadioGroup
            name="kit-radio"
            legend="Strategy"
            value={radio}
            onValueChange={setRadio}
            orientation="horizontal"
            options={[
              { value: 'balanced', label: 'Balanced' },
              { value: 'accessibility', label: 'Accessibility first' },
              { value: 'reach', label: 'Maximum reach' },
            ]}
          />
        </Section>

        <Section title="Facts and Timeline" description="KeyValueList, Timeline, UserChip, Divider.">
          <KeyValueList
            items={[
              { label: 'Starts', value: '31 Dec 2026', mono: true },
              { label: 'Schedule', value: 'Sat 10:00–13:00', mono: true },
              { label: 'Distance', value: '2.4 km', mono: true },
              { label: 'Space', value: 'Kothrud Community Hall' },
            ]}
          />
          <Divider variant="dashed" />
          <Timeline
            steps={[
              { label: 'Submitted', state: 'done', date: '02 Oct 2026' },
              { label: 'Matched', state: 'done', date: '04 Oct 2026', description: 'Grouped with 17 learners in Kothrud.' },
              { label: 'Offered', state: 'current', date: '05 Oct 2026', description: 'Accept before 08 Oct 2026.' },
              { label: 'Scheduled', state: 'pending' },
            ]}
          />
          <UserChip name="Asha Kulkarni" meta="Learner" />
        </Section>

        <Section title="Feedback" description="Empty, error, alert, skeleton, toast, dialogs.">
          <EmptyState icon="building-2" description="No spaces yet. Add your first space to start receiving classes." action={<Button icon="plus">Add Space</Button>} />
          <ErrorState onRetry={() => toast.toast('Retrying')} />
          <Alert tone="warning" title="Offer expires soon">
            Accept before 08 Oct 2026 to keep your seat.
          </Alert>
          <Alert tone="danger">Email or password is incorrect.</Alert>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <SkeletonText lines={3} />
          </div>
          <Row_>
            <Button size="sm" onClick={() => toast.success('Saved')}>
              Toast Saved
            </Button>
            <Button size="sm" onClick={() => toast.error('Could not save', { description: 'Check your connection and try again.' })}>
              Toast Error
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              Open Dialog
            </Button>
            <Button size="sm" onClick={() => setConfirmOpen(true)}>
              Confirm Dialog
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                const ok = await confirm({ title: 'Cancel Allocation?', description: 'Learners will be told the class is cancelled.', confirmLabel: 'Cancel Allocation', tone: 'danger' });
                toast.toast(ok ? 'Allocation cancelled' : 'Kept');
              }}
            >
              useConfirm
            </Button>
          </Row_>
        </Section>

        <Panel title="Data Table" description="Client mode: search, sort, pagination; toggle loading, empty and error states." className="lg:col-span-2">
          <DataTable
            caption="Spaces"
            columns={COLUMNS}
            rows={tableState === 'empty' ? [] : ROWS}
            rowKey={(r) => r.id}
            searchable
            searchPlaceholder="Search spaces"
            itemLabel="spaces"
            loading={tableState === 'loading'}
            error={tableState === 'error' ? new Error('demo') : undefined}
            onRetry={() => setTableState('data')}
            empty={<EmptyState icon="building-2" description="No spaces yet. Add your first space to start receiving classes." size="compact" />}
            onRowClick={(r) => toast.toast(`Opened ${r.name}`)}
            toolbar={
              <Select
                size="sm"
                aria-label="Table state"
                value={tableState}
                onChange={(e) => setTableState(e.target.value as typeof tableState)}
                options={['data', 'loading', 'empty', 'error'].map((v) => ({ value: v, label: `State: ${v}` }))}
                className="w-40"
              />
            }
          />
        </Panel>

        <Panel title="Charts" description="LineChart (info stroke + area) and BarChart (series order).">
          <LineChart data={TREND} xKey="week" series={[{ key: 'requests', label: 'Requests' }]} futureFromIndex={6} label="Weekly learning requests, rising from 120 to 250" />
        </Panel>
        <Panel title="Bar Chart" description="Grouped and stacked.">
          <BarChart
            data={BY_CAT}
            xKey="category"
            stacked
            series={[
              { key: 'accepted', label: 'Accepted' },
              { key: 'waitlisted', label: 'Waitlisted' },
              { key: 'expired', label: 'Expired' },
            ]}
            label="Offers by category and outcome"
          />
        </Panel>

        <Panel title="Map" description="All layers with toggles, filters and legend (demo data around Pune)." className="lg:col-span-2">
          <MapView data={MAP} height={380} label="Demo map" />
        </Panel>

        <Panel title="Form" description="RHF + zodResolver with every bound field, WindowEditor and LocationPicker." className="lg:col-span-2">
          <form
            noValidate
            onSubmit={form.handleSubmit(() => toast.success('Form is valid'))}
            className="grid grid-cols-1 gap-4 lg:grid-cols-2"
          >
            <div className="flex flex-col gap-4">
              <FormInput control={form.control} name="title" label="Offering Title" required />
              <FormInput control={form.control} name="seats" label="Seats" type="number" required />
              <FormSelect control={form.control} name="level" label="Demand Level" placeholder="Choose" options={DEMAND_LEVELS.map((d) => ({ value: d, label: d }))} required />
              <FormTextarea control={form.control} name="notes" label="Notes" optional />
              <FormRadioGroup control={form.control} name="approval" label="Approval" options={[{ value: 'auto', label: 'Automatic' }, { value: 'manual', label: 'Manual' }]} orientation="horizontal" />
              <FormSwitch control={form.control} name="accessible" label="Step-free entrance" />
              <FormCommaList control={form.control} name="tags" label="Tags" hint="Separate with commas." optional />
              <FormCheckbox control={form.control} name="agree" label="I confirm these details are correct." />
            </div>
            <div className="flex flex-col gap-4">
              <FormWindowEditor control={form.control} name="windows" label="Weekly Slots" />
              <FormLocationPicker control={form.control} name="location" label="Location" hint="Click the map or drag the pin." />
            </div>
            <div className="flex gap-2 lg:col-span-2">
              <Button type="submit" variant="secondary">
                Validate Form
              </Button>
              <Button variant="ghost" onClick={() => form.reset()}>
                Reset
              </Button>
            </div>
          </form>
        </Panel>
      </PanelGrid>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Report Issue"
        description="Tell us what is wrong with this space."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setDialogOpen(false);
                toast.success('Issue reported');
              }}
            >
              Report Issue
            </Button>
          </>
        }
      >
        <Field label="What happened">
          <Textarea placeholder="The projector in Room 4 is not working." />
        </Field>
      </Dialog>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => new Promise<void>((r) => setTimeout(r, 800))}
        title="Approve Allocation?"
        description="The provider will be asked to confirm next."
        confirmLabel="Approve"
      />
      {dialog}
    </div>
  );
}
