// Customers tab: ranked value table, segments, and a detail panel. Uses CustLogic + window.__DATA__.
(function(){
  const D = window.__DATA__, L = window.CustLogic, $ = id => document.getElementById(id);
  const view = $('custView'), STORE = D.store || '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money = n => '$' + Math.round(n).toLocaleString();
  const money2 = n => '$' + (+n).toFixed(2);
  const pct = n => (n * 100).toFixed(1) + '%';
  let st = { mode: 'org', store: '', seg: '', from: '', fromM: '', to: '', toM: '', q: '', limit: 100, dLimit: {}, sort: 'revenue', dir: -1, sel: null, year: '', ov: {} };
  let agg = null, segs = null, built = false;
  const years = [...new Set(D.r.map(r => r[0].slice(0, 4)))].sort();

  function compute() {
    agg = L.aggregate(D, { mode: st.mode, store: st.store, from: st.from ? st.from + '-' + (st.fromM || '01') + '-01' : '', to: st.to ? st.to + '-' + (st.toM || '12') + '-31' : '', overrides: st.ov });
    segs = L.bySegment(agg);
  }
  function shell() {
    const yo = '<option value="">Any</option>' + years.map(y => '<option>' + y + '</option>').join('');
    const mo = '<option value="">Month</option>' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => '<option value="' + String(i + 1).padStart(2, '0') + '">' + m + '</option>').join('');
    view.innerHTML =
      '<h2 style="margin:0 0 8px;color:var(--navy)">Customer value</h2>' +
      '<div class="bar">' +
        '<label>Group by <select id="cMode"><option value="org">Organization / team (separate groups)</option><option value="parent">Parent organization (groups rolled up)</option><option value="cust">Contact person</option></select></label>' +
        '<label>Store <select id="cStore"><option value="">Old + New</option><option value="old">Old only</option><option value="new">New only</option></select></label>' +
        '<label>Segment <select id="cSeg"><option value="">All</option>' + L.SEGMENTS.map(s => '<option>' + esc(s) + '</option>').join('') + '</select></label>' +
        '<label>From <select id="cFromM">' + mo + '</select> <select id="cFrom">' + yo + '</select></label><label>To <select id="cToM">' + mo + '</select> <select id="cTo">' + yo + '</select></label>' +
        '<input id="cQ" type="search" placeholder="Find a customer…" style="min-width:200px">' +
      '</div>' +
      '<div class="kpis" id="cKpis"></div><div class="segs" id="cSegs"></div>' +
      '<div class="note">Revenue = item lines only (shipping, tax and fees left out), skipping voided and fully refunded orders. Segments are a best guess from the name; click a customer to correct one.</div>' +
      '<div id="cTable"></div><div class="detail" id="cDetail"></div>';
    $('cMode').onchange = e => { st.mode = e.target.value; st.sel = null; render(true); };
    $('cStore').onchange = e => { st.store = e.target.value; render(true); };
    $('cSeg').onchange = e => { st.seg = e.target.value; st.limit = 100; render(); };
    $('cFrom').onchange = e => { st.from = e.target.value; render(true); };
    $('cTo').onchange = e => { st.to = e.target.value; render(true); };
    $('cFromM').onchange = e => { st.fromM = e.target.value; if (!st.from && st.fromM) { st.from = years[years.length - 1]; $('cFrom').value = st.from; } render(true); };
    $('cToM').onchange = e => { st.toM = e.target.value; if (!st.to && st.toM) { st.to = years[years.length - 1]; $('cTo').value = st.to; } render(true); };
    $('cQ').oninput = e => { st.q = e.target.value; st.limit = 100; render(); };
    view.addEventListener('click', onClick);
  }
  function filtered() {
    const q = L.clean(st.q);
    let l = agg.list.filter(e => (!st.seg || e.segment === st.seg) && (!q || L.clean(e.name + ' ' + e.alsoKnownAs.join(' ') + ' ' + [...e.contacts].join(' ')).includes(q)));
    const k = st.sort, d = st.dir;
    l = l.slice().sort((a, b) => { const x = a[k], y = b[k]; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d; });
    return l;
  }
  function render(recompute) {
    if (recompute || !agg) { compute(); st.limit = 100; }
    const l = filtered(), top10 = agg.list.slice(0, 10).reduce((s, e) => s + e.revenue, 0);
    $('cKpis').innerHTML =
      '<div class="card">Total sales<b>' + money(agg.total) + '</b></div><div class="card">Customers<b>' + agg.list.length.toLocaleString() + '</b></div>' +
      '<div class="card">Top 10 share<b>' + pct(agg.total ? top10 / agg.total : 0) + '</b></div><div class="card">Median customer<b>' + money(L.median(agg.list.map(e => e.revenue))) + '</b></div>';
    $('cSegs').innerHTML = '<table><tr><th>Segment</th><th class="n">Customers</th><th class="n">Revenue</th><th class="n">Share</th><th class="n">Avg per customer</th></tr>' +
      segs.map(s => '<tr class="row" data-seg="' + esc(s.segment) + '"><td>' + esc(s.segment) + '</td><td class="n">' + s.customers.toLocaleString() + '</td><td class="n">' + money(s.revenue) + '</td><td class="n">' + pct(s.share) + '</td><td class="n">' + money(s.avg) + '</td></tr>').join('') + '</table>';
    const cols = [['rank', '#', 'n'], ['name', 'Customer', ''], ['segment', 'Segment', ''], ['revenue', 'Revenue', 'n'], ['share', 'Share', 'n'], ['nOrders', 'Orders', 'n'], ['avgOrder', 'Avg order', 'n'], ['first', 'First', ''], ['last', 'Last', '']];
    const shown = l.slice(0, st.limit);
    $('cTable').innerHTML = '<table><tr>' + cols.map(c => '<th class="' + c[2] + '" data-sort="' + c[0] + '">' + c[1] + (st.sort === c[0] ? (st.dir < 0 ? ' ▼' : ' ▲') : '') + '</th>').join('') + '</tr>' +
      shown.map(e => '<tr class="row" data-key="' + esc(e.key) + '"><td class="n">' + e.rank + '</td><td>' + esc(e.name) + '</td><td>' + esc(e.segment) + '</td><td class="n">' + money(e.revenue) + '</td><td class="n">' + pct(e.share) + '</td><td class="n">' + e.nOrders + '</td><td class="n">' + money(e.avgOrder) + '</td><td>' + e.first.slice(0, 7) + '</td><td>' + e.last.slice(0, 7) + '</td></tr>').join('') + '</table>' +
      (l.length > shown.length ? '<div class="note">Showing ' + shown.length + ' of ' + l.length.toLocaleString() + ' customers. <button class="btn" data-more="main">Show 100 more</button> <button class="btn" data-all="main">Show all ' + l.length.toLocaleString() + '</button></div>' : '');
    if (st.sel) detail(st.sel); else $('cDetail').style.display = 'none';
  }
  function adminUrl(kind, id) { return (STORE && id) ? 'https://admin.shopify.com/store/' + encodeURIComponent(STORE) + '/' + kind + '/' + encodeURIComponent(id) : ''; }
  function detail(key) {
    const e = agg.list.find(x => x.key === key), el = $('cDetail');
    if (!e) { el.style.display = 'none'; return; }
    if (st.sel !== key) st.year = '';
    st.sel = key;
    const yrs = [...e.years.entries()].sort(), mx = Math.max(1, ...yrs.map(y => y[1]));
    const yr = e.years.has(st.year) ? st.year : '';   // the year picked in the Revenue by year graph ('' = all years)
    const allItems = [...e.items.values()].map(i => { if (!yr) return i; const y = i.yr.get(yr); return y ? { item: i.item, qty: y.qty, revenue: y.revenue, prices: y.prices, lastPrice: y.lastPrice } : null; }).filter(Boolean).sort((a, b) => b.revenue - a.revenue), iLim = 12 + (st.dLimit['i' + key] || 0), items = allItems.slice(0, iLim);
    const bar = (id, shown, total) => shown >= total ? '' : '<div style="margin:8px 0"><button class="btn" data-dmore="' + id + '">Show 25 more</button> <button class="btn" data-dall="' + id + '">Show all ' + total + '</button></div>';
    const allOrds = [...e.orders.values()].filter(o => !yr || o.date.slice(0, 4) === yr).sort((a, b) => b.date.localeCompare(a.date)), oLim = 15 + (st.dLimit['o' + key] || 0), ords = allOrds.slice(0, oLim);
    el.innerHTML = '<button class="btn" data-close="1" style="float:right">Close</button><h2>' + esc(e.name) + '</h2>' +
      '<div class="note">' + (e.subList && e.subList.length > 1 ? 'Includes: ' + esc(e.subList.slice(0, 12).map(s => s.name + ' ' + money(s.revenue)).join('; ')) + (e.subList.length > 12 ? '; +' + (e.subList.length - 12) + ' more' : '') + '<br>' : '') + (e.alsoKnownAs.length ? 'Also entered as: ' + esc(e.alsoKnownAs.slice(0, 6).join('; ')) + '<br>' : '') + (e.contacts.size ? 'Contacts: ' + esc([...e.contacts].slice(0, 6).join(', ')) : '') + '</div>' +
      '<div class="kpis"><div class="card">Revenue' + (yr ? ' (' + yr + ')' : '') + '<b>' + money(yr ? e.years.get(yr) : e.revenue) + '</b></div><div class="card">Rank<b>#' + e.rank + '</b></div><div class="card">Orders' + (yr ? ' (' + yr + ')' : '') + '<b>' + (yr ? (e.yearOrders.get(yr) || new Set()).size : e.nOrders) + '</b></div><div class="card">Customer since<b>' + e.first.slice(0, 4) + '</b></div></div>' +
      '<label>Segment <select data-segsel="1">' + L.SEGMENTS.map(s => '<option' + (s === e.segment ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></label>' +
      '<h3>Revenue by year' + (yr ? ' <span class="yrnote">Showing ' + yr + ' only · <a class="yrclear" data-allyears="1">show all years</a></span>' : ' <span class="yrnote">Click a year to see just that year</span>') + '</h3><div class="bars" style="margin-bottom:24px">' + yrs.map(y => '<div class="yb' + (y[0] === yr ? ' sel' : '') + '" data-year="' + y[0] + '" title="' + y[0] + ': ' + money(y[1]) + '"><i class="ylab">' + money(y[1]) + '</i><div class="yfill" style="height:' + Math.max(2, y[1] / mx * 100) + '%"></div><span>' + y[0] + '</span></div>').join('') + '</div>' +
      '<h3>Top items</h3><table><tr><th>Item</th><th class="n">Qty</th><th class="n">Revenue</th><th class="n">Median price</th><th class="n">Last price</th></tr>' +
      items.map(i => '<tr><td>' + esc(i.item) + '</td><td class="n">' + i.qty + '</td><td class="n">' + money(i.revenue) + '</td><td class="n">' + money2(L.median(i.prices)) + '</td><td class="n">' + money2(i.lastPrice) + '</td></tr>').join('') + '</table>' + bar('i' + key, items.length, allItems.length) +
      '<h3>Recent orders</h3><table><tr><th>Date</th><th>Order</th><th class="n">Items total</th></tr>' +
      ords.map(o => { const u = o.src === 'new' ? adminUrl('orders', o.oid) : '', t = (o.src === 'new' ? 'New #' : 'Old #') + o.num; return '<tr><td>' + o.date + '</td><td>' + (u ? '<a class="ext" data-url="' + esc(u) + '">' + t + '</a>' : t) + '</td><td class="n">' + money2(o.total) + '</td></tr>'; }).join('') + '</table>' + bar('o' + key, ords.length, allOrds.length);
    el.style.display = 'block';
  }
  function onClick(ev) {
    const t = ev.target;
    if (t.closest('a.ext')) return;   // handled by the global link handler
    if (t.dataset && t.dataset.allyears) { st.year = ''; if (st.sel) { delete st.dLimit['i' + st.sel]; delete st.dLimit['o' + st.sel]; } if (st.sel) detail(st.sel); return; }
    const yb = t.closest('.yb[data-year]'); if (yb && st.sel) { st.year = st.year === yb.dataset.year ? '' : yb.dataset.year; delete st.dLimit['i' + st.sel]; delete st.dLimit['o' + st.sel]; detail(st.sel); return; }
    if (t.dataset && t.dataset.close) { st.sel = null; $('cDetail').style.display = 'none'; return; }
    if (t.dataset && t.dataset.more === 'main') { st.limit += 100; render(); return; }
    if (t.dataset && t.dataset.all === 'main') { st.limit = 1e9; render(); return; }
    if (t.dataset && t.dataset.dmore) { st.dLimit[t.dataset.dmore] = (st.dLimit[t.dataset.dmore] || 0) + 25; if (st.sel) detail(st.sel); return; }
    if (t.dataset && t.dataset.dall) { st.dLimit[t.dataset.dall] = 1e9; if (st.sel) detail(st.sel); return; }
    const th = t.closest('th[data-sort]');
    if (th) { const k = th.dataset.sort; if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = (k === 'name' || k === 'segment' || k === 'rank') ? 1 : -1; } render(); return; }
    const sg = t.closest('tr[data-seg]'); if (sg) { st.seg = sg.dataset.seg; $('cSeg').value = st.seg; render(); return; }
    const rw = t.closest('tr[data-key]'); if (rw) { detail(rw.dataset.key); }
  }
  view.addEventListener('change', async ev => {
    if (!ev.target.dataset || !ev.target.dataset.segsel || !st.sel) return;
    st.ov[st.sel] = ev.target.value; await window.api.saveSegments(st.ov); render(true);
  });
  async function show(which) {
    if (window.__hideWork) window.__hideWork();
    const c = which === 'cust';
    document.querySelector('main').style.display = c ? 'none' : '';
    view.style.display = c ? 'block' : 'none';
    if (c || which === 'search') $('priceView').style.display = 'none';
    $('tabPrice').classList.remove('on');
    $('tabSearch').classList.toggle('on', !c); $('tabCust').classList.toggle('on', c);
    if (c && !built) { try { st.ov = await window.api.getSegments() || {}; } catch (e) {} shell(); built = true; render(true); }
  }
  $('tabSearch').onclick = () => show('search'); $('tabCust').onclick = () => show('cust');
})();
