'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch, type Control } from 'react-hook-form';
import type { z } from 'zod';
import { applyServerErrors, FormInput, FormRadioGroup, FormSwitch } from '@/components/forms';
import {
  Alert, Badge, Button, ErrorState, PageHeader, Panel, PanelGrid, SegmentBar, Skeleton, SkeletonText, TabPanel, Tabs, useToast,
} from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api';
import { STRATEGIES, STRATEGY_LABEL, type Strategy } from '@/lib/domain';
import { formatDateTime } from '@/lib/format';
import { SettingsPatchInput, type WeightsInput } from '@/schemas/settings';
import type { SettingsView } from '@/app/api/settings/settings-admin';
import type { SettingKey } from '@/server/services/settings';
import {
  STRATEGY_DESCRIPTION, WEIGHT_KEYS, WEIGHT_LABEL, isBalanced, settingLabel, weightSegments, weightTotal,
} from './admin-utils';

type FormIn = z.input<typeof SettingsPatchInput>;
type FormOut = z.output<typeof SettingsPatchInput>;

export const settingsKeys = { all: ['settings'] as const };

const FORM_ID = 'settings-form';

/** Hints written for the screen (the stored descriptions mention internal method names). */
const HINT: Partial<Record<SettingKey, string>> = {
  maxRadiusKm: 'Learners are never matched to a space farther than this.',
  minEdgeScore: 'Space and class pairs below this compatibility score are not matched (0 to 1).',
  debounceSeconds: 'Wait this long after the last change before Smart Allocation runs.',
  offerExpiryHours: 'How long a learner has to accept an offer.',
  offerExpiringNoticeHours: 'Send a reminder this many hours before an offer expires.',
  runLockTtlSeconds: 'A run that holds the lock longer than this is treated as stopped.',
  maxRunRetries: 'Automatic retries after a failed run.',
  alertMinAreas: 'Alert when at least this many areas share unmet demand (N).',
  alertMinRequests: 'Count an area once it has this many open requests (M).',
  alertWindowDays: 'Only count requests from the last this many days (W).',
  kMin: 'Smallest number of demand groups to try.',
  kMax: 'Largest number of demand groups to try.',
  kInits: 'Attempts per group count; the tightest grouping is kept.',
  seed: 'Fixed starting point so results are repeatable.',
};

function toFormValues(view: SettingsView): FormIn {
  const { values } = view;
  return { ...values, strategies: { ...values.strategies } };
}

export function SettingsScreen() {
  const query = useQuery({ queryKey: settingsKeys.all, queryFn: () => apiGet<SettingsView>('/api/settings') });

  if (query.isPending) {
    return (
      <>
        <PageHeader title="Settings" description="Tune Smart Allocation, timing, alerts, notifications and account approval." />
        <PanelGrid columns={2}>
          {[0, 1, 2, 3].map((i) => (
            <Panel key={i}>
              <Skeleton className="mb-3 h-5 w-40" />
              <SkeletonText lines={4} />
            </Panel>
          ))}
        </PanelGrid>
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title="Settings" description="Tune Smart Allocation, timing, alerts, notifications and account approval." />
        <PanelGrid columns={1}>
          <Panel>
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </Panel>
        </PanelGrid>
      </>
    );
  }
  return <SettingsForm view={query.data} />;
}

function SettingsForm({ view }: { view: SettingsView }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [lastChanged, setLastChanged] = useState<SettingKey[] | null>(null);
  const [tab, setTab] = useState<Strategy>(view.values.strategy);
  const form = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(SettingsPatchInput), defaultValues: toFormValues(view) });
  const { control, handleSubmit, setError, reset, resetField, getValues, setValue, formState } = form;
  const strategy = useWatch({ control, name: 'strategy' }) ?? view.values.strategy;
  const strategies = useWatch({ control, name: 'strategies' });

  const applyView = (next: SettingsView) => {
    queryClient.setQueryData(settingsKeys.all, next);
  };

  const onSubmit = handleSubmit(async (values) => {
    const dirty = formState.dirtyFields as Partial<Record<string, unknown>> & { strategies?: Partial<Record<Strategy, unknown>> };
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(dirty)) {
      if (key === 'strategies') continue;
      patch[key] = values[key as keyof FormOut];
    }
    const dirtyPresets = STRATEGIES.filter((s) => dirty.strategies?.[s]);
    if (dirtyPresets.length > 0) {
      patch.strategies = Object.fromEntries(dirtyPresets.map((s) => [s, values.strategies?.[s]]));
    }
    if (Object.keys(patch).length === 0) {
      toast.toast('No changes to save', { tone: 'info' });
      return;
    }
    try {
      const res = await apiSend<{ changed: SettingKey[]; settings: SettingsView }>('PATCH', '/api/settings', patch);
      applyView(res.settings);
      reset(toFormValues(res.settings));
      setLastChanged(res.changed);
      toast.success('Settings saved', {
        description: res.changed.length > 0 ? `Changed: ${res.changed.map(settingLabel).join(', ')}.` : 'Nothing changed.',
      });
    } catch (err) {
      applyServerErrors(setError, err);
    }
  });

  const normalise = useMutation({
    mutationFn: (key: Strategy) => {
      const weights = getValues(`strategies.${key}`) as WeightsInput | undefined;
      return apiSend<{ changed: SettingKey[]; settings: SettingsView }>('PATCH', '/api/settings', {
        strategies: { [key]: weights },
        normalise: true,
      });
    },
    onSuccess: (res, key) => {
      applyView(res.settings);
      const next = res.settings.values.strategies[key];
      if (next) for (const w of WEIGHT_KEYS) resetField(`strategies.${key}.${w}`, { defaultValue: next[w] });
      setLastChanged(res.changed);
      toast.success('Weights normalised', { description: `${STRATEGY_LABEL[key]} weights now add up to 1 and are saved.` });
    },
    onError: (err) => applyServerErrors(setError, err),
  });

  const resetToDefault = (key: Strategy) => {
    const preset = view.presets.find((p) => p.key === key);
    if (!preset) return;
    for (const w of WEIGHT_KEYS) setValue(`strategies.${key}.${w}`, preset.defaultWeights[w], { shouldDirty: true, shouldValidate: true });
  };

  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;
  const strategiesError = formState.errors.strategies?.message;
  const presetOptions = view.presets.map((p) => ({ value: p.key, label: p.label, description: STRATEGY_DESCRIPTION[p.key] }));
  const lastUpdated = Object.values(view.updated)
    .map((u) => u?.at)
    .filter((a): a is string => Boolean(a))
    .sort()
    .at(-1);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Tune Smart Allocation, timing, alerts, notifications and account approval."
        meta={lastUpdated ? <span className="font-mono text-data text-ink-muted">Last changed {formatDateTime(lastUpdated)}</span> : null}
        actions={
          <Button variant="primary" icon="check" type="submit" form={FORM_ID} loading={formState.isSubmitting} disabled={!formState.isDirty}>
            Save Changes
          </Button>
        }
      />
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col">
        {rootError || strategiesError || lastChanged ? (
          <div className="flex flex-col gap-2 border-b border-border px-4 py-3 lg:px-6">
            {rootError ? <Alert tone="danger">{rootError}</Alert> : null}
            {strategiesError ? <Alert tone="danger">{strategiesError}</Alert> : null}
            {lastChanged ? (
              <Alert tone={lastChanged.length > 0 ? 'success' : 'neutral'} title="Settings saved">
                {lastChanged.length > 0 ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    Changed:
                    {lastChanged.map((k) => (
                      <Badge key={k} tone="success">
                        {settingLabel(k)}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  'Nothing changed.'
                )}
              </Alert>
            ) : null}
          </div>
        ) : null}

        <PanelGrid columns={2}>
          <Panel title="Smart Allocation Strategy" description="Choose how the next run balances the seven criteria." icon="layers">
            <div className="flex flex-col gap-5">
              <FormRadioGroup control={control} name="strategy" label="Active strategy" options={presetOptions} />
              <div className="flex flex-col gap-4">
                <span className="text-label uppercase text-ink-muted">Weights by Strategy</span>
                {view.presets.map((p) => {
                  const w = (strategies?.[p.key] as WeightsInput | undefined) ?? p.weights;
                  const complete = WEIGHT_KEYS.every((k) => Number.isFinite(w[k]));
                  return (
                    <div key={p.key} className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-body-sm font-medium text-ink">{p.label}</span>
                        {strategy === p.key ? <Badge tone="accent">Active</Badge> : null}
                      </div>
                      {complete && weightTotal(w) > 0 ? (
                        <SegmentBar segments={weightSegments(w)} label={`${p.label} weights`} size="sm" />
                      ) : (
                        <span className="text-body-sm text-ink-subtle">Enter all seven weights to see the mix.</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>
          <Panel
            title="Strategy Weights"
            description="Each set of seven weights must add up to 1. Normalise rescales and saves them."
            icon="chart-column"
          >
            <Tabs
              id="weights-tabs"
              label="Strategy weights"
              value={tab}
              onValueChange={(v) => setTab(v as Strategy)}
              items={STRATEGIES.map((s) => ({ value: s, label: STRATEGY_LABEL[s] }))}
            />
            {STRATEGIES.map((s) => (
              <TabPanel key={s} id="weights-tabs" value={s} active={tab} className="pt-4">
                <WeightsEditor
                  control={control}
                  strategyKey={s}
                  active={strategy === s}
                  error={formState.errors.strategies?.[s]?.message}
                  normalising={normalise.isPending && normalise.variables === s}
                  onNormalise={() => normalise.mutate(s)}
                  onReset={() => resetToDefault(s)}
                />
              </TabPanel>
            ))}
          </Panel>
        </PanelGrid>

        <PanelGrid columns={3}>
          <Panel title="Matching" description="Distance and quality limits for every match." icon="map-pin">
            <div className="flex flex-col gap-4">
              <FormInput control={control} name="maxRadiusKm" label="Maximum Radius (km)" type="number" mono step={0.5} min={1} max={100} hint={HINT.maxRadiusKm} required />
              <FormInput control={control} name="minEdgeScore" label="Minimum Compatibility Score" type="number" mono step={0.01} min={0} max={1} hint={HINT.minEdgeScore} required />
            </div>
          </Panel>
          <Panel title="Timing" description="When runs start, how long offers last and how runs recover." icon="clock">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormInput control={control} name="debounceSeconds" label="Run Delay (seconds)" type="number" mono step={1} min={0} max={3600} hint={HINT.debounceSeconds} required />
              <FormInput control={control} name="offerExpiryHours" label="Offer Expiry (hours)" type="number" mono step={1} min={1} max={720} hint={HINT.offerExpiryHours} required />
              <FormInput control={control} name="offerExpiringNoticeHours" label="Expiry Reminder (hours)" type="number" mono step={1} min={1} max={72} hint={HINT.offerExpiringNoticeHours} required />
              <FormInput control={control} name="runLockTtlSeconds" label="Run Lock Timeout (seconds)" type="number" mono step={1} min={30} max={3600} hint={HINT.runLockTtlSeconds} required />
              <FormInput control={control} name="maxRunRetries" label="Automatic Retries" type="number" mono step={1} min={0} max={10} hint={HINT.maxRunRetries} required />
            </div>
          </Panel>
          <Panel title="Multi-Area Alert" description="Tell nearby Space Givers and Course Providers when demand spreads across areas." icon="triangle-alert">
            <div className="flex flex-col gap-4">
              <FormInput control={control} name="alertMinAreas" label="Minimum Areas (N)" type="number" mono step={1} min={1} max={50} hint={HINT.alertMinAreas} required />
              <FormInput control={control} name="alertMinRequests" label="Requests per Area (M)" type="number" mono step={1} min={1} max={1000} hint={HINT.alertMinRequests} required />
              <FormInput control={control} name="alertWindowDays" label="Window in Days (W)" type="number" mono step={1} min={1} max={365} hint={HINT.alertWindowDays} required />
            </div>
          </Panel>
          <Panel title="Demand Grouping" description="How Demand Insights groups areas into demand levels." icon="chart-line">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormInput control={control} name="kMin" label="Fewest Groups" type="number" mono step={1} min={2} max={10} hint={HINT.kMin} required />
              <FormInput control={control} name="kMax" label="Most Groups" type="number" mono step={1} min={2} max={12} hint={HINT.kMax} required />
              <FormInput control={control} name="kInits" label="Attempts" type="number" mono step={1} min={1} max={50} hint={HINT.kInits} required />
              <FormInput control={control} name="seed" label="Seed" type="number" mono step={1} hint={HINT.seed} required />
            </div>
          </Panel>
          <Panel title="Notifications" description="Email copies of in-app notifications." icon="bell">
            <div className="flex flex-col gap-3">
              <FormSwitch control={control} name="emailEnabled" label="Send email copies" hint="Needs Resend configured on the server. People can still turn email off in their profile." />
              <Alert tone="neutral">In-app notifications are always sent. Email is extra and never blocks them.</Alert>
            </div>
          </Panel>
          <Panel title="Accounts" description="Who must wait for approval before signing in." icon="users">
            <FormSwitch
              control={control}
              name="requirePartnerApproval"
              label="Require approval for new partners"
              hint="New Space Giver and Course Provider accounts stay pending until an Administrator approves them on the Users page."
            />
          </Panel>
        </PanelGrid>
      </form>
    </>
  );
}

function WeightsEditor({
  control, strategyKey, active, error, normalising, onNormalise, onReset,
}: {
  control: Control<FormIn, unknown, FormOut>;
  strategyKey: Strategy;
  active: boolean;
  error?: string;
  normalising: boolean;
  onNormalise: () => void;
  onReset: () => void;
}) {
  const weights = useWatch({ control, name: `strategies.${strategyKey}` }) as Partial<WeightsInput> | undefined;
  const total = weightTotal(weights);
  const ok = isBalanced(total);
  const complete = WEIGHT_KEYS.every((k) => Number.isFinite(weights?.[k]));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-label uppercase text-ink-muted">Total</span>
          <span className="font-mono text-data tabular-nums text-ink" aria-live="polite">
            {total.toFixed(2)}
          </span>
          <Badge tone={ok ? 'success' : 'warning'}>{ok ? 'Adds up to 1' : 'Must add up to 1'}</Badge>
          {active ? <Badge tone="accent">Active</Badge> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={onReset}>
            Reset to Default
          </Button>
          <Button size="sm" variant="secondary" type="button" icon="refresh-cw" onClick={onNormalise} loading={normalising} disabled={!complete || total <= 0}>
            Normalise
          </Button>
        </div>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        {WEIGHT_KEYS.map((k) => (
          <FormInput
            key={k}
            control={control}
            name={`strategies.${strategyKey}.${k}`}
            label={WEIGHT_LABEL[k]}
            type="number"
            mono
            step={0.01}
            min={0}
            max={1}
            required
          />
        ))}
      </div>
      {complete && total > 0 ? (
        <SegmentBar segments={weightSegments(weights as WeightsInput)} label={`${STRATEGY_LABEL[strategyKey]} weights`} />
      ) : null}
    </div>
  );
}
