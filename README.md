# Labb POCT Control Tracker

A small web app for tracking quality-control (QC) runs on **Labb rapid point-of-care tests (POCTs)** and the shelf-life extensions those controls earn — published online so customers can confirm that an "expired" test kit is still verified for use.

## Why this exists

Labb rapid POCTs ship with a **24-month** expiration date. When a lot reaches expiration, its shelf life can be extended by running a quality control test:

- Each **passing** control extends the lot's shelf life by **60 days**.
- Controls can be repeated **every 60 days** to keep extending the lot, up to a **maximum of one additional year (365 days)** beyond the original expiration.
- A **failing** control grants no extension and flags the lot as *Verification Failed* — it should not be used past its current expiration.

Labb staff record each control run; customers look up their lot number to see the current verified expiration date.

## What it stores

For every POCT lot:

| Field | Description |
|-------|-------------|
| POCT name | e.g. *Labb Rapid Flu A/B* |
| Lot number | Manufacturer lot identifier |
| Original expiration date | The 24-month date printed on the kit |
| Controls | Each control's **date conducted**, **outcome** (Pass/Fail), technician, and notes |
| New (current) expiration | Automatically computed per lot from the passing controls |

## Running it

```bash
npm install
npm run seed     # optional: load a few example lots
npm start        # serves on http://localhost:3000
```

Then open:

- **Customer view:** <http://localhost:3000/> — searchable, read-only lookup of every lot's current expiration and status.
- **Staff console:** <http://localhost:3000/admin.html> — add lots and log controls.

### Admin token

Write operations (adding lots, logging controls, deleting) require an admin token. Set it with the `ADMIN_TOKEN` environment variable (default `labb-admin` for local use):

```bash
ADMIN_TOKEN="choose-a-strong-secret" npm start
```

Enter the same token in the "Admin token" box on the staff console; it is remembered in that browser. Read-only endpoints and the customer view need no token.

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP port |
| `DATA_FILE` | `./data/poct.json` | JSON data file location |
| `ADMIN_TOKEN` | `labb-admin` | Secret required for write endpoints |

## API

Read-only (public):

- `GET /api/lots?q=<search>` — list lots with computed status
- `GET /api/lots/:id` — one lot
- `GET /api/config` — extension rules (`60` days/control, `365`-day cap)

Write (require `x-admin-token` header):

- `POST /api/lots` — `{ poctName, lotNumber, originalExpiration }`
- `POST /api/lots/:id/controls` — `{ dateConducted, outcome: "Pass"|"Fail", performedBy?, notes? }`
- `DELETE /api/lots/:id`

## Expiration logic

The rules live in a single pure module, [`src/logic.js`](src/logic.js), and are covered by unit tests:

```bash
npm test
```

`currentExpiration = originalExpiration + min(passingControls × 60, 365) days`

Statuses: **Active** (no extension yet, not near expiry), **Extended** (has valid extensions), **Control Due** (≤14 days left — run a control to extend), **Expired** (past current expiration), **Verification Failed** (most recent control failed).

## Data storage

Data is kept in a single JSON file (`data/poct.json`), written atomically. This keeps the app dependency-light and easy to deploy anywhere Node runs. The live data file is git-ignored. For higher volumes, `src/store.js` is the only module to swap for a database.
