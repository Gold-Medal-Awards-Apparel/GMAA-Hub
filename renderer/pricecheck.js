// Price Check tab: what customers paid (old + new store orders) vs. what the store charges now (Shopify products).
(function(){
  const D = window.__DATA__, L = window.CustLogic, $ = id => document.getElementById(id);
  const view = $('priceView'), STORE = D.store || '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const m2 = n => '$' + (+n).toFixed(2);
  const med = L.median;
  let products = { products: [], syncedAt: '' }, built = false, busy = false;

  function ago(iso) {
    if (!iso) return 'never';
    const h = Math.round((Date.now() - new Date(iso)) / 3600000);
    return h < 1 ? 'just now' : h < 48 ? h + ' hr ago' : Math.round(h / 24) + ' days ago';
  }
  function shell() {
    view.innerHTML =
      '<h2 style="margin:0 0 6px;color:var(--navy)">Price check</h2>' +
      '<form class="searchbox" id="pForm" autocomplete="off" style="margin-bottom:6px"><input id="pQ" type="search" placeholder="What are you pricing? e.g.  mhs cc shirts, 29m heat press, engraved medal" autofocus><button class="btn primary" type="submit">Check</button></form>' +
      '<div class="note" id="pStatus"></div><div id="pOut"></div>';
    $('pForm').onsubmit = e => { e.preventDefault(); run(); };
    $('pQ').addEventListener('input', () => { clearTimeout(shell.t); shell.t = setTimeout(run, 450); });
    view.addEventListener('click', e => {
      const t = e.target;
      if (t.id === 'pSync') syncProducts();
      else if (t.dataset.is) { ps.iDir = ps.iSort === t.dataset.is ? -ps.iDir : (t.dataset.is === 'item' ? 1 : -1); ps.iSort = t.dataset.is; drawItems(); }
      else if (t.dataset.ps) { ps.pDir = ps.pSort === t.dataset.ps ? -ps.pDir : (t.dataset.ps === 'price' ? -1 : 1); ps.pSort = t.dataset.ps; drawProds(); }
      else if (t.dataset.more) { if (t.dataset.more === 'i') ps.iLimit += 25; else ps.pLimit += 25; drawItems(); drawProds(); }
      else if (t.dataset.all) { if (t.dataset.all === 'i') ps.iLimit = 1e9; else ps.pLimit = 1e9; drawItems(); drawProds(); }
    });
    status();
  }
  function status(extra) {
    const n = products.products.length;
    $('pStatus').innerHTML = (n ? 'Store catalog: ' + n.toLocaleString() + ' products, updated ' + ago(products.syncedAt) + '. ' : 'Store catalog not loaded yet. ') +
      '<button class="btn" id="pSync"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Updating…' : 'Update store prices') + '</button> ' + (extra ? '<b>' + esc(extra) + '</b>' : '') +
      '<br>"Paid" figures use item lines only from orders that were not voided or refunded. Recent = last 2 years.';
  }
  async function syncProducts() {
    if (busy) return; busy = true; status();
    const r = await window.api.syncProducts(); busy = false;
    if (r.error) { status(r.error); return; }
    products = r.data; status('Updated.'); run();
  }
  function bucket(q) { return q <= 1 ? '1' : q <= 5 ? '2–5' : q <= 11 ? '6–11' : q <= 23 ? '12–23' : '24+'; }
  const BUCKETS = ['1', '2–5', '6–11', '12–23', '24+'];

  function run() {
    const text = $('pQ').value.trim(), out = $('pOut');
    if (!text) { out.innerHTML = ''; return; }
    const { rows, parsed } = matchRows(text);
    if (!parsed.units.length) { out.innerHTML = ''; return; }
    const cutoff = (new Date().getFullYear() - 2) + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-01';
    const items = new Map(), all = [], recent = [], tiers = {}, byYear = new Map();
    for (const i of rows) {
      const r = D.r[i], p = r[6], q = Math.max(1, r[5] || 1);
      all.push(p); if (r[0] >= cutoff) recent.push(p);
      const y = r[0].slice(0, 4); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(p);
      const b = bucket(q); (tiers[b] = tiers[b] || []).push(p);
      const k = L.clean(r[4]); let it = items.get(k);
      if (!it) { it = { name: r[4], prices: [], qty: 0, last: r[0], lastPrice: p, orders: new Set() }; items.set(k, it); }
      it.prices.push(p); it.qty += q; it.orders.add(r[1] + ':' + r[10]);
      if (r[0] >= it.last) { it.last = r[0]; it.lastPrice = p; }
    }
    // current store products matching the same words
    const matched = [];
    for (const pr of products.products) {
      if (pr.status === 'ARCHIVED') continue;
      const hay = ' ' + norm(pr.title + ' ' + pr.type + ' ' + pr.variants.map(v => v.title + ' ' + v.sku).join(' ')) + ' ';
      if (parsed.units.every(u => u.variants.some(v => hit(hay, v)))) matched.push(pr);
    }
    const storePrices = []; matched.forEach(pr => pr.variants.forEach(v => { if (v.price > 0) storePrices.push(v.price); }));
    let html = '';
    if (!rows.length) html += '<div class="card">Nothing in the order history matches "' + esc(text) + '". Try fewer words or a known abbreviation.</div>';
    else {
      const basis = recent.length >= 3 ? recent : all, basisLbl = recent.length >= 3 ? 'the last 2 years' : 'all years (little recent data)';
      html += '<div class="kpis"><div class="card">Times sold<b>' + rows.length.toLocaleString() + '</b></div>' +
        '<div class="card">Median paid (recent)<b>' + m2(med(basis)) + '</b></div>' +
        '<div class="card">Range (recent)<b>' + m2(Math.min(...basis)) + ' – ' + m2(Math.max(...basis)) + '</b></div>' +
        '<div class="card">Median paid (all time)<b>' + m2(med(all)) + '</b></div></div>';
      if (storePrices.length) {
        const sm = med(storePrices), bm = med(basis), diff = (sm - bm) / bm;
        const word = Math.abs(diff) < 0.03 ? 'about the same as' : diff > 0 ? 'higher than' : 'lower than';
        html += '<div class="card" style="margin-bottom:12px;border-left:5px solid ' + (Math.abs(diff) < 0.03 ? 'var(--navy2)' : diff > 0 ? 'var(--accent)' : 'var(--ribbon)') + '">Store prices now (median ' + m2(sm) + ') are <b>' + word + '</b> what customers paid over ' + basisLbl + ' (median ' + m2(bm) + ')' + (Math.abs(diff) < 0.03 ? '.' : ': ' + (diff > 0 ? '+' : '') + (diff * 100).toFixed(0) + '%.') + ' Rough guide only — the matches may include different items.</div>';
      } else if (products.products.length) html += '<div class="note">No current store product matches these words, so there is nothing to compare against.</div>';
      html += '<h3>What customers paid, by item</h3><div id="pItems"></div>';
      html += '<h3>Median unit price by quantity</h3><table><tr><th>Quantity on the line</th>' + BUCKETS.map(b => '<th class="n">' + b + '</th>').join('') + '</tr><tr><td>Median each</td>' + BUCKETS.map(b => '<td class="n">' + (tiers[b] ? m2(med(tiers[b])) + ' <span style="color:var(--muted)">(' + tiers[b].length + ')</span>' : '—') + '</td>').join('') + '</tr></table>';
      const ys = [...byYear.keys()].sort();
      html += '<h3>Median price by year</h3><table><tr><th>Year</th>' + ys.map(y => '<th class="n">' + y + '</th>').join('') + '</tr><tr><td>Median each</td>' + ys.map(y => '<td class="n">' + m2(med(byYear.get(y))) + '</td>').join('') + '</tr><tr><td>Times sold</td>' + ys.map(y => '<td class="n">' + byYear.get(y).length + '</td>').join('') + '</tr></table>';
    }
    if (products.products.length) {
      html += '<h3>In the store now (' + matched.length + ' product' + (matched.length === 1 ? '' : 's') + ')</h3>';
      if (matched.length) {
        html += '<div id="pProds"></div>';
      } else html += '<div class="note">No active product in the store matches these words.</div>';
    }
    out.innerHTML = html;
    cur = { items: [...items.values()].map(it => ({ it, orders: it.orders.size, low: Math.min(...it.prices), med: med(it.prices), high: Math.max(...it.prices) })), matched };
    ps.iLimit = 25; ps.pLimit = 40;
    drawItems(); drawProds();
  }
  const ps = { iSort: 'orders', iDir: -1, iLimit: 25, pSort: '', pDir: 1, pLimit: 40 };
  let cur = { items: [], matched: [] };
  const arrow = (a, b, d) => a === b ? (d < 0 ? ' ▼' : ' ▲') : '';
  function moreBar(shown, total, id) {
    return shown >= total ? '' : '<div style="margin:8px 0"><button class="btn" data-more="' + id + '">Show 25 more</button> <button class="btn" data-all="' + id + '">Show all ' + total.toLocaleString() + '</button> <span class="note" style="display:inline">Showing ' + shown.toLocaleString() + ' of ' + total.toLocaleString() + '</span></div>';
  }
  function drawItems() {
    const el = $('pItems'); if (!el) return;
    const k = ps.iSort, d = ps.iDir;
    const key = { item: x => x.it.name.toLowerCase(), orders: x => x.orders, qty: x => x.it.qty, low: x => x.low, med: x => x.med, high: x => x.high, last: x => x.it.last }[k];
    const l = cur.items.slice().sort((a, b) => { const A = key(a), B = key(b); return (A < B ? -1 : A > B ? 1 : 0) * d || b.orders - a.orders; });
    const shown = l.slice(0, ps.iLimit);
    const th = (c, label, n) => '<th class="sortable' + (n ? ' n' : '') + '" data-is="' + c + '" style="cursor:pointer">' + label + arrow(k, c, d) + '</th>';
    el.innerHTML = '<table><tr>' + th('item', 'Item as sold') + th('orders', 'Orders', 1) + th('qty', 'Qty', 1) + th('low', 'Low', 1) + th('med', 'Median', 1) + th('high', 'High', 1) + th('last', 'Last paid', 1) + '</tr>' +
      shown.map(x => '<tr><td>' + esc(x.it.name) + '</td><td class="n">' + x.orders + '</td><td class="n">' + x.it.qty + '</td><td class="n">' + m2(x.low) + '</td><td class="n">' + m2(x.med) + '</td><td class="n">' + m2(x.high) + '</td><td class="n">' + m2(x.it.lastPrice) + ' <span style="color:var(--muted)">' + x.it.last.slice(0, 7) + '</span></td></tr>').join('') + '</table>' + moreBar(shown.length, l.length, 'i');
  }
  function drawProds() {
    const el = $('pProds'); if (!el) return;
    const flat = []; cur.matched.forEach(pr => pr.variants.forEach((v, j) => flat.push({ pr, v, first: j === 0 })));
    const k = ps.pSort, d = ps.pDir;
    if (k) { const key = { product: x => x.pr.title.toLowerCase(), option: x => String(x.v.title).toLowerCase(), sku: x => String(x.v.sku || '').toLowerCase(), price: x => x.v.price }[k];
      flat.sort((a, b) => { const A = key(a), B = key(b); return (A < B ? -1 : A > B ? 1 : 0) * d; }); }
    const shown = flat.slice(0, ps.pLimit);
    const th = (c, label, n) => '<th class="sortable' + (n ? ' n' : '') + '" data-ps="' + c + '" style="cursor:pointer">' + label + arrow(k, c, d) + '</th>';
    el.innerHTML = '<table><tr>' + th('product', 'Product') + th('option', 'Option') + th('sku', 'SKU') + th('price', 'Price', 1) + '</tr>' + shown.map(x => {
      const pr = x.pr, u = STORE && pr.id ? 'https://admin.shopify.com/store/' + encodeURIComponent(STORE) + '/products/' + encodeURIComponent(pr.id) : '';
      const name = (x.first || k) ? (u ? '<a class="ext" data-url="' + esc(u) + '">' + esc(pr.title) + '</a>' : esc(pr.title)) + (pr.status !== 'ACTIVE' ? ' <span style="color:var(--muted)">(' + pr.status.toLowerCase() + ')</span>' : '') : '';
      return '<tr><td>' + name + '</td><td>' + esc(x.v.title) + '</td><td>' + esc(x.v.sku) + '</td><td class="n">' + m2(x.v.price) + '</td></tr>'; }).join('') + '</table>' + moreBar(shown.length, flat.length, 'p');
  }
  async function show(which) {
    if (window.__hideWork) window.__hideWork();
    const p = which === 'price';
    view.style.display = p ? 'block' : 'none';
    if (p) { document.querySelector('main').style.display = 'none'; $('custView').style.display = 'none'; }
    $('tabPrice').classList.toggle('on', p); if (p) { $('tabSearch').classList.remove('on'); $('tabCust').classList.remove('on'); }
    if (p && !built) {
      built = true; try { products = await window.api.getProducts(); } catch (e) {}
      shell();
      if (!products.products.length || (Date.now() - new Date(products.syncedAt)) > 24 * 3600e3) { const st = await window.api.shopifyStatus(); if (st.configured) syncProducts(); }
    }
    if (p) $('pQ') && $('pQ').focus();
  }
  window.__showPrice = show;
  $('tabPrice').onclick = () => show('price');
})();
