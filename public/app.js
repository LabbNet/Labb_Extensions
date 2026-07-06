/* Customer-facing lookup page. */
/* global document, fetch, window */

(() => {
  const rowsEl = document.getElementById('rows');
  const emptyEl = document.getElementById('empty');
  const countEl = document.getElementById('count');
  const searchEl = document.getElementById('search');
  const modal = document.getElementById('modal');
  const mTitle = document.getElementById('m-title');
  const mBody = document.getElementById('m-body');
  const mClose = document.getElementById('m-close');
  const { esc, statusBadge, daysPill, extensionLabel, lotDetail } = window.Render;

  let allLots = [];

  async function load() {
    try {
      const res = await fetch('/api/lots');
      const data = await res.json();
      allLots = data.lots || [];
      apply();
    } catch (err) {
      rowsEl.innerHTML = `<tr><td colspan="8" class="muted">Could not load lots: ${esc(err.message)}</td></tr>`;
    }
  }

  function apply() {
    const q = searchEl.value.trim().toLowerCase();
    const lots = q
      ? allLots.filter((l) => l.poctName.toLowerCase().includes(q)
        || l.lotNumber.toLowerCase().includes(q))
      : allLots;

    countEl.textContent = `${lots.length} lot${lots.length === 1 ? '' : 's'}`;
    emptyEl.style.display = lots.length ? 'none' : 'block';

    rowsEl.innerHTML = lots.map((l) => `
      <tr class="clickable" data-id="${esc(l.id)}">
        <td class="wrap"><strong>${esc(l.poctName)}</strong></td>
        <td>${esc(l.lotNumber)}</td>
        <td>${esc(l.originalExpiration)}</td>
        <td><strong>${esc(l.currentExpiration)}</strong></td>
        <td>${extensionLabel(l)}</td>
        <td>${daysPill(l.daysRemaining)}</td>
        <td>${statusBadge(l.status)}</td>
        <td><a class="btn small" style="text-decoration:none" href="/api/lots/${encodeURIComponent(l.id)}/certificate.pdf" data-cert>⬇ PDF</a></td>
      </tr>`).join('');

    rowsEl.querySelectorAll('tr.clickable').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-cert]')) return; // let the download link work
        openDetail(tr.getAttribute('data-id'));
      });
    });
  }

  function openDetail(id) {
    const lot = allLots.find((l) => l.id === id);
    if (!lot) return;
    mTitle.textContent = `${lot.poctName} — Lot ${lot.lotNumber}`;
    mBody.innerHTML = lotDetail(lot);
    modal.classList.add('open');
  }

  function closeModal() { modal.classList.remove('open'); }

  searchEl.addEventListener('input', apply);
  mClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  load();
})();
