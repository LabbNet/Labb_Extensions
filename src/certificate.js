'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// The ONE by Labb logo, embedded on the certificate when present. Drop a PNG
// (or JPEG) here — or point LOGO_FILE at one — and it appears automatically.
const LOGO_FILE = process.env.LOGO_FILE || path.join(__dirname, '..', 'public', 'img', 'logo.png');

/**
 * Stream a Certificate of Shelf-Life Extension for a POCT lot as a PDF.
 *
 * The certificate documents the lot's original expiration, the control runs
 * performed, and the resulting verified expiration date — a record customers
 * can download and keep on file to justify continued use of the kit.
 *
 * @param {object} res      - Express response to pipe the PDF into
 * @param {object} lot      - serialized lot (includes computed status fields)
 * @param {string} issuedOn - YYYY-MM-DD the certificate was generated
 */
function streamCertificate(res, lot, issuedOn) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
  doc.pipe(res);

  const INK = '#1a2332';
  const BRAND = '#0d5c63';
  const SOFT = '#5b6b82';
  const LINE = '#d7dde5';
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;

  // ---- Header (white, with the ONE by Labb logo) --------------------------
  // Slim brand accent stripe across the very top.
  doc.rect(0, 0, doc.page.width, 8).fill(BRAND);

  const headerTop = 34;
  let logoBottom = headerTop;
  let usedLogo = false;
  if (fs.existsSync(LOGO_FILE)) {
    try {
      const logoH = 46;
      doc.image(LOGO_FILE, left, headerTop, { height: logoH });
      logoBottom = headerTop + logoH;
      usedLogo = true;
    } catch {
      usedLogo = false;
    }
  }
  if (!usedLogo) {
    // Text wordmark fallback until the logo file is added.
    doc.font('Helvetica-Bold').fontSize(26).fillColor('#111111').text('ONE', left, headerTop);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#8a8a8a').text('by Labb', left + 2, headerTop + 28);
    logoBottom = headerTop + 46;
  }

  doc.font('Helvetica').fontSize(11).fillColor(SOFT)
    .text('Certificate of Shelf-Life Extension', left, logoBottom + 8);

  const dividerY = doc.y + 12;
  doc.moveTo(left, dividerY).lineTo(left + pageWidth, dividerY).lineWidth(1).stroke(LINE);
  doc.fillColor(INK);

  let y = dividerY + 22;

  // ---- Title / statement --------------------------------------------------
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK)
    .text('Verified Expiration Extension', left, y);
  y = doc.y + 6;

  const statusLine = validityStatement(lot);
  doc.font('Helvetica').fontSize(10.5).fillColor(SOFT)
    .text(statusLine, left, y, { width: pageWidth });
  y = doc.y + 18;

  // ---- Key fields box -----------------------------------------------------
  const rows = [
    ['POCT Name', lot.poctName],
    ['Lot Number', lot.lotNumber],
    ['Original Expiration', lot.originalExpiration || '—'],
    ['Verified Current Expiration', lot.currentExpiration || '—'],
    ['Extension Earned', lot.extensionDays ? `${lot.extensionDays} days${lot.atExtensionCap ? ' (one-year maximum reached)' : ''}` : 'None'],
    ['Status', lot.status],
  ];

  const boxTop = y;
  const rowH = 26;
  const labelW = 190;
  doc.roundedRect(left, boxTop, pageWidth, rows.length * rowH, 6)
    .lineWidth(1).stroke(LINE);
  rows.forEach((r, i) => {
    const ry = boxTop + i * rowH;
    if (i > 0) doc.moveTo(left, ry).lineTo(left + pageWidth, ry).lineWidth(0.5).stroke(LINE);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(SOFT)
      .text(String(r[0]).toUpperCase(), left + 14, ry + 8, { width: labelW - 20 });
    const emphasize = r[0] === 'Verified Current Expiration';
    doc.font(emphasize ? 'Helvetica-Bold' : 'Helvetica').fontSize(emphasize ? 12 : 11)
      .fillColor(emphasize ? BRAND : INK)
      .text(String(r[1] == null ? '' : r[1]), left + labelW, ry + 7, { width: pageWidth - labelW - 14 });
  });
  y = boxTop + rows.length * rowH + 26;

  // ---- Control history ----------------------------------------------------
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text('Quality-Control History', left, y);
  y = doc.y + 8;

  const cols = [
    { key: 'dateConducted', label: 'Date Conducted', w: 0.26 },
    { key: 'outcome', label: 'Outcome', w: 0.16 },
    { key: 'performedBy', label: 'Performed By', w: 0.28 },
    { key: 'notes', label: 'Notes', w: 0.30 },
  ];
  const colX = [];
  let acc = left;
  cols.forEach((c) => { colX.push(acc); acc += c.w * pageWidth; });

  // header row
  doc.rect(left, y, pageWidth, 22).fill('#f2f5f7');
  doc.fillColor(SOFT).font('Helvetica-Bold').fontSize(9);
  cols.forEach((c, i) => doc.text(c.label.toUpperCase(), colX[i] + 6, y + 7, { width: c.w * pageWidth - 12 }));
  y += 22;

  const controls = (lot.controls || []).slice().sort((a, b) =>
    String(b.dateConducted).localeCompare(String(a.dateConducted)));

  doc.font('Helvetica').fontSize(9.5).fillColor(INK);
  if (!controls.length) {
    doc.fillColor(SOFT).text('No controls recorded.', left + 6, y + 7);
    y += 24;
  } else {
    controls.forEach((c) => {
      const cells = [c.dateConducted, c.outcome, c.performedBy || '—', c.notes || ''];
      const heights = cols.map((col, i) =>
        doc.heightOfString(String(cells[i]), { width: col.w * pageWidth - 12 }));
      const rh = Math.max(20, ...heights) + 8;
      if (y + rh > doc.page.height - 90) { doc.addPage(); y = doc.page.margins.top; }
      cols.forEach((col, i) => {
        if (col.key === 'outcome') {
          doc.fillColor(c.outcome === 'Pass' ? '#0f8a5f' : '#b23b3b').font('Helvetica-Bold');
        } else {
          doc.fillColor(INK).font('Helvetica');
        }
        doc.text(String(cells[i]), colX[i] + 6, y + 5, { width: col.w * pageWidth - 12 });
      });
      y += rh;
      doc.moveTo(left, y).lineTo(left + pageWidth, y).lineWidth(0.5).stroke(LINE);
    });
  }

  // ---- Footer -------------------------------------------------------------
  // Positioned so the (multi-line) note stays above the bottom margin and does
  // not spill onto an extra page. If flow content already reached this far,
  // start a fresh page for the footer.
  const footText = `Issued ${issuedOn} by the Labb POCT Shelf-Life Tracker. Extensions are recorded by `
    + 'Labb staff following successful quality-control verification. Each passing control extends the lot '
    + 'to 60 days after the control date, up to one year beyond the original expiration.';
  const footTextH = doc.font('Helvetica').fontSize(8.5).heightOfString(footText, { width: pageWidth });
  const footY = doc.page.height - doc.page.margins.bottom - footTextH - 12;
  if (y > footY - 6) doc.addPage();
  doc.moveTo(left, footY).lineTo(left + pageWidth, footY).lineWidth(1).stroke(LINE);
  doc.font('Helvetica').fontSize(8.5).fillColor(SOFT)
    .text(footText, left, footY + 8, { width: pageWidth, lineBreak: true });

  doc.end();
}

/** A one-line validity statement tailored to the lot's current status. */
function validityStatement(lot) {
  switch (lot.status) {
    case 'Verification Failed':
      return `This lot's most recent control FAILED verification. It must not be used beyond ${lot.currentExpiration}.`;
    case 'Expired':
      return `This lot expired on ${lot.currentExpiration} and requires a new passing control before further use.`;
    case 'Control Due':
      return `This lot is verified for use through ${lot.currentExpiration}. A new control is due soon to extend it further.`;
    default:
      return `This lot has been verified through quality-control testing and is approved for use through ${lot.currentExpiration}.`;
  }
}

module.exports = { streamCertificate };
