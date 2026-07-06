/* Staff console: login, add lots, log controls, manage users, view audit log. */
/* global document, fetch, window, localStorage */

(() => {
  const { esc, statusBadge, daysPill, extensionLabel, lotDetail, outcomeBadge } = window.Render;
  const TOKEN_KEY = 'labb_session_token';

  const el = (id) => document.getElementById(id);
  const loginView = el('login-view');
  const appView = el('app-view');
  const modal = el('modal');

  let token = localStorage.getItem(TOKEN_KEY) || '';
  let me = null;
  let allLots = [];

  function notice(id, kind, msg) {
    const node = el(id);
    if (!node) return;
    node.innerHTML = msg ? `<div class="notice ${kind}">${esc(msg)}</div>` : '';
    if (msg && kind === 'success') setTimeout(() => { node.innerHTML = ''; }, 4000);
  }

  async function api(method, url, body) {
    const opts = { method, headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, opts);
    let data = {};
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (res.status === 401) { setLoggedOut(); throw new Error(data.error || 'Session expired — sign in again.'); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // ---- Auth ----------------------------------------------------------------

  function setLoggedOut() {
    token = '';
    me = null;
    localStorage.removeItem(TOKEN_KEY);
    loginView.style.display = '';
    appView.style.display = 'none';
    el('who').textContent = '';
    el('logout').style.display = 'none';
  }

  async function afterLogin() {
    loginView.style.display = 'none';
    appView.style.display = '';
    el('who').textContent = `${me.displayName || me.username} · ${me.role}`;
    el('logout').style.display = '';
    el('users-card').style.display = me.role === 'admin' ? '' : 'none';
    el('ctl-by').placeholder = `Defaults to ${me.displayName || me.username}`;
    await refreshAll();
  }

  async function login() {
    const username = el('login-user').value.trim();
    const password = el('login-pass').value;
    if (!username || !password) return notice('login-notice', 'error', 'Enter your username and password.');
    try {
      const res = await api('POST', '/api/login', { username, password });
      token = res.token; me = res.user;
      localStorage.setItem(TOKEN_KEY, token);
      el('login-pass').value = '';
      await afterLogin();
    } catch (err) {
      notice('login-notice', 'error', err.message);
    }
  }

  async function logout() {
    try { await api('POST', '/api/logout'); } catch (e) { /* ignore */ }
    setLoggedOut();
  }

  // ---- Data ----------------------------------------------------------------

  async function refreshAll() {
    await Promise.all([loadLots(), loadAudit(), me.role === 'admin' ? loadUsers() : Promise.resolve()]);
  }

  async function loadLots() {
    const data = await api('GET', '/api/lots');
    allLots = data.lots || [];
    renderRows();
    renderLotOptions();
  }

  function renderLotOptions() {
    const sel = el('ctl-lot');
    const cur = sel.value;
    sel.innerHTML = allLots.length
      ? allLots.map((l) => `<option value="${esc(l.id)}">${esc(l.poctName)} — Lot ${esc(l.lotNumber)}</option>`).join('')
      : '<option value="">No lots yet — add one first</option>';
    if (cur) sel.value = cur;
  }

  function renderRows() {
    el('admin-empty').style.display = allLots.length ? 'none' : 'block';
    el('admin-rows').innerHTML = allLots.map((l) => `
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
    el('admin-rows').querySelectorAll('[data-id]').forEach((n) =>
      n.addEventListener('click', () => openDetail(n.getAttribute('data-id'))));
    el('admin-rows').querySelectorAll('[data-del]').forEach((n) =>
      n.addEventListener('click', (e) => { e.stopPropagation(); del(n.getAttribute('data-del')); }));
  }

  function openDetail(id) {
    const lot = allLots.find((l) => l.id === id);
    if (!lot) return;
    el('m-title').textContent = `${lot.poctName} — Lot ${lot.lotNumber}`;
    el('m-body').innerHTML = lotDetail(lot);
    modal.classList.add('open');
  }

  async function addLot() {
    const poctName = el('poctName').value.trim();
    const lotNumber = el('lotNumber').value.trim();
    const originalExpiration = el('originalExpiration').value;
    if (!poctName || !lotNumber || !originalExpiration) {
      return notice('lot-notice', 'error', 'POCT name, lot number and original expiration are all required.');
    }
    try {
      await api('POST', '/api/lots', { poctName, lotNumber, originalExpiration });
      notice('lot-notice', 'success', `Added ${poctName} (Lot ${lotNumber}).`);
      el('poctName').value = ''; el('lotNumber').value = ''; el('originalExpiration').value = '';
      await Promise.all([loadLots(), loadAudit()]);
    } catch (err) { notice('lot-notice', 'error', err.message); }
  }

  async function addControl() {
    const lotId = el('ctl-lot').value;
    const dateConducted = el('ctl-date').value;
    const outcome = el('ctl-outcome').value;
    const performedBy = el('ctl-by').value.trim();
    const notes = el('ctl-notes').value.trim();
    if (!lotId) return notice('control-notice', 'error', 'Select a lot first.');
    if (!dateConducted) return notice('control-notice', 'error', 'Date conducted is required.');
    try {
      const data = await api('POST', `/api/lots/${lotId}/controls`, { dateConducted, outcome, performedBy, notes });
      const lot = data.lot;
      notice('control-notice', 'success',
        `${outcome} recorded. New expiration for Lot ${lot.lotNumber}: ${lot.currentExpiration}.`);
      el('ctl-date').value = ''; el('ctl-by').value = ''; el('ctl-notes').value = '';
      await Promise.all([loadLots(), loadAudit()]);
    } catch (err) { notice('control-notice', 'error', err.message); }
  }

  async function del(id) {
    const lot = allLots.find((l) => l.id === id);
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete ${lot ? `${lot.poctName} Lot ${lot.lotNumber}` : 'this lot'} and all its controls?`)) return;
    try { await api('DELETE', `/api/lots/${id}`); await Promise.all([loadLots(), loadAudit()]); }
    catch (err) { notice('lot-notice', 'error', err.message); }
  }

  // ---- Users (admin) -------------------------------------------------------

  async function loadUsers() {
    const data = await api('GET', '/api/users');
    el('user-rows').innerHTML = (data.users || []).map((u) => `
      <tr>
        <td>${esc(u.username)}</td>
        <td>${esc(u.displayName || '')}</td>
        <td>${esc(u.role)}</td>
        <td>${u.active ? '<span class="badge active">Active</span>' : '<span class="badge expired">Disabled</span>'}</td>
        <td>${u.id === me.id ? '<span class="muted">you</span>'
          : `<button class="btn secondary small" data-toggle="${esc(u.id)}" data-active="${u.active ? 0 : 1}">${u.active ? 'Disable' : 'Enable'}</button>`}</td>
      </tr>`).join('');
    el('user-rows').querySelectorAll('[data-toggle]').forEach((n) =>
      n.addEventListener('click', () => toggleUser(n.getAttribute('data-toggle'), n.getAttribute('data-active') === '1')));
  }

  async function addUser() {
    const username = el('u-username').value.trim();
    const displayName = el('u-display').value.trim();
    const password = el('u-pass').value;
    const role = el('u-role').value;
    if (!username || !password) return notice('user-notice', 'error', 'Username and password are required.');
    try {
      await api('POST', '/api/users', { username, displayName, password, role });
      notice('user-notice', 'success', `Created account "${username}".`);
      el('u-username').value = ''; el('u-display').value = ''; el('u-pass').value = '';
      await Promise.all([loadUsers(), loadAudit()]);
    } catch (err) { notice('user-notice', 'error', err.message); }
  }

  async function toggleUser(id, active) {
    try { await api('POST', `/api/users/${id}/active`, { active }); await Promise.all([loadUsers(), loadAudit()]); }
    catch (err) { notice('user-notice', 'error', err.message); }
  }

  // ---- Audit ---------------------------------------------------------------

  async function loadAudit() {
    const data = await api('GET', '/api/audit?limit=50');
    el('audit-rows').innerHTML = (data.entries || []).map((e) => `
      <tr>
        <td>${esc(new Date(e.ts).toLocaleString())}</td>
        <td>${esc(e.username || 'system')}</td>
        <td>${esc(e.action)}</td>
        <td class="wrap">${esc(e.details || '')}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center">No activity yet.</td></tr>';
  }

  // ---- Wire up -------------------------------------------------------------

  el('login-btn').addEventListener('click', login);
  el('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  el('logout').addEventListener('click', (e) => { e.preventDefault(); logout(); });
  el('add-lot').addEventListener('click', addLot);
  el('add-control').addEventListener('click', addControl);
  el('add-user').addEventListener('click', addUser);
  el('m-close').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });

  // Restore session if we have a saved token.
  if (token) {
    api('GET', '/api/me').then((res) => { me = res.user; return afterLogin(); }).catch(() => setLoggedOut());
  } else {
    setLoggedOut();
  }
})();
