'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { createStore } = require('./src/store');
const logic = require('./src/logic');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'poct.db');
const JSON_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'poct.json');
// Bootstrap admin used only when the users table is empty (first run).
const BOOTSTRAP_USER = process.env.ADMIN_USER || 'admin';
const BOOTSTRAP_PASSWORD = process.env.ADMIN_PASSWORD || 'labb-admin';

const db = createStore({ dbFile: DB_FILE, jsonFile: JSON_FILE });
bootstrap(db);

const app = express();
app.use(express.json());

/** Attach computed status to a stored lot for API responses. */
function serializeLot(lot) {
  const status = logic.computeLotStatus(lot);
  return {
    id: lot.id,
    poctName: lot.poctName,
    lotNumber: lot.lotNumber,
    createdAt: lot.createdAt,
    createdBy: lot.createdBy || null,
    ...status,
  };
}

// ---- Auth middleware ------------------------------------------------------

function currentUser(req) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.get('x-session-token');
  return db.userForToken(token);
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in required.' });
  req.user = user;
  return next();
}

function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in required.' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
  req.user = user;
  return next();
}

// ---- Auth endpoints -------------------------------------------------------

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const result = db.login(username, password);
  if (!result) return res.status(401).json({ error: 'Invalid username or password.' });
  return res.json(result);
});

app.post('/api/logout', requireAuth, (req, res) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.get('x-session-token');
  db.logout(token);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: db.publicUser(req.user) });
});

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
  let lots = db.listLots().map(serializeLot);
  if (q) {
    lots = lots.filter(
      (l) => l.poctName.toLowerCase().includes(q) || l.lotNumber.toLowerCase().includes(q),
    );
  }
  res.json({ lots });
});

app.get('/api/lots/:id', (req, res) => {
  const lot = db.getLot(req.params.id);
  if (!lot) return res.status(404).json({ error: 'Lot not found' });
  return res.json({ lot: serializeLot(lot) });
});

// ---- Write API (signed-in staff) -----------------------------------------

app.post('/api/lots', requireAuth, async (req, res) => {
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
  const existing = db.findLot(poctName, lotNumber);
  if (existing) {
    return res.status(409).json({
      error: 'A lot with this POCT name and lot number already exists',
      lot: serializeLot(existing),
    });
  }
  const lot = db.addLot({ poctName, lotNumber, originalExpiration: exp }, req.user);
  return res.status(201).json({ lot: serializeLot(lot) });
});

app.post('/api/lots/:id/controls', requireAuth, async (req, res) => {
  const lot = db.getLot(req.params.id);
  if (!lot) return res.status(404).json({ error: 'Lot not found' });

  const { dateConducted, outcome, performedBy, notes } = req.body || {};
  const date = logic.formatDate(dateConducted);
  if (!date) {
    return res.status(400).json({ error: 'dateConducted must be a valid YYYY-MM-DD date' });
  }
  if (outcome !== logic.PASS && outcome !== logic.FAIL) {
    return res.status(400).json({ error: `outcome must be "${logic.PASS}" or "${logic.FAIL}"` });
  }
  db.addControl(lot.id, { dateConducted: date, outcome, performedBy, notes }, req.user);
  return res.status(201).json({ lot: serializeLot(db.getLot(lot.id)) });
});

app.delete('/api/lots/:id', requireAuth, async (req, res) => {
  const ok = db.deleteLot(req.params.id, req.user);
  if (!ok) return res.status(404).json({ error: 'Lot not found' });
  return res.json({ ok: true });
});

// ---- User management (admins only) ---------------------------------------

app.get('/api/users', requireAdmin, (_req, res) => {
  res.json({ users: db.listUsers().map((u) => db.publicUser(u)) });
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, displayName, role } = req.body || {};
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }
  try {
    const user = db.createUser({ username, password, displayName, role }, req.user);
    return res.status(201).json({ user });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.post('/api/users/:id/active', requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own active status.' });
  }
  const ok = db.setUserActive(req.params.id, !!(req.body && req.body.active), req.user);
  if (!ok) return res.status(404).json({ error: 'User not found' });
  return res.json({ ok: true });
});

// ---- Audit log (signed-in staff) -----------------------------------------

app.get('/api/audit', requireAuth, (req, res) => {
  const limit = Number(req.query.limit) || 100;
  res.json({ entries: db.listAudit(limit) });
});

// ---- Static front end -----------------------------------------------------

app.use(express.static(path.join(__dirname, 'public')));

/**
 * First-run setup: create an admin user if none exist, and import any legacy
 * JSON data file left over from the file-based store.
 */
function bootstrap(database) {
  if (database.countUsers() === 0) {
    database.createUser({
      username: BOOTSTRAP_USER,
      password: BOOTSTRAP_PASSWORD,
      displayName: 'Administrator',
      role: 'admin',
    }, { id: null, username: 'system' });
    console.log(`Created bootstrap admin user "${BOOTSTRAP_USER}".`);
    if (BOOTSTRAP_PASSWORD === 'labb-admin') {
      console.warn('WARNING: using the default admin password. Set ADMIN_PASSWORD in production.');
    }
  }

  // Only the SQLite store needs an explicit migration: the JSON store already
  // reads data/poct.json as its own native file.
  if (database.kind === 'sqlite' && database.listLots().length === 0
      && JSON_FILE !== database.location && fs.existsSync(JSON_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
      const lots = Array.isArray(parsed.lots) ? parsed.lots : [];
      let imported = 0;
      for (const lot of lots) {
        const created = database.addLot({
          poctName: lot.poctName,
          lotNumber: lot.lotNumber,
          originalExpiration: lot.originalExpiration,
        }, { id: null, username: 'migration' });
        for (const c of lot.controls || []) {
          database.addControl(created.id, {
            dateConducted: c.dateConducted,
            outcome: c.outcome,
            performedBy: c.performedBy,
            notes: c.notes,
          }, { id: null, username: 'migration' });
        }
        imported += 1;
      }
      if (imported) console.log(`Migrated ${imported} lot(s) from legacy JSON store (${JSON_FILE}).`);
    } catch (err) {
      console.error(`Could not migrate legacy JSON store: ${err.message}`);
    }
  }
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Labb POCT Control Tracker listening on http://localhost:${PORT}`);
    console.log(`Storage: ${db.kind} (${db.location})`);
  });
}

module.exports = { app, db };
