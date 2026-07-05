'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Writable } = require('node:stream');
const { streamCertificate } = require('../src/certificate');

/** Collect a streamed PDF into a single Buffer. */
function collect(lot) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink = new Writable({
      write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
    });
    sink.on('finish', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    streamCertificate(sink, lot, '2026-07-05');
  });
}

const SAMPLE = {
  poctName: 'Labb Rapid Flu A/B',
  lotNumber: 'CERT-1',
  originalExpiration: '2026-07-10',
  currentExpiration: '2026-09-03',
  extensionDays: 55,
  atExtensionCap: false,
  status: 'Extended',
  controls: [
    { dateConducted: '2026-07-05', outcome: 'Pass', performedBy: 'J. Rivera', notes: 'QC lot QC-77' },
  ],
};

test('streamCertificate emits a valid PDF document', async () => {
  const pdf = await collect(SAMPLE);
  assert.ok(pdf.length > 500, 'PDF should have meaningful content');
  assert.strictEqual(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(pdf.subarray(-1024).toString('latin1').includes('%%EOF'), 'PDF should be terminated');
});

test('streamCertificate handles a lot with no controls', async () => {
  const pdf = await collect({
    ...SAMPLE, controls: [], extensionDays: 0, currentExpiration: '2026-07-10', status: 'Active',
  });
  assert.strictEqual(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('streamCertificate handles a verification-failed lot', async () => {
  const pdf = await collect({
    ...SAMPLE,
    status: 'Verification Failed',
    controls: [{ dateConducted: '2026-07-05', outcome: 'Fail', performedBy: 'A. Patel', notes: '' }],
  });
  assert.strictEqual(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
});
