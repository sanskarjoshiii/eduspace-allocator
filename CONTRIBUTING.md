# Contributing to EduSpace Allocator

Spec: [README.md](README.md). Plan and task IDs: [PLAN.md](PLAN.md). UI rules: [CLAUDE.md](CLAUDE.md) and the design system.

## Layout

```
src/
  app/                 Next.js App Router
    (public)/          landing, public impact
    (auth)/            login, register
    (app)/             signed-in shell (sidebar from GET /api/me/menu)
    api/               Route Handlers
  components/
    ui/                design-system components (Button, Badge, StatCard, ...)
    shell/             sidebar, header, notification bell
    map/               Leaflet map (client only)
    <domain>/          feature components (spaces, offerings, allocations, ...)
  engine/              pure TypeScript Smart Allocation engine (no I/O)
  server/
    models/            Mongoose schemas (one import: '@/server/models')
    services/          business logic per domain
    worker/            outbox, run lock, run orchestration
    notifications/     templates, notify(), email
    auth/              session, menus
    dto/               stage-based redaction mappers
    http.ts            withAuth, withCron, errors, parseBody, scopeToOwner
  lib/                 env, db, logger, domain constants, formatting, fetch client
  schemas/             Zod schemas shared by client forms and route handlers
scripts/               seed, bench
tests/unit             pure functions (engine, redaction, rendering)
tests/integration      route handlers and services on an in-memory replica set
tests/e2e              Playwright
```

## Route handlers

- Every handler is wrapped: `export const GET = withAuth({ roles: [...] }, async (req, { user, params }) => ...)`.
  Use `withCron` for `/api/internal/*` and `withPublic` for unauthenticated reads.
- Validate input with a Zod schema from `src/schemas` via `parseBody(req, Schema)` / `parseQuery(req, Schema)`.
- Respond with `ok(data)`, `created(data)`; throw `badRequest`, `forbidden`, `notFound`, `conflict` (from `@/server/http`).
  Responses are `{ data }` or `{ error: { code, message, details } }`. Validation errors are 422 with `z.flattenError` details.
- Ownership is enforced on the server: `scopeToOwner(user, 'ownerUserId')` in list queries, `assertOwner(user, doc.ownerUserId)` before writes.
- Never return a Mongoose document directly. Map it through a DTO in `src/server/dto` (ids as strings, learner data redacted by stage).
- Every create, update and delete calls `audit(...)`. Saves that affect allocation call `emitEvent(...)`.
- Business logic lives in `src/server/services/<domain>.ts`; handlers stay thin.
- Next 16: `params` is a Promise; `withAuth` resolves it for you. Route file paths use `[id]` folders.

## Data conventions

- Ids cross the API as strings. Coordinates are GeoJSON `[lng, lat]`.
- Weekly windows are `{ dayOfWeek: 0..6 (0 = Sunday), startTime: "HH:mm", endTime: "HH:mm" }` in the database and API;
  the engine uses minutes from midnight (`toMinutes` / `toHHmm` in `src/lib/utils.ts`).
- Status names and transitions live in `src/lib/domain.ts`. Use `canTransition(...)` before changing a status and push to `statusHistory`.
- Tunables come from `getSettings()` (`src/server/services/settings.ts`); never hard-code weights, radii or expiry.
- Notifications go through `notify({ type, userIds, vars, related, href })`; text comes from templates.
- Learner exact locations never leave the server except to the learner themself and administrators.

## Client code

- Fetch with `apiGet` / `apiSend` from `src/lib/api.ts` inside TanStack Query hooks.
- Forms: React Hook Form + `zodResolver` with the same schema as the route handler.
- Every page handles loading (skeletons), empty and error states.
- Style only with design-system tokens (Tailwind names such as `bg-surface`, `text-ink-muted`, `text-label`). No hex values.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm test` | Vitest unit and integration tests (in-memory MongoDB replica set) |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run seed` | Lookups, settings, templates, admin and demo data |
| `npm run engine:bench` | Engine benchmark (500 spaces, 2,000 requests) |
