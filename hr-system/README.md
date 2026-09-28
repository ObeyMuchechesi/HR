# HR Management System

Full-stack HR system: Express + MongoDB Atlas backend, React (CRA) frontend.

## Structure

```
hr-system/
├── backend/    Express API (auth, employees, departments, leaves, attendance, payroll)
└── frontend/   React SPA (dashboard, CRUD pages, login/register)
```

## Run the backend

```bash
cd hr-system/backend
npm install
npm run dev        # http://localhost:5001 (5000 was taken, change PORT in .env if you prefer)
```

The `.env` points `MONGO_URI` at your MongoDB Atlas cluster (`hr_system` database).
Your Atlas credentials were placed in `hr-system/backend/.env`, which is gitignored —
do not commit it or share it.

Make sure Atlas allows connections from your IP (Network Access → add your IP or 0.0.0.0/0 for dev).

## Run the frontend

```bash
cd hr-system/frontend
npm install
npm start          # http://localhost:3000 (proxies /api to port 5000)
```

## First login & roles

Open http://localhost:3000 and **Register** — new accounts always start with the
**Employee** role (public signup cannot grant privileged roles).

To create the first admin, register normally, then promote yourself from the
MongoDB Atlas UI (Browse Collections → `users` → edit your document → set
`role: "admin"`), or have an existing admin call:

```bash
curl -X PUT http://localhost:5001/api/auth/role \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"userId":"<your-user-id>","role":"admin"}'
```

Roles: `admin` (everything) → `hr` (most writes) → `manager` (leave approvals)
→ `employee` (own data only).

## Notes

- The API requires a Bearer token for every route except register/login.
- Roles: `admin`, `hr`, `manager`, `employee`. Payroll/employee writes are restricted to `admin`/`hr`.
- Approving a leave deducts days from the employee's leave balance.
