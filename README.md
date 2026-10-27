# HR Management System

Full-stack HR platform: **Express + MongoDB Atlas** backend and **React** frontend.

![status](https://img.shields.io/badge/status-active-brightgreen) ![stack](https://img.shields.io/badge/stack-MERN-informational)

## Features

- **JWT authentication** with role-based access: `admin` → `hr` → `manager` → `employee`
- **Employees** — full CRUD, department assignment, leave balances
- **Departments** — managers, budgets, live headcount
- **Leave management** — request/approve/reject, automatic balance deduction on approval (single-approval enforced)
- **Attendance** — check-in/check-out with hours calculation; bulk "check in everyone" at a chosen time, manual & bulk check-out; **per-day check-in/check-out approval queue** — the system never permanently records attendance without an admin accepting it, and staff on approved leave are never checked in at all
- **Payroll** — allowances/deductions, net-pay computation, mark-as-paid with the actual payment date
- **Dashboard** — live stats, department chart, today's attendance summary

New accounts created via public signup always start as `employee`; privileged
roles are granted only by an admin via `PUT /api/auth/role`.

## Project structure

```
hr-system/
├── backend/    Express API (auth, employees, departments, leaves, attendance, payroll)
└── frontend/   React SPA (dashboard, CRUD pages, login/register)
```

## Getting started

### Backend

```bash
cd hr-system/backend
npm install
# create .env (see below)
npm run dev        # http://localhost:5001
```

`.env` template:

```
PORT=5001
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>/<dbname>?retryWrites=true&w=majority
JWT_SECRET=<long-random-string>
JWT_EXPIRE=7d
```

Make sure Atlas Network Access allows your IP.

### Frontend

```bash
cd hr-system/frontend
npm install
npm start          # http://localhost:3000 (proxies /api to the backend)
```

If port 3000 is taken: `PORT=3001 npm start` (and the CRA proxy target in
`package.json` must point at the backend port).

## First admin & roles

Register through the UI — new accounts start as **Employee**. To bootstrap the
first admin, promote your user in Atlas (Browse Collections → `users` → set
`role: "admin"`), or have an existing admin call:

```bash
curl -X PUT http://localhost:5001/api/auth/role \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"userId":"<user-id>","role":"admin"}'
```

## API overview

All routes except `/api/auth/register` and `/api/auth/login` require a
`Authorization: Bearer <token>` header.

| Area | Endpoints |
|------|-----------|
| Auth | `POST /register`, `POST /login`, `GET /me`, `PUT /role` (admin) |
| Employees | CRUD + `GET /stats/dashboard` |
| Departments | CRUD (delete: admin only) |
| Leaves | list/create, approve/reject (single-approval), delete (admin/hr) |
| Attendance | list (self-scoped for employees), check-in, check-out, manual entry & check-out, check-in/check-out everyone (date + time), `GET /summary/today`, `GET /pending` + `POST /approve` (admin approval queue; rejects require a reason — Absent / Sick / Other), `GET /leave-summary` (per-person leave days per year, admin/hr/manager) |
| Payroll | list (self-scoped for employees), generate, mark paid (with payment date) |

## Attendance automation (Vercel Cron)

The backend runs two weekday cron entries (Mon–Fri; the Hobby plan allows each
cron to fire at most once per day, so morning and evening are separate):

- **`55 5 * * 1-5` → `GET /api/cron/auto-attendance` (05:55 UTC = 07:55 CAT) —
  morning pass:** every active employee without a record for the day is
  checked in at 07:55 as **`pending-checkin`** — nothing is final until the
  admin approves it on the Attendance page. Staff on approved leave and
  Zimbabwe public holidays are skipped entirely (no check-in is even
  proposed); weekends never trigger.
- **`0 22 * * 1-5` → `GET /api/cron/evening-close` (22:00 UTC) — evening pass:**
  still-open approved check-ins get closed at **16:00 CAT** (8.08h) as
  **`pending-checkout`** for approval; check-ins still awaiting approval are
  **left pending** (never auto-converted — the admin decides each one);
  everyone with no record at all is marked **Absent**; then the daily summary
  notification goes out.
- **Fridays:** right after the morning pass, a **weekly attendance summary**
  notification (in-app + email) listing every person's approved present days,
  hours worked, and leave for Mon → Fri goes to admin/hr/manager **and all
  staff** (part of `auto-attendance`, no separate cron).
- **`0 2 * * *` → `GET /api/cron/holiday-announce`** unchanged: announces
  Zimbabwe public holidays.
All passes are idempotent — re-running on the same day changes nothing that
already exists. Admins can also trigger a specific day by hand:
`/api/cron/auto-attendance?day=YYYY-MM-DD` or
`/api/cron/evening-close?day=YYYY-MM-DD` (CRON_SECRET
or an admin JWT). The old `mark-absents` endpoint remains for the UI button.

> Morning and evening are two cron *entries* because Vercel's Hobby plan only
> allows each cron expression to fire at most once per day (a "55 5,22 ..."
> dual-time schedule is rejected at deploy time).

## Deployment (Vercel)

Both apps are deployed **with the Vercel CLI, not from Git**. The Vercel projects
are intentionally **disconnected from this GitHub repository**: a Git-triggered
build runs at the repo root, where there is no `api/` or `vercel.json`, and
ships an empty deployment that 404s every route — replacing the working
production deployment (this took the site down on 2026-10-01).

```bash
# Backend API  (Vercel project: callcentral-hr-api)
cd hr-system/backend
vercel --prod

# Frontend  (Vercel project: frontend) — MUST run from the repo root,
# because that project's Root Directory is hr-system/frontend
vercel --prod
```

- Production: backend `https://callcentral-hr-api.vercel.app`, frontend
  `https://frontend-obey-muchechesi.vercel.app`
- Do not reconnect the projects to GitHub in Vercel and do not push empty
  commits to "force a redeploy" — that is what broke production.
