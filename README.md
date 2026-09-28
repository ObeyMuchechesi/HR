# HR Management System

Full-stack HR platform: **Express + MongoDB Atlas** backend and **React** frontend.

![status](https://img.shields.io/badge/status-active-brightgreen) ![stack](https://img.shields.io/badge/stack-MERN-informational)

## Features

- **JWT authentication** with role-based access: `admin` → `hr` → `manager` → `employee`
- **Employees** — full CRUD, department assignment, leave balances
- **Departments** — managers, budgets, live headcount
- **Leave management** — request/approve/reject, automatic balance deduction on approval (single-approval enforced)
- **Attendance** — check-in/check-out with hours calculation
- **Payroll** — allowances/deductions, net-pay computation, mark-as-paid
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
| Attendance | list (self-scoped for employees), check-in, check-out, `GET /summary/today` |
| Payroll | list (self-scoped for employees), generate, mark paid |
