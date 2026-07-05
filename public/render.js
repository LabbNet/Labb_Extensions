/* Shared rendering helpers for the customer and staff pages. */
/* global window, document */

const Render = (() => {
  const STATUS_CLASS = {
    Active: 'active',
    Extended: 'extended',
    'Control Due': 'due',
    Expired: 'expired',
    'Verification Failed': 'failed',
    Unknown: 'expired',
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusBadge(status) {
    const cls = STATUS_CLASS[status] || 'expired';
    return `<span class="badge ${cls}">${esc(status)}</span>`;
  }

  function outcomeBadge(outcome) {
    const cls = outcome === 'Pass' ? 'pass' : 'fail';
    return `<span class="badge ${cls}">${esc(outcome)}</span>`;
  }

  function daysPill(days) {
    if (days == null) return '<span class="muted">—</span>';
    let cls = 'ok';
    let label = `${days} days`;
    if (days < 0) { cls = 'neg'; label = `${Math.abs(days)} days ago`; }
    else if (days <= 14) { cls = 'warn'; }
    return `<span class="days-pill ${cls}">${label}</span>`;
  }

  function extensionLabel(lot) {
    if (!lot.extensionDays) return '<span class="muted">None</span>';
    const cap = lot.atExtensionCap ? ' (max)' : '';
    return `+${lot.extensionDays} days${cap}`;
  }

  /** Build the innerHTML for the lot-detail modal body. */
  function lotDetail(lot) {
    const controls = (lot.controls || []).slice().sort((a, b) =>
      String(b.dateConducted).localeCompare(String(a.dateConducted)));

    const controlRows = controls.length
      ? controls.map((c) => `
          <tr>
            <td>${esc(c.dateConducted)}</td>
            <td>${outcomeBadge(c.outcome)}</td>
            <td class="wrap">${esc(c.performedBy || '—')}</td>
            <td class="wrap">${esc(c.notes || '')}</td>
          </tr>`).join('')
      : '<tr><td colspan="4" class="muted" style="text-align:center">No controls recorded yet.</td></tr>';

    return `
      <div class="summary-grid">
        <div class="cell"><div class="k">Original Expiration</div><div class="v">${esc(lot.originalExpiration)}</div></div>
        <div class="cell"><div class="k">Current Expiration</div><div class="v">${esc(lot.currentExpiration)}</div></div>
        <div class="cell"><div class="k">Extension Earned</div><div class="v">${extensionLabel(lot)}</div></div>
        <div class="cell"><div class="k">Passing Controls</div><div class="v">${lot.passCount}</div></div>
        <div class="cell"><div class="k">Days Remaining</div><div class="v">${daysPill(lot.daysRemaining)}</div></div>
        <div class="cell"><div class="k">Status</div><div class="v">${statusBadge(lot.status)}</div></div>
      </div>
      <h3 style="margin:0 0 10px">Control History</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date Conducted</th><th>Outcome</th><th>Performed By</th><th>Notes</th></tr></thead>
          <tbody>${controlRows}</tbody>
        </table>
      </div>`;
  }

  return { esc, statusBadge, outcomeBadge, daysPill, extensionLabel, lotDetail };
})();

if (typeof window !== 'undefined') window.Render = Render;
