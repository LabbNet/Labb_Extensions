'use strict';

const express = require('express');
const path = require('path');
const { Store } = require('./src/store');
const logic = require('./src/logic');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'poct.json');
// Shared secret required to record lots/controls. Read-only endpoints are open
// so customers can view extensions without a token.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'labb-admin';

const store = new Store(DATA_FILE);
const app = express();
app.use(express.json());

/** Attach the computed status to a stored lot for API responses. */
function serializeLot(lot) {
  const status = logic.computeLotStatus(lot);
  return {
    id: lot.id,
    poctName: lot.poctName,
    lotNumber: lot.lotNumber,
    createdAt: lot.createdAt,
    ...status,
  };
}

function requireAdmin(req, res, next) {
  const token = req.get('x-admin-token') || (req.body && req.body.adminToken);
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized. A valid admin token is required.' });
  }
  return next();
}

// ---- Read-only API (public / customer facing) ----------------------------

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/config', (_req, res) => {
  res.json({
    extensionDaysPerControl: logic.EXTENSION_DAYS_PER_CONTROL,
    maxExtensionDays: logic.MAX_EXTENSION_DAYS,
  });
});

app.get('/api/lots', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let lots = store.listLots().map(serializeLot);
  if (q) {
    lots = lots.filter(
      (l) => l.poctName.toLowerCase().includes(q) || l.lotNumber.toLowerCase().includes(q),
    );
  }
  lots.sort((a, b) => a.poctName.localeCompare(b.poctName)
    || a.lotNumber.localeCompare(b.lotNumber));
  res.json({ lots });
});

app.get('/api/lots/:id', (req, res) => {
  const lot = store.getLot(req.params.id);
  if (!lot) return res.status(404).json({ error: 'Lot not found' });
  return res.json({ lot: serializeLot(lot) });
});

// ---- Write API (Labb staff only) -----------------------------------------

app.post('/api/lots', requireAdmin, async (req, res) => {
  const { poctName, lotNumber, originalExpiration } = req.body || {};
  if (!poctName || !String(poctName).trim()) {
    return res.status(400).json({ error: 'poctName is required' });
  }
  if (!lotNumber || !String(lotNumber).trim()) {
    return res.status(400).json({ error: 'lotNumber is required' });
  }
  const exp = logic.formatDate(originalExpiration);
  if (!exp) {
    return res.status(400).json({ error: 'originalExpiration must be a valid YYYY-MM-DD date' });
  }
  const existing = store.findLot(poctName, lotNumber);
  if (existing) {
    return res.status(409).json({
      error: 'A lot with this POCT name and lot number already exists',
      lot: serializeLot(existing),
    });
  }
  const lot = await store.addLot({ poctName, lotNumber, originalExpiration: exp });
  return res.status(201).json({ lot: serializeLot(lot) });
});

app.post('/api/lots/:id/controls', requireAdmin, async (req, res) => {
  const lot = store.getLot(req.params.id);
  if (!lot) return res.status(404).json({ error: 'Lot not found' });

  const { dateConducted, outcome, performedBy, notes } = req.body || {};
  const date = logic.formatDate(dateConducted);
  if (!date) {
    return res.status(400).json({ error: 'dateConducted must be a valid YYYY-MM-DD date' });
  }
  if (outcome !== logic.PASS && outcome !== logic.FAIL) {
    return res.status(400).json({ error: `outcome must be "${logic.PASS}" or "${logic.FAIL}"` });
  }
  await store.addControl(lot.id, { dateConducted: date, outcome, performedBy, notes });
  return res.status(201).json({ lot: serializeLot(store.getLot(lot.id)) });
});

app.delete('/api/lots/:id', requireAdmin, async (req, res) => {
  const ok = await store.deleteLot(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Lot not found' });
  return res.json({ ok: true });
});

// ---- Static front end -----------------------------------------------------

app.use(express.static(path.join(__dirname, 'public')));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Labb POCT Control Tracker listening on http://localhost:${PORT}`);
    console.log(`Data file: ${DATA_FILE}`);
  });
}

module.exports = { app, store };
