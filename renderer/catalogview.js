// Catalog tab: one search box over every supplier price list (JDS, PDU, ...). Needs a PIN sign-in; admins load the lists.
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const m2 = n => '$' + (+n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const view = $('catView'), gm = window.__gm || {};
  const S = { suppliers: [], q: '', sup: '', limit: 100, rows: [], total: 0, err: '', offline: false, ready: false, locked: false, busy: false, imp: null, seq: 0 };
  const isAdmin = () => { const a = gm.auth ? gm.auth() : {}; return !!(a && (a.admin || a.bootstrap || !a.required)); };
  const num = v => { if (typeof v === 'number') return v > 0 ? v : null; const s = String(v == null ? '' : v).replace(/[$,\s]/g, ''); return /^-?\d*\.?\d+$/.test(s) && parseFloat(s) > 0 ? parseFloat(s) : null; };

  // ---------------- the search page ----------------
  function shell() {
    view.innerHTML = '<div class="wbar"><h2>Catalog</h2><span class="grow"></span><span id="catAdmin"></span></div>' +
      '<div class="note" id="catNote"></div>' +
      '<form class="searchbox" id="catForm" autocomplete="off"><input id="catQ" type="search" placeholder="Type a product number or key words, e.g.  ACG13,  9 diamond glass,  magnetic header plate" value="' + esc(S.q) + '"><select id="catSup" title="Which supplier"></select><button class="btn primary" type="submit">Search</button></form>' +
      '<div id="catOut"></div>';
    paintTop(); paintOut();
  }
  function paintTop() {
    if (!$('catNote')) return;
    const sel = $('catSup'); if (sel) sel.innerHTML = '<option value="">All suppliers</option>' + S.suppliers.map(s => '<option' + (s.name === S.sup ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
    $('catAdmin').innerHTML = isAdmin() && !S.locked ? '<button class="btn" data-a="manage">Import price lists</button>' : '';
    $('catNote').innerHTML = S.suppliers.length
      ? 'Lists on file: ' + S.suppliers.map(s => '<b>' + esc(s.name) + '</b> ' + s.n.toLocaleString() + ' items' + (s.list_date ? ', list dated ' + esc(s.list_date) : '')).join(' &nbsp;·&nbsp; ') + '. These are the suppliers\' list prices. Check the supplier before ordering, because prices change.' + (S.offline ? ' <b>Offline: showing the copy saved on this computer.</b>' : '')
      : (S.ready && !S.locked ? 'No price lists have been loaded yet.' + (isAdmin() ? ' Use "Import price lists" to add your first supplier.' : ' Ask an admin to load them.') : '');
  }
  function priceCell(r) {
    const l = r.labels || [], lines = [];
    (r.prices || []).forEach((p, i) => { if (p != null) lines.push('<div class="cp"><span>' + esc(l[i] || 'Price') + '</span><b>' + m2(p) + '</b></div>'); });
    return lines.length ? lines.join('') : '<span class="muted">No price listed</span>';
  }
  function whenCell(r) {
    let h = '<div class="muted">List ' + esc(r.listDate || 'date not set') + '</div>';
    if (r.change && r.prev != null) {
      const p0 = (r.prices || []).find(p => p != null);
      let arrow = ''; if (p0 != null && r.prev > 0) { const d = (p0 - r.prev) / r.prev; arrow = Math.abs(d) < 0.0005 ? '' : (d > 0 ? ' <span class="up">▲ ' : ' <span class="dn">▼ ') + Math.abs(d * 100).toFixed(1) + '%</span>'; }
      h += '<div class="muted">Changed ' + esc(r.change) + ', was ' + m2(r.prev) + arrow + '</div>';
    }
    return h;
  }
  function paintOut() {
    const out = $('catOut'); if (!out) return;
    if (S.locked) { out.innerHTML = '<div class="card">Wholesale prices need a PIN sign-in.<br><br><button class="btn primary" data-a="signin">Sign in with PIN</button></div>'; return; }
    if (S.err) { out.innerHTML = '<div class="card" style="background:var(--warn)">' + esc(S.err) + '</div>'; return; }
    if (!S.q.trim()) { out.innerHTML = S.ready && S.suppliers.length ? '<div class="note">Search by product number (SKU) or by words in the description. Every supplier is searched at once, and the supplier is shown on each line.</div>' : ''; return; }
    if (!S.rows.length) { out.innerHTML = '<div class="card">Nothing matches "' + esc(S.q) + '". Try fewer words, or part of the product number.</div>'; return; }
    out.innerHTML = '<table class="res"><tr><th>SKU</th><th>Supplier</th><th>Description</th><th>Size</th><th class="n">Case / pack</th><th>Prices</th><th>Catalog &amp; page</th><th>Price list</th></tr>' +
      S.rows.map(r => '<tr><td class="sku"><b>' + esc(r.sku) + '</b></td><td>' + esc(r.supplier) + '</td><td>' + esc(r.desc) + (/coming soon/i.test(r.catalog) ? ' <span class="soon">coming soon</span>' : '') + '</td><td>' + esc(r.size) + '</td><td class="n">' + (r.pack ? r.pack : '') + '</td><td class="pr">' + priceCell(r) + '</td><td>' + (/coming soon/i.test(r.catalog) ? '' : esc(r.catalog)) + (r.page ? (r.catalog && !/coming soon/i.test(r.catalog) ? ', ' : '') + 'page ' + esc(r.page) : '') + '</td><td>' + whenCell(r) + '</td></tr>').join('') + '</table>' +
      '<div class="note">' + (S.total > S.rows.length ? 'Showing ' + S.rows.length.toLocaleString() + ' of ' + S.total.toLocaleString() + ' matches. <button class="btn" data-a="more">Show 100 more</button>' : S.total.toLocaleString() + ' match' + (S.total === 1 ? '' : 'es') + '.') + '</div>';
  }
  async function search(keepLimit) {
    if (!keepLimit) S.limit = 100;
    const mine = ++S.seq, q = S.q.trim();
    if (!q) { S.rows = []; S.total = 0; S.err = ''; paintOut(); return; }
    const r = await gm.write(() => window.api.catSearch({ q, supplier: S.sup, limit: S.limit }), null);
    if (mine !== S.seq) return;   // a newer search is already running
    if (!r) { S.locked = true; paintTop(); paintOut(); return; }
    if (r.error) { S.err = r.error.replace(/^LOCKED: /, ''); S.rows = []; paintOut(); return; }
    S.err = ''; S.locked = false; S.rows = r.rows; S.total = r.total; paintOut();
  }
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(() => search(), 220); };

  // ---------------- importing price lists (admin) ----------------
  const modal = () => $('catModal');
  function openModal(html) {
    let m = modal(); if (!m) { m = document.createElement('div'); m.id = 'catModal'; m.className = 'wmodal'; m.style.zIndex = 110; document.body.appendChild(m); }
    m.innerHTML = '<div class="wbox" style="width:min(860px,96vw)">' + html + '</div>';
  }
  function closeModal() { const m = modal(); if (m) m.remove(); S.imp = null; }
  function manage(msg) {
    S.imp = null;
    openModal('<h3>Price lists</h3>' +
      (S.suppliers.length ? '<table class="wt"><tr><th>Supplier</th><th class="n">Items</th><th>List date</th><th>Loaded</th><th></th></tr>' + S.suppliers.map(s => '<tr><td><b>' + esc(s.name) + '</b></td><td class="n">' + s.n.toLocaleString() + '</td><td>' + esc(s.list_date || '—') + '</td><td>' + esc((s.updated_at || '').slice(0, 10)) + (s.updated_by ? ' by ' + esc(s.updated_by) : '') + '</td><td><button class="btn" data-a="rm" data-n="' + esc(s.name) + '">Remove</button></td></tr>').join('') + '</table>' : '<div class="note">Nothing loaded yet.</div>') +
      '<div class="note" style="margin-top:10px">To add a supplier, or to replace one with a newer list, choose the file below (.csv or .xlsx). A list with the same supplier name replaces the old one. Files are read on this computer and stored only in your shared database, never on GitHub.</div>' +
      '<div class="srow" style="margin-top:8px"><button class="btn primary" data-a="pick">Choose a price list file…</button><span class="grow"></span><button class="btn" data-a="mclose">Close</button></div><div class="note" id="catMsg" style="min-height:18px">' + esc(msg || '') + '</div>');
  }
  const colSel = (id, headers, val, none) => '<select id="' + id + '"><option value="-1">' + (none || '(not in this file)') + '</option>' + headers.map((h, i) => '<option value="' + i + '"' + (i === val ? ' selected' : '') + '>' + esc(h || '(blank heading)') + '</option>').join('') + '</select>';
  function mapForm() {
    const p = S.imp, m = p.mapping, hs = p.headers, pr = m.prices.slice(); while (pr.length < 4) pr.push({ label: '', col: -1 });
    const have = S.suppliers.find(s => s.name.toLowerCase() === (m.supplier || '').toLowerCase());
    openModal('<h3>Import ' + esc(p.fileName) + '</h3>' +
      '<div class="note">' + p.count.toLocaleString() + ' rows found. ' + (p.known ? '<b>Recognized as a ' + esc(p.known) + ' price list</b>, so the columns are already matched. Check the preview, then import.' : 'This is a new kind of list. Match each piece of information to the column in your file that holds it.') + '</div>' +
      '<div class="srow"><div style="flex:1 1 200px"><label>Supplier name</label><input id="cmName" value="' + esc(m.supplier) + '" maxlength="40"></div><div style="flex:1 1 200px"><label>Date of this price list</label><input id="cmDate" type="date" value="' + esc(m.listDate) + '"></div></div>' +
      '<div id="cmHave" class="note"></div>' +
      '<details' + (p.known ? '' : ' open') + '><summary style="cursor:pointer;margin:10px 0 4px;font-weight:600">Column matching</summary><div class="cmgrid">' +
      '<div><label>Product number (SKU)</label>' + colSel('cmSku', hs, m.sku, '(pick one)') + '</div><div><label>Description</label>' + colSel('cmDesc', hs, m.desc, '(pick one)') + '</div>' +
      '<div><label>Size</label>' + colSel('cmSize', hs, m.size) + '</div><div><label>Case / pack quantity</label>' + colSel('cmPack', hs, m.pack) + '</div>' +
      '<div><label>Catalog page</label>' + colSel('cmPage', hs, m.page) + '</div><div><label>Catalog name</label>' + colSel('cmCat', hs, m.catalog) + '</div>' +
      '<div><label>Previous price</label>' + colSel('cmPrev', hs, m.prev) + '</div><div><label>Date of last price change</label>' + colSel('cmChg', hs, m.change) + '</div></div>' +
      '<label>Prices (give each one a name, for example "1 case")</label>' + pr.map((x, i) => '<div class="srow" style="margin-bottom:4px"><input id="cmPl' + i + '" placeholder="Name, e.g. 1 case" value="' + esc(x.label) + '" style="flex:1 1 150px">' + colSel('cmPc' + i, hs, x.col, '(not used)').replace('<select', '<select style="flex:2 1 220px"') + '</div>').join('') + '</details>' +
      '<div id="cmPrev2"></div><div class="srow" style="margin-top:10px"><button class="btn primary" data-a="doimport">Import</button><button class="btn" data-a="mcancel">Cancel</button></div><div class="note" id="catMsg" style="min-height:18px"></div>');
    mapPreview();
  }
  function readMap() {
    const g = id => { const e = $(id); return e ? parseInt(e.value, 10) : -1; }, prices = [];
    for (let i = 0; i < 6; i++) { const c = $('cmPc' + i); if (c && parseInt(c.value, 10) >= 0) prices.push({ label: ($('cmPl' + i).value || '').trim(), col: parseInt(c.value, 10) }); }
    return { supplier: $('cmName').value.trim(), listDate: $('cmDate').value, sku: g('cmSku'), desc: g('cmDesc'), size: g('cmSize'), pack: g('cmPack'), page: g('cmPage'), catalog: g('cmCat'), prev: g('cmPrev'), change: g('cmChg'), prices };
  }
  function mapPreview() {
    if (!S.imp || !$('cmPrev2')) return; const m = readMap(), p = S.imp, v = (r, c) => c >= 0 && c < r.length ? r[c] : '';
    const have = S.suppliers.find(s => s.name.toLowerCase() === m.supplier.toLowerCase());
    $('cmHave').innerHTML = have ? '<b>This replaces the current ' + esc(have.name) + ' list</b> (' + have.n.toLocaleString() + ' items' + (have.list_date ? ', dated ' + esc(have.list_date) : '') + ').' : '';
    $('cmPrev2').innerHTML = '<div class="note" style="margin-top:8px">Preview of the first rows as they will appear:</div><table class="wt"><tr><th>SKU</th><th>Description</th><th>Size</th><th class="n">Pack</th><th>Prices</th></tr>' +
      p.sample.slice(0, 3).map(r => '<tr><td>' + esc(v(r, m.sku)) + '</td><td>' + esc(v(r, m.desc)) + '</td><td>' + esc(v(r, m.size)) + '</td><td class="n">' + esc(v(r, m.pack)) + '</td><td>' + (m.prices.map(x => { const n = num(v(r, x.col)); return n == null ? '' : esc(x.label || 'Price') + ' ' + m2(n); }).filter(Boolean).join(' · ') || '<span class="muted">none</span>') + '</td></tr>').join('') + '</table>';
  }

  async function onClick(e) {
    const t = e.target.closest('[data-a]'); if (!t) return; const a = t.dataset.a;
    if (a === 'signin') { show(); return; }
    if (a === 'more') { S.limit += 100; search(true); return; }
    if (a === 'manage') { manage(); return; }
    if (a === 'mclose') { closeModal(); paintTop(); return; }
    if (a === 'mcancel') { manage(); return; }
    if (a === 'pick') {
      const r = await gm.write(() => window.api.catPick(), null); if (!r || r.canceled) return;
      if (r.error) { const m = $('catMsg'); if (m) m.textContent = r.error.replace(/^LOCKED: /, ''); return; }
      S.imp = r; mapForm(); return;
    }
    if (a === 'rm') {
      if (t.dataset.armed !== '1') { t.dataset.armed = '1'; t.textContent = 'Click again to remove'; return; }
      const r = await gm.write(() => window.api.catRemove(t.dataset.n), null); if (r && r.ok) { await refresh(); manage('Removed ' + t.dataset.n + '.'); } return;
    }
    if (a === 'doimport') {
      const m = readMap(), msg = $('catMsg'), p = S.imp; if (!p) return;
      if (!m.supplier) { msg.textContent = 'Type the supplier name (for example JDS).'; return; }
      if (m.sku < 0 || m.desc < 0) { msg.textContent = 'Pick the SKU and description columns.'; return; }
      if (!m.prices.length) { msg.textContent = 'Pick at least one price column.'; return; }
      t.disabled = true; msg.innerHTML = 'Importing ' + p.count.toLocaleString() + ' items… <progress id="catProg" max="100" value="0" style="width:200px;vertical-align:middle"></progress> (about a minute for a large list; keep this window open)';
      const r = await gm.write(() => window.api.catImport(p.token, m), null);
      if (!r) { t.disabled = false; msg.textContent = 'Not imported (sign-in was cancelled).'; return; }
      if (r.error) { t.disabled = false; msg.textContent = r.error.replace(/^LOCKED: /, ''); return; }
      await refresh(); manage('Imported ' + r.count.toLocaleString() + ' ' + r.name + ' items.'); if (S.q.trim()) search(true); return;
    }
  }
  async function refresh() {
    const r = await window.api.catStatus();
    if (r && !r.error) { S.suppliers = r.suppliers; S.offline = r.offline; S.err = r.error || ''; }
    paintTop();
  }
  view.addEventListener('click', onClick);
  document.addEventListener('click', e => { if (modal() && modal().contains(e.target)) onClick(e); });
  document.addEventListener('change', e => { if (modal() && modal().contains(e.target) && S.imp && e.target.id && /^cm/.test(e.target.id)) mapPreview(); });
  document.addEventListener('input', e => { if (modal() && modal().contains(e.target) && S.imp && e.target.id === 'cmName') mapPreview(); });
  view.addEventListener('input', e => { if (e.target.id === 'catQ') { S.q = e.target.value; later(); } });
  view.addEventListener('change', e => { if (e.target.id === 'catSup') { S.sup = e.target.value; search(); } });
  view.addEventListener('submit', e => { e.preventDefault(); clearTimeout(timer); search(); });
  if (window.api.onCatProgress) window.api.onCatProgress(p => { const b = $('catProg'); if (b && p && p.total) b.value = Math.round(p.done * 100 / p.total); });

  async function show() {
    if (window.__hideWork) window.__hideWork();
    ['main', '#custView', '#priceView'].forEach(sel => { const el = document.querySelector(sel); if (el) el.style.display = 'none'; });
    ['tabSearch', 'tabCust', 'tabPrice'].forEach(i => $(i) && $(i).classList.remove('on'));
    view.style.display = 'block'; $('tabCat').classList.add('on');
    shell();
    const st = await window.api.cloudStatus();
    if (!st.configured) { S.err = 'The shared database is not connected yet. Use File > Shared database connection, then come back here.'; S.ready = true; paintTop(); paintOut(); return; }
    const r = await gm.write(() => window.api.catStatus(), null);
    if (!r) { S.locked = true; S.ready = true; paintTop(); paintOut(); return; }
    if (r.error && !r.suppliers) { S.err = r.error.replace(/^LOCKED: /, ''); S.ready = true; paintTop(); paintOut(); return; }
    S.locked = false; S.err = r.error || ''; S.suppliers = r.suppliers; S.offline = r.offline; S.ready = true; paintTop(); paintOut();
    const q = $('catQ'); if (q) q.focus(); if (S.q.trim()) search(true);
  }
  const prevHide = window.__hideWork;
  window.__hideWork = () => { if (prevHide) prevHide(); if (view.style.display !== 'none') view.style.display = 'none'; $('tabCat').classList.remove('on'); closeModal(); };
  // When the sign-in times out, the wholesale prices disappear from the screen.
  setInterval(() => { if (view.style.display === 'none' || S.locked) return; const a = gm.auth ? gm.auth() : null; if (a && a.required && !a.user) { S.locked = true; S.rows = []; S.total = 0; paintTop(); paintOut(); closeModal(); } }, 10000);
  window.__showCatalog = show; $('tabCat').onclick = show;
})();
