'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tiny append-safe JSON file store for POCT lots and their controls.
 *
 * Data shape on disk:
 *   {
 *     "lots": [
 *       {
 *         "id": "...",
 *         "poctName": "...",
 *         "lotNumber": "...",
 *         "originalExpiration": "YYYY-MM-DD",
 *         "createdAt": "ISO",
 *         "controls": [
 *           { "id": "...", "dateConducted": "YYYY-MM-DD",
 *             "outcome": "Pass|Fail", "performedBy": "...",
 *             "notes": "...", "createdAt": "ISO" }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Writes are serialized and flushed atomically (write temp + rename) so the
 * file is never left half-written.
 */
class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { lots: [] };
    this._writeQueue = Promise.resolve();
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.lots)) {
        this.data = parsed;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`Could not read data file, starting empty: ${err.message}`);
      }
      this.data = { lots: [] };
    }
  }

  _persist() {
    // Serialize writes to avoid interleaving.
    const snapshot = JSON.stringify(this.data, null, 2);
    this._writeQueue = this._writeQueue.then(() => new Promise((resolve, reject) => {
      const dir = path.dirname(this.filePath);
      fs.mkdir(dir, { recursive: true }, (mkErr) => {
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
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  listLots() {
    return this.data.lots;
  }

  getLot(id) {
    return this.data.lots.find((l) => l.id === id) || null;
  }

  findLot(poctName, lotNumber) {
    const name = String(poctName || '').trim().toLowerCase();
    const lot = String(lotNumber || '').trim().toLowerCase();
    return this.data.lots.find(
      (l) => l.poctName.toLowerCase() === name && l.lotNumber.toLowerCase() === lot,
    ) || null;
  }

  async addLot({ poctName, lotNumber, originalExpiration }) {
    const lot = {
      id: Store._id('lot'),
      poctName: String(poctName).trim(),
      lotNumber: String(lotNumber).trim(),
      originalExpiration,
      createdAt: new Date().toISOString(),
      controls: [],
    };
    this.data.lots.push(lot);
    await this._persist();
    return lot;
  }

  async addControl(lotId, { dateConducted, outcome, performedBy, notes }) {
    const lot = this.getLot(lotId);
    if (!lot) return null;
    const control = {
      id: Store._id('ctl'),
      dateConducted,
      outcome,
      performedBy: performedBy ? String(performedBy).trim() : '',
      notes: notes ? String(notes).trim() : '',
      createdAt: new Date().toISOString(),
    };
    lot.controls.push(control);
    await this._persist();
    return control;
  }

  async deleteLot(id) {
    const idx = this.data.lots.findIndex((l) => l.id === id);
    if (idx === -1) return false;
    this.data.lots.splice(idx, 1);
    await this._persist();
    return true;
  }
}

module.exports = { Store };
