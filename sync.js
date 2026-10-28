// New-store order sync: Shopify Admin GraphQL -> local file. Runs in the main process only.
const fs = require('fs');
const path = require('path');
const API_VERSION = '2026-01';

const QUERY = `query($cursor:String,$q:String){
  orders(first:10, after:$cursor, query:$q, sortKey:UPDATED_AT){
    pageInfo{hasNextPage endCursor}
    nodes{
      id legacyResourceId name createdAt updatedAt cancelledAt displayFinancialStatus
      customer{ legacyResourceId firstName lastName defaultAddress{ company } }
      billingAddress{ name company }
      shippingLines(first:5){ nodes{ title originalPriceSet{ shopMoney{ amount } } } }
      lineItems(first:60){ pageInfo{hasNextPage} nodes{ name sku quantity originalUnitPriceSet{ shopMoney{ amount } } discountedTotalSet{ shopMoney{ amount } } } }
    }
  }
}`;

function normShop(s) {
  s = String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!s) return '';
  if (!s.includes('.')) s += '.myshopify.com';
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : '';
}

function makeSync({ dir, safeStorage, baseUrl }) {
  const secureFile = path.join(dir, 'secure', 'shopify.bin');
  const newFile = path.join(dir, 'data', 'new-store.json');
  const base = shop => baseUrl || ('https://' + shop);

  function loadCreds() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(secureFile)));
    } catch (e) { return null; }
  }
  function saveCreds(c) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer cannot encrypt saved passwords, so the connection was not saved.');
    fs.mkdirSync(path.dirname(secureFile), { recursive: true });
    fs.writeFileSync(secureFile, safeStorage.encryptString(JSON.stringify(c)));
  }
  function clearCreds() { try { fs.unlinkSync(secureFile); } catch (e) {} }
  function loadNew() {
    try { const j = JSON.parse(fs.readFileSync(newFile, 'utf8')); if (j && j.orders) return j; } catch (e) {}
    return { version: 1, shop: '', lastUpdated: '', syncedAt: '', orders: {} };
  }
  function saveNew(j) {
    fs.mkdirSync(path.dirname(newFile), { recursive: true });
    const tmp = newFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(j)); fs.renameSync(tmp, newFile);
  }

  async function getToken(c) {
    const r = await fetch(base(c.shop) + '/admin/oauth/access_token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret })
    });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) {}
    if (!r.ok || !j || !j.access_token) {
      const code = String((j && (j.error || j.errors)) || '').toLowerCase();
      const detail = ((j && (j.error_description || j.error)) || t.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).toString().slice(0, 200);
      let hint = 'Check the store address, Client ID and Client secret, and that the app is installed on the store.';
      if (/app_not_installed/.test(code + t)) hint = 'The app is not installed on THIS store yet. In the Dev Dashboard open the app, release a version, then click Install app and pick this store. Also double-check the store address.';
      else if (/shop_not_permitted/.test(code + t)) hint = 'The app and the store belong to different Shopify organizations. The Dev Dashboard account that created the app must be the one that owns this store.';
      else if (/invalid_client|invalid_request|unauthorized/.test(code + t.toLowerCase())) hint = 'The Client ID or Client secret was not accepted. Copy both again from the app\'s Settings page.';
      else if (r.status === 404 || /not found|no such shop|unavailable/i.test(t)) hint = 'Shopify could not find a store at that address. Use the store\'s .myshopify.com address from Settings > Domains in Shopify.';
      throw new Error('Shopify did not accept the connection (HTTP ' + r.status + (detail ? ': ' + detail : '') + '). ' + hint);
    }
    return j.access_token;
  }

  async function gql(c, token, variables, query) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = await fetch(base(c.shop) + '/admin/api/' + API_VERSION + '/graphql.json', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query: query || QUERY, variables })
      });
      if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 1500 * (attempt + 1))); continue; }
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) throw new Error('Shopify returned an error (HTTP ' + r.status + ').');
      if (j.errors && j.errors.length) {
        const msg = JSON.stringify(j.errors);
        if (/THROTTLED/i.test(msg)) { await new Promise(s => setTimeout(s, 2000 * (attempt + 1))); continue; }
        if (/access denied|not approved|protected customer/i.test(msg)) throw new Error((/product/i.test(msg) ? 'Shopify has not given this app permission to read products yet. In the Dev Dashboard add the read_products scope, release a new version, then approve the update on the store. Details: ' : 'Shopify denied access to some data: ') + (j.errors[0].message || msg) + ' (In the Dev Dashboard, check the app scopes and the protected customer data request.)');
        throw new Error('Shopify error: ' + (j.errors[0].message || msg));
      }
      return j.data;
    }
    throw new Error('Shopify kept asking us to slow down. Try again in a few minutes.');
  }

  const STATUS = { PAID: 0, PENDING: 1, AUTHORIZED: 1, PARTIALLY_PAID: 1, EXPIRED: 1, VOIDED: 2, REFUNDED: 3, PARTIALLY_REFUNDED: 4 };
  const num = x => { const n = parseFloat(x); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
  function localDate(iso) { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

  function convert(o) {
    const cu = o.customer || {}, ba = o.billingAddress || {};
    const cust = ([cu.firstName, cu.lastName].filter(Boolean).join(' ') || ba.name || '').trim();
    const co = (ba.company || (cu.defaultAddress && cu.defaultAddress.company) || '').trim();
    const status = o.cancelledAt ? 2 : (STATUS[o.displayFinancialStatus] !== undefined ? STATUS[o.displayFinancialStatus] : 5);
    const date = localDate(o.createdAt);
    const rows = [];
    for (const li of (o.lineItems && o.lineItems.nodes) || []) {
      const qty = li.quantity || 0, unit = num(li.originalUnitPriceSet && li.originalUnitPriceSet.shopMoney.amount);
      const total = num(li.discountedTotalSet && li.discountedTotalSet.shopMoney.amount);
      rows.push([date, String(li.name || '').trim(), qty, unit, total, unit > 0 ? 0 : 1, status]);
    }
    for (const sl of (o.shippingLines && o.shippingLines.nodes) || []) {
      const amt = num(sl.originalPriceSet && sl.originalPriceSet.shopMoney.amount);
      if (amt > 0) rows.push([date, String(sl.title || 'Shipping'), 1, amt, amt, 2, status]);
    }
    return { n: parseInt(String(o.name).replace(/\D/g, ''), 10) || 0, cust, co, custId: cu.legacyResourceId || '', rows,
      more: !!(o.lineItems && o.lineItems.pageInfo && o.lineItems.pageInfo.hasNextPage) };
  }

  const OQUERY = `query($q:String){
    orders(first:3, query:$q){ nodes{
      legacyResourceId name createdAt note cancelledAt displayFinancialStatus displayFulfillmentStatus
      customer{ firstName lastName defaultAddress{ company } }
      billingAddress{ name company }
      shippingLines(first:3){ nodes{ title } }
      currentTotalPriceSet{ shopMoney{ amount } }
      lineItems(first:60){ nodes{ name quantity sku } }
    } }
  }`;
  // Live lookup of one order by its number, straight from Shopify (works for orders newer than the last sync).
  async function lookupOrder(numStr) {
    const n = parseInt(String(numStr).replace(/\D/g, ''), 10);
    if (!n) throw new Error('Type the order number first.');
    const c = loadCreds();
    if (!c) throw new Error('Shopify is not connected yet.');
    const token = await getToken(c);
    const d = await gql(c, token, { q: 'name:#' + n }, OQUERY);
    const o = ((d.orders && d.orders.nodes) || []).find(x => parseInt(String(x.name).replace(/\D/g, ''), 10) === n);
    if (!o) return { found: false };
    const cu = o.customer || {}, ba = o.billingAddress || {};
    const cust = ([cu.firstName, cu.lastName].filter(Boolean).join(' ') || ba.name || '').trim();
    const co = (ba.company || (cu.defaultAddress && cu.defaultAddress.company) || '').trim();
    return { found: true, tag: 'New #' + n, cust, co, created: localDate(o.createdAt), note: o.note || '', cancelled: !!o.cancelledAt,
      paid: o.displayFinancialStatus || '', fulfillment: o.displayFulfillmentStatus || '',
      shipping: ((o.shippingLines && o.shippingLines.nodes) || []).map(x => x.title).filter(Boolean).join(', '),
      total: num(o.currentTotalPriceSet && o.currentTotalPriceSet.shopMoney.amount),
      items: ((o.lineItems && o.lineItems.nodes) || []).map(li => ({ name: String(li.name || '').trim(), qty: li.quantity || 0, sku: li.sku || '' })) };
  }

  async function sync() {
    const c = loadCreds();
    if (!c) throw new Error('Shopify is not connected yet. Use File > Shopify connection.');
    const token = await getToken(c);
    const store = loadNew();
    if (store.shop && store.shop !== c.shop) { store.orders = {}; store.lastUpdated = ''; }   // switched stores: start over
    store.shop = c.shop;
    const since = store.lastUpdated ? new Date(new Date(store.lastUpdated).getTime() - 10 * 60 * 1000).toISOString() : '';   // 10-minute overlap
    const q = since ? "updated_at:>'" + since + "'" : '';
    let cursor = null, changed = 0, seen = 0, maxUpdated = store.lastUpdated, partial = 0;
    for (;;) {
      const data = await gql(c, token, { cursor, q: q || null });
      const page = data.orders;
      for (const o of page.nodes) {
        seen++;
        const conv = convert(o); if (conv.more) partial++;
        const key = String(o.legacyResourceId);
        const prev = store.orders[key];
        if (!prev || JSON.stringify(prev) !== JSON.stringify(conv)) { store.orders[key] = conv; changed++; }
        if (o.updatedAt > (maxUpdated || '')) maxUpdated = o.updatedAt;
      }
      if (!page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.endCursor;
    }
    store.lastUpdated = maxUpdated || store.lastUpdated;
    store.syncedAt = new Date().toISOString();
    saveNew(store);
    return { seen, changed, total: Object.keys(store.orders).length, partial };
  }

  const PQUERY = `query($cursor:String){
    products(first:40, after:$cursor){
      pageInfo{hasNextPage endCursor}
      nodes{ legacyResourceId title handle status productType vendor
        variants(first:100){ nodes{ title sku price } } }
    }
  }`;
  const prodFile = path.join(dir, 'data', 'products.json');
  function loadProducts() { try { return JSON.parse(fs.readFileSync(prodFile, 'utf8')); } catch (e) { return { shop: '', syncedAt: '', products: [] }; } }
  async function syncProducts() {
    const c = loadCreds();
    if (!c) throw new Error('Shopify is not connected yet. Use File > Shopify connection.');
    const token = await getToken(c);
    const out = []; let cursor = null;
    for (let page = 0; page < 200; page++) {
      const d = await gql(c, token, { cursor }, PQUERY);
      const p = d.products;
      for (const n of p.nodes) out.push({ id: n.legacyResourceId, title: n.title, handle: n.handle, status: n.status, type: n.productType || '', vendor: n.vendor || '',
        variants: n.variants.nodes.map(v => ({ title: v.title === 'Default Title' ? '' : v.title, sku: v.sku || '', price: num(v.price) })) });
      if (!p.pageInfo.hasNextPage) break; cursor = p.pageInfo.endCursor;
    }
    const j = { shop: c.shop, syncedAt: new Date().toISOString(), products: out };
    fs.mkdirSync(path.dirname(prodFile), { recursive: true }); fs.writeFileSync(prodFile, JSON.stringify(j));
    return { count: out.length };
  }
  function status() {
    const c = loadCreds(), s = loadNew();
    return { configured: !!c, shop: c ? c.shop : '', syncedAt: s.syncedAt, orders: Object.keys(s.orders).length };
  }

  // Combine old-store data with synced new-store orders into the one shape the search screen uses.
  function merge(old) {
    const s = loadNew();
    const handle = (s.shop || '').replace(/\.myshopify\.com$/, '');
    const c = old.c.slice(), co = old.co.slice(), r = old.r.slice();
    const ci = new Map(c.map((v, i) => [v, i])), coi = new Map(co.map((v, i) => [v, i]));
    const idx = (v, arr, m) => { if (!m.has(v)) { m.set(v, arr.length); arr.push(v); } return m.get(v); };
    for (const [id, o] of Object.entries(s.orders)) {
      const a = idx(o.cust, c, ci), b = idx(o.co, co, coi);
      for (const x of o.rows) r.push([x[0], o.n, a, b, x[1], x[2], x[3], x[4], x[5], x[6], 1, id, o.custId]);
    }
    return { c, co, r, store: handle, newOrders: Object.keys(s.orders).length };
  }

  return { loadCreds, saveCreds, clearCreds, getToken, sync, lookupOrder, syncProducts, loadProducts, status, merge, normShop };
}
module.exports = { makeSync, normShop };
