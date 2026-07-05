'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword, verifyPassword, newToken } = require('./auth');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * SQLite-backed data store for the Labb POCT tracker.
 *
 * Holds POCT lots and their controls, plus staff users, login sessions, and an
 * audit log recording who did what. All methods are synchronous (node:sqlite is
 * synchronous); callers may still `await` them harmlessly.
 *
 * Uses the built-in node:sqlite module — no native dependencies. Run Node with
 * the `--experimental-sqlite` flag (the npm scripts do this for you).
 */
class Db {
  constructor(filePath) {
    this.filePath = filePath;
    if (filePath !== ':memory:') {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    this.sql = new DatabaseSync(filePath);
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this._migrate();
  }

  _migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS lots (
        id TEXT PRIMARY KEY,
        poctName TEXT NOT NULL,
        lotNumber TEXT NOT NULL,
        originalExpiration TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        createdBy TEXT
      );
      CREATE TABLE IF NOT EXISTS controls (
        id TEXT PRIMARY KEY,
        lotId TEXT NOT NULL,
        dateConducted TEXT NOT NULL,
        outcome TEXT NOT NULL,
        performedBy TEXT,
        notes TEXT,
        createdAt TEXT NOT NULL,
        createdBy TEXT,
        FOREIGN KEY (lotId) REFERENCES lots(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        displayName TEXT,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'staff',
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        userId TEXT,
        username TEXT,
        action TEXT NOT NULL,
        entity TEXT,
        entityId TEXT,
        details TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_controls_lot ON controls(lotId);
      CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
    `);
  }

  static _id(prefix) {
    return `${prefix}_${Date.now().toString(36)}${newToken(4)}`;
  }

  // ---- Lots & controls ----------------------------------------------------

  _controlsForLot(lotId) {
    return this.sql.prepare(
      'SELECT * FROM controls WHERE lotId = ? ORDER BY dateConducted ASC, createdAt ASC',
    ).all(lotId);
  }

  _attachControls(lot) {
    if (!lot) return null;
    return { ...lot, controls: this._controlsForLot(lot.id) };
  }

  listLots() {
    const lots = this.sql.prepare('SELECT * FROM lots ORDER BY poctName, lotNumber').all();
    return lots.map((l) => this._attachControls(l));
  }

  getLot(id) {
    const lot = this.sql.prepare('SELECT * FROM lots WHERE id = ?').get(id);
    return this._attachControls(lot);
  }

  findLot(poctName, lotNumber) {
    const lot = this.sql.prepare(
      'SELECT * FROM lots WHERE lower(poctName) = lower(?) AND lower(lotNumber) = lower(?)',
    ).get(String(poctName || '').trim(), String(lotNumber || '').trim());
    return this._attachControls(lot);
  }

  addLot({ poctName, lotNumber, originalExpiration }, actor) {
    const lot = {
      id: Db._id('lot'),
      poctName: String(poctName).trim(),
      lotNumber: String(lotNumber).trim(),
      originalExpiration,
      createdAt: new Date().toISOString(),
      createdBy: actor ? actor.username : null,
    };
    this.sql.prepare(`INSERT INTO lots (id, poctName, lotNumber, originalExpiration, createdAt, createdBy)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      lot.id, lot.poctName, lot.lotNumber, lot.originalExpiration, lot.createdAt, lot.createdBy,
    );
    this.audit(actor, 'create', 'lot', lot.id, `${lot.poctName} / ${lot.lotNumber}`);
    return this._attachControls(lot);
  }

  addControl(lotId, { dateConducted, outcome, performedBy, notes }, actor) {
    const lot = this.sql.prepare('SELECT * FROM lots WHERE id = ?').get(lotId);
    if (!lot) return null;
    const control = {
      id: Db._id('ctl'),
      lotId,
      dateConducted,
      outcome,
      performedBy: (performedBy && String(performedBy).trim())
        || (actor ? actor.displayName || actor.username : ''),
      notes: notes ? String(notes).trim() : '',
      createdAt: new Date().toISOString(),
      createdBy: actor ? actor.username : null,
    };
    this.sql.prepare(`INSERT INTO controls
      (id, lotId, dateConducted, outcome, performedBy, notes, createdAt, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      control.id, control.lotId, control.dateConducted, control.outcome,
      control.performedBy, control.notes, control.createdAt, control.createdBy,
    );
    this.audit(actor, 'record-control', 'lot', lotId,
      `${outcome} on ${lot.poctName} / ${lot.lotNumber} (${dateConducted})`);
    return control;
  }

  deleteLot(id, actor) {
    const lot = this.sql.prepare('SELECT * FROM lots WHERE id = ?').get(id);
    if (!lot) return false;
    this.sql.prepare('DELETE FROM lots WHERE id = ?').run(id);
    this.audit(actor, 'delete', 'lot', id, `${lot.poctName} / ${lot.lotNumber}`);
    return true;
  }

  // ---- Users --------------------------------------------------------------

  countUsers() {
    return this.sql.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  }

  getUserByUsername(username) {
    return this.sql.prepare('SELECT * FROM users WHERE lower(username) = lower(?)')
      .get(String(username || '').trim()) || null;
  }

  getUser(id) {
    return this.sql.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  }

  listUsers() {
    return this.sql.prepare(
      'SELECT id, username, displayName, role, active, createdAt FROM users ORDER BY username',
    ).all();
  }

  createUser({ username, password, displayName, role = 'staff' }, actor) {
    const uname = String(username || '').trim();
    if (!uname) throw new Error('username is required');
    if (this.getUserByUsername(uname)) throw new Error('username already exists');
    if (role !== 'admin' && role !== 'staff') throw new Error('role must be admin or staff');
    const user = {
      id: Db._id('usr'),
      username: uname,
      displayName: displayName ? String(displayName).trim() : uname,
      passwordHash: hashPassword(password),
      role,
      active: 1,
      createdAt: new Date().toISOString(),
    };
    this.sql.prepare(`INSERT INTO users
      (id, username, displayName, passwordHash, role, active, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      user.id, user.username, user.displayName, user.passwordHash,
      user.role, user.active, user.createdAt,
    );
    this.audit(actor, 'create-user', 'user', user.id, `${user.username} (${user.role})`);
    return this.publicUser(user);
  }

  setUserActive(id, active, actor) {
    const user = this.getUser(id);
    if (!user) return false;
    this.sql.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    this.audit(actor, active ? 'enable-user' : 'disable-user', 'user', id, user.username);
    return true;
  }

  publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      active: !!user.active,
      createdAt: user.createdAt,
    };
  }

  // ---- Sessions -----------------------------------------------------------

  login(username, password) {
    const user = this.getUserByUsername(username);
    if (!user || !user.active) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    const token = newToken();
    const now = Date.now();
    this.sql.prepare('INSERT INTO sessions (token, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)')
      .run(token, user.id, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString());
    this.audit(user, 'login', 'user', user.id, user.username);
    return { token, user: this.publicUser(user) };
  }

  userForToken(token) {
    if (!token) return null;
    const session = this.sql.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      this.sql.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return null;
    }
    const user = this.getUser(session.userId);
    if (!user || !user.active) return null;
    return user;
  }

  logout(token) {
    this.sql.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  // ---- Audit --------------------------------------------------------------

  audit(actor, action, entity, entityId, details) {
    this.sql.prepare(`INSERT INTO audit_log (ts, userId, username, action, entity, entityId, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      new Date().toISOString(),
      actor ? actor.id : null,
      actor ? actor.username : 'system',
      action, entity || null, entityId || null, details || null,
    );
  }

  listAudit(limit = 100) {
    return this.sql.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?')
      .all(Math.max(1, Math.min(500, limit)));
  }

  close() {
    this.sql.close();
  }
}

module.exports = { Db, SESSION_TTL_MS };
