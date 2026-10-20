# EduSpace UI catalogue

Every page is built from these components. They follow the EduSpace design system
(https://claude.ai/artifact/58sQU8fyC1kGAdBL2o9xmQ) and use only the Tailwind token names from
`src/app/globals.css`. You can see every component in every state at **`/ui-kit`** (Administrator only).

```ts
import { Button, Panel, DataTable, StatusBadge } from '@/components/ui';
import { FormInput, FormSelect, FormWindowEditor, FormLocationPicker, applyServerErrors } from '@/components/forms';
import { MapView, type MapData } from '@/components/map';
import { LineChart, BarChart } from '@/components/charts';
```

## Rules you must keep

- Use **one `primary` Button per view**: the action the page exists for. Use `secondary` for everything else, `ghost` for Cancel and Not Now, and `danger` for destructive actions.
- `accent` is a **fill only**. If text must be orange, use `text-accent-ink`.
- **Statuses always carry a word.** Use `<StatusBadge status={x} />`, which takes its tone from `STATUS_TONE` and its label from `ALLOCATION_LABEL`. Never colour text by hand.
- Show deltas with `<Delta>`, which adds the sign and arrow. Set figures with `tabular-nums`; `StatCard` and `DataTable` do this for you.
- Format money, dates, times and km with `src/lib/format.ts` (`formatInr`, `formatDate`, `formatWindow`, `formatKm`). Put dates, times, scores and distances in mono.
- Call a score a **compatibility score** and show two decimals (`ScoreBar`, `CriterionRow`). Never call it a percent or a probability.
- Never show "AI", "K-Means" or "Hungarian". Users see **Smart Allocation** and **Demand Insights**.
- Never show a learner's exact point to another role. Show "Kothrud (area centre)" instead.
- Copy uses Title Case for titles, nav and buttons, and sentence case with a full stop for descriptions. No emoji, no exclamation marks.
- Do not use `window.confirm` or `alert`. Use `useConfirm()` or `ConfirmDialog`, and report outcomes with `useToast()`.
- To merge classes, import `cn` from `@/components/ui`. It knows the token names; the `cn` in `src/lib/utils.ts` drops `text-control` next to `text-ink`.

## Page skeleton (follow this for every feature page)

The `(app)` layout supplies the rail, the breadcrumb bar (derived from the path and menu labels), the bell, the theme toggle, the account menu and a `ToastProvider`. A page renders only its content:

```tsx
'use client';
import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiGet, type Paged } from '@/lib/api';
import { Button, DataTable, EmptyState, PageHeader, Panel, PanelGrid, StatCard, StatusBadge, type DataTableColumn, type SortState } from '@/components/ui';
import { formatNumber } from '@/lib/format';

interface SpaceRow { id: string; name: string; areaName: string; seats: number; status: string }

const columns: DataTableColumn<SpaceRow>[] = [
  { key: 'name', header: 'Space', sortable: true },
  { key: 'areaName', header: 'Area', hideBelow: 'sm' },
  { key: 'seats', header: 'Seats', align: 'end', sortable: true, cell: (r) => formatNumber(r.seats) },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
];

export default function SpacesPage() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>(null);
  const [q, setQ] = useState('');
  const query = useQuery({
    queryKey: ['spaces', { page, sort, q }],
    queryFn: () => apiGet<Paged<SpaceRow>>('/api/spaces', { page, pageSize: 20, q, sort: sort?.key, dir: sort?.direction }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Space Registry"
        description="Every registered space, its seats and status."
        actions={<Button variant="primary" icon="plus" href="/spaces/new">Add Space</Button>}
      />
      <PanelGrid columns={3}>
        <Panel><StatCard label="Spaces" value={formatNumber(query.data?.total ?? 0)} loading={query.isPending} /></Panel>
        {/* more panels */}
      </PanelGrid>
      <Panel title="All Spaces" description="Search, sort and open a space.">
        <DataTable
          caption="Spaces"
          columns={columns}
          rows={query.data?.items ?? []}
          rowKey={(r) => r.id}
          rowHref={(r) => `/spaces/${r.id}`}
          searchable
          searchPlaceholder="Search spaces"
          itemLabel="spaces"
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          empty={<EmptyState icon="building-2" description="No spaces yet. Add your first space to start receiving classes." size="compact" />}
          server={{
            page, pageSize: 20, total: query.data?.total ?? 0, onPageChange: setPage,
            sort, onSortChange: (s) => { setSort(s); setPage(1); },
            onSearch: (text) => { setQ(text); setPage(1); },
          }}
        />
      </Panel>
    </>
  );
}
```

Every page must handle these states (PLAN 6.8):

- **Loading.** Show skeletons shaped like the content: `StatCard loading`, `DataTable loading`, `Skeleton` and `SkeletonText`. The `(app)/loading.tsx` covers route transitions. Never show a lone spinner.
- **Empty.** Use `EmptyState`: an icon, one sentence and one action.
- **Error.** Use `ErrorState error={err} onRetry={refetch}`, which turns an `ApiError` into a sentence. The `(app)/error.tsx` catches render errors.
- **Not found.** Call `notFound()` from `next/navigation`; `(app)/not-found.tsx` renders it.

### Forms

Forms use React Hook Form with `zodResolver` and the same schema the route handler uses. Map 422 errors with `applyServerErrors`, which wraps `fieldErrors()` from `src/lib/api.ts`:

```tsx
const { control, handleSubmit, setError, formState } = useForm({ resolver: zodResolver(SpaceInput), defaultValues });
const toast = useToast();
const onSubmit = handleSubmit(async (values) => {
  try {
    await apiSend('POST', '/api/spaces', values);
    toast.success('Saved');
    router.push('/spaces');
  } catch (err) {
    applyServerErrors(setError, err); // 422 field errors go to their fields; anything else goes to errors.root.server
  }
});
const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;
// <form onSubmit={onSubmit} noValidate> {rootError && <Alert tone="danger">{rootError}</Alert>} ... </form>
```

### Map

```tsx
const map = useQuery({ queryKey: ['map', filters], queryFn: () => apiGet<MapData>('/api/map', filters) });
<MapView data={map.data} loading={map.isPending} error={map.error} onRetry={() => map.refetch()} layers={['spaces', 'demand', 'unusedHours']} />
```

`MapView` is a client component. It loads Leaflet with `next/dynamic({ ssr: false })` internally, so you can import it anywhere. Do **not** import `map-canvas.tsx` directly.

---

## Components (`@/components/ui`)

Every component takes a `className` that is merged with `cn`. In React 19, `ref` is a regular prop and reaches the element on Button, Input, Select, Textarea, Checkbox and SearchField.

| Component | Props | Use |
| --- | --- | --- |
| `Button` | `variant: 'primary' \| 'secondary' \| 'ghost' \| 'danger'` (default secondary), `size: 'sm' \| 'md'`, `icon`, `iconRight` (an icon name or a node), `loading`, `block`, `href` (renders a Next `Link`), plus native button or Link props | One action, in mono Title Case. `loading` shows a spinner and disables the button. |
| `IconButton` | `icon`, `label` (**required**: the accessible name and tooltip), `size: 'sm' \| 'md'` | Obvious secondary actions in tray eyebrows and toolbars. Never a page's main action. |
| `ActionTile` | `icon`, `label`, `description?`, `selected?` (sets aria-pressed) | Two to four dashboard shortcuts, or a chooser (role picker). |
| `Badge` | `tone: Tone`, `dot?`, `children` | Status of one record, in a word. |
| `StatusBadge` | `status` (a domain value), `tone?` (override), `label?`, `dot?` | **Default for every status.** For example, facility-issue "Open" needs `tone="warning"`. |
| `Tag` | `tone` (default accent), `icon?`, `attached?` | The category of a whole card (demand level, course category). `attached` sits on top of a card like a folder tab; give that card `rounded-tl-none`. |
| `Delta` | `value`, `suffix='%'`, `digits=1`, `invert?` | Change against the last period. Set `invert` when a decrease is good. |
| `StatCard` | `label` (eyebrow), `value`, `icon?`, `action?`, `title?`, `delta?` (a number or a node), `footnote?`, `size: 'lg' \| 'xl'`, `loading?`, `children?` | KPI tray. One figure per tray. Write the footnote as a comparison with the number in `<strong>`. |
| `Progress` | `value`, `max=100`, `label` (**required**), `tone: FillTone`, `size: 'sm' \| 'md'`, `startLabel`, `endLabel` | One capacity ("18 seats filled" / "24 seats"). Use `size="sm"` in table cells. |
| `SegmentBar` | `segments: {label, value, tone}[]`, `label?`, `showLegend=true`, `size` | Share of a whole, five parts or fewer. Order the tones accent, success, info, sky, then neutral for "Idle". |
| `ScoreBar` | `score` (0..1), `label='Compatibility score'`, `showLabel`, `size` | Compatibility score as two decimals plus a bar. |
| `CriterionRow` | `name`, `status: 'pass' \| 'partial' \| 'fail'`, `detail`, `score?` (omit for a hard constraint), `firstFailure?` | "Why this space" and "Why not the others", one row per check in engine order. |
| `DataTable<T>` | `columns: {key, header, cell?, align?, sortable?, sortValue?, searchValue?, width?, hideBelow?}[]`, `rows`, `rowKey`, `caption` (**required**), `searchable`, `searchPlaceholder`, `toolbar`, `pageSize=10` (0 = all), `initialSort`, `server?: {page, pageSize, total, onPageChange, sort?, onSortChange?, onSearch?}`, `loading`, `skeletonRows`, `error`, `onRetry`, `empty`, `onRowClick`, `rowHref`, `itemLabel` | Record lists. Client mode searches, sorts and pages `rows`. Server mode is controlled, and search is debounced by 300 ms. Right-align numbers with `align: 'end'`. |
| `Pagination` | `page` (1-based), `pageSize`, `total`, `onPageChange`, `itemLabel?` | Standalone pagination. DataTable already includes it. |
| `NavItem` | `href`, `label`, `icon?`, `active?`, `sub?`, `badge?` | Rail items. The shell builds these from `/api/me/menu`. |
| `Breadcrumb` | `items: (string \| {label, href?})[]`, `icon?` | The header shows it automatically. Use it inside a page only when you need one there. |
| `SearchField` | `id` (**required**), `placeholder`, `label`, `shortcut?`, `size`, plus input props | Search above a table, with a specific placeholder ("Search areas"). |
| `Input` | `size: 'sm' \| 'md' \| 'lg'`, `mono?`, plus input props | Control primitive. Wrap it in `Field`. |
| `Textarea` | native props | Multi-line text. |
| `Select` | `options?: {value,label,disabled?}[]`, `placeholder?` (adds an empty option), `size`, plus select props | Native select restyled. |
| `Checkbox` | `label`, `description?`, plus input props | Native checkbox with its label. |
| `Switch` | `checked`, `onCheckedChange`, `label?` | On/off setting (`role="switch"`). |
| `RadioGroup` | `name`, `legend`, `hideLegend?`, `options: {value,label,description?}[]`, `value`, `onValueChange`, `orientation` | Exclusive choice inside a fieldset. |
| `Field` | `label`, `hint?`, `error?`, `required?`, `optional?`, `id?`, `children` (an element or a render function) | Wires the label, hint and error to the control (`id`, `aria-describedby`, `aria-invalid`). |
| `Label`, `FieldError` | — | Low-level pieces of `Field`. |
| `Kbd` | `children` | Keyboard hint. |
| `PageHeader` | `title`, `description?`, `actions?`, `meta?` | Title row under the breadcrumb bar. The primary button goes last in `actions`. |
| `Panel` | `title?`, `description?`, `icon?`, `actions?`, `flush?`, `id?`, `bodyClassName?` | One section: heading, a one-line description, then the body. |
| `PanelGrid` | `columns: 1 \| 2 \| 3` | Tiles panels edge to edge with 1px hairlines. Widen a panel with `className="lg:col-span-2"`. |
| `KeyValueList` | `items: {label, value, mono?}[]`, `columns: 1 \| 2` | Facts with dashed meta rules. |
| `Divider` | `variant: 'solid' \| 'dashed'`, `orientation` | A rule. Use dashed between a figure and its meta. |
| `Timeline` | `steps: {label, state: 'done' \| 'current' \| 'pending' \| 'failed', date?, description?}[]`, `label?` | A learner request's status timeline. |
| `EmptyState` | `description` (one sentence), `icon='inbox'`, `title?`, `action?`, `size: 'md' \| 'compact'` | Empty lists and panels. |
| `ErrorState` | `error?` or `message?`, `onRetry?`, `retryLabel`, `size` | Load failures: a danger badge, a sentence and Try Again. |
| `Alert` | `tone: 'neutral' \| 'info' \| 'success' \| 'warning' \| 'danger'`, `title?`, `children`, `action?` | Inline notices: form errors, pending approval, offer expiry. |
| `Skeleton`, `SkeletonText`, `LoadingLabel` | `className` / `lines` / text | Loading placeholders, plus an announcement for screen readers. |
| `UserChip` | `name`, `meta?`, `compact?` | Initials circle with a name. No photos. |
| `Dialog` | `open`, `onClose`, `title`, `description?`, `footer?`, `size: 'sm' \| 'md' \| 'lg'`, `dismissible=true` | Modal on the native `<dialog>`: the rest of the page is inert, Esc closes it and focus returns to the opener. |
| `ConfirmDialog` | `open`, `onClose`, `onConfirm` (can be async; shows loading and stays open if it throws), `title`, `description?`, `confirmLabel`, `cancelLabel`, `tone: 'primary' \| 'danger'` | Confirmation with built-in state. |
| `useConfirm()` | returns `{ confirm(opts): Promise<boolean>, dialog }`; render `{dialog}` once | Confirmation in a single line: `if (await confirm({ title: 'Cancel Allocation?', tone: 'danger' }))`. |
| `Drawer` | `open`, `onClose`, `label`, `side` | Slide-over sheet; the mobile rail uses it. |
| `Tabs` + `TabPanel` | Tabs: `id`, `label`, `items: {value,label,count?,disabled?}[]`, `value`, `onValueChange`. TabPanel: `id`, `value`, `active` | Accessible tablist with arrow keys and Home/End. |
| `useToast()` | `toast(msg, {tone, description, duration})`, `success(msg)`, `error(msg)` | Short status messages ("Saved"). The `(app)` and `(auth)` layouts provide it; outside a provider it does nothing. |
| `ToastProvider` | — | Already mounted in the app and auth layouts. |
| `Tooltip` | `content`, `side`, `children` (one focusable element) | Supplementary hint. The trigger still needs its own accessible name. |
| `Popover` | `trigger(props, open)`, `children(close)`, `label`, `align` | Click-to-open panel (the bell and the account menu use it). Closes on an outside click or Esc. |
| `Icon` | `name` (a kebab-case lucide name from `ICONS`), `size=16` (18 in nav), `strokeWidth=1.6`, `title?` | Line icons. Unknown names fall back to a circle. Add new icons to `ICONS` in `icon.tsx`. |
| `statusLabel(s)`, `formatDelta`, `errorMessage(err)`, `initials`, `TONE_TINT`, `TONE_FILL`, `SERIES_ORDER` | — | Helpers. |

`Tone` is `neutral | accent | success | info | warning | danger`. `FillTone` adds `sky` and uses `neutral` for the border-strong remainder.

## Forms (`@/components/forms`)

Every bound field takes `control` (from `useForm`), `name`, `label`, plus `hint?`, `required?`, `optional?`, `disabled?` and `className?`. The types follow your schema, including zodResolver's input and output types.

| Component | Extra props | Value |
| --- | --- | --- |
| `FormInput` | `type`, `placeholder`, `autoComplete`, `mono`, ... | string. With `type="number"` it stores a number, or `undefined` when empty. |
| `FormTextarea` | `rows`, `placeholder`, `maxLength` | string |
| `FormSelect` | `options`, `placeholder`, `parse?` (for example `Number` for `dayOfWeek`) | string (or the parsed value). The empty choice stores `undefined`. |
| `FormCheckbox` | `description?` | boolean |
| `FormSwitch` | — | boolean |
| `FormRadioGroup` | `options`, `orientation` | string |
| `FormCommaList` | `placeholder` | `string[]`, edited as comma-separated text (for example accessibility needs) |
| `FormWindowEditor` / `WindowEditor` | `step=30` (minutes); controlled version: `value`, `onChange`, `rowErrors`, `error`, `newWindow`, `max` | `{dayOfWeek, startTime, endTime}[]`. Has a Sun–Sat day select, 24-hour time selects, Add Slot and remove buttons, and shows end-before-start and same-day overlap errors as you edit. Pair it with `z.array(WindowInput).refine(noOverlap)`. |
| `FormLocationPicker` / `LocationPicker` | `height=280`; controlled version: `value`, `onChange`, `error` | GeoJSON `{type:'Point', coordinates:[lng, lat]}`. Pick a point by clicking the map, dragging the pin, using "Pin Map Centre" (for keyboard users) or typing latitude and longitude. OpenStreetMap tiles, default centre Pune, zoom 12. It does not use device location. |
| `applyServerErrors(setError, err)` | — | Sends 422 field errors to their fields and anything else to `root.server`. Returns true when a field error was applied. |
| `latLngToPoint`, `pointToLatLng`, `pointToTuple`, `isValidPoint`, `findWindowProblems`, `timeOptions`, `sortWindows`, `splitCommaList` | — | Pure helpers, covered by unit tests. |

FacilityEditor is not part of this layer; the spaces page builds it from these fields.

## Map (`@/components/map`)

`MapView` takes these props:

- `data?: MapData`
- `loading`, `error`, `onRetry`
- `layers?` (the toggles to offer; defaults to the layers present in `data`)
- `initialLayers?`
- `showControls=true`, `showLegend=true`
- `height=420`
- `center?` (otherwise the view fits the data)
- `zoom?`
- `label` (the accessible name)

`MapData` is the shape `GET /api/map` should return. All points are GeoJSON `[lng, lat]`.

```ts
{
  spaces?:      { id, name, status: 'available' | 'booked' | 'inactive', location, seats, areaName?, categories?, href? }[];
  allocations?: { id, from /* space */, to /* area centre */, spaceName?, areaName?, courseTitle?, category?, learners?, href? }[];
  demand?:      { areaId, areaName, centre, openRequests, level: 'High' | 'Medium' | 'Emerging', category? }[];
  offers?:      { id, title, location, spaceName?, category?, schedule?, distanceKm?, href? }[];
  unusedHours?: { spaceId, name, location, hours }[];
  categories?:  string[];
}
```

How each layer is drawn:

- **Spaces:** circle markers. Available is success, booked is accent, inactive is border-strong.
- **Allocations:** info polylines to the area centre.
- **Demand:** semi-transparent circles sized by open requests (8–28 px). High is accent, Medium is info, Emerging is success.
- **Offers:** info diamonds.
- **Unused hours:** "14 h idle" badges.

The controls are checkbox chips for each layer plus Available Only, a category select and a demand level select. A legend sits underneath. Colours are read from CSS variables at runtime, so dark mode works; the tiles are dimmed in dark mode. Markers use circle markers and divIcons, so there are no image assets to break.

## Charts (`@/components/charts`)

| Component | Props |
| --- | --- |
| `LineChart<T>` | `data`, `xKey`, `series: {key, label, tone?}[]`, `label` (**required**: an accessible summary), `height=240`, `valueFormatter`, `xFormatter`, `futureFromIndex?` (greys out the future), `loading`, `showLegend`, `footer` |
| `BarChart<T>` | `data`, `xKey`, `series`, `label` (**required**), `height`, `stacked?`, `horizontal?` (for long category labels), `valueFormatter`, `loading`, `showLegend`, `footer` |

A single-series line chart uses a 2px info stroke with an info-tint area. Several series, and all bars, follow the series order accent, success, info, sky. Both charts have a faint grid, mono tabular axis labels, a dashed cursor on lines and an inner-card tooltip. Colours come from CSS variables at runtime.

## Hooks (`@/hooks/*`)

| Hook | Returns |
| --- | --- |
| `useMe()` | `GET /api/me` → `Me {id, name, email, role, status, ownerRefId}` |
| `useMenu(initial?)` | `GET /api/me/menu` → `MenuItem[]` (accepts an array, `{items}` or `{menu}`) |
| `useUnreadCount()` | polls `GET /api/notifications/unread-count` every 30 s |
| `useNotifications({page,pageSize,unread})` | `GET /api/notifications` → `Paged<NotificationItem>` |
| `useMarkNotificationRead()`, `useMarkAllNotificationsRead()` | mutations that invalidate `notificationKeys.all` |
| `useLookups()` | `GET /api/lookups` → `{facilityTypes, categories, areas}` as `{id, name}[]` |
| `usePublicImpact()` | `GET /api/public/impact` |
| `useDebouncedValue(v, ms)` | debounced value |
| `useTheme()` / `useThemeValue()` | `{theme, setTheme, toggle}`; writes `localStorage['eduspace-theme']` |
| `useThemeColors()` | `{colors, ready}`: resolved token colours for libraries |
| `useMediaQuery(q)` / `useIsDesktop()` | boolean |
