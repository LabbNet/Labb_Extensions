'use strict';

/**
 * Populate the database with a few example lots, controls, and a demo staff
 * user so the app has something to show on first run. Safe to run repeatedly —
 * it skips lots/users that already exist.
 *
 *   npm run seed
 */

const path = require('path');
const { createStore } = require('../src/store');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'poct.db');
const JSON_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'poct.json');
const SYSTEM = { id: null, username: 'seed' };

const SAMPLES = [
  {
    poctName: 'Labb Rapid Flu A/B',
    lotNumber: 'LOT-24-00815',
    originalExpiration: '2026-03-15',
    controls: [
      { dateConducted: '2026-03-01', outcome: 'Pass', performedBy: 'J. Rivera', notes: 'QC lot QC-A21' },
      { dateConducted: '2026-04-28', outcome: 'Pass', performedBy: 'J. Rivera', notes: 'QC lot QC-A21' },
    ],
  },
  {
    poctName: 'Labb Rapid Strep A',
    lotNumber: 'LOT-24-00932',
    originalExpiration: '2026-06-30',
    controls: [
      { dateConducted: '2026-06-20', outcome: 'Pass', performedBy: 'M. Chen', notes: '' },
    ],
  },
  {
    poctName: 'Labb Rapid COVID-19 Ag',
    lotNumber: 'LOT-24-01120',
    originalExpiration: '2026-05-10',
    controls: [
      { dateConducted: '2026-05-02', outcome: 'Pass', performedBy: 'A. Patel', notes: '' },
      { dateConducted: '2026-07-01', outcome: 'Fail', performedBy: 'A. Patel', notes: 'Positive control faint; lot pulled from use' },
    ],
  },
  {
    poctName: 'Labb Rapid RSV',
    lotNumber: 'LOT-23-00477',
    originalExpiration: '2025-11-01',
    controls: [
      { dateConducted: '2025-10-20', outcome: 'Pass', performedBy: 'S. Okafor', notes: '' },
      { dateConducted: '2025-12-18', outcome: 'Pass', performedBy: 'S. Okafor', notes: '' },
      { dateConducted: '2026-02-14', outcome: 'Pass', performedBy: 'S. Okafor', notes: '' },
    ],
  },
];

async function main() {
  const db = createStore({ dbFile: DB_FILE, jsonFile: JSON_FILE });

  // Ensure an admin exists so the app is usable immediately.
  if (db.countUsers() === 0) {
    db.createUser({ username: 'admin', password: 'labb-admin', displayName: 'Administrator', role: 'admin' }, SYSTEM);
    console.log('Created admin user (admin / labb-admin) — change this password!');
  }
  if (!db.getUserByUsername('tech')) {
    db.createUser({ username: 'tech', password: 'labb-tech', displayName: 'Demo Technician', role: 'staff' }, SYSTEM);
    console.log('Created staff user (tech / labb-tech).');
  }

  for (const sample of SAMPLES) {
    if (db.findLot(sample.poctName, sample.lotNumber)) {
      console.log(`Skipping existing lot: ${sample.poctName} / ${sample.lotNumber}`);
      continue;
    }
    const lot = db.addLot({
      poctName: sample.poctName,
      lotNumber: sample.lotNumber,
      originalExpiration: sample.originalExpiration,
    }, SYSTEM);
    for (const c of sample.controls) {
      db.addControl(lot.id, c, SYSTEM);
    }
    console.log(`Seeded: ${sample.poctName} / ${sample.lotNumber} (${sample.controls.length} controls)`);
  }

  console.log(`\nDone. Storage: ${db.kind} (${db.location})`);
  await db.flush();
  db.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
