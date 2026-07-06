'use strict';

/**
 * Copy POCT lots and their control history into another instance (e.g. your
 * live Render deployment).
 *
 * Source (where the data comes from), in priority order:
 *   - SOURCE_URL set  → read the public API at SOURCE_URL/api/lots
 *   - otherwise       → read the local data file (DATA_FILE or data/poct.json)
 *
 * Target (where the data goes):
 *   - TARGET_URL      → the app's write API, authenticated as an admin
 *
 * Staff accounts are NOT copied — passwords can't be recovered from the store,
 * so recreate staff in the target's console (Staff Accounts). Lots that already
 * exist in the target (same POCT name + lot number) are skipped, so this is
 * safe to re-run.
 *
 * Usage (run on the machine that has your data, e.g. your Mac):
 *
 *   TARGET_URL=https://labb-poct-tracker.onrender.com \
 *   ADMIN_PASSWORD='your-production-admin-password' \
 *   node scripts/migrate.js
 *
 * Optional env: ADMIN_USER (default "admin"), SOURCE_URL, DATA_FILE.
 */

const fs = require('fs');
const path = require('path');

const SOURCE_URL = (process.env.SOURCE_URL || '').replace(/\/$/, '');
const TARGET_URL = (process.env.TARGET_URL || '').replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'poct.json');

async function getSourceLots() {
  if (SOURCE_URL) {
    const res = await fetch(`${SOURCE_URL}/api/lots`);
    if (!res.ok) throw new Error(`Could not read source lots from ${SOURCE_URL} (${res.status})`);
    const { lots } = await res.json();
    console.log(`Source: ${lots.length} lot(s) from ${SOURCE_URL}/api/lots`);
    return lots;
  }
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(
      `No local data file at ${DATA_FILE}. If your data is in a running app, set `
      + 'SOURCE_URL (e.g. http://localhost:8090) instead.',
    );
  }
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const lots = Array.isArray(parsed.lots) ? parsed.lots : [];
  console.log(`Source: ${lots.length} lot(s) from ${DATA_FILE}`);
  return lots;
}

async function main() {
  if (!TARGET_URL) throw new Error('TARGET_URL is required (e.g. https://your-app.onrender.com)');
  if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD is required (the TARGET admin password)');

  const lots = await getSourceLots();
  if (!lots.length) { console.log('Nothing to copy.'); return; }

  const loginRes = await fetch(`${TARGET_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) {
    throw new Error(`Login to ${TARGET_URL} failed (${loginRes.status}). Check ADMIN_USER / ADMIN_PASSWORD.`);
  }
  const { token } = await loginRes.json();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  let created = 0;
  let skipped = 0;
  let controlCount = 0;

  for (const lot of lots) {
    const createRes = await fetch(`${TARGET_URL}/api/lots`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        poctName: lot.poctName,
        lotNumber: lot.lotNumber,
        originalExpiration: lot.originalExpiration,
      }),
    });

    if (createRes.status === 409) {
      console.log(`• skip (already exists): ${lot.poctName} / ${lot.lotNumber}`);
      skipped += 1;
      continue;
    }
    if (!createRes.ok) {
      const e = await createRes.json().catch(() => ({}));
      console.warn(`! failed to create ${lot.poctName} / ${lot.lotNumber}: ${e.error || createRes.status}`);
      continue;
    }

    const { lot: newLot } = await createRes.json();
    created += 1;

    for (const c of (lot.controls || [])) {
      const cr = await fetch(`${TARGET_URL}/api/lots/${newLot.id}/controls`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          dateConducted: c.dateConducted,
          outcome: c.outcome,
          performedBy: c.performedBy,
          notes: c.notes,
        }),
      });
      if (cr.ok) controlCount += 1;
      else console.warn(`  ! control ${c.dateConducted} (${c.outcome}) failed: ${cr.status}`);
    }
    console.log(`✓ ${lot.poctName} / ${lot.lotNumber} (${(lot.controls || []).length} controls)`);
  }

  console.log(`\nDone. Created ${created} lot(s) and ${controlCount} control(s); skipped ${skipped} already present.`);
  console.log(`Review it live at ${TARGET_URL}/`);
}

main().catch((err) => {
  console.error(`\nMigration failed: ${err.message}`);
  process.exit(1);
});
