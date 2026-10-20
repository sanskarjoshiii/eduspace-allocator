# Seed data

`npm run seed` fills a database with the lookups, settings and accounts EduSpace needs, plus a generated dataset. The code is in `scripts/seed.ts` (CLI) and `src/server/seed/` (data, generator and writer; tests can import it).

## Commands

```bash
npm run seed                                   # demo profile, seed 42
npm run seed -- --profile=minimal              # base data and admin only
npm run seed -- --profile=e2e --reset          # the Playwright scenario, on a clean database
npm run seed -- --profile=bench --reset        # 500 spaces, 2,000 requests
npm run seed -- --seed=7                       # a different (still reproducible) dataset
npm run seed:reset                             # = --reset with the demo profile
npm run seed -- --help
```

| Flag | Meaning |
| --- | --- |
| `--profile=minimal\|demo\|e2e\|bench` | What to load (default `demo`) |
| `--seed=<n>` | Random seed for generated data (default `42`) |
| `--reset` | Drop every EduSpace collection first. Prints the database and host before wiping |
| `--yes-really` | Required with `--reset` when `MONGODB_URI` looks like Atlas (`mongodb+srv://` or `*.mongodb.net`) |

| Environment variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Target database (required). Read from `.env.local` when it exists |
| `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` | First Administrator. Without both, the admin is skipped with a message |
| `SEED_DEMO_PASSWORD` | Password for all demo and generated accounts (default `Demo-Pass-2026`) |

## What every run does

1. Optional `--reset`.
2. Builds every model's indexes (`syncIndexes`).
3. Inserts **only what is missing**, so Administrator edits survive a re-seed:
   - 10 facility types and the course category tree (6 parents, 15 leaves).
   - 24 Pune areas and 360 student-demand baselines.
   - Every `DEFAULT_SETTINGS` key with its description.
   - Every `DEFAULT_TEMPLATES` notification template.
4. Creates the Administrator by email if it does not exist. Running twice never creates a second admin, and an existing admin's password is never overwritten.
5. Loads the profile's data. If any of its accounts already exist, this step is skipped; run with `--reset` to regenerate.
6. Queues one `manual.trigger` domain event, so the first worker tick runs Smart Allocation.
7. Prints a table of counts and the demo logins.

All inserts go through the Mongoose models, so every schema validator runs, including the Space hook that rejects overlapping slots or `workingQuantity > quantity`. Every seeded account shares one bcrypt hash (cost 10) of the demo password.

## Profiles

| Profile | Contents |
| --- | --- |
| `minimal` | Base data and the admin only |
| `demo` (default) | 6 Space Givers / 15 spaces, 6 Course Providers / 9 courses / 10 offerings, 80 learners / 100 requests. 75% of requests are feasible |
| `e2e` | The fixed "weekend coding classes in South Pune" scenario (below) |
| `bench` | 100 Space Givers / 500 spaces, 60 providers / 180 offerings, 1,600 learners / 2,000 requests. 75% feasible |

### Demo accounts (every profile except `minimal`)

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `ADMIN_SEED_EMAIL` | `ADMIN_SEED_PASSWORD` |
| Learner (Kothrud) | `learner@eduspace.local` | `SEED_DEMO_PASSWORD` or `Demo-Pass-2026` |
| Space Giver | `spaces@eduspace.local` | same |
| Course Provider | `provider@eduspace.local` | same |

Generated accounts use `@demo.eduspace.local` addresses (for example `aarav.joshi.52@demo.eduspace.local`) and the same password.

### The e2e scenario

- **Space:** Space Giver **Kothrud Community Centre**, logged in as `spaces@eduspace.local`. Computer lab in Kothrud: 30 seats, 30 working computers, Sat and Sun 09:00–18:00, auto approval, ₹300/h.
- **Course:** Course Provider **CodeBridge Pune**, logged in as `provider@eduspace.local`. Course **Python Basics** (Coding, needs 15 computers). One offering: batch 15, 120-minute session in a Sat 10:00–13:00 window, 8 weeks from the first of next month, target area Kothrud, ₹400/h maximum rent, ₹500/month fee.
- **Learners:** 18 learners in Kothrud (8), Karve Nagar (6) and Warje (4), all adults wanting Coding on Saturday mornings within 5 km. `learner@eduspace.local` is learner 1 and lives closest to the centre. The others are `e2e.learner02@eduspace.local` … `e2e.learner18@eduspace.local`. With 15 seats, 15 learners should be seated and 3 waitlisted; the three farthest are in Warje.
- **Extra account:** `fresh.learner@eduspace.local`, a Kothrud learner with no request.

The constants live in `src/server/seed/constants.ts` (`E2E_SCENARIO`, `E2E_ACCOUNTS`) and have no dependencies, so Playwright specs can import them.

## How the generator works

`generatePlan(config, now)` in `src/server/seed/generate.ts` is pure. It returns plain data with lookups referenced by name, and `applyPlan` writes it. Randomness comes from a seeded mulberry32 PRNG. The same `--seed` (and the same month) always produces the same names, numbers and coordinates. Only ids and timestamps differ, and start dates move with "next month".

The config is `{ seed, spaceGivers, spacesPerGiver, providers, coursesPerProvider, offeringsPerCourse, learners, requestsPerLearner, feasibleRatio }`. The "per" values are averages, spread evenly.

- **Spaces:** computer labs, community halls, classrooms, dance studios, music rooms and art rooms. Each has realistic facilities (working ≤ total). Slots are weekday evenings and/or weekend blocks that never overlap, and some have a blocked slot. Policies set allowed categories and audiences, rent of ₹0–800/h, and auto or manual approval.
- **Offerings:** each one is built around an *anchor* space that can host it. The anchor's policy allows the category and audience, its seats and working facilities meet the course requirements (for example, Coding needs Computers ≥ batch size), the window sits inside an open slot, and the maximum rent covers the space's rent. Batch is 8–30, session 60–180 min, 4–16 weeks, starting next month.
- **Requests:** `round(total × feasibleRatio)` are feasible. Each sits within about 1.5 km of its area centre, near an offering's anchor, with a matching audience, covering windows, a big enough radius (2–8 km) and a budget that covers the fee. The rest are infeasible for a known reason, rotated across five:

| Reason | How it is built |
| --- | --- |
| `far` | In an outer area where no space is placed (Wakad, Pimple Saudagar, Kharadi, Wanowrie), with a radius smaller than the distance to the nearest space |
| `category` | A category no provider offers (Theatre, Hindi, Financial Literacy) |
| `budget` | Budget below half the cheapest fee in the category |
| `facility` | Requires a facility that no space within the radius has working |
| `time` | Weekday 06:00–07:30 windows; no slot starts before 09:00 |

  If a reason cannot be built for the current data (for example, no category where every offering is paid), the request falls back to `time`. The infeasible share stays exact either way.
- **Self-check:** after generating, every request is re-checked against an independent restatement of the README 13.4 hard constraints (`src/server/seed/feasibility.ts`). Generation fails loudly if any request is not (in)feasible as intended.

## What is synthetic

- **Area demographics are synthetic.** Locality names and approximate centre coordinates are real. Population, student count, literacy rate, income score and income group are generated from a fixed seed (`AREA_SEED`) around a rough per-locality profile. They are not census figures. Replace them when sourced data is available (PLAN.md, Dependencies).
- **Student demand baselines are synthetic.** They are derived from the synthetic student counts, category popularity and seeded noise (`DEMAND_SEED`).
- **All people, organisations, venues, phone numbers and addresses are fictional.** Street names are real Pune roads, used only for flavour.
- Areas and demand use fixed seeds, so `--seed` never changes them.
