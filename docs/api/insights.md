# Insights, Notifications, Analytics, Impact, Settings and Map API

Every response has the shape `{ data }` on success or `{ error: { code, message, details } }` on failure.
Ids are strings and coordinates are `[lng, lat]`. Paged lists return `{ items, total, page, pageSize, pages }` (`Paged<T>` in `src/lib/api.ts`).

Common errors on every endpoint:

| Status | Code | When |
| --- | --- | --- |
| 401 | `unauthorized` | Not signed in (all endpoints except `/api/public/impact`) |
| 403 | `forbidden` | Wrong role, account not active, or another owner's data |
| 404 | `not_found` | Unknown id |
| 422 | `validation_failed` | Body or query failed Zod validation. `details` is `z.flattenError` output (`formErrors`, `fieldErrors`) |

**Privacy.** No endpoint here returns a learner's exact location to anyone else. Learner positions appear only as **area centres** (`areaCenter`, `center`, `to[].center`). Demand data is always aggregated (counts per area and category).

Response types live in `src/server/dto/{notification,insight,analytics,impact,map,audit}.ts` and in the service files named below. Import them with `import type` in client code.

---

## Notifications

| Method and path | Roles | Purpose |
| --- | --- | --- |
| `GET /api/notifications` | all | The caller's own notifications, newest first |
| `GET /api/notifications/unread-count` | all | `{ count }` for the bell. Poll it |
| `POST /api/notifications/:id/read` | all (owner) | Mark one notification read. Returns the updated `NotificationDto` |
| `POST /api/notifications/read-all` | all | `{ updated }` |

`GET /api/notifications` query: `page` (default 1), `pageSize` (1–100, default 20), `unread=1` (unread only).
Response: `Paged<NotificationDto> & { unread: number }`.

```ts
NotificationDto { id, type, title, message, href: string | null, relatedType: string | null, relatedId: string | null, isRead, createdAt }
```

Administrators get their own notifications, which include system alerts such as `run.failed`, `schedule.clash` and `facility.issueReported`. Marking another user's notification read returns 404.

### Notification templates (Administrator)

| Method and path | Body or response |
| --- | --- |
| `GET /api/notification-templates` | `{ items: TemplateDto[] }`: built-in defaults merged with stored overrides, one row per (type, role) |
| `PATCH /api/notification-templates` | Body `{ type, role, titleTemplate (1–200), bodyTemplate (1–2000), sendEmail? }`. Upserts the override and returns the `TemplateDto`. Audited |

```ts
TemplateDto { type, role, titleTemplate, bodyTemplate, sendEmail, customised: boolean,
  defaultTemplate: { titleTemplate, bodyTemplate, sendEmail } | null,   // for "Reset to default"
  placeholders: string[],                                              // e.g. ["courseTitle", "spaceName"]
  updatedAt: string | null }
```

Placeholders use the `{{name}}` form. `{{recipientName}}` is always available. Unknown placeholders render as an empty string. A change applies to the next notification sent; no redeploy is needed.

Email copies go out only when `settings.emailEnabled` is on, Resend is configured, the template has `sendEmail`, and the user turned on `emailNotifications`. A failed email never blocks the in-app notification.

---

## Demand insights

| Method and path | Roles | Query |
| --- | --- | --- |
| `GET /api/demand-insights` | all | `areaId`, `categoryId`, `level` (`High` / `Medium` / `Emerging`) |
| `GET /api/demand-insights/areas` | all | `categoryId`, `level` (filters on the area's run-assigned demand level) |

`GET /api/demand-insights` returns:

```ts
{ items: DemandInsightDto[], ownAreaId: string | null, computedAt: string | null }
DemandInsightDto { areaId, areaName, areaCenter: [lng, lat], categoryId, categoryName, level, demand, seatsOffered, gap, computedAt, isOwnArea }
```

Rows are sorted with the learner's own area first (the "Own area summary"), then by level (High first), then by gap (largest first). `ownAreaId` comes from the learner's profile area, or else the area of their latest request. For other roles it is `null`.

`GET /api/demand-insights/areas` returns `{ items: AreaDemandDto[] }`, one row per area, sorted by gap. Use it for the heatmap:

```ts
AreaDemandDto { areaId, areaName, areaCenter, demandLevel: DemandLevel | null, demandIndex: number | null,
  demand, seatsOffered, gap, openRequests, categories }
```

### Multi-area demand alert (worker)

The worker calls `evaluateDemandAlerts(): Promise<{ fired }>` from `src/server/services/alerts.ts` after each publish. It applies the README section 14 rule:

1. Count open requests (statuses `Submitted`, `Analysed`, `Unmatched`, `Matched`) created within `alertWindowDays`, per category and area.
2. Keep areas with at least `alertMinRequests` such requests.
3. Remove areas already served by a `ConfirmedByProvider`, `Scheduled` or `Active` allocation of that category. An area is served when the allocation's space is in it or the offering targets it.
4. If at least `alertMinAreas` areas remain, notify:
   - Space Givers with an active space within `maxRadiusKm` of any of those areas, whose policy allows the category, and who have a free (unblocked, unbooked) slot.
   - Course Providers who have a course in the category or in its parent.

Template variables: `categoryName`, `areaCount`, `anchorArea`, `requestCount`, `freeSlot` (for example `Mon 18:00–20:00 (60 seats)`), `spaceName`, `seats`.

The alert is deduplicated through `AlertState { key: "demand:<categoryId>" }`, keyed on a signature of the sorted area ids and their counts bucketed by `alertMinRequests`. It fires again only when that signature changes. When the category stops qualifying, its state is cleared.

---

## Recommendations

### `GET /api/recommendations?requestId=`

Roles: the Learner who owns the request, or an Administrator. Other roles get 403.

The response uses the suggestions stored by the last run. When none are stored, it computes them live with the engine's `suggestFor`. The request's status is never changed, so an Unmatched request stays open.

```ts
RecommendationResult { requestId, requestStatus, source: 'stored' | 'live' | 'none', items: RecommendationItem[] }
RecommendationItem { offeringId | null, offeringTitle | null, providerName | null, categoryId, categoryName,
  spaceId | null, spaceName | null, areaId | null, areaName | null, session: string | null,   // "Sat 10:00–12:00"
  feePerMonth | null, distanceKm | null,   // measured from the learner's AREA CENTRE
  score /* compatibility score 0..1 */, reasons: string[] }
```

`source: 'none'` with empty `items` means the engine was unavailable.

### `GET /api/recommendations/discover` (Learner only)

Powers the Discover Courses page.

```ts
DiscoverResult {
  areaId, areaName, radiusKm,
  offerings: DiscoverOffering[],              // Open or Allocated, seats left, within radiusKm of the area centre; up to 30
  highDemandCategories: DiscoverCategory[],   // High/Medium demand in nearby areas; up to 5
  similarCategories: DiscoverCategory[],      // same parent as, parent of, or child of a requested category; up to 6
}
DiscoverOffering { offeringId, title, providerName, categoryId, categoryName, status, spaceName, areaName, session,
  seatsLeft, feePerMonth, distanceKm, matchesRequest, reasons: string[] }
DiscoverCategory { categoryId, categoryName, reasons: string[] }
```

`radiusKm` is the larger of `settings.maxRadiusKm` and the largest `maxDistanceKm` among the learner's open requests. Offerings that match one of the learner's requests are listed first, then the rest by distance.

---

## Attendance and feedback

### `POST /api/attendance`

Roles: the Course Provider who owns the allocation, or an Administrator.

Body: `{ scheduleId, records: [{ enrollmentId, present }] }`, with 1–500 records and each enrollment at most once.

- Only `Accepted` enrollments of that session's allocation may be marked. Any other enrollment returns 400 with `details.enrollmentIds`.
- Records are upserted by (enrollment, session date), so marking a session again overwrites it.
- The session becomes `Held`. A `Cancelled` or `Moved` session returns 409.
- Each call is audited.
- When no `Planned` sessions remain, learners get a `course.completed` "rate your course" notification, once per allocation.

Returns 201 `{ scheduleId, recorded, present }`.

### `GET /api/attendance?allocationId=`

Roles: the provider who owns the allocation, the Space Giver who owns its space, or an Administrator. Learners get 403.

```ts
AttendanceReport { allocationId, offeringTitle, acceptedLearners, sessionsHeld, attendanceRate: number | null,
  sessions: [{ scheduleId, date, startTime, endTime, status, present, absent, marked }],
  learners: [{ enrollmentId, learner: LearnerView | null, attended, sessionsMarked, rate: number | null }] | null }
```

Space Givers get `learners: null` (counts only). Providers get `LearnerView` with `visibility: 'provider-accepted'`, from `src/server/dto/privacy.ts`.

### `POST /api/feedback` (Learner)

Body: `{ enrollmentId, rating (integer 1–5), comment? (up to 2000 characters) }`.

- Only the learner who owns an `Accepted` enrollment may rate it. Anyone else gets 403.
- A second rating for the same enrollment returns 409.
- Returns 201 with a `FeedbackDto`.

### `GET /api/feedback?offeringId=`

Roles: Course Provider (own offerings; all of them when `offeringId` is omitted; another provider's offering returns 403), Learner (only their own feedback), Administrator (everything). Space Givers get 403.

```ts
FeedbackList { items: FeedbackDto[], count, averageRating: number | null }
FeedbackDto { id, enrollmentId, offeringId, offeringTitle, rating, comment, learnerName: string | null, createdAt }
```

`learnerName` is `null` for providers, so they see feedback anonymously.

---

## Analytics

### `GET /api/analytics`

Roles: Administrator, Space Giver, Course Provider. Learners get 403.

Query: `scope` (`global` / `SpaceGiver` / `CourseProvider`) and `ownerId`.

- Non-admins always get their own scope, and `scope` is ignored. Passing an `ownerId` other than their own returns 403.
- An Administrator may pass `scope=SpaceGiver&ownerId=` or `scope=CourseProvider&ownerId=` to see one owner's view. A role mismatch returns 403.

The response is one of three shapes, told apart by `scope`.

**Administrator**: `{ scope: 'Administrator', kpis: AdminKpis }`

```ts
AdminKpis { requestsTotal, requestsByStatus: Record<status, n>, coverageRate, avgDistanceKm, seatUtilisation,
  spaceUtilisationHours /* weekly booked */, spaceOpenHours /* weekly open */, waitlistRate,
  runsLast30Days, runsByStatusLast30Days, unmatchedCount, facilityAlertsOpen, allocationsByStatus,
  trend: [{ week /* Monday, YYYY-MM-DD */, requests, seatsOffered, seatsFilled }]   // 12 weeks, oldest first
}
```

All rates are 0..1. How each KPI is computed:

- `coverageRate`: requests in `Matched`, `Waitlisted`, `Offered`, `Accepted`, `Scheduled`, `Active` or `Completed`, divided by requests that are not Cancelled.
- `waitlistRate`: requests with a Waitlisted enrollment, divided by requests that are not Cancelled.
- `seatUtilisation`: seats held (Proposed, Offered or Accepted enrollments), divided by the batch sizes of offerings that have a live allocation.

**Space Giver**:

```ts
{ scope: 'SpaceGiver', ownerId, spaces: SpaceUsageRow[], byWeekday: [{ dayOfWeek, openHours, bookedHours }] /* 0 = Sun */,
  totals: { openHours, bookedHours, unusedHours, utilisation }, upcomingSessions, pendingApprovals, sessionsHeld, issuesOpen }
SpaceUsageRow { spaceId, spaceName, isActive, seatCapacity, openHours, bookedHours, unusedHours, utilisation }
```

**Course Provider**:

```ts
{ scope: 'CourseProvider', ownerId, offeringsByStatus, seatsOffered, seatsFilled, acceptedLearners,
  attendanceRate: number | null, averageRating: number | null, ratingsCount, highDemandAreas: HighDemandArea[] }
HighDemandArea { areaId, areaName, areaCenter, categoryId, categoryName, level, demand, seatsOffered, gap }
```

`highDemandAreas` holds DemandInsight rows at High or Medium level for the provider's course and offering categories, sorted by gap, up to 10.

### `GET /api/analytics/dashboard` (all roles)

Returns every widget the caller's dashboard needs (README section 17) in one call. Switch on `role`.

**Administrator**

```ts
{ role: 'Administrator',
  kpis: AdminKpis,
  latestRun: { id, status, trigger, strategy, startedAt, finishedAt, metrics, baselineMetrics, counts, error } | null,
  unmatchedRequests: [{ id, learnerName, categoryName, areaName, status, createdAt, topSuggestion: string | null }],  // oldest 5
  facilityAlerts: [{ id, spaceId, spaceName, facilityName, affectedQuantity, affectedAllocations, createdAt }],      // open, newest 5
  demandByArea: AreaDemandDto[],                                    // top 10 by gap, for the heatmap
  utilisation: { bookedHours, openHours, ratio, seatUtilisation },
  impact: { period, metrics: ImpactMetrics, computedAt } }
```

**Learner**

```ts
{ role: 'Learner',
  requests: [{ id, categoryName, areaName, status, note: string | null, createdAt,
               timeline: [{ status, label, state: 'done' | 'current' | 'upcoming' }] }],   // latest 10
  pendingOffers: [{ enrollmentId, offeringId, offeringTitle, spaceName, areaName, session, distanceKm, expiresAt }],
  recommended: DiscoverOffering[],    // top 3, same shape as Discover
  nearbyOffers: number }              // count of the map "offers" layer
```

Timeline steps are Submitted, Analysed, Matched, Offer sent, Accepted, Scheduled, In class, Completed. Off-path statuses sit where they happen and carry a `note`:

- `Unmatched` sits at Analysed.
- `Waitlisted` sits at Matched.
- `Declined` and `Expired` sit at Offer sent.

Accept and decline with the enrollment endpoints (`POST /api/enrollments/:id/accept|decline`).

**Space Giver**

```ts
{ role: 'SpaceGiver',
  utilisation: { spaces: SpaceUsageRow[], byWeekday, totals },
  upcomingSessions: [{ scheduleId, date, startTime, endTime, spaceName, courseTitle }],               // next 5
  pendingApprovals: [{ allocationId, courseTitle, spaceName, session, headcount, score, createdAt }],  // Proposed, oldest 5
  unusedHours: number,                                                                                // weekly
  nearbyDemand: AreaDemandDto[],              // aggregated, areas within maxRadiusKm of own spaces, top 5
  openIssues: [{ id, spaceName, facilityName, affectedQuantity, createdAt }] }
```

**Course Provider**

```ts
{ role: 'CourseProvider',
  offerings: [{ offeringId, title, status, batchSize, acceptedLearners,
                assigned: { allocationId, allocationStatus, spaceName, areaName, session } | null }],   // up to 20, not cancelled
  acceptedLearners: number, highDemandAreas: HighDemandArea[], attendanceRate: number | null }
```

---

## Audit logs

### `GET /api/audit-logs`

Roles: Administrator (everything), Space Giver and Course Provider (their own activity: entries where they are the actor or the record owner). Learners get 403.

Query:

- `page`, `pageSize` (up to 200, default 25)
- `entity`, `action`, `actorId`
- `from`, `to` (ISO dates; `from` must not be after `to`)
- `facets=1` adds `facets: { entities: string[], actions: string[] }` for filter dropdowns

A non-admin who passes another user's `actorId` gets 403.

Response: `Paged<AuditLogDto>`, newest first.

```ts
AuditLogDto { id, action, entity, entityId | null, actor: { id | null, name, role }, ownerUserId | null, diff, createdAt }
```

System entries show `actor { id: null, name: 'System', role: 'System' }`. Secret-looking keys in `diff` are replaced with `[redacted]`.

---

## Social impact and SDG

| Method and path | Roles | Response |
| --- | --- | --- |
| `GET /api/impact` | all signed in | `{ latest: ImpactSnapshotDto, history: ImpactSnapshotDto[] }` (history: up to 12 months, oldest first) |
| `GET /api/sdg` | all signed in | `{ period, computedAt, goals: SdgGoal[] }` |
| `GET /api/public/impact` | public (no auth) | `PublicImpactDto` headline numbers. Cached for 5 minutes |

```ts
ImpactSnapshotDto { period /* YYYY-MM */, metrics: ImpactMetrics, computedAt, stored: boolean }
ImpactMetrics { learnersServed, learningHours, providersWithVenue, sessionsScheduled, spacesUsed, idleHoursUsed,
  areasReached, highDemandAreasServed, avgDistanceKm, spaceUtilisation, activeSpaceGivers, activeProviders, ngoPartners }
SdgGoal { goal: 4 | 8 | 9 | 10 | 11 | 17, title, indicators: [{ key, label, value, unit: 'count' | 'hours' | 'km' | 'ratio', source: 'snapshot' | 'live' }] }
PublicImpactDto { period, learnersServed, learningHours, sessionsScheduled, spacesUsed, areasReached, activeSpaceGivers, activeProviders, ngoPartners, computedAt }
```

`stored: false` means no snapshot exists yet, so the numbers were computed on request.

The nightly job calls `computeImpactSnapshot(period?)` from `src/server/services/impact.ts`. The period defaults to the current month in Asia/Kolkata, and the snapshot is upserted by period. Metric definitions:

| Metric | Definition |
| --- | --- |
| learnersServed | Distinct learners with `Accepted` enrollments in `Scheduled`, `Active` or `Completed` allocations |
| learningHours | For sessions dated in the period (`Planned` or `Held`): hours × learners present when attendance is marked, otherwise hours × accepted learners |
| providersWithVenue | Distinct providers with allocations in `ConfirmedByProvider`, `Scheduled`, `Active` or `Completed` |
| spacesUsed | Distinct spaces with allocations in those same statuses |
| sessionsScheduled | Sessions dated in the period, `Planned` or `Held` |
| idleHoursUsed | Weekly booked hours: sessions of allocations that hold a slot |
| areasReached | Distinct request areas of the served learners |
| highDemandAreasServed | Those areas whose demand level is `High` |
| avgDistanceKm | Mean `distanceKm` of `Accepted` enrollments |
| spaceUtilisation | idleHoursUsed / weekly unblocked slot hours on active spaces |
| activeSpaceGivers | Active Space Givers with at least one active space |
| activeProviders | Active providers with an Open, Allocated or Active offering |
| ngoPartners | Partners of type `SpaceGiverOrg` or `ProviderOrg` |

SDG 11 also shows `distanceReducedKm`: the latest completed run's baseline average distance minus its optimised average distance.

---

## Settings (Administrator)

### `GET /api/settings`

```ts
SettingsView { values: Settings, defaults: Settings, descriptions: Record<key, string>,
  presets: [{ key, label, defaultWeights, weights }], activeWeights /* normalised */,
  updated: { [key]: { at, by } } }
```

### `PATCH /api/settings`

Body: any subset of the settings, plus `normalise?: boolean`. The schema is `SettingsPatchInput` in `src/schemas/settings.ts`; it is client-safe, so forms can use it with `zodResolver`.

Validation:

- `strategies` may contain only the presets being changed. Each set must include all seven weights, each between 0 and 1.
- A set where every weight is zero is rejected.
- A set must sum to between 0.99 and 1.01 unless `normalise: true`. With `normalise: true` it is rescaled to sum to 1, rounded to 4 decimals.
- `kMin` must not exceed `kMax`, checked against stored values too.
- Every other bound matches `SettingsSchema`.

Response: `{ changed: SettingKey[], settings: SettingsView }`. Each change is audited (entity `SystemSetting`, with a `{ key: { from, to } }` diff). The next allocation run reads the new values; no redeploy is needed.

---

## Map

### `GET /api/map`

Roles: all signed in.

Query:

- `layers`: comma list of `spaces,allocations,demand,offers,unused`. Omit it for every layer the role may see. An unknown name returns 422.
- `categoryId`
- `level` (`High` / `Medium` / `Emerging`)
- `availableOnly=1`

Layers each role may see (layers the role may not see are left out of the response):

| Layer | Administrator | Space Giver | Course Provider | Learner |
| --- | --- | --- | --- | --- |
| spaces | all spaces, with hours | own (with hours), plus other active spaces as public points | active spaces, public info | active spaces, public info |
| allocations | all live | on own spaces | own offerings | — |
| demand | aggregated | aggregated | aggregated | aggregated |
| offers | — | — | — | nearby classes |
| unused | all active spaces | own active spaces | — | — |

```ts
MapPayload {
  layers: {
    spaces?: [{ id, name, coordinates, status: 'available' | 'booked' | 'inactive', seatCapacity, areaId, areaName,
                owned, openHours | null, bookedHours | null }],
    allocations?: [{ allocationId, offeringTitle, categoryId, status, spaceId, spaceName, from: [lng, lat],
                     to: [{ areaId, areaName, center: [lng, lat], learners }] }],
    demand?: [{ areaId, areaName, center, demandLevel, openRequests, demand, seatsOffered, gap }],
    offers?: [{ allocationId, offeringId, title, categoryId, categoryName, spaceName, coordinates, session,
                seatsLeft, distanceKm, requestId, feePerMonth }],
    unused?: [{ spaceId, spaceName, coordinates, openHours, bookedHours, freeHours, freeSlots: string[] }],
  },
  center: [lng, lat] | null,                                   // learner home area centre, else the centroid of the spaces
  home: { areaId, areaName, center } | null                    // learners only, area centre
}
```

How each layer is built:

- **Space status:** `inactive` when the space is switched off; `available` when at least one unblocked slot has no booking; otherwise `booked`. `availableOnly=1` keeps only `available` spaces. `categoryId` keeps spaces whose policy allows that category.
- **Allocation lines:** live allocations (`Proposed` up to `Active`, plus `NeedsReallocation`). Each line goes from the space to the **area centres** of the learners holding seats in it (Proposed, Offered or Accepted).
- **Offers (learners only):** `ConfirmedByProvider`, `Scheduled` or `Active` allocations with seats left. A space is included when it is within one of the learner's open requests' `maxDistanceKm`, measured from that request's **area centre**.
- **Demand:** per-area totals. `level` filters on the area's run-assigned demand level.

Exact learner coordinates never appear in this payload, for any role. `tests/integration/map-privacy.test.ts` enforces this.
