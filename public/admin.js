/* Staff console: add lots, log controls. */
/* global document, fetch, window, localStorage */

(() => {
  const { esc, statusBadge, daysPill, extensionLabel, lotDetail } = window.Render;

  const tokenEl = document.getElementById('token');
  const tokenState = document.getElementById('token-state');
  const rowsEl = document.getElementById('admin-rows');
  const emptyEl = document.getElementById('admin-empty');
  const lotSelect = document.getElementById('ctl-lot');
  const modal = document.getElementById('modal');
  const mTitle = document.getElementById('m-title');
  const mBody = document.getElementById('m-body');

  const TOKEN_KEY = 'labb_admin_token';
  let allLots = [];

  function getToken() { return tokenEl.value.trim(); }

  function notice(elId, kind, msg) {
    const el = document.getElementById(elId);
    el.innerHTML = msg ? `<div class="notice ${kind}">${esc(msg)}</div>` : '';
    if (msg && kind === 'success') setTimeout(() => { el.innerHTML = ''; }, 4000);
  }

  async function api(method, url, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (getToken()) opts.headers['x-admin-token'] = getToken();
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    let data = {};
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function load() {
    const data = await api('GET', '/api/lots');
    allLots = data.lots || [];
    renderRows();
    renderLotOptions();
  }

  function renderLotOptions() {
    const cur = lotSelect.value;
    lotSelect.innerHTML = allLots.length
      ? allLots.map((l) => `<option value="${esc(l.id)}">${esc(l.poctName)} — Lot ${esc(l.lotNumber)}</option>`).join('')
      : '<option value="">No lots yet — add one first</option>';
    if (cur) lotSelect.value = cur;
  }

  function renderRows() {
    emptyEl.style.display = allLots.length ? 'none' : 'block';
    rowsEl.innerHTML = allLots.map((l) => `
      <tr>
        <td class="wrap clickable" data-id="${esc(l.id)}"><strong>${esc(l.poctName)}</strong></td>
        <td>${esc(l.lotNumber)}</td>
        <td>${esc(l.originalExpiration)}</td>
        <td><strong>${esc(l.currentExpiration)}</strong></td>
        <td>${extensionLabel(l)}</td>
        <td>${l.passCount}✓ ${l.failCount ? `/ ${l.failCount}✗` : ''}</td>
        <td>${daysPill(l.daysRemaining)}</td>
        <td>${statusBadge(l.status)}</td>
        <td><button class="btn danger small" data-del="${esc(l.id)}">Delete</button></td>
      </tr>`).join('');

    rowsEl.querySelectorAll('[data-id]').forEach((el) =>
      el.addEventListener('click', () => openDetail(el.getAttribute('data-id'))));
    rowsEl.querySelectorAll('[data-del]').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); del(el.getAttribute('data-del')); }));
  }

  function openDetail(id) {
    const lot = allLots.find((l) => l.id === id);
    if (!lot) return;
    mTitle.textContent = `${lot.poctName} — Lot ${lot.lotNumber}`;
    mBody.innerHTML = lotDetail(lot);
    modal.classList.add('open');
  }

  async function addLot() {
    const poctName = document.getElementById('poctName').value.trim();
    const lotNumber = document.getElementById('lotNumber').value.trim();
    const originalExpiration = document.getElementById('originalExpiration').value;
    if (!poctName || !lotNumber || !originalExpiration) {
      return notice('lot-notice', 'error', 'POCT name, lot number and original expiration are all required.');
    }
    try {
      await api('POST', '/api/lots', { poctName, lotNumber, originalExpiration });
      notice('lot-notice', 'success', `Added ${poctName} (Lot ${lotNumber}).`);
      document.getElementById('poctName').value = '';
      document.getElementById('lotNumber').value = '';
      document.getElementById('originalExpiration').value = '';
      await load();
    } catch (err) {
      notice('lot-notice', 'error', err.message);
    }
  }

  async function addControl() {
    const lotId = lotSelect.value;
    const dateConducted = document.getElementById('ctl-date').value;
    const outcome = document.getElementById('ctl-outcome').value;
    const performedBy = document.getElementById('ctl-by').value.trim();
    const notes = document.getElementById('ctl-notes').value.trim();
    if (!lotId) return notice('control-notice', 'error', 'Select a lot first.');
    if (!dateConducted) return notice('control-notice', 'error', 'Date conducted is required.');
    try {
      const data = await api('POST', `/api/lots/${lotId}/controls`, { dateConducted, outcome, performedBy, notes });
      const lot = data.lot;
      notice('control-notice', 'success',
        `${outcome} recorded. New expiration for Lot ${lot.lotNumber}: ${lot.currentExpiration}.`);
      document.getElementById('ctl-date').value = '';
      document.getElementById('ctl-by').value = '';
      document.getElementById('ctl-notes').value = '';
      await load();
    } catch (err) {
      notice('control-notice', 'error', err.message);
    }
  }

  async function del(id) {
    const lot = allLots.find((l) => l.id === id);
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete ${lot ? `${lot.poctName} Lot ${lot.lotNumber}` : 'this lot'} and all its controls?`)) return;
    try {
      await api('DELETE', `/api/lots/${id}`);
      await load();
    } catch (err) {
      notice('lot-notice', 'error', err.message);
    }
  }

  // Token persistence
  document.getElementById('save-token').addEventListener('click', () => {
    localStorage.setItem(TOKEN_KEY, getToken());
    tokenState.textContent = getToken() ? 'Token saved for this browser.' : 'Token cleared.';
    load().catch((e) => notice('lot-notice', 'error', e.message));
  });

  document.getElementById('add-lot').addEventListener('click', addLot);
  document.getElementById('add-control').addEventListener('click', addControl);
  document.getElementById('m-close').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });

  // Restore token and initial load
  tokenEl.value = localStorage.getItem(TOKEN_KEY) || '';
  load().catch((err) => notice('lot-notice', 'error', `Could not load: ${err.message}`));
})();
