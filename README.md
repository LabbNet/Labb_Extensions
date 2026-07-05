# Labb POCT Control Tracker

A web app for tracking quality-control (QC) runs on **Labb rapid point-of-care tests (POCTs)** and the shelf-life extensions those controls earn — published online so customers can confirm that an "expired" test kit is still verified for use.

## Why this exists

Labb rapid POCTs ship with a **24-month** expiration date. When a lot reaches expiration, its shelf life can be extended by running a quality control test:

- Each **passing** control extends the lot's shelf life by **60 days**.
- Controls can be repeated **every 60 days** to keep extending the lot, up to a **maximum of one additional year (365 days)** beyond the original expiration.
- A **failing** control grants no extension and flags the lot as *Verification Failed* — it should not be used past its current expiration.

Labb staff sign in to record each control run; customers look up their lot number to see the current verified expiration date.

## What it stores

For every POCT lot:

| Field | Description |
|-------|-------------|
| POCT name | e.g. *Labb Rapid Flu A/B* |
| Lot number | Manufacturer lot identifier |
| Original expiration date | The 24-month date printed on the kit |
| Controls | Each control's **date conducted**, **outcome** (Pass/Fail), technician, and notes |
| New (current) expiration | Automatically computed per lot from the passing controls |

Every write is attributed to the signed-in staff member and recorded in an **audit log**.

## Running it

```bash
npm install
npm run seed     # optional: load example lots + demo users
npm start        # serves on http://localhost:3000
```

Then open:

- **Customer view:** <http://localhost:3000/> — searchable, read-only lookup of every lot's current expiration and status.
- **Staff console:** <http://localhost:3000/admin.html> — sign in to add lots, log controls, manage staff accounts, and view the audit log.

> The app uses Node's built-in SQLite, so the npm scripts run Node with the
> `--experimental-sqlite` flag. Requires Node 22.5+ (developed on Node 22).

### Accounts & roles

On first run the app creates a bootstrap **admin** account from environment
variables (defaults: `admin` / `labb-admin`). Sign in and change it immediately.

- **admin** — everything staff can do, plus create/enable/disable staff accounts.
- **staff** — add lots and log controls.

Read-only endpoints and the customer view require no sign-in.

```bash
ADMIN_USER="you@labb.net" ADMIN_PASSWORD="a-strong-secret" npm start
```

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP port |
| `DB_FILE` | `./data/poct.db` | SQLite database location |
| `ADMIN_USER` | `admin` | Bootstrap admin username (first run only) |
| `ADMIN_PASSWORD` | `labb-admin` | Bootstrap admin password (first run only) |
| `DATA_FILE` | `./data/poct.json` | Legacy JSON store to migrate from, if present |

### Migration from the JSON store

Earlier versions stored data in a JSON file. On first start, if the database is
empty and a legacy `data/poct.json` exists, its lots and controls are imported
automatically (attributed to `migration` in the audit log).

## API

Read-only (public):

- `GET /api/lots?q=<search>` — list lots with computed status
- `GET /api/lots/:id` — one lot
- `GET /api/config` — extension rules (`60` days/control, `365`-day cap)

Auth:

- `POST /api/login` — `{ username, password }` → `{ token, user }`
- `POST /api/logout`, `GET /api/me`

Write (require `Authorization: Bearer <token>`):

- `POST /api/lots` — `{ poctName, lotNumber, originalExpiration }`
- `POST /api/lots/:id/controls` — `{ dateConducted, outcome: "Pass"|"Fail", performedBy?, notes? }`
- `DELETE /api/lots/:id`
- `GET /api/audit?limit=` — recent activity

Admin only:

- `GET /api/users`, `POST /api/users`, `POST /api/users/:id/active`

## Expiration logic

The rules live in a single pure module, [`src/logic.js`](src/logic.js), covered by unit tests:

```bash
npm test
```

`currentExpiration = originalExpiration + min(passingControls × 60, 365) days`

Statuses: **Active** (no extension yet, not near expiry), **Extended** (has valid extensions), **Control Due** (≤14 days left — run a control to extend), **Expired** (past current expiration), **Verification Failed** (most recent control failed).

## Architecture

| Module | Responsibility |
|--------|----------------|
| `src/logic.js` | Pure expiration math (no I/O) |
| `src/auth.js` | scrypt password hashing + token generation |
| `src/db.js` | SQLite store: lots, controls, users, sessions, audit log |
| `server.js` | Express REST API, session auth, RBAC, first-run bootstrap/migration |
| `public/` | Customer lookup page and staff console |

Data lives in a single SQLite database (`data/poct.db`) via Node's built-in
`node:sqlite` — no native dependencies. The database file is git-ignored.
