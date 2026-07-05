'use strict';

const test = require('node:test');
const assert = require('node:assert');
const logic = require('../src/logic');

test('parseDate / formatDate round trip', () => {
  assert.strictEqual(logic.formatDate('2026-01-15'), '2026-01-15');
  assert.strictEqual(logic.formatDate(logic.parseDate('2026-01-15')), '2026-01-15');
  assert.strictEqual(logic.formatDate('not-a-date'), null);
});

test('addDays and daysBetween are consistent', () => {
  const d = logic.parseDate('2026-01-01');
  const later = logic.addDays(d, 60);
  assert.strictEqual(logic.formatDate(later), '2026-03-02');
  assert.strictEqual(logic.daysBetween(later, d), 60);
});

test('a single passing control extends the lot by 60 days', () => {
  const lot = {
    originalExpiration: '2026-01-01',
    controls: [{ dateConducted: '2025-12-20', outcome: 'Pass' }],
  };
  const s = logic.computeLotStatus(lot, '2026-01-10');
  assert.strictEqual(s.extensionDays, 60);
  assert.strictEqual(s.currentExpiration, '2026-03-02');
  assert.strictEqual(s.passCount, 1);
  assert.strictEqual(s.status, 'Extended');
});

test('failing controls grant no extension', () => {
  const lot = {
    originalExpiration: '2026-01-01',
    controls: [{ dateConducted: '2025-12-20', outcome: 'Fail' }],
  };
  const s = logic.computeLotStatus(lot, '2025-12-25');
  assert.strictEqual(s.extensionDays, 0);
  assert.strictEqual(s.currentExpiration, '2026-01-01');
  assert.strictEqual(s.failCount, 1);
  assert.strictEqual(s.status, 'Verification Failed');
});

test('multiple passing controls stack up to the one-year cap', () => {
  const controls = [];
  // 7 passes would be 420 days, but the cap is 365.
  for (let i = 0; i < 7; i += 1) {
    controls.push({ dateConducted: `2026-0${(i % 9) + 1}-01`, outcome: 'Pass' });
  }
  const lot = { originalExpiration: '2026-01-01', controls };
  const s = logic.computeLotStatus(lot, '2026-01-02');
  assert.strictEqual(s.extensionDays, logic.MAX_EXTENSION_DAYS);
  assert.strictEqual(s.atExtensionCap, true);
  // 2026-01-01 + 365 days = 2027-01-01
  assert.strictEqual(s.currentExpiration, '2027-01-01');
});

test('six passing controls give 360 days and are not yet capped', () => {
  const controls = [];
  for (let i = 0; i < 6; i += 1) {
    controls.push({ dateConducted: '2026-01-01', outcome: 'Pass' });
  }
  const lot = { originalExpiration: '2026-01-01', controls };
  const s = logic.computeLotStatus(lot, '2026-01-02');
  assert.strictEqual(s.extensionDays, 360);
  assert.strictEqual(s.atExtensionCap, false);
});

test('a lot past its extended expiration reads as Expired', () => {
  const lot = {
    originalExpiration: '2026-01-01',
    controls: [{ dateConducted: '2025-12-20', outcome: 'Pass' }],
  };
  // Extended to 2026-03-02; evaluating well after that.
  const s = logic.computeLotStatus(lot, '2026-06-01');
  assert.strictEqual(s.status, 'Expired');
  assert.ok(s.daysRemaining < 0);
});

test('a lot within 14 days of expiring is flagged Control Due', () => {
  const lot = { originalExpiration: '2026-01-20', controls: [] };
  const s = logic.computeLotStatus(lot, '2026-01-10');
  assert.strictEqual(s.status, 'Control Due');
  assert.strictEqual(s.daysRemaining, 10);
});

test('mixed outcomes only count passes, and last-fail flags verification', () => {
  const lot = {
    originalExpiration: '2026-01-01',
    controls: [
      { dateConducted: '2025-12-01', outcome: 'Pass' },
      { dateConducted: '2026-01-25', outcome: 'Fail' },
    ],
  };
  const s = logic.computeLotStatus(lot, '2026-02-15');
  assert.strictEqual(s.passCount, 1);
  assert.strictEqual(s.failCount, 1);
  assert.strictEqual(s.extensionDays, 60); // only the pass counts
  // current expiration 2026-03-02, still in the future, but last control failed
  assert.strictEqual(s.status, 'Verification Failed');
});

test('controls are evaluated in chronological order regardless of input order', () => {
  const lot = {
    originalExpiration: '2026-01-01',
    controls: [
      { dateConducted: '2026-02-01', outcome: 'Fail' },
      { dateConducted: '2026-03-01', outcome: 'Pass' },
    ],
  };
  const s = logic.computeLotStatus(lot, '2026-03-05');
  // Latest control (2026-03-01) passed, so not a verification failure.
  assert.strictEqual(s.lastControlFailed, false);
});
