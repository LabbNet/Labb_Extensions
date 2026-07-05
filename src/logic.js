'use strict';

/**
 * POCT shelf-life extension logic for Labb rapid point-of-care tests.
 *
 * Business rules:
 *  - Every Labb rapid POCT lot ships with an original expiration date
 *    (24 months from manufacture).
 *  - When a lot reaches (or approaches) its expiration, its shelf life can be
 *    extended by running a quality control test.
 *  - Each PASSING control extends the lot's shelf life by 60 days.
 *  - Controls can be repeated (every 60 days) to keep extending the life,
 *    but the total extension is capped at 1 year (365 days) beyond the
 *    original expiration date.
 *  - A FAILING control grants no extension and means the lot has failed
 *    verification and should not be used past its current expiration.
 *
 * This module is pure (no I/O) so it can be unit tested in isolation and
 * reused by both the API and the front end.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const EXTENSION_DAYS_PER_CONTROL = 60;
const MAX_EXTENSION_DAYS = 365; // total extension is capped at one year
const PASS = 'Pass';
const FAIL = 'Fail';

/**
 * Parse a YYYY-MM-DD string into a UTC Date at midnight.
 * Using UTC avoids timezone drift when doing date arithmetic.
 */
function parseDate(value) {
  if (value instanceof Date) return new Date(Date.UTC(
    value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Format a Date (or date string) as YYYY-MM-DD. Returns null on bad input. */
function formatDate(value) {
  const d = value instanceof Date ? value : parseDate(value);
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Add whole days to a date, returning a new Date. */
function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Whole-day difference (a - b). Positive when a is later than b. */
function daysBetween(a, b) {
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

/**
 * Compute the number of extension days earned by a set of controls.
 * Only passing controls count; the total is capped at MAX_EXTENSION_DAYS.
 */
function extensionDaysFromControls(controls) {
  const passes = (controls || []).filter((c) => c && c.outcome === PASS).length;
  return Math.min(passes * EXTENSION_DAYS_PER_CONTROL, MAX_EXTENSION_DAYS);
}

/**
 * Given a lot record and today's date, compute its current expiration status.
 *
 * @param {object} lot           - { originalExpiration, controls: [...] }
 * @param {Date|string} [asOf]   - date to evaluate against (defaults to today)
 * @returns {object} summary with derived expiration fields
 */
function computeLotStatus(lot, asOf) {
  const original = parseDate(lot.originalExpiration);
  const today = asOf ? parseDate(asOf) : parseDate(formatDate(new Date()));

  const controls = Array.isArray(lot.controls) ? lot.controls.slice() : [];
  // Evaluate controls in chronological order.
  controls.sort((a, b) => {
    const da = parseDate(a.dateConducted);
    const db = parseDate(b.dateConducted);
    return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
  });

  const passCount = controls.filter((c) => c.outcome === PASS).length;
  const failCount = controls.filter((c) => c.outcome === FAIL).length;
  const extensionDays = extensionDaysFromControls(controls);
  const currentExpiration = original ? addDays(original, extensionDays) : null;

  const atExtensionCap = extensionDays >= MAX_EXTENSION_DAYS;
  const daysRemaining = currentExpiration && today
    ? daysBetween(currentExpiration, today)
    : null;

  // A lot is considered "verification failed" if its most recent control failed.
  const lastControl = controls[controls.length - 1] || null;
  const lastFailed = !!(lastControl && lastControl.outcome === FAIL);

  let status;
  if (!original) {
    status = 'Unknown';
  } else if (daysRemaining < 0) {
    status = 'Expired';
  } else if (lastFailed) {
    status = 'Verification Failed';
  } else if (daysRemaining <= 14) {
    status = 'Control Due';
  } else {
    status = extensionDays > 0 ? 'Extended' : 'Active';
  }

  return {
    originalExpiration: formatDate(original),
    currentExpiration: formatDate(currentExpiration),
    extensionDays,
    extensionMonths: Math.round((extensionDays / 30) * 10) / 10,
    passCount,
    failCount,
    controlCount: controls.length,
    daysRemaining,
    atExtensionCap,
    lastControlFailed: lastFailed,
    status,
    controls,
  };
}

module.exports = {
  DAY_MS,
  EXTENSION_DAYS_PER_CONTROL,
  MAX_EXTENSION_DAYS,
  PASS,
  FAIL,
  parseDate,
  formatDate,
  addDays,
  daysBetween,
  extensionDaysFromControls,
  computeLotStatus,
};
