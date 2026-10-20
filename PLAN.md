# Project: EduSpace Allocator, Implementation Plan

Companion to [`README.md`](./README.md). Feature IDs (F-01 to F-36) refer to the feature list in the README.

## Executive Summary

EduSpace Allocator matches idle spaces, course providers and learners automatically, using GIS, K-Means demand clustering and bipartite / flow optimisation, and explains every decision. We are building it on Next.js, TypeScript, MongoDB Atlas and Auth.js, with four roles (Administrator, Learner, Space Giver, Course Provider). The result is a working end-to-end demo: a learner request becomes a scheduled class with no manual matching, and an Administrator can monitor and override it.

## Success Criteria

- [x] Each of the 4 roles logs in, sees its own backend-served menu, and cannot edit or read another owner's data (verified by automated authorisation tests)
- [x] A new request, offering or space triggers a run automatically (debounced) and produces explained allocations with no manual action
- [x] Every allocation shows a per-criterion breakdown and the closest rejected alternatives with their first failed constraint
- [x] Offer accept, decline, expiry and waitlist promotion work, and seat limits are never exceeded
- [x] Learner contact details are visible to a provider only after that learner accepts; exact learner location is never returned to other roles
- [x] A facility issue produces a reallocation proposal that the affected parties can confirm
- [x] Optimised allocation beats the greedy nearest-space baseline on coverage or average score in the seeded demo (report generated per run)
- [x] A run on about 500 spaces and 2,000 requests finishes within the agreed target time (target set in Phase 3, see Open Questions)
- [x] The end-to-end scenario "weekend coding classes in South Pune" passes in Playwright
- [ ] CI (lint, typecheck, unit, integration) is green on GitHub, and the app is deployed on Vercel

## Architecture Decision

Full detail is in README sections 10 to 13. Key decisions:

1. **Single Next.js app** (UI and Route Handlers), MongoDB Atlas via Mongoose.
2. **Engine as a pure TypeScript module** (`src/engine`) with no I/O, behind an `EngineClient` interface. It can be swapped for a Python service later without touching the worker.
3. **Outbox plus scheduled tick** instead of a long-lived background worker, with a single-run lock and resumable area partitions (Vercel is serverless).
4. **Polling** for notifications first; SSE only if needed.
5. **Settings in the database** for weights, thresholds, radius, debounce, expiry, alert N / M / W.
6. **Server-side ownership filtering and stage-based DTO redaction** are the only trusted privacy controls.

## Dependency Graph

```
[Phase 0 Bootstrap]
        │
        ▼
[Phase 1 Roles + ownership] ──► [Phase 2 Registries] ──► [Phase 3 Automatic engine]
                                                                  │
                                         ┌────────────────────────┴───────────┐
                                         ▼                                    ▼
                               [Phase 4 Offers + scheduling]     [Phase 5 Notifications + insights]
                                         │                                    │
                                         └──────────────┬─────────────────────┘
                                                        ▼
                                           [Phase 6 Dashboards + GIS]
                                                        │
                                                        ▼
                                           [Phase 7 Operations]
                                                        │
                                                        ▼
                                           [Phase 8 Quality + release]
```

Engine unit work (Phase 3 tasks 3.1 to 3.8) has no database dependency and can start in parallel with Phases 1 and 2.

Each phase is built, tested and committed before the next one starts.

## Effort Key and Timeline

Targets are **relative weeks from project start**, assuming one to two developers. They are estimates to be adjusted after Phase 0. Task size: **S** about 2 to 4 h, **M** about 4 to 8 h, **L** 1 to 2 days, **XL** 2 to 5 days.

| Milestone | Target |
|---|---|
| M0 Bootstrap | Week 1 |
| M1 Roles and ownership | Week 2 |
| M2 Registries | Weeks 3 to 4 |
| M3 Automatic engine | Weeks 5 to 7 |
| M4 Offers and scheduling | Week 8 |
| M5 Notifications and demand insights | Week 9 |
| M6 Dashboards and GIS | Weeks 10 to 11 |
| M7 Operations | Week 12 |
| M8 Quality and release | Weeks 13 to 14 |

---

## Milestones

### Milestone 0: Bootstrap, Target: Week 1

**Deliverable:** deployed skeleton on Vercel with working CI, database connection and design system.

- [ ] 0.1 (S) Create Next.js (App Router, TypeScript strict) repo on GitHub. Acceptance: `npm run dev`, `lint`, `typecheck` pass on a clean clone
- [x] 0.2 (S) Tailwind and shadcn/ui setup with theme tokens from the EduSpace design system (https://claude.ai/artifact/58sQU8fyC1kGAdBL2o9xmQ): warm paper rail, white panels, orange accent, Geist + Geist Mono, light and dark. Acceptance: a sample page renders a StatCard, Badge and Button matching the system in both themes
- [x] 0.3 (M) MongoDB Atlas cluster, Mongoose connection helper with serverless-safe caching. Acceptance: health route `GET /api/health` returns DB status
- [x] 0.4 (S) Zod env validation (`MONGODB_URI`, `AUTH_SECRET`, etc.) failing fast on missing values. Acceptance: app refuses to boot with a missing variable and names it
- [x] 0.5 (M) GitHub Actions: lint, typecheck, Vitest on every PR. Acceptance: a failing test blocks the PR
- [ ] 0.6 (S) Vercel project linked, preview deployments on PRs. Acceptance: preview URL serves the sample page
- [x] 0.7 (S) Folder structure from README section 23, `.env.example`, `CONTRIBUTING` notes. Acceptance: structure matches README
- [x] 0.8 (S) Vitest with `mongodb-memory-server` harness. Acceptance: one sample model test runs in CI

**Exit check:** preview deployment is live and CI is green.

---

### Milestone 1: Roles and Ownership, Target: Week 2 (Phase 1)

**Features:** F-01, F-02, F-03, F-04 (shell part)
**Done when:** each role logs in, sees its own menu, and cannot edit others' data.

- [x] 1.1 (M) `User` model: email, passwordHash, role enum (Administrator, Learner, SpaceGiver, CourseProvider), ownerRefId, status. Acceptance: unique email index; invalid role rejected
- [x] 1.2 (L) Auth.js with Credentials provider and JWT strategy; `role` and `ownerRefId` in token and session. Acceptance: login works; session exposes both claims; `bcryptjs` hashes
- [x] 1.3 (M) `POST /api/auth/register` for Learner, Space Giver, Course Provider only (Administrator role rejected). Acceptance: Zod-validated; creates profile or partner record and sets `ownerRefId`; learner registration stores consent
- [x] 1.4 (S) Administrator seed script from `ADMIN_SEED_*`. Acceptance: running twice does not duplicate the admin
- [x] 1.5 (M) `withAuth({ roles })` wrapper plus `scopeToOwner()` helper for queries. Acceptance: unit tests show unauthenticated gets 401, wrong role gets 403
- [x] 1.6 (M) `GET /api/me` and `GET /api/me/menu` returning role-specific menus from a server config. Acceptance: four distinct menus matching README section 17
- [x] 1.7 (M) Role-aware shell: sidebar from menu endpoint, Next.js middleware route guards, placeholder dashboards per role. Acceptance: Learner opening an Administrator URL is redirected
- [x] 1.8 (M) Audit log model and `audit()` helper called on create, update, delete. Acceptance: login-protected writes produce an `auditLogs` entry
- [x] 1.9 (M) Authorisation test suite skeleton (cross-owner edit attempts). Acceptance: tests run in CI and fail if ownership filter is removed

---

### Milestone 2: Registries, Target: Weeks 3 to 4 (Phase 2)

**Features:** F-05, F-06, F-07, F-08, F-36 (data for it)
**Done when:** providers and learners can register everything through their own login.

- [x] 2.1 (S) `FacilityType` and `CourseCategory` lookups with seed (computers, projector, Wi-Fi, dance floor, mirrors, music system, accessibility; category tree). Acceptance: Administrator CRUD; others read only
- [x] 2.2 (M) `Area` and `StudentDemand` models with `2dsphere` index, demographic fields, income group. Acceptance: area seed for Pune localities loads; geo query returns nearest area
- [x] 2.3 (L) `Space` model with embedded facilities, slots, policy, GeoJSON location and photos; `2dsphere` index. Acceptance: slot overlap within a space rejected; `workingQuantity <= quantity` enforced
- [x] 2.4 (L) Space CRUD routes plus forms (facilities, weekly slots, policy with approval mode and rent). Acceptance: only the owner edits; public read hides owner-only fields
- [x] 2.5 (M) Cloudinary signed upload route and upload component. Acceptance: image appears on a space; unsigned requests rejected
- [x] 2.6 (L) `Course` (with requirements) and `CourseOffering` (with windows, batch size, duration, target area, status). Acceptance: provider CRUD own only; offering validates window times
- [x] 2.7 (L) `LearningRequest` with windows, max distance, start month, duration, budget, consent fields, GeoJSON location. Acceptance: submission blocked without consent; location snapped to a valid area
- [x] 2.8 (M) Map-based location picker (Leaflet) for spaces and requests. Acceptance: picking a point stores GeoJSON in `[lng, lat]` order
- [x] 2.9 (M) Shared data table (search, filter, sort, pagination) and validated form components. Acceptance: used by at least three registry pages
- [x] 2.10 (M) Domain event outbox: every relevant save writes a `DomainEvent`. Acceptance: saving a space, slot, policy, offering, request or facility issue each creates one event
- [x] 2.11 (M) Seed generator v1 with configurable feasible / infeasible mix. Acceptance: one command creates a reproducible dataset (seeded RNG)

---

### Milestone 3: Automatic Engine, Target: Weeks 5 to 7 (Phase 3)

**Features:** F-09 to F-20
**Done when:** a submission starts a run and produces explained allocations without manual action.

**Engine (pure functions, start early, no DB needed)**

- [x] 3.1 (M) StandardScaler, ordinal encoder (Low 0, Medium 1, High 2), silhouette score. Acceptance: outputs match a scikit-learn reference on a fixture
- [x] 3.2 (L) Demand K-Means: seeded, 10 inits keeping lowest inertia, k in 2 to 6 by silhouette, fallback 3, High / Medium / Emerging labelling by demand index. Acceptance: labels stay correct when cluster ids are permuted (test)
- [x] 3.3 (L) Cohort formation: equirectangular projection, k = ceil(requests / target batch size), per category. Acceptance: no cohort exceeds batch size in the fixture
- [x] 3.4 (L) Seven hard constraints with first-failure reason. Acceptance: one unit test per constraint; reason names the first failing constraint
- [x] 3.5 (M) Seven sub-scores and weighted sum with four strategy presets. Acceptance: all sub-scores in [0, 1]; weights sum to 1 or are normalised
- [x] 3.6 (L) Bipartite max-weight matching (Hungarian), edges only above threshold. Acceptance: beats greedy on a crafted counter-example
- [x] 3.7 (XL) Min-cost flow for learner assignment (integer costs, seat capacities), waitlist and second-best offering. Acceptance: seat limits exact; every learner is either assigned or waitlisted
- [x] 3.8 (M) Explainability builder (per-criterion pass / fail / detail; closest rejected alternatives) and unmatched suggestions (0.4 / 0.3 / 0.2 / 0.1). Acceptance: top-3 alternatives with reasons
- [x] 3.9 (M) Greedy nearest-space baseline and run metrics (coverage, avg distance, seat and space utilisation, avg score, waitlist rate, run time). Acceptance: both results returned from the same snapshot

**Orchestration**

- [x] 3.10 (L) `SystemSetting` store with typed accessors and defaults for weights, strategies, radius, debounce, expiry. Acceptance: changing a weight changes the next run without redeploy
- [x] 3.11 (L) Snapshot reader using `$geoNear` prefilter and area partitioning. Acceptance: distant pairs never enter the graph
- [x] 3.12 (XL) Worker: tick endpoint, debounce check, single-run lock with expiry, `AllocationRun` lifecycle, resumable partitions, retry. Acceptance: ten rapid submissions produce one run; a killed run resumes or fails visibly
- [x] 3.13 (L) Transactional publish of allocations, enrollments, demand insights. Acceptance: a mid-save failure leaves no partial results
- [x] 3.14 (M) Vercel Cron wiring and `CRON_SECRET` guard; nightly re-optimisation of unconfirmed allocations only. Acceptance: confirmed / active allocations are untouched by the nightly run
- [x] 3.15 (M) Administrator run monitor API: list, details, trigger, re-run, override. Acceptance: override is Administrator-only and audited
- [x] 3.16 (M) Audit entries for engine decisions. Acceptance: each run writes a decision summary
- [x] 3.17 (M) Performance benchmark script (500 spaces, 2,000 requests). Acceptance: result recorded; target agreed (see Open Questions)

---

### Milestone 4: Offers and Scheduling, Target: Week 8 (Phase 4)

**Features:** F-21, F-22, F-23
**Done when:** offers can be accepted or declined and waitlist seats are promoted.

- [x] 4.1 (M) Enrollment state machine (Offered, Accepted, Declined, Waitlisted, Expired) with legal-transition guard. Acceptance: illegal transitions rejected in tests
- [x] 4.2 (M) Space approval modes: auto-approve policy-compliant allocations, manual asks the Space Giver. Acceptance: manual mode blocks provider confirmation until approved
- [x] 4.3 (S) Provider confirmation endpoint. Acceptance: only the owning provider can confirm; order Approved then Confirmed enforced
- [x] 4.4 (M) Accept and decline endpoints with expiry check. Acceptance: expired offers cannot be accepted
- [x] 4.5 (M) Expiry job and waitlist promotion (offer a declined or expired seat to next waitlisted learner). Acceptance: promotion preserves seat count
- [x] 4.6 (L) Schedule generator: weekly sessions across duration, conflict-free per space. Acceptance: no overlapping sessions for one space; clash produces a flagged change
- [x] 4.7 (M) Stage-based DTO redaction (before matching, proposed, accepted). Acceptance: provider sees contact only for accepted learners; space giver never sees contact
- [x] 4.8 (M) Request, allocation and enrollment status propagation per lifecycles in README section 8. Acceptance: status timeline for a learner reflects every step

---

### Milestone 5: Notifications and Demand Insights, Target: Week 9 (Phase 5)

**Features:** F-25, F-26, F-27, F-17
**Done when:** all roles receive notifications and see demand insights.

- [x] 5.1 (M) `Notification` and `NotificationTemplate` models, template renderer with placeholders. Acceptance: editing a template changes new messages without redeploy
- [x] 5.2 (L) Notification service with all events in README section 14. Acceptance: one test per event and recipient set
- [x] 5.3 (M) Notification APIs (list, mark read, unread count) and bell with polling. Acceptance: unread count updates within the polling interval
- [x] 5.4 (L) `DemandInsight` job: demand, seats offered, gap, level per area and category. Acceptance: aggregated views never expose individual learners
- [x] 5.5 (M) Multi-area alert (N areas, M requests, W days, no confirmed offering), deduplicated until demand changes. Acceptance: fires once; fires again only after demand changes
- [x] 5.6 (M) Recommendations endpoint (top 3 with reasons) and Discover Courses page. Acceptance: unmatched request keeps status open
- [x] 5.7 (M) Resend email channel behind feature flag and per-user preference. Acceptance: offer-expiring email sent only when enabled; failures never block the in-app notification

---

### Milestone 6: Dashboards and GIS, Target: Weeks 10 to 11 (Phase 6)

**Features:** F-04, F-28, F-29
**Done when:** every role has a working dashboard and map.

- [x] 6.1 (L) Administrator dashboard: KPIs, run monitor, unmatched requests, facility alerts, demand heatmap, utilisation, impact
- [x] 6.2 (L) Learner dashboard: status timeline, pending offers with accept / decline, recommended courses, nearby map
- [x] 6.3 (L) Space Giver dashboard: utilisation, upcoming sessions, pending approvals, unused hours, nearby demand, issues
- [x] 6.4 (L) Course Provider dashboard: offering status, assigned space and slot, accepted learners, high-demand areas, attendance
- [x] 6.5 (XL) GIS map layers: spaces by status, allocation lines, demand heatmap, nearby offers, unused hours; toggles for available only, category, demand level
- [x] 6.6 (M) Privacy rounding: learner points replaced by area centre in every non-owner, non-admin response. Acceptance: automated test scans map payloads for exact request coordinates
- [x] 6.7 (M) Explain panel ("Why this space", "Why not the others") with compatibility-score wording. Acceptance: no text calls the score a probability
- [x] 6.8 (M) Empty, loading and error states on every page. Acceptance: checklist signed off per page

Each dashboard task acceptance: widgets match README section 17 for that role and show only data the role is allowed to see.

---

### Milestone 7: Operations, Target: Week 12 (Phase 7)

**Features:** F-18, F-24, F-30, F-31, F-32, F-33, F-34
**Done when:** a facility issue produces a confirmed alternative.

- [x] 7.1 (M) Facility issue report and resolve; reduces working quantity. Acceptance: quantity restored on resolve
- [x] 7.2 (XL) Reallocation: re-check confirmed and active allocations, find alternatives only for failing ones, mark Needs reallocation, send proposals. Acceptance: unaffected allocations untouched; nothing moves without confirmations
- [x] 7.3 (M) Attendance records and feedback (rating, comment), course-completed prompt. Acceptance: only enrolled learners can rate
- [x] 7.4 (L) Role-scoped analytics (Administrator all, Space Giver own spaces, Course Provider own courses). Acceptance: cross-scope request returns 403
- [x] 7.5 (M) Audit log views (Administrator all, others own activity)
- [x] 7.6 (L) Social Impact snapshots and SDG dashboard with the six goals and indicators from README section 20. Acceptance: numbers reconcile with underlying records
- [x] 7.7 (M) Settings UI: strategy presets, weights, radius, debounce, expiry, alert N / M / W. Acceptance: invalid weights rejected; change audited
- [x] 7.8 (M) Administrator Users page (create Administrators, suspend accounts; see Open Questions)
- [x] 7.9 (M) Run comparison report: optimised vs greedy baseline per run

---

### Milestone 8: Quality and Release, Target: Weeks 13 to 14 (Phase 8)

**Features:** F-35 plus hardening of everything
**Done when:** test suites pass and the demo runs end to end.

- [x] 8.1 (L) Complete unit coverage of constraints, scoring, labelling, matching, flow limits, redaction
- [x] 8.2 (L) Integration tests: event to run to notifications; accept / decline with waitlist promotion; facility issue to reallocation
- [x] 8.3 (L) Authorisation tests for every role, every owned resource, every redacted field
- [x] 8.4 (L) Playwright end-to-end: weekend coding classes in South Pune, request to scheduled class
- [x] 8.5 (M) Performance run (500 spaces, 2,000 requests) meets the target; tune partitioning if not
- [x] 8.6 (M) Seed generator v2 with a demo profile (feasible and infeasible mix) and reset command
- [ ] 8.7 (M) Cross-check engine output against a Python scikit-learn / NetworkX reference on fixtures
- [x] 8.8 (M) Security review: cron secret, signed uploads, rate limiting on auth, secrets absent from the repo
- [ ] 8.9 (M) Accessibility pass (keyboard navigation, contrast, map alternatives)
- [ ] 8.10 (M) Production deployment: Atlas production cluster and IP rules, Vercel env vars, cron schedule, Resend domain
- [x] 8.11 (M) Final documentation: README updated to match what was built, runbook for failed runs

---

## Requirement Traceability

| Feature | Milestone | Key tasks |
|---|---|---|
| F-01 Roles and role-based menu | M1 | 1.1, 1.5, 1.6, 1.7 |
| F-02 Registration and admin creation | M1 | 1.3, 1.4 |
| F-03 Ownership filtering | M1 | 1.5, 1.9, 8.3 |
| F-04 Dashboards | M1, M6 | 1.7, 6.1 to 6.4 |
| F-05 Space Registry | M2 | 2.3, 2.4, 2.5 |
| F-06 Lookups | M2 | 2.1 |
| F-07 Course and Offering | M2 | 2.6 |
| F-08 Learning Request | M2 | 2.7, 2.8 |
| F-09 Automatic runs | M3 | 2.10, 3.12, 3.14 |
| F-10 Demand K-Means | M3 | 3.1, 3.2 |
| F-11 Cohorts | M3 | 3.3 |
| F-12 Hard constraints | M3 | 3.4 |
| F-13 Scoring and strategies | M3 | 3.5, 3.10, 7.7 |
| F-14 Space matching | M3 | 3.6 |
| F-15 Learner assignment and waitlist | M3 | 3.7 |
| F-16 Explainability | M3, M6 | 3.8, 6.7 |
| F-17 Unmatched suggestions | M3, M5 | 3.8, 5.6 |
| F-18 Reallocation | M7 | 7.1, 7.2 |
| F-19 Evaluation and baseline | M3, M7 | 3.9, 7.9 |
| F-20 Admin monitor and override | M3 | 3.15 |
| F-21 Enrollment and expiry | M4 | 4.1, 4.4, 4.5 |
| F-22 Approval modes | M4 | 4.2, 4.3 |
| F-23 Scheduling | M4 | 4.6 |
| F-24 Attendance and feedback | M7 | 7.3 |
| F-25 Demand Insights | M5 | 5.4 |
| F-26 Multi-area alert | M5 | 5.5 |
| F-27 Notifications | M5 | 5.1 to 5.3, 5.7 |
| F-28 GIS map | M6 | 6.5 |
| F-29 Location privacy | M4, M6 | 4.7, 6.6 |
| F-30 Facility issues | M7 | 7.1 |
| F-31 Analytics | M7 | 7.4 |
| F-32 Audit log | M1, M3, M7 | 1.8, 3.16, 7.5 |
| F-33 Impact and SDG | M7 | 7.6 |
| F-34 Settings | M3, M7 | 3.10, 7.7 |
| F-35 Seed generator | M2, M8 | 2.11, 8.6 |
| F-36 Discover Courses | M2, M5 | 2.1, 5.6 |

---

## Dependencies

| Dependency | Owner | Status | Blocker risk | Needed by |
|---|---|---|---|---|
| MongoDB Atlas cluster (replica set, transactions enabled) | Project owner | To create | High: transactional publish depends on it | M0 |
| GitHub repository and Actions | Project owner | To create | Low | M0 |
| Vercel project and plan with suitable Cron limits | Project owner | To verify | Medium: tick frequency depends on plan | M3 |
| Cloudinary account (cloud name, API keys) | Project owner | To create | Low | M2 |
| Resend account and verified sending domain | Project owner | To create | Low (email is a flagged addition) | M5 |
| Realistic Pune area and demographic data (population, student count, literacy, income) | Project owner | To source, or generate synthetically | Medium: affects K-Means realism | M2 |
| Python reference environment for cross-checking engine output | Developer | Optional | Low | M8 |

---

## Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Serverless time limits cut off long runs | Medium | High | Area partitioning, resumable runs, geo prefilter, benchmark in 3.17 early |
| Cron too infrequent for the debounce design | Medium | Medium | Verify plan limits in M0; fallback to a post-response trigger plus daily cron; debounce becomes "at most every X minutes" |
| Own Hungarian / min-cost flow implementations contain bugs | Medium | High | Reference tests against NetworkX fixtures, property tests for seat limits, small graphs by partitioning |
| TypeScript K-Means differs from scikit-learn | Medium | Medium | Seeded multi-init, silhouette checks, reference comparison in 8.7 |
| Privacy leak through DTOs or map payloads | Medium | High | Central redaction mappers, automated payload scans (6.6), authorisation test suite in CI |
| Cold start: too few providers, most learners unmatched | High | Medium | Suggestions, waitlists, realistic seed profile, demo with controlled feasible / infeasible mix |
| Weights give poor results on real data | Medium | Medium | Strategy presets, editable settings, evaluation against baseline |
| Mongo transaction limits on large result sets | Low | Medium | Batch writes per partition within a run-level state machine; idempotent publish keyed by run id |
| Scope creep from "future" items (payments, SMS, mobile) | High | Medium | README out-of-scope list is the contract; additions tracked in README section 25 |
| Polling feels slow for notifications | Low | Low | Shorter interval on active pages; SSE upgrade path |

---

## Open Questions

- [ ] What run-time target counts as passing for 500 spaces and 2,000 requests? (Measured: 0.7 s for the whole pipeline on this machine; proposed target 60 s, which leaves room for the database read and publish)
- [ ] Which Vercel plan will be used (affects cron frequency and function duration)?
- [ ] Should new Space Giver / Course Provider accounts require Administrator approval? (Proposed: setting, default off)
- [ ] Is email (Resend) wanted in the first release, given the spec lists email as out of scope? (Proposed: ship behind a flag)
- [ ] Is the Administrator Users page acceptable as an addition to the spec's sidebar?
- [ ] Which city and areas should the seed data cover (spec examples point to South Pune and Kothrud)?
- [ ] What is the default offer expiry duration and debounce window? (Spec examples: 30 s debounce; expiry to be set)
- [ ] Should rent budgets be set per offering, per request, or both? (Spec constraint 7 mentions both)

---

## Out of Scope

- Online payments
- Video classes
- Native mobile apps
- SMS delivery
- Multi-city support and learned demand forecasting (future scope, needs real history)
- What-if simulator
- Public visitor page (optional, can follow after Phase 6)
- Any fifth user role (the spec fixes four)

---

## Validation Checkpoint (plan completeness)

- [x] Every task has acceptance criteria or a clear check (dashboard tasks share the criterion stated under M6)
- [x] Dependencies are mapped, with external services listed
- [x] Risks have specific mitigations
- [x] Success criteria are measurable and testable
- [x] First milestone (M0) is achievable within one week
- [x] Out-of-scope items are explicitly listed
- [x] Every feature F-01 to F-36 maps to at least one milestone