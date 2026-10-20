# Setting Up EduSpace on Your Computer

Follow these steps in order. It takes about 20–30 minutes the first time, mostly waiting for downloads. The steps are written for **Windows**; Mac and Linux differences are noted where they matter.

---

## Step 1. Install the tools (one time only)

Install these four programs. Accept the default options in each installer.

| Tool | Why you need it | Where to get it |
|---|---|---|
| **Node.js 24 (LTS)** | Runs the app | nodejs.org → download the "LTS" version |
| **Git** | Downloads the code | git-scm.com → Download |
| **MongoDB Community Server 8** | The database | mongodb.com/try/download/community → choose your system, keep "Install MongoDB as a Service" ticked |
| **VS Code** | Editor to open the project | code.visualstudio.com |

**Check that they installed.** Open a new terminal (on Windows: Start → type **PowerShell** → open it) and run:

```
node -v
git --version
```

You should see version numbers, such as `v24.x.x` and `git version 2.x`. If you see "not recognised", restart the computer and try again.

**Check that the database is running.** On Windows, MongoDB starts by itself after installing. To be sure, open PowerShell **as administrator** (right-click → Run as administrator) and run:

```
Start-Service MongoDB
```

If it says the service is already running, that is fine.

> **Mac:** `brew tap mongodb/brew && brew install mongodb-community@8.0 && brew services start mongodb-community@8.0`
> **Linux:** follow MongoDB's install guide for your distribution, then `sudo systemctl start mongod`.

---

## Step 2. Download the project

You need access to the repository (ask the project owner to add you as a collaborator if it is private). Then, in your terminal:

```
cd Desktop
git clone https://github.com/sanskarjoshiii/eduspace-allocator.git
cd eduspace-allocator
```

Open the folder in VS Code: **File → Open Folder → eduspace-allocator**. From now on, use the terminal inside VS Code (**Terminal → New Terminal**). It opens in the project folder automatically.

---

## Step 3. Install the project's packages

In the VS Code terminal:

```
npm install
```

This takes a few minutes and downloads about 700 MB into a `node_modules` folder. Warnings during install are normal; only a red **ERR!** at the end is a problem.

---

## Step 4. Create your settings file

The app reads its settings from a file called `.env.local`. This file holds secrets, so it is **never** uploaded to GitHub, and everyone creates their own.

**4a. Copy the template.**

Windows (PowerShell):
```
Copy-Item env.example .env.local
```
Mac / Linux:
```
cp env.example .env.local
```

**4b. Make two secret codes.** Run this command twice. Each time it prints a random code:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**4c. Fill in the file.** Open `.env.local` in VS Code and change these lines:

| Line | What to put |
|---|---|
| `MONGODB_URI=` | Leave as it is: `mongodb://127.0.0.1:27017/eduspace` |
| `AUTH_SECRET=` | The first code from 4b |
| `CRON_SECRET=` | The second code from 4b |
| `ADMIN_SEED_EMAIL=` | Leave as `admin@eduspace.local`, or use your own email |
| `ADMIN_SEED_PASSWORD=` | Choose a password for your admin account (at least 10 characters, with a letter and a number) |

Leave the Cloudinary and Resend lines empty. They are optional: photo uploads and emails simply stay switched off.

Save the file.

> **Shared database instead of a local one:** if the team uses one shared MongoDB Atlas database for development, the project owner will give you a connection string. Put it in `MONGODB_URI` and skip running MongoDB locally. Do **not** run `npm run seed:reset` against a shared database; it wipes everything.

---

## Step 5. Fill the database with demo data

```
npm run seed
```

This creates the city areas, course categories, equipment types and settings, your admin account, and a demo set of rooms, courses and learners. At the end it prints a table of the demo logins.

To start again from a clean database later:

```
npm run seed:reset
```

---

## Step 6. Start the app

```
npm run dev
```

When the terminal shows **Ready**, open **http://localhost:3000** in your browser.

> **"Port 3000 is in use"?** Another app is using that port. Either close it, or run on another port: `npm run dev -- -p 3100`, then open http://localhost:3100.

To stop the app, click in the terminal and press **Ctrl + C**.

---

## Step 7. Sign in and try it

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@eduspace.local` (or what you set) | The `ADMIN_SEED_PASSWORD` you chose |
| Learner | `learner@eduspace.local` | `Demo-Pass-2026` |
| Space Giver | `spaces@eduspace.local` | `Demo-Pass-2026` |
| Course Provider | `provider@eduspace.local` | `Demo-Pass-2026` |

**First thing to do:** sign in as the Administrator and press **Run Allocation**. On your computer, matching does not run on a timer (that only happens when the app is deployed online), so this button starts it. Then explore each role.

For what every screen does, read [SYSTEM_GUIDE.md](./SYSTEM_GUIDE.md).

---

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app for development |
| `npm run seed` | Add demo data (safe to run again; it skips what already exists) |
| `npm run seed:reset` | Wipe the local database and seed it again |
| `npm test` | Run all automated tests (about 1–2 minutes; uses its own temporary database, not yours) |
| `npm run lint` | Check code style |
| `npm run typecheck` | Check for type errors |
| `npm run build` | Build the production version (to check that it builds) |
| `npm run engine:bench` | Speed test of the matching engine |

**Before you push code**, run `npm run lint`, `npm run typecheck` and `npm test`. GitHub runs the same checks on every pull request.

**When someone else's changes add new packages** (after `git pull`), run `npm install` again.

---

## Optional: the browser test

This test opens a real browser and clicks through the whole flow, from a learner's request to a scheduled class.

1. One time only, download the test browser (about 150 MB):
   ```
   npx playwright install chromium
   ```
2. Run it:
   ```
   npm run test:e2e
   ```

It builds the app, uses its own database called `eduspace_e2e` (your normal data is untouched) and runs on port 3000. If port 3000 is busy, run it on another port.

Windows (PowerShell):
```
$env:E2E_PORT="3100"; npm run test:e2e
```
Mac / Linux:
```
E2E_PORT=3100 npm run test:e2e
```

---

## Optional: database transactions (closer to production)

In production the database saves each matching run "all or nothing" (a transaction). A normal local MongoDB cannot do this, so the app falls back to a safe alternative, and everything still works. If you want your computer to match production exactly:

1. Open `C:\Program Files\MongoDB\Server\8.2\bin\mongod.cfg` in Notepad **as administrator** and add at the end:
   ```
   replication:
     replSetName: rs0
   ```
2. In PowerShell as administrator: `Restart-Service MongoDB`
3. Install **MongoDB Shell** (mongodb.com/try/download/shell), then run: `mongosh --eval "rs.initiate()"`
4. In `.env.local`, change the database line to:
   `MONGODB_URI=mongodb://127.0.0.1:27017/eduspace?replicaSet=rs0`

---

## If something goes wrong

| Problem | Fix |
|---|---|
| `Invalid environment configuration` when starting | A line in `.env.local` is missing or too short. The message names it. `AUTH_SECRET` and `CRON_SECRET` must be at least 16 characters |
| `connect ECONNREFUSED 127.0.0.1:27017` | MongoDB is not running. Run `Start-Service MongoDB` in PowerShell as administrator |
| Sign in says "Email or password is incorrect" | Run `npm run seed` first. For the admin, use the password from `.env.local` |
| Admin password changed in `.env.local` but the old one still works | The seed never overwrites an existing admin. Run `npm run seed:reset` (local database only) to recreate it |
| Pages are empty: no classes, no offers | Sign in as the Administrator and press **Run Allocation** |
| `Port 3000 is in use` | Use `npm run dev -- -p 3100` |
| Photo upload says "not set up yet" | Expected: Cloudinary is not configured. Ask the project owner if you need it |
| Tests fail with "failed to find the current suite" | Run tests with `npm test`, not `npx vitest` directly. The npm command fixes a Windows path issue |
| Is the app healthy? | Open http://localhost:3000/api/health. It should say `"status":"ok"` |

Still stuck? Copy the full error from the terminal and share it with the team.
