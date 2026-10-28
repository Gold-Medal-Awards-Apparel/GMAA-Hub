// Inventory tab: scan a barcode (the vendor item number), then use / receive / count stock. Shared through the Cloudflare database.
// A keyboard-style scanner just types the code and presses Enter, so the scan box only has to stay focused.
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => '$' + (+n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const view = $('invView');
  const gm = window.__gm || {};
  const S = { items: [], stock: [], idx: new Map(), loaded: false, err: '', mode: 'lookup', qty: 1, q: '', vendor: '', cat: '', loc: '', low: false, flag: false,
    sort: 'code', dir: 1, limit: 100, last: null, log: null, open: null, moves: null, moveLimit: 50, active: false, busy: false, importing: false };
  const num = n => Math.max(1, Math.round(Number(n) || 1));
  const isAdmin = () => { const a = gm.auth ? gm.auth() : {}; return !!(a && (a.admin || a.bootstrap || !a.required)); };

  function rebuild() {
    S.idx = new Map();
    S.items.forEach(it => S.idx.set(it.id, { it, lines: [], onHand: 0, value: 0, locs: [], hay: '' }));
    S.stock.forEach(l => { const e = S.idx.get(l.item_id); if (e) e.lines.push(l); });
    S.idx.forEach(e => {
      e.onHand = e.lines.reduce((a, l) => a + l.qty, 0); e.value = e.lines.reduce((a, l) => a + l.qty * l.cost, 0);
      e.locs = [...new Set(e.lines.map(l => l.location).filter(Boolean))];
      e.flagged = e.lines.some(l => l.flag); e.low = e.it.min_qty > 0 && e.onHand <= e.it.min_qty;
      e.hay = (e.it.code + ' ' + e.it.vendor + ' ' + e.it.name + ' ' + e.it.category + ' ' + e.lines.map(l => l.label + ' ' + l.location).join(' ')).toLowerCase();
    });
  }
  async function pull(quiet) {
    if (S.busy) return; S.busy = true;
    const r = await window.api.invPull(); S.busy = false;
    if (r && r.error) { S.err = r.error; if (!quiet || !S.loaded) paint(); return; }
    S.err = ''; S.items = r.items; S.stock = r.stock; S.loaded = true; rebuild(); paint(); if (S.open) openItem(S.open, true);
  }

  // ---------- page ----------
  function shell() {
    view.innerHTML =
      '<div class="wbar"><h2>Inventory</h2><span class="grow"></span><button class="btn" data-a="refresh">Refresh</button> <button class="btn" data-a="new">+ New item</button> <button class="btn" data-a="recent">Recent activity</button></div>' +
      '<div class="invscan"><input id="invScan" type="text" autocomplete="off" spellcheck="false" placeholder="Scan a barcode here (or type an item number and press Enter)"><span class="invdot" id="invDot"></span>' +
      '<div class="invmodes" id="invModes"></div><label class="sm">Amount <input id="invQty" type="number" min="1" value="1" style="width:70px"></label></div>' +
      '<div id="invLog"></div><div id="invErr"></div><div id="invKpi" class="kpis"></div>' +
      '<div class="wbar"><input id="invQ" type="search" placeholder="Search name, item number, color, location…" style="min-width:260px"><select id="invVen"></select><select id="invCat"></select><select id="invLoc"></select>' +
      '<label class="sm"><input type="checkbox" id="invLow"> Low stock</label> <label class="sm"><input type="checkbox" id="invFlag"> Needs a check</label></div>' +
      '<div id="invBody"></div>';
    const sc = $('invScan');
    sc.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const v = sc.value.trim(); sc.value = ''; if (v) scan(v); } });
    sc.addEventListener('focus', () => $('invDot').classList.add('on')); sc.addEventListener('blur', () => $('invDot').classList.remove('on'));
    $('invQty').addEventListener('input', () => { S.qty = num($('invQty').value); });
    $('invQ').addEventListener('input', e => { S.q = e.target.value; S.limit = 100; body(); });
    [['invVen', 'vendor'], ['invCat', 'cat'], ['invLoc', 'loc']].forEach(([id, k]) => $(id).addEventListener('change', e => { S[k] = e.target.value; S.limit = 100; body(); }));
    $('invLow').addEventListener('change', e => { S.low = e.target.checked; S.limit = 100; body(); });
    $('invFlag').addEventListener('change', e => { S.flag = e.target.checked; S.limit = 100; body(); });
    view.addEventListener('click', onClick);
    view.addEventListener('click', e => { if (!/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && !document.querySelector('.invmodal')) setTimeout(() => { const s = $('invScan'); if (s && S.active) s.focus(); }, 0); });
  }
  function paint() { if (!$('invScan')) shell(); modes(); filters(); kpi(); log(); body(); }
  function modes() {
    const M = [['lookup', 'Look up'], ['use', 'Use (−)'], ['receive', 'Receive (+)'], ['count', 'Count']];
    $('invModes').innerHTML = M.map(m => '<button class="btn' + (S.mode === m[0] ? ' primary' : '') + '" data-mode="' + m[0] + '">' + m[1] + '</button>').join('');
  }
  function fillSel(id, label, vals, cur) {
    const el = $(id); const html = '<option value="">' + label + '</option>' + vals.map(v => '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
    if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
  }
  function filters() {
    const u = f => [...new Set(f)].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    fillSel('invVen', 'All vendors', u(S.items.map(i => i.vendor)), S.vendor); fillSel('invCat', 'All categories', u(S.items.map(i => i.category)), S.cat);
    fillSel('invLoc', 'All locations', u(S.stock.map(l => l.location)), S.loc);
  }
  function kpi() {
    const all = [...S.idx.values()]; const pieces = all.reduce((a, e) => a + e.onHand, 0), value = all.reduce((a, e) => a + e.value, 0);
    $('invKpi').innerHTML = [['Items', all.length.toLocaleString()], ['Pieces on hand', pieces.toLocaleString()], ['Stock value (at cost)', money(value)],
      ['Low stock', all.filter(e => e.low).length], ['Need a check', all.filter(e => e.flagged).length]].map(k => '<div class="card">' + k[0] + '<b>' + k[1] + '</b></div>').join('');
  }
  function log() {
    const l = S.log; if (!l) { $('invLog').innerHTML = ''; return; }
    $('invLog').innerHTML = '<div class="invlog ' + (l.ok ? 'ok' : 'bad') + '">' + esc(l.text) + (l.undo ? ' <button class="btn" data-a="undo">Undo</button>' : '') + (l.add ? ' <button class="btn" data-a="addscan" data-code="' + esc(l.add) + '">Add it as a new item</button>' : '') + '</div>';
  }
  function list() {
    const toks = S.q.toLowerCase().split(/\s+/).filter(Boolean);
    let l = [...S.idx.values()].filter(e => (!S.vendor || e.it.vendor === S.vendor) && (!S.cat || e.it.category === S.cat) && (!S.loc || e.lines.some(x => x.location === S.loc)) &&
      (!S.low || e.low) && (!S.flag || e.flagged) && toks.every(t => e.hay.includes(t)));
    const k = S.sort, d = S.dir;
    const key = { code: e => e.it.code.toLowerCase(), vendor: e => e.it.vendor.toLowerCase(), name: e => e.it.name.toLowerCase(), onHand: e => e.onHand, value: e => e.value, loc: e => (e.locs[0] || '').toLowerCase() }[k];
    return l.sort((a, b) => { const A = key(a), B = key(b); return (typeof A === 'string' ? A.localeCompare(B, undefined, { numeric: true }) : A - B) * d; });
  }
  function body() {
    if (S.err) $('invErr').innerHTML = '<div class="card" style="background:var(--warn);margin:8px 0">' + esc(S.err) + '</div>'; else $('invErr').innerHTML = '';
    if (!S.loaded) { $('invBody').innerHTML = S.err ? '' : '<div class="note">Loading inventory…</div>'; return; }
    if (!S.items.length) {
      $('invBody').innerHTML = '<div class="card" style="margin:10px 0">The inventory is empty. ' + (S.importing ? 'Loading your starter list… this takes about a minute, please keep the app open.' :
        'You can load your spreadsheet list (about 970 items) as a starting point, or add items one by one with "+ New item".<br><br><button class="btn primary" data-a="import">Load my spreadsheet list</button>') + '</div>'; return;
    }
    const l = list(), shown = l.slice(0, S.limit);
    const th = (c, t, n) => '<th class="sortable' + (n ? ' n' : '') + '" data-s="' + c + '">' + t + (S.sort === c ? (S.dir < 0 ? ' ▼' : ' ▲') : '') + '</th>';
    $('invBody').innerHTML = '<table class="wt invt"><tr>' + th('code', 'Item #') + th('vendor', 'Vendor') + th('name', 'Name') + th('onHand', 'On hand', 1) + th('value', 'Value', 1) + th('loc', 'Where') + '</tr>' +
      shown.map(e => '<tr class="invrow" data-open="' + esc(e.it.id) + '"><td><b>' + esc(e.it.code) + '</b></td><td>' + esc(e.it.vendor) + '</td><td>' + esc(e.it.name) + (e.lines.length > 1 ? ' <span class="sm">(' + e.lines.length + ' lines)</span>' : '') +
        (e.low ? ' <span class="bdg">low</span>' : '') + (e.flagged ? ' <span class="invwarn" title="Needs a check">⚠</span>' : '') + '</td><td class="n">' + e.onHand.toLocaleString() + '</td><td class="n">' + money(e.value) + '</td><td>' + esc(e.locs.slice(0, 2).join(', ')) + (e.locs.length > 2 ? ' +' + (e.locs.length - 2) : '') + '</td></tr>').join('') + '</table>' +
      '<div class="note" style="margin:8px 0">Showing ' + shown.length.toLocaleString() + ' of ' + l.length.toLocaleString() + ' items. ' + (l.length > shown.length ? '<button class="btn" data-a="more">Show 100 more</button> <button class="btn" data-a="all">Show all ' + l.length.toLocaleString() + '</button>' : '') + '</div>' +
      (l.length ? '' : '<div class="card">Nothing matches. Try fewer words or clear the filters.</div>');
  }

  // ---------- scanning and stock changes ----------
  function scan(code) {
    const c = code.toLowerCase(); const hits = [...S.idx.values()].filter(e => e.it.code.toLowerCase() === c);
    if (!hits.length) { S.log = { ok: false, text: 'No item with the number "' + code + '".', add: code }; log(); return; }
    if (hits.length > 1) { chooser(hits, code); return; }
    handle(hits[0]);
  }
  function handle(e) {
    const m = S.mode;
    if ((m === 'use' || m === 'receive') && e.lines.length === 1) { move(e.lines[0], m, S.qty); S.qty = 1; $('invQty').value = 1; return; }
    if (!e.lines.length) { S.log = { ok: false, text: e.it.code + ' has no stock lines yet. Add one first.' }; log(); openItem(e.it.id); return; }
    openItem(e.it.id);
  }
  async function move(line, kind, n, silent) {
    const e = S.idx.get(line.item_id), prev = line.qty;
    const r = await gm.write(() => window.api.invMove(line.id, kind, n, ''), null);
    if (!r) return null;
    if (r.error) { if (r.qty !== undefined) { line.qty = r.qty; rebuild(); body(); } S.log = { ok: false, text: r.error.replace(/^LOCKED: /, '') }; log(); return r; }
    line.qty = r.qty; rebuild(); kpi(); body();
    const verb = kind === 'use' ? 'Used ' + n : kind === 'receive' ? 'Received ' + n : 'Counted ' + r.qty;
    S.last = { id: line.id, kind, n, prev };
    S.log = { ok: true, undo: !silent, text: verb + ' · ' + (e ? e.it.code + ' · ' : '') + line.label + ' · now ' + r.qty + ' on hand' + (e && e.low ? ' (LOW)' : '') }; log();
    if (S.open) openItem(S.open, true);
    return r;
  }
  async function undo() {
    const l = S.last; if (!l) return; const line = S.stock.find(x => x.id === l.id); if (!line) return;
    const inv = l.kind === 'use' ? ['receive', l.n] : l.kind === 'receive' ? ['use', l.n] : ['count', l.prev];
    S.last = null; await move(line, inv[0], inv[1], true); S.log = { ok: true, text: 'Undone · ' + line.label + ' · now ' + line.qty + ' on hand' }; log();
  }

  // ---------- item panel ----------
  function closeModals() { document.querySelectorAll('.invmodal').forEach(m => m.remove()); S.open = null; S.moves = null; const s = $('invScan'); if (s && S.active) s.focus(); }
  function modal(html, wide) {
    document.querySelectorAll('.invmodal').forEach(m => m.remove());
    const box = document.createElement('div'); box.className = 'wmodal invmodal'; box.style.zIndex = 90;
    box.innerHTML = '<div class="wbox" style="width:min(' + (wide || 640) + 'px,96vw)">' + html + '</div>'; document.body.appendChild(box); return box;
  }
  function chooser(hits, code) {
    const box = modal('<h3>More than one item has the number ' + esc(code) + '</h3><div class="note">Pick the one you mean.</div>' + hits.map(e => '<p><button class="btn" data-open="' + esc(e.it.id) + '" style="width:100%;text-align:left"><b>' + esc(e.it.vendor) + '</b> · ' + esc(e.it.name) + ' · ' + e.onHand + ' on hand</button></p>').join('') + '<p style="text-align:right"><button class="btn" data-a="close">Cancel</button></p>');
    box.addEventListener('click', onClick);
  }
  function openItem(id, keep) {
    const e = S.idx.get(id); if (!e) { closeModals(); return; }
    const prevScroll = document.querySelector('.invmodal .wbox') ? document.querySelector('.invmodal .wbox').scrollTop : 0;
    S.open = id; if (!keep) { S.moves = null; }
    const adm = isAdmin();
    const lines = e.lines.map(l => '<tr><td>' + esc(l.label) + (l.flag ? '<div class="invwarn sm">⚠ ' + esc(l.flag) + '</div>' : '') + (l.note ? '<div class="sm">' + esc(l.note) + '</div>' : '') + '</td><td>' + esc(l.location) + '</td><td class="n">' + money(l.cost) + '</td><td class="n"><b>' + l.qty + '</b></td>' +
      '<td class="invact"><input type="number" min="0" value="' + S.qty + '" data-n="' + esc(l.id) + '" aria-label="Amount"> <button class="btn' + (S.mode === 'use' ? ' primary' : '') + '" data-do="use" data-l="' + esc(l.id) + '">Use</button> <button class="btn' + (S.mode === 'receive' ? ' primary' : '') + '" data-do="receive" data-l="' + esc(l.id) + '">Receive</button> <button class="btn' + (S.mode === 'count' ? ' primary' : '') + '" data-do="count" data-l="' + esc(l.id) + '">Set count</button> ' +
      '<button class="btn" data-a="editline" data-l="' + esc(l.id) + '">Edit</button>' + (adm ? ' <button class="btn" data-a="delline" data-l="' + esc(l.id) + '">Delete</button>' : '') + '</td></tr>').join('');
    const box = modal('<button class="btn" data-a="close" style="float:right">Close</button><h3 style="margin:0">' + esc(e.it.code) + ' · ' + esc(e.it.name) + '</h3><div class="note">' + esc(e.it.vendor) + (e.it.category ? ' · ' + esc(e.it.category) : '') + ' · <b>' + e.onHand + '</b> on hand · ' + money(e.value) + ' at cost' + (e.it.min_qty ? ' · reorder at ' + e.it.min_qty : '') + '</div>' +
      '<div class="wbar"><button class="btn" data-a="edititem">Edit item</button> <button class="btn" data-a="addline">+ Add a color / size / bin</button> <button class="btn" data-a="history">History</button>' + (adm ? ' <button class="btn" data-a="delitem">Delete item</button>' : '') + '</div>' +
      '<table class="wt"><tr><th>Color / size</th><th>Where</th><th class="n">Cost</th><th class="n">On hand</th><th></th></tr>' + (lines || '<tr><td colspan="5">No stock lines yet. Use "Add a color / size / bin".</td></tr>') + '</table><div id="invHist"></div>', 980);
    box.addEventListener('click', onClick); const wb = box.querySelector('.wbox'); if (keep) wb.scrollTop = prevScroll;
    if (S.moves) drawHist(); box.querySelectorAll('input[data-n]').forEach(i => i.addEventListener('keydown', ev => { if (ev.key === 'Enter') { const b = box.querySelector('[data-do="' + (S.mode === 'lookup' ? 'use' : S.mode) + '"][data-l="' + i.dataset.n + '"]'); if (b) b.click(); } }));
    if (!keep && S.mode === 'count') { const f = box.querySelector('input[data-n]'); if (f) { f.value = e.lines[0] ? e.lines[0].qty : 0; f.focus(); f.select(); } }
  }
  async function history(more) {
    const e = S.idx.get(S.open); if (!e) return; if (more) S.moveLimit += 100; else S.moveLimit = 50;
    const r = await window.api.invMoves(S.moveLimit, e.it.id); if (r.error) { gm.toast && gm.toast(r.error); return; } S.moves = { rows: r.moves, more: r.moves.length >= S.moveLimit }; drawHist();
  }
  const fmtT = iso => { try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
  const KIND = { use: 'Used', receive: 'Received', count: 'Counted', remove: 'Removed', import: 'Imported' };
  function drawHist() {
    const el = $('invHist'); if (!el || !S.moves) return;
    el.innerHTML = '<h3>History</h3><table class="wt"><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th class="n">Change</th><th class="n">Left</th></tr>' + (S.moves.rows.map(m => '<tr><td>' + fmtT(m.at) + '</td><td>' + esc(m.by || '—') + '</td><td>' + (KIND[m.kind] || esc(m.kind)) + '</td><td>' + esc(m.code + ' ' + m.label) + (m.note ? ' <span class="sm">' + esc(m.note) + '</span>' : '') + '</td><td class="n">' + (m.delta > 0 ? '+' : '') + m.delta + '</td><td class="n">' + m.qty_after + '</td></tr>').join('') || '<tr><td colspan="6">Nothing yet.</td></tr>') + '</table>' +
      (S.moves.more ? '<p><button class="btn" data-a="histmore">Show 100 more</button></p>' : '');
  }
  async function recent(more) {
    const n = more ? S.moveLimit + 100 : 100; S.moveLimit = n; const r = await window.api.invMoves(n); if (r.error) { gm.toast && gm.toast(r.error); return; }
    const box = modal('<button class="btn" data-a="close" style="float:right">Close</button><h3 style="margin:0">Recent activity</h3><table class="wt"><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th class="n">Change</th><th class="n">Left</th></tr>' + (r.moves.map(m => '<tr><td>' + fmtT(m.at) + '</td><td>' + esc(m.by || '—') + '</td><td>' + (KIND[m.kind] || esc(m.kind)) + '</td><td>' + esc(m.code + ' ' + m.label) + (m.note ? ' <span class="sm">' + esc(m.note) + '</span>' : '') + '</td><td class="n">' + (m.delta > 0 ? '+' : '') + m.delta + '</td><td class="n">' + m.qty_after + '</td></tr>').join('') || '<tr><td colspan="6">Nothing yet.</td></tr>') + '</table>' +
      (r.moves.length >= n ? '<p><button class="btn" data-a="recentmore">Show 100 more</button></p>' : ''), 1000);
    box.addEventListener('click', onClick);
  }

  // ---------- editors ----------
  function itemForm(it, code) {
    const cats = [...new Set(S.items.map(i => i.category).filter(Boolean))], vens = [...new Set(S.items.map(i => i.vendor).filter(Boolean))];
    const box = modal('<h3>' + (it ? 'Edit item' : 'New item') + '</h3><label>Item number (what the barcode says)</label><input id="fiCode" value="' + esc(it ? it.code : code || '') + '"><label>Vendor</label><input id="fiVen" list="invVens" value="' + esc(it ? it.vendor : '') + '"><datalist id="invVens">' + vens.map(v => '<option>' + esc(v) + '</option>').join('') + '</datalist>' +
      '<label>Name</label><input id="fiName" value="' + esc(it ? it.name : '') + '"><label>Category</label><input id="fiCat" list="invCats" value="' + esc(it ? it.category : '') + '"><datalist id="invCats">' + cats.map(v => '<option>' + esc(v) + '</option>').join('') + '</datalist>' +
      '<label>Reorder when on hand falls to (0 = no reminder)</label><input id="fiMin" type="number" min="0" value="' + (it ? it.min_qty : 0) + '"><div class="note" id="fiMsg" style="color:#B3261E;min-height:18px"></div>' +
      '<p style="text-align:right"><button class="btn primary" data-a="saveitem" data-id="' + esc(it ? it.id : '') + '">Save</button> <button class="btn" data-a="close">Cancel</button></p>', 520);
    box.addEventListener('click', onClick); $('fiCode').focus();
  }
  function lineForm(line, itemId) {
    const locs = [...new Set(S.stock.map(l => l.location).filter(Boolean))].sort();
    const box = modal('<h3>' + (line ? 'Edit this line' : 'Add a color / size / bin') + '</h3><label>Color / size / description</label><input id="flLabel" value="' + esc(line ? line.label : '') + '">' +
      '<label>Cost per piece</label><input id="flCost" type="number" min="0" step="0.01" value="' + (line ? line.cost : '') + '"><label>Where it is kept</label><input id="flLoc" list="invLocs" value="' + esc(line ? line.location : '') + '"><datalist id="invLocs">' + locs.map(v => '<option>' + esc(v) + '</option>').join('') + '</datalist>' +
      (line ? '' : '<label>How many are on hand now</label><input id="flQty" type="number" min="0" value="0">') + '<label>Note</label><input id="flNote" value="' + esc(line ? line.note : '') + '"><div class="note" id="flMsg" style="color:#B3261E;min-height:18px"></div>' +
      '<p style="text-align:right"><button class="btn primary" data-a="saveline" data-id="' + esc(line ? line.id : '') + '" data-item="' + esc(itemId) + '">Save</button> <button class="btn" data-a="back" data-item="' + esc(itemId) + '">Cancel</button></p>', 520);
    box.addEventListener('click', onClick); $('flLabel').focus();
  }

  async function onClick(ev) {
    const t = ev.target.closest('[data-a],[data-mode],[data-s],[data-open],[data-do]'); if (!t) return;
    const d = t.dataset;
    if (d.mode) { S.mode = d.mode; modes(); if ($('invScan')) $('invScan').focus(); return; }
    if (d.s) { S.dir = S.sort === d.s ? -S.dir : (d.s === 'onHand' || d.s === 'value' ? -1 : 1); S.sort = d.s; body(); return; }
    if (d.open) { document.querySelectorAll('.invmodal').forEach(m => m.remove()); openItem(d.open); return; }
    if (d.do) {
      const line = S.stock.find(l => l.id === d.l), inp = document.querySelector('.invmodal input[data-n="' + d.l + '"]'); if (!line) return;
      const n = Number(inp ? inp.value : 1); if (d.do === 'count' ? !(n >= 0) : !(n >= 1)) { gm.toast && gm.toast('Enter a number first.'); return; }
      await move(line, d.do, n); return;
    }
    switch (d.a) {
      case 'refresh': pull(); break;
      case 'more': S.limit += 100; body(); break;
      case 'all': S.limit = 1e9; body(); break;
      case 'undo': undo(); break;
      case 'close': closeModals(); break;
      case 'new': itemForm(null); break;
      case 'addscan': itemForm(null, d.code); break;
      case 'recent': S.moveLimit = 100; recent(); break;
      case 'recentmore': recent(true); break;
      case 'history': history(); break;
      case 'histmore': history(true); break;
      case 'edititem': { const e = S.idx.get(S.open); if (e) itemForm(e.it); break; }
      case 'addline': lineForm(null, S.open); break;
      case 'editline': { const l = S.stock.find(x => x.id === d.l); if (l) lineForm(l, l.item_id); break; }
      case 'back': openItem(d.item); break;
      case 'saveitem': {
        const f = { id: d.id || undefined, code: $('fiCode').value, vendor: $('fiVen').value, name: $('fiName').value, category: $('fiCat').value, min_qty: $('fiMin').value };
        const r = await gm.write(() => window.api.invSaveItem(f), null); if (!r) return; if (r.error) { $('fiMsg') && ($('fiMsg').textContent = r.error.replace(/^LOCKED: /, '')); return; }
        await pull(true); closeModals(); openItem(r.id); break;
      }
      case 'saveline': {
        const f = { id: d.id || undefined, item_id: d.item, label: $('flLabel').value, cost: $('flCost').value, location: $('flLoc').value, note: $('flNote').value, qty: $('flQty') ? $('flQty').value : 0 };
        const r = await gm.write(() => window.api.invSaveStock(f), null); if (!r) return; if (r.error) { $('flMsg') && ($('flMsg').textContent = r.error.replace(/^LOCKED: /, '')); return; }
        await pull(true); closeModals(); openItem(d.item); break;
      }
      case 'delline': { if (!t.dataset.armed) { t.dataset.armed = 1; t.textContent = 'Click again to delete'; break; } const r = await gm.write(() => window.api.invDelete('line', d.l), 'Line deleted.'); if (r && r.ok) { await pull(true); } break; }
      case 'delitem': { if (!t.dataset.armed) { t.dataset.armed = 1; t.textContent = 'Click again to delete'; break; } const id = S.open; const r = await gm.write(() => window.api.invDelete('item', id), 'Item deleted.'); if (r && r.ok) { closeModals(); await pull(true); } break; }
      case 'import': {
        if (!confirm('Load the starter list from your spreadsheet into the shared inventory? This only works while the inventory is empty.')) break;
        S.importing = true; body(); const r = await gm.write(() => window.api.invImport(), null); S.importing = false;
        if (r && r.ok) { gm.toast && gm.toast('Loaded ' + r.items + ' items and ' + r.lines + ' stock lines.'); } else if (r && r.error) { S.err = r.error.replace(/^LOCKED: /, ''); }
        await pull(true); break;
      }
    }
  }

  async function show() {
    if (window.__hideWork) window.__hideWork();
    ['main', '#custView', '#priceView'].forEach(sel => { const el = document.querySelector(sel); if (el) el.style.display = 'none'; });
    ['tabSearch', 'tabCust', 'tabPrice'].forEach(i => $(i) && $(i).classList.remove('on'));
    view.style.display = 'block'; $('tabInv').classList.add('on'); S.active = true;
    paint(); const st = await window.api.cloudStatus();
    if (!st.configured) { S.err = 'The shared database is not connected yet. Use File > Shared database connection, then come back here.'; S.loaded = true; paint(); return; }
    await pull(); const s = $('invScan'); if (s) s.focus();
  }
  const prevHide = window.__hideWork;
  window.__hideWork = () => { if (prevHide) prevHide(); if (view.style.display !== 'none') { view.style.display = 'none'; } $('tabInv').classList.remove('on'); S.active = false; closeModals(); };
  window.__showInventory = show; $('tabInv').onclick = show;
  setInterval(() => { if (S.active && !document.hidden && !document.querySelector('.invmodal')) pull(true); }, 60000);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.querySelector('.invmodal')) closeModals(); });
})();
