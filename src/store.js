'use strict';

const path = require('path');

/**
 * Storage factory. Prefers the built-in SQLite store when node:sqlite is
 * available (Node 24+, or Node 22.5+ launched with --experimental-sqlite),
 * and transparently falls back to a JSON-file store otherwise (e.g. Node 20).
 *
 * Both stores implement the same interface, so the rest of the app does not
 * care which one it gets.
 *
 * Override the choice with STORE=sqlite or STORE=json if needed.
 */

function sqliteAvailable() {
  try {
    require('node:sqlite'); // throws if the module/flag is unavailable
    return true;
  } catch {
    return false;
  }
}

function createStore(options = {}) {
  const {
    dbFile = path.join(process.cwd(), 'data', 'poct.db'),
    jsonFile = path.join(process.cwd(), 'data', 'poct.json'),
    prefer = process.env.STORE, // 'sqlite' | 'json' | undefined (auto)
  } = options;

  let useSqlite;
  if (prefer === 'sqlite') useSqlite = true;
  else if (prefer === 'json') useSqlite = false;
  else useSqlite = sqliteAvailable();

  if (useSqlite) {
    const { Db } = require('./db');
    const store = new Db(dbFile);
    store.kind = 'sqlite';
    store.location = dbFile;
    return store;
  }

  const { JsonStore } = require('./json-store');
  const store = new JsonStore(jsonFile);
  store.kind = 'json';
  store.location = jsonFile;
  return store;
}

module.exports = { createStore, sqliteAvailable };
