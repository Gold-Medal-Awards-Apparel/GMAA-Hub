// Supplier price lists (JDS, PDU, ...): import a CSV/Excel price list once, search it from every computer.
// Main process only. The lists are stored in the shared Cloudflare database in chunks (never in the app files or on GitHub),
// each computer keeps a local copy and searches it in memory. Searching needs a PIN sign-in; importing needs an admin.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------- file readers (no outside libraries) ----------------
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], f = '', q = false, i = 0; const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += ch; i++; continue;
    }
    if (ch === '"') { q = true; i++; continue; }
    if (ch === ',') { row.push(f); f = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; continue; }
    f += ch; i++;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function unzip(buf) {   // minimal .zip reader (enough for .xlsx): returns Map(name -> Buffer)
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('This does not look like an Excel (.xlsx) file.');
  const count = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = new Map();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const ln = buf.readUInt16LE(off + 26), lx = buf.readUInt16LE(off + 28), start = off + 30 + ln + lx;
    const data = buf.subarray(start, start + csize);
    if (/\.(xml|rels)$/i.test(name)) out.set(name, method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data));
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
const unxml = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, g) => {
  g = g.toLowerCase();
  if (g === 'amp') return '&'; if (g === 'lt') return '<'; if (g === 'gt') return '>'; if (g === 'quot') return '"'; if (g === 'apos') return "'";
  const c = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10); try { return String.fromCodePoint(c); } catch (e) { return ''; }
});
const textOf = xml => { let s = ''; xml = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, ''); const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let m; while ((m = re.exec(xml))) s += unxml(m[1]); return s; };
const colNo = ref => { let n = 0; for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

function parseXlsx(buf) {   // first worksheet -> array of rows (arrays of strings/numbers)
  const z = unzip(buf), get = n => z.has(n) ? z.get(n).toString('utf8') : '';
  const shared = []; const ss = get('xl/sharedStrings.xml');
  if (ss) { const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g; let m; while ((m = re.exec(ss))) shared.push(m[1] ? textOf(m[1]) : ''); }
  let target = '';
  const wb = get('xl/workbook.xml'), rels = get('xl/_rels/workbook.xml.rels');
  const sh = /<sheet\b[^>]*?r:id="([^"]+)"/.exec(wb);
  if (sh) { const rr = new RegExp('<Relationship\\b[^>]*?Id="' + sh[1] + '"[^>]*?>').exec(rels); const t = rr && /Target="([^"]+)"/.exec(rr[0]); if (t) target = t[1].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/'); }
  if (!target || !z.has(target)) target = [...z.keys()].filter(k => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k)).sort()[0];
  if (!target) throw new Error('No worksheet found in that Excel file.');
  const xml = get(target), rows = []; const rre = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g; let rm;
  while ((rm = rre.exec(xml))) {
    const row = []; if (rm[1]) {
      const cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
      while ((cm = cre.exec(rm[1]))) {
        const at = cm[1], ref = /\br="([A-Z]+\d+)"/.exec(at), ty = (/\bt="([^"]+)"/.exec(at) || [])[1], body = cm[2] || '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body); let val = '';
        if (ty === 's') val = v ? (shared[+v[1]] || '') : '';
        else if (ty === 'inlineStr') val = textOf(body);
        else if (ty === 'str') val = v ? unxml(v[1]) : '';
        else if (ty === 'b') val = v && v[1] === '1' ? 'TRUE' : 'FALSE';
        else if (ty === 'e') val = '';
        else if (v && v[1] !== '') { const num = Number(v[1]); val = Number.isFinite(num) ? num : unxml(v[1]); }
        const ci = ref ? colNo(ref[1]) : row.length; while (row.length < ci) row.push(''); row[ci] = val;
      }
    }
    rows.push(row);
  }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}
function readTable(file) {
  const buf = fs.readFileSync(file);
  if (/\.xlsx$/i.test(file)) return parseXlsx(buf);
  if (/\.(csv|txt)$/i.test(file)) return parseCsv(buf.toString('utf8'));
  throw new Error('Please choose a .csv or .xlsx price list.');
}

// ---------------- turning a table into catalog records ----------------
const norm = s => String(s == null ? '' : s).trim();
const lc = s => norm(s).toLowerCase();
function toNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const s = norm(v).replace(/[$,\s]/g, ''); if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s); return n > 0 ? n : null;
}
function toDate(v) {
  if (typeof v === 'number') { if (v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10); return ''; }
  const s = norm(v); let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'); }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? m[0].slice(0, 10) : '';
}
const dateFromName = name => {
  let m = /(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})/.exec(name); if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = /(\d{1,2})[-_.](\d{1,2})[-_.](\d{2,4})(?!\d)/.exec(name); if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  return '';
};
const find = (hs, ...names) => { for (const n of names) { const i = hs.indexOf(n); if (i >= 0) return i; } return -1; };

// Recognises the two layouts we know; anything else gets a best guess the person can correct.
function detect(headers, fileName) {
  const hs = headers.map(lc), M = (o) => Object.assign({ supplier: '', listDate: dateFromName(fileName || ''), sku: -1, desc: -1, size: -1, pack: -1, page: -1, catalog: -1, prev: -1, change: -1, prices: [] }, o);
  if (hs.includes('sku') && hs.includes('name') && hs.includes('price each') && hs.includes('price break 1')) {
    return { known: 'JDS', mapping: M({ supplier: 'JDS', sku: hs.indexOf('sku'), desc: hs.indexOf('name'), pack: hs.indexOf('case qty'), page: hs.indexOf('pages'), catalog: hs.indexOf('catalog'), prev: hs.indexOf('previous price'), change: hs.indexOf('last price change date'),
      prices: [['Less than case', 'price each'], ['1 case', 'price break 1'], ['5 cases', 'price break 2'], ['10 cases', 'price break 3']].map(([label, h]) => ({ label, col: hs.indexOf(h) })) }) };
  }
  if (hs.includes('part#') && hs.includes('description') && hs.includes('less case') && hs.includes('1 case')) {
    return { known: 'PDU', mapping: M({ supplier: 'PDU', sku: hs.indexOf('part#'), desc: hs.indexOf('description'), size: hs.indexOf('size'), pack: hs.indexOf('std pk'), page: hs.indexOf('page'),
      prices: [['Less than case', 'less case'], ['1 case', '1 case'], ['5 cases', '5 case'], ['Buyers Club', 'buyers club']].map(([label, h]) => ({ label, col: hs.indexOf(h) })).filter(p => p.col >= 0) }) };
  }
  if (hs.includes('product') && hs.includes('description') && hs.includes('price 1') && hs.includes('qty brk')) {
    const pcs = [], qb = []; hs.forEach((h, i) => { if (/^qty brk$/.test(h)) qb.push(i); });
    ['price 1', 'price 2', 'price 3', 'price 4'].forEach((h, k) => { const col = hs.indexOf(h); if (col >= 0) pcs.push({ label: k === 0 ? 'Each' : 'Break ' + k, col, brk: k > 0 && qb[k - 1] != null ? qb[k - 1] : -1 }); });
    return { known: 'Marco', mapping: M({ supplier: 'Marco', sku: hs.indexOf('product'), desc: hs.indexOf('description'), size: hs.indexOf('description 2'), page: hs.indexOf('page'), prices: pcs }) };
  }
  const pr = []; headers.forEach((h, i) => { if (/price|cost|each|case|break|club|net|list/i.test(h) && !/previous|prev|date|qty|quantity|pk|pack|page/i.test(h)) pr.push({ label: norm(h), col: i }); });
  return { known: '', mapping: M({ sku: find(hs, 'sku', 'part#', 'part #', 'part number', 'item number', 'item #', 'item', 'style', 'code', 'number'), desc: find(hs, 'description', 'name', 'title', 'product', 'item name'), size: find(hs, 'size'),
    pack: find(hs, 'case qty', 'std pk', 'pack', 'pack qty', 'case', 'qty'), page: find(hs, 'page', 'pages'), catalog: find(hs, 'catalog'), prev: find(hs, 'previous price'), change: find(hs, 'last price change date', 'price change date'), prices: pr.slice(0, 6) }) };
}

// record = [sku, description, size, pack, page, catalog, [prices], previousPrice, changeDate]
function buildRecords(rows, m) {
  const out = [], cell = (r, c) => c >= 0 && c < r.length ? r[c] : '';
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i], sku = norm(cell(r, m.sku)), desc = norm(cell(r, m.desc)); if (!sku && !desc) continue;
    const page = norm(cell(r, m.page)).replace(/\.0+$/, ''), pk = toNum(cell(r, m.pack));
    out.push([sku, desc, norm(cell(r, m.size)), pk ? Math.round(pk) : null, page && page !== '0' ? page : '', norm(cell(r, m.catalog)).replace(/^0$/, ''), m.prices.map(p => toNum(cell(r, p.col))), toNum(cell(r, m.prev)), toDate(cell(r, m.change))].concat(m.prices.some(p => p.brk >= 0) ? [m.prices.map(p => p.brk >= 0 ? toNum(cell(r, p.brk)) : null)] : []));
  }
  return out;
}
function chunkRecords(recs, maxChars) {
  const chunks = []; let cur = [], len = 2;
  for (const r of recs) { const s = JSON.stringify(r); if (cur.length && len + s.length + 1 > maxChars) { chunks.push(JSON.stringify(cur)); cur = []; len = 2; } cur.push(r); len += s.length + 1; }
  if (cur.length) chunks.push(JSON.stringify(cur));
  return chunks;
}

// ---------------- searching ----------------
const alnum = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function wordStart(hay, tok) { let i = hay.indexOf(tok); while (i >= 0) { if (i === 0 || !/[a-z0-9]/.test(hay[i - 1])) return true; i = hay.indexOf(tok, i + 1); } return false; }
function indexSupplier(records) {
  return records.map(r => ({ skuN: alnum(r[0]), hay: (r[0] + ' ' + r[1] + ' ' + r[2]).toLowerCase() }));
}
function searchIn(sup, q, limit, max) {   // sup = { name, meta, records, idx }
  const toks = String(q).toLowerCase().replace(/["“”]/g, '').split(/[\s,;]+/).filter(Boolean); if (!toks.length) return [];
  const whole = alnum(q), tn = toks.map(alnum); const hits = [];
  for (let i = 0; i < sup.records.length; i++) {
    const ix = sup.idx[i]; let score = 0, ok = true;
    for (let t = 0; t < toks.length; t++) {
      if (tn[t] && ix.skuN.startsWith(tn[t])) score += 40 - Math.min(30, ix.skuN.length - tn[t].length);
      else if (tn[t] && ix.skuN.includes(tn[t]) && tn[t].length >= 3) score += 12;
      else if (wordStart(ix.hay, toks[t])) score += 6;
      else { ok = false; break; }
    }
    if (!ok) continue;
    if (whole && ix.skuN === whole) score += 10000; else if (whole && ix.skuN.startsWith(whole)) score += 500 - Math.min(400, ix.skuN.length);
    hits.push([score, i]);
  }
  hits.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return hits;
}

function makeCatalog(ctx) {
  const { need, ensure, query, actor, newId, str, dir } = ctx;
  const cacheFile = path.join(dir, 'data', 'catalog-cache.json');
  let pending = null, mem = null, lastSync = 0;   // mem = Map(lowercase name -> { meta, records, idx })

  function loadMem() {
    if (mem) return;
    mem = new Map();
    try {
      const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      for (const s of j.suppliers || []) { const recs = (j.data || {})[s.name] || []; mem.set(s.name.toLowerCase(), { meta: s, records: recs, idx: indexSupplier(recs) }); }
    } catch (e) {}
  }
  function saveMem() {
    try {
      const j = { at: new Date().toISOString(), suppliers: [], data: {} };
      for (const s of mem.values()) { j.suppliers.push(s.meta); j.data[s.meta.name] = s.records; }
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(j));
    } catch (e) {}
  }
  const metaOut = m => ({ name: m.name, list_date: m.list_date, labels: m.labels, n: m.n, updated_at: m.updated_at, updated_by: m.updated_by, file_name: m.file_name });
  const rowToMeta = r => ({ name: r.name, list_date: r.list_date, labels: JSON.parse(r.labels || '[]'), n: r.n, gen: r.gen, updated_at: r.updated_at, updated_by: r.updated_by, file_name: r.file_name });

  // Brings this computer's copy up to date with the shared database (only downloads lists that changed).
  async function sync(force) {
    loadMem(); const c = need(); await ensure(c);
    const rows = (await query(c, 'SELECT * FROM cat_suppliers ORDER BY name COLLATE NOCASE')).rows; let changed = false; const seen = new Set();
    for (const r of rows) {
      const meta = rowToMeta(r), key = meta.name.toLowerCase(); seen.add(key); const have = mem.get(key);
      if (!force && have && have.meta.gen === meta.gen && have.meta.updated_at === meta.updated_at) continue;
      const recs = []; let off = 0;
      for (;;) {
        const part = (await query(c, 'SELECT data FROM cat_chunks WHERE supplier=? AND gen=? ORDER BY idx LIMIT 12 OFFSET ?', [meta.name, meta.gen, off])).rows;
        for (const p of part) for (const x of JSON.parse(p.data)) recs.push(x);
        if (part.length < 12) break; off += 12;
      }
      mem.set(key, { meta, records: recs, idx: indexSupplier(recs) }); changed = true;
    }
    for (const k of [...mem.keys()]) if (!seen.has(k)) { mem.delete(k); changed = true; }
    if (changed) saveMem();
    lastSync = Date.now(); return changed;
  }

  async function status() {
    const c = need(); await ensure(c); await actor(c);   // PIN sign-in needed once PINs exist
    loadMem(); let offline = false, err = '';
    try { if (Date.now() - lastSync > 60000 || !mem.size) await sync(false); } catch (e) { if (e.locked) throw e; offline = !!e.offline; err = e.message; }
    return { suppliers: [...mem.values()].map(s => metaOut(s.meta)), offline, error: mem.size ? '' : err };
  }
  const toRow = (s, r) => ({ sku: r[0], supplier: s.meta.name, desc: r[1], size: r[2], pack: r[3], page: r[4], catalog: r[5], prices: r[6], prev: r[7], change: r[8], brks: r[9] || null, labels: s.meta.labels, listDate: s.meta.list_date });
  async function search(opts) {
    const c = need(); await ensure(c); await actor(c);
    loadMem(); const q = String((opts && opts.q) || '').trim(), only = String((opts && opts.supplier) || '').toLowerCase(), limit = Math.max(1, Math.min(1000, +(opts && opts.limit) || 100));
    if (!q && opts && opts.recent) {   // nothing typed: the latest price changes on file, newest first (fills the Catalog page)
      const only2 = only, list = [];
      for (const s of mem.values()) { if (only2 && s.meta.name.toLowerCase() !== only2) continue; for (const r of s.records) { const p0 = r[6].find(x => x != null); if (r[8] && r[7] != null && p0 != null && Math.abs(p0 - r[7]) > 0.004) list.push([r[8], Math.abs(p0 - r[7]) / r[7], s, r]); } }
      list.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0) || b[1] - a[1]);
      return { total: list.length, rows: list.slice(0, limit).map(x => toRow(x[2], x[3])), recent: true };
    }
    if (!q) return { total: 0, rows: [] };
    let all = [];
    for (const s of mem.values()) { if (only && s.meta.name.toLowerCase() !== only) continue; for (const h of searchIn(s, q)) all.push([h[0], s, h[1]]); }
    all.sort((a, b) => b[0] - a[0] || (a[1].meta.name < b[1].meta.name ? -1 : 1) || a[2] - b[2]);
    const rows = all.slice(0, limit).map(([, s, i]) => toRow(s, s.records[i]));
    return { total: all.length, rows };
  }

  // ---- importing (admin) ----
  async function pick(file) {
    let rows = readTable(file); if (rows.length < 2) return { error: 'That file has no rows to import.' };
    let titleDate = ''; const hi = rows.slice(0, 10).findIndex(r => r.filter(c => norm(c) !== '').length >= 4);   // skip a title line above the headings
    if (hi > 0) { titleDate = toDate(((/\d{1,2}\/\d{1,2}\/\d{2,4}/.exec(rows.slice(0, hi).map(r => r.join(' ')).join(' ')) || [''])[0])); rows = rows.slice(hi); }
    const headers = rows[0].map(norm), name = path.basename(file); const d = detect(headers, name);
    const token = newId(); pending = { token, rows, name }; if (!d.mapping.listDate && titleDate) d.mapping.listDate = titleDate;
    if (!d.mapping.supplier) d.mapping.supplier = name.replace(/\.[^.]+$/, '').replace(/[-_ ]*\d{1,4}[-_.]\d{1,2}[-_.]\d{1,4}[-_ ]*/g, ' ').replace(/[_]+/g, ' ').trim().slice(0, 40);
    return { token, fileName: name, count: rows.length - 1, headers, sample: rows.slice(1, 5).map(r => headers.map((h, i) => r[i] == null ? '' : r[i])), known: d.known, mapping: d.mapping };
  }
  async function importPending(token, mapping, progress) {
    const c = need(); await ensure(c); const by = await actor(c, { admin: true });
    if (!pending || pending.token !== token) return { error: 'Please choose the file again.' };
    const m = mapping || {}; const name = str(m.supplier, 40).trim();
    if (!name) return { error: 'Type the supplier name (for example JDS).' };
    if (!(m.sku >= 0)) return { error: 'Pick which column holds the product number (SKU).' };
    if (!(m.desc >= 0)) return { error: 'Pick which column holds the description.' };
    const prices = (m.prices || []).filter(p => p && p.col >= 0).slice(0, 6).map(p => ({ label: str(p.label, 30).trim() || 'Price', col: p.col, brk: p.brk >= 0 ? p.brk : -1 }));
    if (!prices.length) return { error: 'Pick at least one price column.' };
    const mm = { sku: m.sku, desc: m.desc, size: m.size >= 0 ? m.size : -1, pack: m.pack >= 0 ? m.pack : -1, page: m.page >= 0 ? m.page : -1, catalog: m.catalog >= 0 ? m.catalog : -1, prev: m.prev >= 0 ? m.prev : -1, change: m.change >= 0 ? m.change : -1, prices };
    const recs = buildRecords(pending.rows, mm); if (!recs.length) return { error: 'No products were found with those columns. Check the matching.' };
    const chunks = chunkRecords(recs, 38000), listDate = /^\d{4}-\d{2}-\d{2}$/.test(m.listDate || '') ? m.listDate : '';
    const prior = (await query(c, 'SELECT gen FROM cat_suppliers WHERE name=?', [name])).rows[0], maxg = (await query(c, 'SELECT MAX(gen) AS g FROM cat_chunks WHERE supplier=?', [name])).rows[0];
    const gen = Math.max(prior ? prior.gen : 0, maxg && maxg.g ? maxg.g : 0) + 1, now = new Date().toISOString(); let done = 0, next = 0, failed = null;
    const worker = async () => { while (next < chunks.length && !failed) { const k = next++; try { await query(c, 'INSERT INTO cat_chunks (supplier,gen,idx,data) VALUES (?,?,?,?)', [name, gen, k, chunks[k]]); done++; if (progress) progress(done, chunks.length); } catch (e) { failed = e; } } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (failed) { try { await query(c, 'DELETE FROM cat_chunks WHERE supplier=? AND gen=?', [name, gen]); } catch (e) {} throw failed; }
    const labels = JSON.stringify(prices.map(p => p.label));
    await query(c, 'INSERT INTO cat_suppliers (name,list_date,labels,n,gen,file_name,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET list_date=excluded.list_date, labels=excluded.labels, n=excluded.n, gen=excluded.gen, file_name=excluded.file_name, updated_at=excluded.updated_at, updated_by=excluded.updated_by', [name, listDate, labels, recs.length, gen, str(pending.name, 120), now, by]);
    try { await query(c, 'DELETE FROM cat_chunks WHERE supplier=? AND gen<>?', [name, gen]); } catch (e) {}
    loadMem(); const meta = { name, list_date: listDate, labels: prices.map(p => p.label), n: recs.length, gen, updated_at: now, updated_by: by, file_name: pending.name };
    for (const k of [...mem.keys()]) if (k === name.toLowerCase()) mem.delete(k);
    mem.set(name.toLowerCase(), { meta, records: recs, idx: indexSupplier(recs) }); saveMem(); pending = null;
    return { ok: true, name, count: recs.length, chunks: chunks.length };
  }
  async function remove(name) {
    const c = need(); await ensure(c); await actor(c, { admin: true });
    await query(c, 'DELETE FROM cat_chunks WHERE supplier=?', [name]); await query(c, 'DELETE FROM cat_suppliers WHERE name=?', [name]);
    loadMem(); mem.delete(String(name).toLowerCase()); saveMem(); return { ok: true };
  }
  async function guard() { const c = need(); await ensure(c); await actor(c, { admin: true }); return { ok: true }; }
  return { status, search, pick, importPending, remove, sync, guard };
}

module.exports = { makeCatalog, parseCsv, parseXlsx, detect, buildRecords, chunkRecords, searchIn, indexSupplier };
