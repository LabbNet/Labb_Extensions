'use strict';

const test = require('node:test');
const assert = require('node:assert');
const logic = require('../src/logic');

const { parseDate, formatDate, addDays, computeLotStatus } = logic;

// Helper: the expected expiration is (control date + 60 days).
const plus60 = (date) => formatDate(addDays(parseDate(date), 60));

test('parseDate / formatDate round trip', () => {
  assert.strictEqual(formatDate('2026-01-15'), '2026-01-15');
  assert.strictEqual(formatDate(parseDate('2026-01-15')), '2026-01-15');
  assert.strictEqual(formatDate('not-a-date'), null);
});

test('addDays and daysBetween are consistent', () => {
  const d = parseDate('2026-01-01');
  const later = addDays(d, 60);
  assert.strictEqual(formatDate(later), '2026-03-02');
  assert.strictEqual(logic.daysBetween(later, d), 60);
});

test('a passing control extends expiration to 60 days after the control date', () => {
  const lot = {
    originalExpiration: '2026-01-01',
    controls: [{ dateConducted: '2026-01-10', outcome: 'Pass' }],
  };
  const s = computeLotStatus(lot, '2026-01-15');
  assert.strictEqual(s.currentExpiration, plus60('2026-01-10'));
  assert.strictEqual(s.passCount, 1);
  assert.strictEqual(s.status, 'Extended');
});

test('the most recent passing control governs the expiration', () => {
  const lot = {
    originalExpiration: '2026-01-01',
    controls: [
      { dateConducted: '2026-01-10', outcome: 'Pass' },
      { dateConducted: '2026-03-05', outcome: 'Pass' },
    ],
  };
  const s = computeLotStatus(lot, '2026-03-06');
  // Extension is measured from the latest control date, not stacked from original.
  assert.strictEqual(s.currentExpiration, plus60('2026-03-05'));
});

test('failing controls grant no extension and flag verification', () => {
  const lot = {
    originalExpiration: '2026-01-01',
    controls: [{ dateConducted: '2025-12-20', outcome: 'Fail' }],
  };
  const s = computeLotStatus(lot, '2025-12-25');
  assert.strictEqual(s.currentExpiration, '2026-01-01');
  assert.strictEqual(s.extensionDays, 0);
  assert.strictEqual(s.failCount, 1);
  assert.strictEqual(s.status, 'Verification Failed');
});

test('extension is capped at one year (365 days) beyond the original expiration', () => {
  const lot = {
    originalExpiration: '2026-01-01',
    // control date + 60 = 2027-02-13, which is past the 2027-01-01 cap
    controls: [{ dateConducted: '2026-12-15', outcome: 'Pass' }],
  };
  const s = computeLotStatus(lot, '2026-12-16');
  assert.strictEqual(s.currentExpiration, formatDate(addDays(parseDate('2026-01-01'), 365)));
  assert.strictEqual(s.atExtensionCap, true);
});

test('a control run well before expiration never shortens the date', () => {
  const lot = {
    originalExpiration: '2026-06-01',
    // 2026-01-01 + 60 = 2026-03-02, which is before the original expiration
    controls: [{ dateConducted: '2026-01-01', outcome: 'Pass' }],
  };
  const s = computeLotStatus(lot, '2026-02-01');
  assert.strictEqual(s.currentExpiration, '2026-06-01');
  assert.strictEqual(s.extensionDays, 0);
});

test('a lot past its extended expiration reads as Expired', () => {
  const lot = {
    originalExpiration: '2026-01-01',
    controls: [{ dateConducted: '2026-01-05', outcome: 'Pass' }], // extends to 2026-03-06
  };
  const s = computeLotStatus(lot, '2026-06-01');
  assert.strictEqual(s.status, 'Expired');
  assert.ok(s.daysRemaining < 0);
});

test('a lot within 14 days of expiring is flagged Control Due', () => {
  const lot = { originalExpiration: '2026-01-20', controls: [] };
  const s = computeLotStatus(lot, '2026-01-10');
  assert.strictEqual(s.status, 'Control Due');
  assert.strictEqual(s.daysRemaining, 10);
});

test('mixed outcomes: only passes extend, and a later fail flags verification', () => {
  const lot = {
    originalExpiration: '2026-01-01',
    controls: [
      { dateConducted: '2025-12-01', outcome: 'Pass' },
      { dateConducted: '2026-01-25', outcome: 'Fail' },
    ],
  };
  // Evaluate before the extended date (2025-12-01 + 60 = 2026-01-30) so the
  // verification-failed flag is what shows, not expiry.
  const s = computeLotStatus(lot, '2026-01-20');
  assert.strictEqual(s.passCount, 1);
  assert.strictEqual(s.failCount, 1);
  assert.strictEqual(s.currentExpiration, plus60('2025-12-01'));
  assert.strictEqual(s.status, 'Verification Failed');
});

test('controls are evaluated chronologically regardless of input order', () => {
  const lot = {
    originalExpiration: '2026-01-01',
    controls: [
      { dateConducted: '2026-02-01', outcome: 'Fail' },
      { dateConducted: '2026-03-01', outcome: 'Pass' },
    ],
  };
  const s = computeLotStatus(lot, '2026-03-05');
  // Latest control (2026-03-01) passed → not a verification failure.
  assert.strictEqual(s.lastControlFailed, false);
  assert.strictEqual(s.currentExpiration, plus60('2026-03-01'));
});
