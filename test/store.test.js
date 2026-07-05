'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword, newToken } = require('../src/auth');
const { JsonStore } = require('../src/json-store');
const { sqliteAvailable } = require('../src/store');

// ---- Auth helpers (storage-independent) ----------------------------------

test('password hashing verifies correct password and rejects wrong ones', () => {
  const stored = hashPassword('s3cret-pw');
  assert.ok(stored.startsWith('scrypt$'));
  assert.strictEqual(verifyPassword('s3cret-pw', stored), true);
  assert.strictEqual(verifyPassword('wrong', stored), false);
  assert.strictEqual(verifyPassword('s3cret-pw', 'garbage'), false);
});

test('newToken produces distinct hex tokens', () => {
  assert.notStrictEqual(newToken(), newToken());
  assert.match(newToken(), /^[0-9a-f]+$/);
});

// ---- Shared store behaviour ----------------------------------------------

/**
 * Runs the full store contract against a factory that returns a fresh,
 * in-memory store. Both the JSON and SQLite stores must pass identically.
 */
function runStoreSuite(label, makeStore) {
  test(`[${label}] lots and controls persist with computed retrieval shape`, () => {
    const db = makeStore();
    const actor = { id: 'u1', username: 'tester', displayName: 'Tester' };
    const lot = db.addLot({ poctName: 'Labb Rapid Flu A/B', lotNumber: 'L1', originalExpiration: '2026-01-01' }, actor);
    assert.ok(lot.id);
    db.addControl(lot.id, { dateConducted: '2025-12-20', outcome: 'Pass' }, actor);

    const loaded = db.getLot(lot.id);
    assert.strictEqual(loaded.controls.length, 1);
    assert.strictEqual(loaded.controls[0].outcome, 'Pass');
    assert.strictEqual(loaded.controls[0].performedBy, 'Tester'); // defaults to actor
    assert.strictEqual(loaded.createdBy, 'tester');
    db.close();
  });

  test(`[${label}] findLot is case-insensitive on name and lot number`, () => {
    const db = makeStore();
    db.addLot({ poctName: 'Labb Rapid RSV', lotNumber: 'ABC-1', originalExpiration: '2026-01-01' }, null);
    assert.ok(db.findLot('labb rapid rsv', 'abc-1'));
    assert.strictEqual(db.findLot('nope', 'abc-1'), null);
    db.close();
  });

  test(`[${label}] deleteLot removes the lot and its controls`, () => {
    const db = makeStore();
    const lot = db.addLot({ poctName: 'X', lotNumber: 'L', originalExpiration: '2026-01-01' }, null);
    db.addControl(lot.id, { dateConducted: '2026-01-01', outcome: 'Pass' }, null);
    assert.strictEqual(db.deleteLot(lot.id, null), true);
    assert.strictEqual(db.getLot(lot.id), null);
    db.close();
  });

  test(`[${label}] user creation, login, session lookup, and logout`, () => {
    const db = makeStore();
    const admin = db.createUser({ username: 'admin', password: 'labb-admin', role: 'admin' }, null);
    assert.strictEqual(admin.role, 'admin');
    assert.ok(!('passwordHash' in admin)); // publicUser must not leak the hash

    assert.strictEqual(db.login('admin', 'wrong'), null);
    const session = db.login('admin', 'labb-admin');
    assert.ok(session.token);
    assert.strictEqual(session.user.username, 'admin');

    assert.strictEqual(db.userForToken(session.token).username, 'admin');
    db.logout(session.token);
    assert.strictEqual(db.userForToken(session.token), null);
    db.close();
  });

  test(`[${label}] duplicate usernames are rejected and disabled users cannot log in`, () => {
    const db = makeStore();
    db.createUser({ username: 'sam', password: 'password1', role: 'staff' }, null);
    assert.throws(() => db.createUser({ username: 'Sam', password: 'password2' }, null), /already exists/);

    const sam = db.getUserByUsername('sam');
    db.setUserActive(sam.id, false, null);
    assert.strictEqual(db.login('sam', 'password1'), null);
    db.close();
  });

  test(`[${label}] audit log records actions in reverse-chronological order`, () => {
    const db = makeStore();
    const actor = { id: 'u1', username: 'auditor' };
    db.addLot({ poctName: 'A', lotNumber: '1', originalExpiration: '2026-01-01' }, actor);
    const entries = db.listAudit(10);
    assert.ok(entries.length >= 1);
    assert.strictEqual(entries[0].action, 'create');
    assert.strictEqual(entries[0].username, 'auditor');
    db.close();
  });
}

// The JSON store must work on every supported Node version.
runStoreSuite('json', () => new JsonStore(':memory:'));

// The SQLite store is exercised only where node:sqlite is available
// (Node 24+, or Node 22.5+ with --experimental-sqlite).
if (sqliteAvailable()) {
  const { Db } = require('../src/db');
  runStoreSuite('sqlite', () => new Db(':memory:'));
} else {
  test('sqlite store suite skipped (node:sqlite unavailable on this runtime)', (t) => {
    t.skip('node:sqlite not available — JSON store suite covers the contract');
  });
}
