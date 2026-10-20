# End-to-end tests (Playwright)

The scenario under test is **weekend coding classes in South Pune** (PLAN 8.4). It goes from learner requests to a scheduled class. The data comes from the seed's `e2e` profile; see [docs/seed.md](../../docs/seed.md).

## Prerequisites

- A local MongoDB on `mongodb://127.0.0.1:27017`. A standalone server is enough; Atlas is never used for e2e.
- The Chromium browser for Playwright (one-time, about 150 MB download):

  ```bash
  npx playwright install chromium
  ```

  On Linux CI, use `npx playwright install --with-deps chromium`.

## Run

```bash
npm run test:e2e                 # build + start the app, seed, run the specs
PW_DEV=1 npm run test:e2e        # use `next dev` instead of a production build (faster locally)
PW_PREBUILT=1 npm run test:e2e   # `.next` is already built: only `next start`
npx playwright test --ui         # interactive mode
npx playwright show-report       # open the last HTML report
```

Before the specs run, `global-setup.ts` runs `scripts/seed.ts --profile=e2e --reset` against `E2E_MONGODB_URI` (default `mongodb://127.0.0.1:27017/eduspace_e2e`). The web server is started with the same URI, so the app and the tests share one throwaway database. Your `.env.local` database is not used.

| Variable | Default | Purpose |
| --- | --- | --- |
| `E2E_MONGODB_URI` | `mongodb://127.0.0.1:27017/eduspace_e2e` | Database that is wiped, seeded and served |
| `E2E_PORT` | `3000` | App port (`baseURL` is `http://localhost:<port>`) |
| `E2E_SKIP_SEED` | unset | `1` = do not reseed (CI seeds in its own step) |
| `E2E_ALLOW_ANY_DB` | unset | `1` = allow a database whose name lacks `e2e` or `test` (normally refused, because it is wiped) |
| `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` | `admin@eduspace.local` / `Admin-Pass-2026` | Administrator login |
| `SEED_DEMO_PASSWORD` | `Demo-Pass-2026` | Password of every other seeded account |

Locally, an already running server on the port is reused (`reuseExistingServer`). Make sure that server points at the e2e database. Traces are recorded on the first retry.

## Writing specs

Put specs in `tests/e2e/*.spec.ts`. Import the fixed data from `./env` instead of hard-coding it:

```ts
import { E2E_ACCOUNTS, E2E_ADMIN, E2E_PASSWORD, E2E_SCENARIO } from './env';
```

| Login | Email | Notes |
| --- | --- | --- |
| Administrator | `E2E_ADMIN.email` | From `ADMIN_SEED_*` |
| Space Giver | `spaces@eduspace.local` | Owns Kothrud Community Centre (lab: 30 seats, 30 working computers, Sat/Sun 09:00–18:00, auto approval, ₹300/h) |
| Course Provider | `provider@eduspace.local` | CodeBridge Pune, course Python Basics (Coding, needs 15 computers). One offering: batch 15, 120-min session in Sat 10:00–13:00, 8 weeks, target Kothrud |
| Learner | `learner@eduspace.local` | Learner 1 of 18. Lives closest to the centre and has a Coding request |
| Learners 2–18 | `e2e.learner02@eduspace.local` … `e2e.learner18@eduspace.local` | Kothrud, Karve Nagar and Warje, all with Coding requests |
| Fresh learner | `fresh.learner@eduspace.local` | Kothrud profile with no request, for "submit a request in the browser" flows. Submitting one makes 19 requests |

Expected outcome after one Smart Allocation run: **15 seated, 3 waitlisted**. The three farthest learners are all in Warje (about 3–4 km away). The seed queues one `manual.trigger` domain event, so the first worker tick (or a manual run from the Administrator console) starts the run.
