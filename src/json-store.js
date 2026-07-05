'use strict';

const fs = require('fs');
const path = require('path');
const { hashPassword, verifyPassword, newToken } = require('./auth');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * JSON-file data store for the Labb POCT tracker.
 *
 * A dependency-free fallback that mirrors the SQLite store's interface exactly,
 * so the rest of the app is storage-agnostic. Used automatically when the
 * built-in node:sqlite module is unavailable (Node < 22.5). Fine for the
 * single-node volumes this app handles; writes are flushed atomically.
 *
 * On-disk shape:
 *   { lots: [ { ..., controls: [...] } ], users: [...], sessions: [...], audit: [...] }
 */
class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.memory = filePath === ':memory:';
    this.data = { lots: [], users: [], sessions: [], audit: [], auditSeq: 0 };
    this._writeQueue = Promise.resolve();
    if (!this.memory) this._load();
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.data = {
        lots: Array.isArray(parsed.lots) ? parsed.lots : [],
        users: Array.isArray(parsed.users) ? parsed.users : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        audit: Array.isArray(parsed.audit) ? parsed.audit : [],
        auditSeq: Number(parsed.auditSeq) || 0,
      };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`Could not read data file, starting empty: ${err.message}`);
      }
    }
  }

  _persist() {
    if (this.memory) return Promise.resolve();
    const snapshot = JSON.stringify(this.data, null, 2);
    this._writeQueue = this._writeQueue.then(() => new Promise((resolve, reject) => {
      fs.mkdir(path.dirname(this.filePath), { recursive: true }, (mkErr) => {
        if (mkErr) return reject(mkErr);
        const tmp = `${this.filePath}.${process.pid}.tmp`;
        fs.writeFile(tmp, snapshot, (wErr) => {
          if (wErr) return reject(wErr);
          fs.rename(tmp, this.filePath, (rErr) => (rErr ? reject(rErr) : resolve()));
        });
      });
    }));
    return this._writeQueue;
  }

  static _id(prefix) {
    return `${prefix}_${Date.now().toString(36)}${newToken(4)}`;
  }

  // ---- Lots & controls ----------------------------------------------------

  _clone(lot) {
    return lot ? JSON.parse(JSON.stringify(lot)) : null;
  }

  _sortedControls(lot) {
    return (lot.controls || []).slice().sort((a, b) => {
      const d = String(a.dateConducted).localeCompare(String(b.dateConducted));
      return d !== 0 ? d : String(a.createdAt).localeCompare(String(b.createdAt));
    });
  }

  listLots() {
    return this.data.lots
      .slice()
      .sort((a, b) => a.poctName.localeCompare(b.poctName) || a.lotNumber.localeCompare(b.lotNumber))
      .map((l) => {
        const c = this._clone(l);
        c.controls = this._sortedControls(c);
        return c;
      });
  }

  getLot(id) {
    const lot = this.data.lots.find((l) => l.id === id);
    if (!lot) return null;
    const c = this._clone(lot);
    c.controls = this._sortedControls(c);
    return c;
  }

  findLot(poctName, lotNumber) {
    const name = String(poctName || '').trim().toLowerCase();
    const num = String(lotNumber || '').trim().toLowerCase();
    const lot = this.data.lots.find(
      (l) => l.poctName.toLowerCase() === name && l.lotNumber.toLowerCase() === num,
    );
    if (!lot) return null;
    const c = this._clone(lot);
    c.controls = this._sortedControls(c);
    return c;
  }

  addLot({ poctName, lotNumber, originalExpiration }, actor) {
    const lot = {
      id: JsonStore._id('lot'),
      poctName: String(poctName).trim(),
      lotNumber: String(lotNumber).trim(),
      originalExpiration,
      createdAt: new Date().toISOString(),
      createdBy: actor ? actor.username : null,
      controls: [],
    };
    this.data.lots.push(lot);
    this.audit(actor, 'create', 'lot', lot.id, `${lot.poctName} / ${lot.lotNumber}`);
    this._persist();
    return this._clone(lot);
  }

  addControl(lotId, { dateConducted, outcome, performedBy, notes }, actor) {
    const lot = this.data.lots.find((l) => l.id === lotId);
    if (!lot) return null;
    const control = {
      id: JsonStore._id('ctl'),
      lotId,
      dateConducted,
      outcome,
      performedBy: (performedBy && String(performedBy).trim())
        || (actor ? actor.displayName || actor.username : ''),
      notes: notes ? String(notes).trim() : '',
      createdAt: new Date().toISOString(),
      createdBy: actor ? actor.username : null,
    };
    lot.controls.push(control);
    this.audit(actor, 'record-control', 'lot', lotId,
      `${outcome} on ${lot.poctName} / ${lot.lotNumber} (${dateConducted})`);
    this._persist();
    return this._clone(control);
  }

  deleteLot(id, actor) {
    const idx = this.data.lots.findIndex((l) => l.id === id);
    if (idx === -1) return false;
    const [lot] = this.data.lots.splice(idx, 1);
    this.audit(actor, 'delete', 'lot', id, `${lot.poctName} / ${lot.lotNumber}`);
    this._persist();
    return true;
  }

  // ---- Users --------------------------------------------------------------

  countUsers() {
    return this.data.users.length;
  }

  getUserByUsername(username) {
    const u = String(username || '').trim().toLowerCase();
    return this.data.users.find((x) => x.username.toLowerCase() === u) || null;
  }

  getUser(id) {
    return this.data.users.find((x) => x.id === id) || null;
  }

  listUsers() {
    return this.data.users
      .slice()
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((u) => ({ ...u }));
  }

  createUser({ username, password, displayName, role = 'staff' }, actor) {
    const uname = String(username || '').trim();
    if (!uname) throw new Error('username is required');
    if (this.getUserByUsername(uname)) throw new Error('username already exists');
    if (role !== 'admin' && role !== 'staff') throw new Error('role must be admin or staff');
    const user = {
      id: JsonStore._id('usr'),
      username: uname,
      displayName: displayName ? String(displayName).trim() : uname,
      passwordHash: hashPassword(password),
      role,
      active: 1,
      createdAt: new Date().toISOString(),
    };
    this.data.users.push(user);
    this.audit(actor, 'create-user', 'user', user.id, `${user.username} (${user.role})`);
    this._persist();
    return this.publicUser(user);
  }

  setUserActive(id, active, actor) {
    const user = this.getUser(id);
    if (!user) return false;
    user.active = active ? 1 : 0;
    this.audit(actor, active ? 'enable-user' : 'disable-user', 'user', id, user.username);
    this._persist();
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
    this.data.sessions.push({
      token,
      userId: user.id,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    });
    this.audit(user, 'login', 'user', user.id, user.username);
    this._persist();
    return { token, user: this.publicUser(user) };
  }

  userForToken(token) {
    if (!token) return null;
    const idx = this.data.sessions.findIndex((s) => s.token === token);
    if (idx === -1) return null;
    const session = this.data.sessions[idx];
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      this.data.sessions.splice(idx, 1);
      this._persist();
      return null;
    }
    const user = this.getUser(session.userId);
    if (!user || !user.active) return null;
    return user;
  }

  logout(token) {
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => s.token !== token);
    if (this.data.sessions.length !== before) this._persist();
  }

  // ---- Audit --------------------------------------------------------------

  audit(actor, action, entity, entityId, details) {
    this.data.auditSeq += 1;
    this.data.audit.push({
      id: this.data.auditSeq,
      ts: new Date().toISOString(),
      userId: actor ? actor.id : null,
      username: actor ? actor.username : 'system',
      action,
      entity: entity || null,
      entityId: entityId || null,
      details: details || null,
    });
    // Note: persistence is triggered by the calling mutation.
  }

  listAudit(limit = 100) {
    const n = Math.max(1, Math.min(500, limit));
    return this.data.audit.slice().sort((a, b) => b.id - a.id).slice(0, n);
  }

  /** Resolve once all queued writes have been flushed to disk. */
  flush() {
    return this._writeQueue;
  }

  close() { /* no-op for the JSON store */ }
}

module.exports = { JsonStore, SESSION_TTL_MS };
