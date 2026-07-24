# Labb POCT Control Tracker

A web app for tracking quality-control (QC) runs on **Labb rapid point-of-care tests (POCTs)** and the shelf-life extensions those controls earn — published online so customers can confirm that an "expired" test kit is still verified for use.

## Why this exists

Labb rapid POCTs ship with a **24-month** expiration date. When a lot reaches expiration, its shelf life can be extended by running a quality control test:

- Each **passing** control extends the expiration to **60 days after the control's date**.
- Controls can be repeated (roughly every 60 days) to keep extending the lot, up to a **maximum of one additional year (365 days)** beyond the original expiration.
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

Customers can download a **PDF Certificate of Shelf-Life Extension** for any lot (from the customer
view or the lot-detail dialog) documenting the original expiration, the control history, and the
verified current expiration — a record they can keep on file to justify continued use of the kit.

## Running it

```bash
npm install
npm run seed     # optional: load example lots + demo users
npm start        # serves on http://localhost:3000
```

Then open:

- **Customer view:** <http://localhost:3000/> — searchable, read-only lookup of every lot's current expiration and status.
- **Staff console:** <http://localhost:3000/admin.html> — sign in to add lots, log controls, manage staff accounts, and view the audit log.

> Runs on **Node 18.17+** — no build tools or native modules required.
> See [Storage](#data-storage) for how the database backend is chosen.

### Accounts & roles

On first run the app creates a bootstrap **admin** account from environment
variables (defaults: `admin` / `labb-admin`). Sign in and change it immediately.

- **admin** — everything staff can do, plus create/enable/disable staff accounts.
- **staff** — add lots and log controls.

Read-only endpoints and the customer view require no sign-in.

```bash
ADMIN_USER="you@labb.net" ADMIN_PASSWORD="a-strong-secret" npm start
```

## Deploying online (Render)

The repo includes a [`render.yaml`](render.yaml) blueprint that deploys the app
as a web service with a **persistent disk**, so lot and control data survive
restarts and redeploys.

1. Push this branch to GitHub (already done if you're reading this there).
2. Go to <https://dashboard.render.com> → **New** → **Blueprint**, and connect
   this repository. Render reads `render.yaml` automatically.
3. When prompted, set a strong **`ADMIN_PASSWORD`** (it is intentionally not
   stored in the repo). Optionally change `ADMIN_USER`.
4. Click **Apply**. Render provisions the service and a 1 GB disk mounted at
   `/var/data`; the app stores its database there.
5. When the deploy finishes you get a public URL like
   `https://labb-poct-tracker.onrender.com` — that's the customer view. Staff
   sign in at `…/admin.html`.

Notes:
- The `starter` plan is used because persistent disks require a paid instance
  (~$7/mo). Free instances have **ephemeral** storage and would lose data on
  redeploy.
- `PORT` is provided by Render automatically; the app already honors it.
- `autoDeploy` is on, so pushing to the deploy branch ships a new version.
- A [`Dockerfile`](Dockerfile) is included for other container hosts (Fly.io,
  Railway, a VPS); mount a volume at `/var/data` to persist data.

### Uptime monitoring

A scheduled GitHub Action ([`.github/workflows/health-check.yml`](.github/workflows/health-check.yml))
pings `/api/health` every 15 minutes so an outage surfaces as a failed workflow
run (and the usual GitHub failure email) instead of a surprise. It checks for
`HTTP 200` with `{"ok":true}` and retries a few times to ride out cold starts.

Point it at your deployment by setting a **`SITE_URL`** repository variable
(Settings → Secrets and variables → Actions → Variables); otherwise it falls
back to the Render blueprint URL `https://labb-poct-tracker.onrender.com`. You
can also run it on demand from the **Actions** tab via **Run workflow**, passing
a one-off URL to check.

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
- `GET /api/lots/:id/certificate.pdf` — downloadable PDF Certificate of Shelf-Life Extension
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

Each passing control extends the expiration to **60 days after that control's date**; the most
recent passing control governs the current expiration, never falling before the original date and
capped at **365 days beyond** it:

`currentExpiration = clamp(latestPassingControlDate + 60 days, originalExpiration, originalExpiration + 365 days)`

Statuses: **Active** (no extension yet, not near expiry), **Extended** (has valid extensions), **Control Due** (≤14 days left — run a control to extend), **Expired** (past current expiration), **Verification Failed** (most recent control failed).

## Architecture

| Module | Responsibility |
|--------|----------------|
| `src/logic.js` | Pure expiration math (no I/O) |
| `src/auth.js` | scrypt password hashing + token generation |
| `src/store.js` | Storage factory — picks SQLite or the JSON fallback |
| `src/db.js` | SQLite store: lots, controls, users, sessions, audit log |
| `src/json-store.js` | JSON-file store with the same interface (fallback) |
| `server.js` | Express REST API, session auth, RBAC, first-run bootstrap/migration |
| `public/` | Customer lookup page and staff console |

## Data storage

The app keeps everything (lots, controls, users, sessions, audit log) in a
single local file and picks the backend automatically — **no native
dependencies, no build step:**

- **SQLite** (`data/poct.db`) via Node's built-in `node:sqlite`, used when it's
  available — Node 24+, or Node 22.5+ started with `--experimental-sqlite`.
- **JSON file** (`data/poct.json`) used everywhere else, including **Node 18–22**.
  Same features, same API; ideal for the single-node volumes this app handles.

Force a choice with `STORE=sqlite` or `STORE=json` if you ever need to. Both
data files are git-ignored. If a SQLite database starts empty and a legacy
`data/poct.json` exists, its lots are imported automatically.

> **Which am I using?** The startup banner prints e.g. `Storage: json (…/poct.json)`.
