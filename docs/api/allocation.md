# Allocation, Offers, Scheduling and Reallocation API

Backend for Smart Allocation runs, allocations, enrollments (offers), schedules, facility issues and the internal cron jobs.
All responses are `{ data }` or `{ error: { code, message, details } }`. Ids are strings. Validation errors are `422` with `z.flattenError` details.
Common errors: `401` signed out, `403` wrong role or not the owner, `404` not found (also used when a record exists but the viewer may not see it), `409` illegal state change.

Zod schemas: `src/schemas/allocation.ts`, `enrollment.ts`, `facility-issue.ts`, `run.ts`. DTO types: `src/server/dto/{allocation,enrollment,run,schedule,facility-issue}.ts`.

---

## 1. Lifecycle as implemented

### Run (worker)

```
DomainEvent (outbox) ──debounce──▶ tick ──lock──▶ AllocationRun Running
  phases: snapshot → engine → publish (ONE transaction) → notify → done
  success: status Completed, events marked processed (inside the publish transaction)
  error:   status Failed + error, admins get run.failed, retried on the next tick up to maxRunRetries
```

- **Debounce**: a tick starts a run only when unprocessed events exist and the newest is older than `debounceSeconds`. A burst of submissions becomes one run.
- **Lock**: a single `RunLock` document (`_id: 'allocation'`) with an expiry (`runLockTtlSeconds`), extended between phases. A held lock makes ticks and manual triggers return `locked` / `409`.
- **Interrupted runs**: a run left `Running` with an expired lock is recovered on the next tick. If it died before publish it is marked **Failed** (nothing was written; snapshot and engine are pure) and retried; if it died after publish it **resumes** at the notify phase.
- **Fixed allocations**: offerings with an approved, confirmed, scheduled or active allocation are passed to the engine as `fixed`. The engine fills their free seats only. Only `Proposed` allocations are re-optimised; a proposal that comes back unchanged (same space and session) is kept, not re-created, so nobody is re-notified.
- **Geo prefilter**: only active spaces within `maxRadiusKm` + spread + 1 km of an area centre with open requests, or of a targeted offering's area, enter the snapshot (`$geoWithin`/`$centerSphere`).

### Allocation

| From | To | Who / what |
|---|---|---|
| Proposed | ApprovedBySpace | auto (space policy `auto`, right after publish) or space giver `approve` |
| Proposed / ApprovedBySpace | Rejected | space giver `reject` (offering back to Open, learners back to Analysed, engine retries without that space) |
| ApprovedBySpace | ConfirmedByProvider | provider `confirm` (seats become offers) |
| Proposed | Superseded | a later run replaced the proposal |
| ConfirmedByProvider | Scheduled | first learner acceptance (schedule generated) |
| Scheduled | Active | nightly, when the first session date arrives |
| Active | Completed | nightly, after the last session date |
| ConfirmedByProvider / Scheduled / Active | NeedsReallocation | facility issue makes it infeasible |
| NeedsReallocation | Cancelled | replacement confirmed (class moved) |
| NeedsReallocation | previous status | facility issue resolved and it fits again |
| any live | Cancelled | administrator override |

Every change checks `ALLOCATION_TRANSITIONS`, pushes `statusHistory` (`{ status, at, by, note }`) and writes an audit entry.

### Enrollment

`Proposed` (seat held while the space approves and provider confirms) → `Offered` (on confirm, with `offerExpiresAt = now + offerExpiryHours`) → `Accepted` | `Declined` | `Expired`.
`Waitlisted` → `Offered` (class confirmed) or `Proposed` (not yet confirmed) when a seat frees. Any live state → `Cancelled`.
Seat-holding = Proposed + Offered + Accepted, never more than `batchSize` (publish converts overflow seats to waitlist; promotion re-counts before every promotion).

### Learning request (propagated)

Submitted → Analysed (seen by a run) → Matched (seat) / Waitlisted / Unmatched (with up to 3 suggestions) → Offered → Accepted → Scheduled → Active → Completed. Also Declined, Expired. Rejection or cancellation of a class sends requests back to Analysed so the engine places them again.

---

## 2. Allocations

### `GET /api/allocations`
Roles: all signed-in. Scope: Administrator all; Space Giver `spaceOwnerUserId = me`; Course Provider `providerUserId = me`; Learner allocations where they hold an enrollment.
Query: `page` (1), `pageSize` (25, max 200), `status` (repeatable), `runId`, `offeringId`, `spaceId`.
Response: `{ items, meta: { total, page, pageSize, pages } }`.
- Non-learners: `AllocationListItemDto` — `id, runId, offeringId, courseTitle, categoryName, spaceId, spaceName, areaName, session {dayOfWeek,startTime,endTime}, sessionLabel ("Sat 10:00–12:00"), score (compatibility score 0..1), distanceKm, status, statusLabel, strategy, approvalMode, replacesAllocationId, approvedAt, confirmedAt, createdAt, seats { batchSize, proposed, offered, accepted, waitlisted, taken }`.
- Learners: `LearnerAllocationDto` — `id, courseTitle, spaceName, areaName, session, sessionLabel, status, statusLabel, myEnrollment { id, status, offerExpiresAt, waitlistRank } | null`.

### `GET /api/allocations/:id`
Roles: admin, the owning provider, the owning space giver (others `404`). Learners holding a place get `LearnerAllocationDto` only.
Response `AllocationDetailDto` = list item plus:
`offering { id, title, categoryName, audience, batchSize, sessionMinutes, durationWeeks, startDate }`, `space { id, name, address, areaName, location [lng,lat], seatCapacity, approvalMode }`, `providerName`, `spaceGiverName`,
`breakdown [{ criterion, score, weight, weighted, detail }]` ("Why this space"), `constraints [{ constraint, passed, detail }]`, `rejectedAlternatives [{ spaceId, spaceName, session, sessionLabel, failedConstraint, reason, score, distanceKm }]` ("Why not the others"),
`statusHistory [{ status, label, at, note }]`, `overrideNote`,
`cohort { headcount, byArea [{ areaName, count }], learners: LearnerView[] }` — identities only through `learnerViewFor` (cohort entries before acceptance; provider contact / space-giver name after acceptance; full for admins). A replacement proposal shows the cohort of the allocation it replaces.
`schedules: ScheduleDto[]`, `replacements [{ id, spaceName, status }]`, `actions { approve, reject, confirm, override }` (what this viewer may do now).

### `POST /api/allocations/:id/approve`
Roles: owning Space Giver, Administrator. Body (optional): `{ note?: string }`. Only from `Proposed` (`409` otherwise).
Effect: `ApprovedBySpace`, `approvedAt`; provider gets `allocation.approved`. Response: `AllocationDetailDto`.

### `POST /api/allocations/:id/reject`
Roles: owning Space Giver, Administrator. Body: `{ note?: string }`. From `Proposed` or `ApprovedBySpace`.
Effect: `Rejected`; its enrollments `Cancelled`; requests back to `Analysed`; offering back to `Open` when it has no other live allocation; an `offering.saved` event so the engine retries (it will not re-propose the same space for that offering); provider gets `allocation.rejected`.

### `POST /api/allocations/:id/confirm`
Roles: owning Course Provider, Administrator. Body: `{ note?: string }`.
Errors: `409 "The space has not approved this yet."` while `Proposed`; `409` for any other non-`ApprovedBySpace` status.
Effect: `ConfirmedByProvider`, `confirmedAt`; Proposed enrollments → `Offered` with expiry; requests → `Offered`; learners get `offer.sent`; space giver gets `allocation.confirmed`.
If the allocation is a **replacement** (`replacesAllocationId`): the old allocation becomes `Cancelled`, its enrollments move over with their status (Accepted stay Accepted, Offered keep their expiry), its future sessions become `Moved`, the new allocation gets schedules for the remaining sessions (→ `Scheduled` when it has accepted learners), and everyone gets `schedule.changed`.

### `POST /api/allocations/:id/override`
Roles: **Administrator only**. Every call is audited (`action: 'override'`) with the note and stored in `overrideNote`.
Body: `{ action: 'approve' | 'confirm' | 'reject' | 'cancel' | 'move', note: string (3..1000, required), spaceId?: string, session?: { dayOfWeek, startTime, endTime } }`. `move` needs `spaceId` and/or `session`.
- `approve` / `reject`: as above, on the space's behalf.
- `confirm`: approves first if still `Proposed`, then confirms.
- `cancel`: `Cancelled`; enrollments cancelled; requests → `Analysed`; future sessions `Cancelled`; engine event; `schedule.changed` to everyone.
- `move`: refuses a clash with another booking on the target space (`409`, `details.failedConstraint = 'time'`) and re-checks the target with the engine (`409` with the failed constraint, e.g. outside open slots, facilities, policy). On success the space/session change, future sessions are moved and regenerated, a `NeedsReallocation` allocation returns to its previous status, and everyone gets `schedule.changed`.
Response: `AllocationDetailDto`.

---

## 3. Enrollments and offers

### `GET /api/enrollments/mine`
Role: Learner. Response `MyEnrollmentDto[]` (newest first): `id, status, requestId, offeringId, allocationId, allocationStatus, courseTitle, categoryName, providerName, spaceId, spaceName, spaceAddress, areaName, spaceLocation [lng,lat], session, sessionLabel, startDate, durationWeeks, feePerMonth, offerExpiresAt, score, distanceKm, waitlistRank (Waitlisted only), history [{ status, at, note }], createdAt`.

### `POST /api/enrollments/:id/accept`
Role: Learner (owner; `403` otherwise). No body.
Errors: `409` when not `Offered`; **`410 { code: 'expired', message: 'This offer expired.' }`** when `offerExpiresAt` has passed (the enrollment is expired on the spot and the seat goes to the waitlist).
Effect: `Accepted`, request `Accepted`, provider gets `offer.accepted`. The first acceptance on a confirmed class generates the schedule (allocation → `Scheduled`); the request then moves to `Scheduled`.
Response `EnrollmentActionDto`: `{ id, status, requestStatus, allocationStatus }`.

### `POST /api/enrollments/:id/decline`
Role: Learner (owner). `409` unless `Offered`.
Effect: `Declined`, request `Declined`, provider gets `offer.declined`, next waitlisted learner promoted (`Offered` with expiry and `waitlist.promoted` if the class is confirmed, else `Proposed`). Waitlist ranks are renumbered. Response `EnrollmentActionDto`.

### `GET /api/enrollments?allocationId=`
Roles: the allocation's provider, the space's giver, Administrator (`403` for others, including learners).
Response `RosterDto`: `{ allocationId, batchSize, counts { proposed, offered, accepted, waitlisted }, entries [{ enrollmentId, status, waitlistRank, offerExpiresAt, learner }] }`.
`learner` comes from `learnerViewFor`: provider sees contact details only for `Accepted` (`visibility: 'provider-accepted'`), space giver sees a name only for `Accepted` (`'roster'`), both see `'cohort'` (area, windows, no identity) before acceptance, administrators see `'full'`. Exact learner locations never appear for providers or space givers.

---

## 4. Schedules

### `GET /api/schedules`
Roles: all signed-in. Query: `allocationId`, `mine=1`, `spaceId`, `from`, `to` (`YYYY-MM-DD`).
Scope: Learner — sessions of their **accepted** enrollments (`403` when asking for another allocation); Provider — their allocations; Space Giver — their spaces; Administrator — any, with filters.
Response `ScheduleDto[]`: `{ id, allocationId, offeringId, courseTitle, spaceId, spaceName, date ("YYYY-MM-DD"), startTime, endTime, status: 'Planned'|'Held'|'Cancelled'|'Moved', note }`.

Generation rules:
- One session per week for `durationWeeks`, starting on the first date on or after both `offering.startDate` and today whose weekday is the session's `dayOfWeek`.
- Timezone `Asia/Kolkata`. `date` is the IST calendar date **stored as UTC midnight of that date** (`2026-11-07` IST → `2026-11-07T00:00:00Z`); start and end are `HH:mm` IST.
- Conflict check on write: if another `Planned`/`Held` session on the same space and date overlaps, the new session is stored as `Moved` with note `Clash with <course>` (never double-booked), and admins plus the provider get `schedule.clash`.

---

## 5. Facility issues and reallocation

### `POST /api/facility-issues`
Roles: Space Giver (own space), Administrator. Body: `{ spaceId, facilityTypeId, affectedQuantity (int ≥ 1), description?, evidenceUrl? (https URL or '') }`. `400` if the space does not list that facility.
Effect: the facility's `workingQuantity` drops by `affectedQuantity` (floor 0); `facilityIssue.reported` event; booked allocations on that space are re-checked with the engine:
- still feasible → untouched;
- failing `ConfirmedByProvider`/`Scheduled`/`Active` → `NeedsReallocation`, and the engine's best alternative becomes a new `Proposed` allocation with `replacesAllocationId` (then the new space's approval mode applies: auto-approve or ask its giver);
- failing `ApprovedBySpace` (not yet confirmed, no offers out) → `Cancelled` and back to the engine.
Notifications: admins `facility.issueReported`; provider and accepted learners `facility.issueReported`; `reallocation.proposed` to provider, new space giver, accepted/offered learners and admins. **Nothing moves until the replacement is approved and the provider confirms it** (via the normal approve / confirm endpoints).
Response `201 FacilityIssueDto`: `{ id, spaceId, spaceName, facilityTypeId, facilityName, affectedQuantity, description, evidenceUrl, status, reportedBy, reportedByName, createdAt, resolvedAt, affectedAllocationIds, replacementAllocationIds }`.

### `POST /api/facility-issues/:id/resolve`
Roles: Space Giver (own space), Administrator. Body (optional): `{ note?: string }`. `409` if already resolved.
Effect: working quantity restored (capped at the installed quantity); `facilityIssue.resolved` event; affected allocations still `NeedsReallocation` that fit again return to their previous status, and unconfirmed replacements are withdrawn (`Superseded`, or `Cancelled` if already approved); provider, space giver and learners get `schedule.changed`.

### `GET /api/facility-issues` and `GET /api/facility-issues/:id`
Roles: Space Giver (own spaces), Course Provider (spaces that host or hosted their allocations), Administrator (all). Query: `status`, `spaceId`. Response `FacilityIssueDto[]` / `FacilityIssueDto`.

---

## 6. Runs (Administrator)

### `GET /api/runs`
Query: `page`, `pageSize` (20, max 100), `status`, `trigger`. Response `{ items: RunListItemDto[], meta }` with `id, ref ("#A1B2C3"), trigger, status, strategy, triggeredBy, startedAt, finishedAt, durationMs, retryOf, attempts, coverageRate, avgDistanceKm, optimisationScore, allocations, error`.

### `GET /api/runs/:id`
`RunDetailDto` = list item plus `metrics`, `baselineMetrics` (greedy nearest-space baseline), `comparison [{ metric, optimised, baseline, delta, deltaRatio, better }]` (lower is better for `avgDistanceKm`, `waitlistRate`, `unmatched`, `waitlisted`, `runTimeMs`), `decisionSummary`, `counts` (`requests, offerings, spaces, newAllocations, keptAllocations, supersededAllocations, seated, waitlisted, unmatched, analysed, offered, cancelledEnrollments, droppedRejectedPairs, seatsConvertedToWaitlist`), `k`, `silhouette`, `partitionState { phase, attempts, completedPhases }`, `eventCount`, `retries [{ id, status }]`.

### `POST /api/runs`
Manual trigger. Body (optional): `{ note?: string }`. Writes a `manual.trigger` event and runs immediately (bypasses debounce). `409` while a run holds the lock. Response `201 RunDetailDto` (the run has finished when the response returns; status `Completed` or `Failed`).

### `POST /api/runs/:id/retry`
Only for `Failed` runs (`409` otherwise or while locked). Starts a new run with `retryOf`. Response `201 RunDetailDto`.

---

## 7. Internal cron (`Authorization: Bearer $CRON_SECRET`, GET and POST)

| Endpoint | Schedule (`vercel.json`) | Does |
|---|---|---|
| `/api/internal/allocation/tick` | `*/5 * * * *` | Recover interrupted runs, retry one failed run, or start a run when the outbox burst has settled. Response `{ action: 'locked' \| 'idle' \| 'debouncing' \| 'ran', ... }` |
| `/api/internal/nightly` | `30 20 * * *` (02:00 IST) | Run with trigger `nightly` (re-optimises Proposed only; confirmed/active are fixed), lifecycle progression (Scheduled → Active → Completed, offerings and requests follow, `course.completed` to learners), `computeImpactSnapshot()`, `evaluateDemandAlerts()` |
| `/api/internal/offers/expire` | `0 * * * *` | Expire overdue offers (`offer.expired`, waitlist promotion) and send `offer.expiring` reminders for offers expiring within `offerExpiringNoticeHours` (once each) |

Internal routes have `maxDuration` 300 s. **Vercel Hobby plans allow only daily cron jobs**: on Hobby, the five-minute tick will not run. Runs still happen through `POST /api/runs` (manual), the nightly job, or an external scheduler calling the tick endpoint with the cron secret.

---

## 8. Notifications sent

`allocation.proposed`, `allocation.approvalNeeded`, `allocation.approved`, `allocation.confirmed`, `allocation.rejected`, `offer.sent`, `offer.expiring`, `offer.accepted`, `offer.declined`, `offer.expired`, `waitlist.promoted`, `schedule.created`, `schedule.changed`, `schedule.clash`, `facility.issueReported`, `reallocation.proposed`, `course.completed`, `run.failed`, `request.unmatched`. Variables follow `src/server/notifications/defaults.ts`; dates use `src/lib/format.ts` (IST).
