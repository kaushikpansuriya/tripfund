# TripFund

A web app for managing money on a group trip: who put money in, who paid for what, who shared each expense, and the fewest payments needed to settle up at the end.

This is **version 1**, covering steps 1–10 of the specification: accounts, trips, members, contributions, expenses, the four split methods, the calculation engine, settlement, the dashboard, and PDF / Excel / CSV export. Payments between members (section 11), roles and permissions, an audit log and activity notifications are also included. Receipt uploads, charts from a chart library, OCR, multi-currency and the AI assistant are planned for later versions (see [Roadmap](#roadmap)).

## Quick start (Docker)

```bash
cp .env.example .env          # set POSTGRES_PASSWORD
docker compose up --build
```

Open http://localhost:8080, create an account and create a trip. Database migrations run automatically when the API starts.

In production, serve the app over HTTPS and set `COOKIE_SECURE=true` in `.env`.

## Deploy on Render

The project runs on Render as **one web service** plus a **PostgreSQL database**. The API also serves the built website, so both share one address. `render.yaml` sets this up automatically:

1. Push the project to a GitHub or GitLab repository.
2. In the Render Dashboard choose **New → Blueprint**, select the repository and click **Apply**.

Or set it up by hand with a **Web Service** (runtime Node, root directory empty):

| Setting | Value |
|---|---|
| Build command | `npm install --include=dev && npm run build -w @tripfund/web` |
| Start command | `npm start -w @tripfund/server` |
| Health check path | `/api/health` |
| Environment | `DATABASE_URL` = the database's **Internal Database URL**, `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=1`, `NODE_VERSION=22` |

Migrations run automatically on every start.

## Deploy on Vercel with Render PostgreSQL

Vercel serves the Vite website and runs the Express API as a Node.js Function. The API applies pending database migrations on its first request after a function starts.

1. Rotate the Render database password because the previous connection URL was shared in chat. Copy the new **External Database URL** from the Render database's **Connect** menu.
2. In Render, make sure external database connections are allowed. Add `?sslmode=require` to the URL (or `&sslmode=require` if it already has query parameters) to require TLS.
3. Import this repository into Vercel with the repository root (`.`) as the project root. `vercel.json` configures the web build, SPA routes, API function, and migration files.
4. In the Vercel project's **Settings → Environment Variables**, set `DATABASE_URL` to the rotated Render URL. Set it for **Production**; use a separate database for Preview deployments if you enable the API there. Also set `COOKIE_SECURE=true`. Do not commit the URL or put it in a `VITE_` variable.
5. Deploy, then open `/api/health` on the deployed site. The first API request applies the SQL migrations and checks the database connection.

Vercel Functions connect to Render using the database's external URL over the public internet, which adds latency compared with an internal Render connection. Vercel uses a small per-function PostgreSQL pool to limit connections. Existing Render deployments continue to use their current configuration.

## How the money is calculated

The whole calculation lives in one dependency-free module, `packages/engine`. The API, the web app (for the live split preview) and the exports all use it, so every screen shows the same numbers.

**All amounts are integers in the currency's smallest unit** (paise, cents, øre). Floating-point numbers are never used for money.

### The money model

Every expense is paid with someone's **own money**. There is no shared pot that expenses are paid from.

| Record | What it means | Effect on balances |
|---|---|---|
| **Contribution** | A member hands money to another member, normally the trip's *fund holder* (e.g. everyone gives John ₹5,000). A member can also record money they keep themselves. | Giver +amount, holder −amount (the holder owes it back). Kept money has no effect, but still counts in "money added". |
| **Expense** | A member pays for something that some members share. | Payer +amount, each participant −their share. |
| **Refund** | Money received back, e.g. a cancelled hotel night. | Receiver −amount, each participant +their share. |
| **Payment** | A direct payment between two members (settling up, returning fund money). | Sender +amount, receiver −amount. |

For each member:

```
Net balance = money added − fund money held
            + paid for expenses − refunds received
            − own share of expenses + own share of refunds
            + payments sent − payments received
```

Every record adds and subtracts the same amount, so **all balances always add up to exactly zero**. Nothing is counted twice: a contribution is never also treated as an expense payment. A positive balance means the member should receive money; a negative balance means they need to pay.

**Remaining** on the dashboard is money added minus net spending. When it is positive, that money goes back to the people who put it in, through the settlement.

### Splits

- **Equal:** the amount is divided evenly. Leftover paise go one at a time to the first people in the list, so ₹100 ÷ 3 = 33.34 + 33.33 + 33.33.
- **Custom amounts:** must add up exactly to the expense amount.
- **Percentage:** up to 2 decimals, must total exactly 100%.
- **Shares:** e.g. 2 / 1 / 1, decimals allowed.

Rounding uses the largest-remainder method, so the shares **always add up exactly** to the expense amount. This is checked three times: in the engine, before saving in the API, and by a database constraint trigger at commit.

### Settlement

The engine finds the **smallest possible number of payments**. For up to 16 people with an open balance it searches exactly for the largest number of groups whose balances cancel out; a group of *k* people needs *k − 1* payments. Above 16 people it uses the greedy largest-debtor-to-largest-creditor method, which is at most *n − 1* payments. Recording a payment (full or partial) updates the suggestions immediately.

### The specification's example (section 22)

John, David, Alex and Sarah. Everyone gives their contribution to John (the fund holder): John ₹10,000, the others ₹5,000 each. Expenses: Hotel ₹8,000 paid by John, shared by all 4. Food ₹4,000 paid by David, shared by all 4. Taxi ₹2,000 paid by Alex, shared by John, David and Alex. Activity ₹3,000 paid by Sarah, shared by Sarah and John.

| | John | David | Alex | Sarah |
|---|---:|---:|---:|---:|
| Money added | 10,000 | 5,000 | 5,000 | 5,000 |
| Holding fund money | −25,000 | | | |
| Paid for expenses | 8,000 | 4,000 | 2,000 | 3,000 |
| Own share | −5,166.67 | −3,666.67 | −3,666.66 | −4,500.00 |
| **Balance** | **−12,166.67** | **+5,333.33** | **+3,333.34** | **+3,500.00** |

Totals: money added ₹25,000, spent ₹17,000, remaining ₹8,000.

Settlement (3 payments): John → David ₹5,333.33, John → Sarah ₹3,500, John → Alex ₹3,333.34.

John holds everyone's money, so he pays it back minus what they owe. The engine calculates all of this; the automated test in `packages/engine/test/ledger.test.ts` checks it against values worked out independently in the test.

## Project structure

```
packages/engine/   Calculation engine (TypeScript, no dependencies) + tests
server/            REST API: Node.js + TypeScript + Express 5 + PostgreSQL
  migrations/      SQL schema (applied automatically on start)
  src/routes/      auth, trips/members/categories, money records, exports
  src/exports/     one report model → PDF, Excel and CSV
  test/            unit tests + database constraint tests
  scripts/         check-sql: verifies every SQL statement against the schema
web/               React + TypeScript + Tailwind CSS (Vite), mobile-first
docker-compose.yml PostgreSQL + API + web (nginx)
```

The API and the engine run as TypeScript directly on Node 22.18+ / 24 (type stripping), so the server has no build step.

## Running without Docker

Requirements: Node.js 22.18 or newer, PostgreSQL 14 or newer.

```bash
npm install
createdb tripfund
export DATABASE_URL=postgres://localhost/tripfund
npm run dev:api        # API on http://localhost:4000 (runs migrations)
npm run dev:web        # web on http://localhost:5173 (proxies /api)
```

## Tests

```bash
npm test               # engine tests + server unit tests (no database needed)
npm run test:db        # database constraint tests + SQL check (needs DATABASE_URL)
npm run typecheck
```

The engine tests cover every case in the specification: equal, custom, percentage and shares splits; multiple contributors; members joining later and leaving; partial settlements; refunds; negative and zero balances; rounding; and the section 22 example. There are also randomised tests: hundreds of generated trips that check balances sum to zero, shares match every expense, the settlement clears every balance, and the payment count matches a brute-force optimum.

The database tests check that the schema itself rejects bad data: shares that don't add up, members from another trip, categories from another trip, non-positive amounts, payments to yourself, deleting members who have records, and editing or deleting the audit log.

## Security

- **Passwords:** hashed with scrypt and a per-user salt.
- **Sessions:** random tokens stored only as SHA-256 hashes. They are sent in an httpOnly, SameSite=Lax cookie, or as `Authorization: Bearer` for future mobile apps (register/login with `"wantToken": true`).
- **CSRF:** double-submit token on every state-changing request made with a cookie.
- **Trip-level access control:** every `/api/trips/:id` request checks membership. Trips you are not part of return 404, so their existence is never revealed. Owners manage the trip; members can add records and edit their own (the owner can turn that off).
- **Input validation:** zod on every request.
- **SQL:** parameterised queries only. The `SQL` tag refuses interpolated values at compile time.
- **Database integrity:** composite foreign keys guarantee every member reference belongs to the same trip.
- **Rate limiting:** a general API limit, plus a stricter one on login and register.
- **Headers:** security headers via helmet and nginx.
- **Audit log:** append-only, with before/after snapshots of every financial change. It survives trip deletion.
- **Exports:** CSV text cells that start with `=`, `+`, `-` or `@` are neutralised against spreadsheet formula injection.

## API overview

All amounts are integers in minor units. Main endpoints:

```
POST   /api/auth/register | /api/auth/login | /api/auth/logout      GET /api/auth/me
GET    /api/trips                     POST /api/trips
GET    /api/trips/:id                 PATCH/DELETE /api/trips/:id
POST   /api/trips/:id/members         PATCH/DELETE /api/trips/:id/members/:memberId
POST   /api/trips/:id/categories      DELETE /api/trips/:id/categories/:categoryId
GET    /api/trips/:id/summary         totals, balances, settlement plan, breakdowns, self-checks
GET/POST /api/trips/:id/contributions PATCH/DELETE …/:id
GET/POST /api/trips/:id/expenses      GET/PUT/DELETE …/:id   (filters: q, memberId, categoryId, from, to, sort)
GET/POST /api/trips/:id/settlements   PATCH/DELETE …/:id
GET    /api/trips/:id/export.pdf | export.xlsx | export.csv?table=all|expenses|… | export.json
GET    /api/trips/:id/audit           owners only
GET    /api/notifications             POST /api/notifications/read-all
```

`export.json` returns every record plus the computed report. It is the intended data source for the future AI assistant, which must answer from these numbers rather than inventing any.

## Roadmap

- Receipt upload (JPG/PNG/PDF to S3-compatible storage). The `receipts` table already exists.
- Charts with a chart library (category, member, daily, contribution vs spending). The data is already in `/summary`.
- Push/email notifications. In-app notifications already work.
- OCR for receipts, multi-currency with conversion, PWA/offline mode, bank/payment integration.
- AI assistant working from `export.json`.
