// Shared notes + order board: talks to a Cloudflare D1 database over Cloudflare's REST API. Main process only.
// Staff sign in with a PIN (scrypt-hashed in the database); the signed-in session lives here, in memory, and times out.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATUSES = ['received', 'hold', 'material', 'progress', 'pickup', 'delivery'];
const SECTIONS = ['embroidery', 'heatpress', 'sublimation', 'trophy'];   // a job can be in several; each has its own status + assignee
const SECNAME = { embroidery: 'Embroidery', heatpress: 'Heat press', sublimation: 'Sublimation', trophy: 'Trophy & awards' };
const STNAME = { received: 'Received', hold: 'On Hold', material: 'Material Ordered', progress: 'In Progress', pickup: 'Ready for Pickup', delivery: 'Ready for Delivery/Shipping', done: 'Finished' };
const IDLE_MS = 5 * 60 * 1000;
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '')",
  "CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, order_ref TEXT NOT NULL DEFAULT '', customer TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'received', due TEXT NOT NULL DEFAULT '', assigned TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, sections TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '')",
  "CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')",
  "CREATE TABLE IF NOT EXISTS staff (name TEXT PRIMARY KEY COLLATE NOCASE, salt TEXT NOT NULL, hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS job_notes (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, at TEXT NOT NULL, by TEXT NOT NULL DEFAULT '', job_id TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '')",
  "CREATE TABLE IF NOT EXISTS inv_items (id TEXT PRIMARY KEY, code TEXT NOT NULL, vendor TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', min_qty INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '')",
  "CREATE TABLE IF NOT EXISTS inv_stock (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', qty INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, location TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', flag TEXT NOT NULL DEFAULT '', deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '')",
  "CREATE TABLE IF NOT EXISTS inv_moves (id TEXT PRIMARY KEY, at TEXT NOT NULL, by TEXT NOT NULL DEFAULT '', item_id TEXT NOT NULL DEFAULT '', stock_id TEXT NOT NULL DEFAULT '', code TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', delta INTEGER NOT NULL DEFAULT 0, qty_after INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '')",
  "CREATE INDEX IF NOT EXISTS idx_inv_items_code ON inv_items(code)",
  "CREATE INDEX IF NOT EXISTS idx_inv_stock_item ON inv_stock(item_id)",
  "CREATE INDEX IF NOT EXISTS idx_inv_moves_at ON inv_moves(at)",
  "CREATE INDEX IF NOT EXISTS idx_notes_upd ON notes(updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_jobs_upd ON jobs(updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_jn_job ON job_notes(job_id)",
  "CREATE INDEX IF NOT EXISTS idx_act_at ON activity(at)"
];
// Columns added after the first release; added to older databases automatically.
const UPGRADES = [
  "ALTER TABLE jobs ADD COLUMN sections TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE jobs ADD COLUMN assign TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE jobs ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE notes ADD COLUMN pad TEXT NOT NULL DEFAULT 'shop'"
];
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const hashPinAsync = (pin, salt) => new Promise((res, rej) => crypto.scrypt(String(pin), salt, 32, (e, k) => e ? rej(e) : res(k.toString('hex'))));

function makeCloud({ dir, safeStorage, baseUrl }) {
  const secureFile = path.join(dir, 'secure', 'cloud.bin');
  const cacheFile = path.join(dir, 'data', 'cloud-cache.json');
  const base = baseUrl || 'https://api.cloudflare.com/client/v4';
  let ready = false, staffCount = null, session = null;
  const fails = new Map();

  function loadCreds() {
    try {
      const raw = fs.readFileSync(secureFile);
      const txt = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
      const c = JSON.parse(txt); return c && c.token ? c : null;
    } catch (e) { return null; }
  }
  function saveCreds(c) {
    fs.mkdirSync(path.dirname(secureFile), { recursive: true });
    const txt = JSON.stringify(c);
    fs.writeFileSync(secureFile, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : Buffer.from(txt));
    ready = false; staffCount = null; session = null;
  }
  function clearCreds() { try { fs.unlinkSync(secureFile); } catch (e) {} ready = false; staffCount = null; session = null; }

  async function query(c, sql, params) {
    let r;
    try {
      r = await fetch(base + '/accounts/' + encodeURIComponent(c.accountId) + '/d1/database/' + encodeURIComponent(c.databaseId) + '/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.token },
        body: JSON.stringify({ sql, params: params || [] })
      });
    } catch (e) { const err = new Error('Could not reach the shared database. The computer may be offline.'); err.offline = true; throw err; }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.success === false) {
      const m = j && j.errors && j.errors[0] && j.errors[0].message;
      let hint = '';
      if (r.status === 401 || r.status === 403) hint = ' The API token was not accepted. Make sure it has Account > D1 > Edit permission.';
      else if (r.status === 404 || /not found|no such database/i.test(m || '')) hint = ' Check the Account ID and Database ID.';
      const err = new Error('The shared database said no (HTTP ' + r.status + (m ? ': ' + m : '') + ').' + hint); err.sqlMessage = m || ''; throw err;
    }
    const res = j.result && j.result[0];
    return { rows: (res && res.results) || [], changes: (res && res.meta && res.meta.changes) || 0 };
  }
  async function ensure(c) {
    if (ready) return;
    for (const s of SCHEMA) await query(c, s);
    for (const u of UPGRADES) { try { await query(c, u); } catch (e) { if (!/duplicate column/i.test(e.sqlMessage || e.message)) throw e; } }
    ready = true;
  }
  const need = () => { const c = loadCreds(); if (!c) throw new Error('The shared database is not connected yet. Use File > Shared database connection.'); return c; };

  function loadCache() { try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) { return { notes: [], jobs: [], jobNotes: [], settings: {}, staff: [], at: '' }; } }
  function saveCache(j) { try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(j)); } catch (e) {} }

  // ---------------- sign-in (PIN) ----------------
  const live = () => !!session && (Date.now() - session.last) < IDLE_MS;
  async function countStaff(c) { if (staffCount === null) staffCount = (await query(c, 'SELECT COUNT(*) AS n FROM staff')).rows[0].n; return staffCount; }
  // Returns the name to stamp on a change. Throws "LOCKED" when PINs are set up but nobody is signed in (or the 5 minutes ran out).
  async function actor(c, opts) {
    const n = await countStaff(c);
    if (n > 0) {
      if (!live()) { session = null; const e = new Error('LOCKED: Please sign in with your PIN.'); e.locked = true; throw e; }
      if (opts && opts.admin && !session.admin) throw new Error('Only an admin can do that.');
      session.last = Date.now(); return session.name;
    }
    return '';
  }
  async function authState() {
    const c = loadCreds(); if (!c) return { required: false, user: '', admin: false, bootstrap: false };
    await ensure(c); const n = await countStaff(c); if (n > 0) loadStaff(c).catch(() => {});
    return { required: n > 0, user: live() ? session.name : '', admin: live() ? !!session.admin : false, bootstrap: n === 0, idleMs: IDLE_MS };
  }
  function ping() { if (live()) session.last = Date.now(); return { ok: true, user: live() ? session.name : '' }; }
  function logout() { session = null; return { ok: true }; }
  // One PIN pad, no name: the PIN is checked against everyone's PIN. Wrong guesses are counted for the whole computer.
  const lock = { n: 0, until: 0, locks: 0 };
  let staffRows = null, staffAt = 0;   // staff list kept in memory so the PIN check needs no network trip
  async function loadStaff(c, force) { if (force || !staffRows || Date.now() - staffAt > 120000) { staffRows = (await query(c, 'SELECT * FROM staff')).rows; staffAt = Date.now(); } return staffRows; }
  async function findPin(pin, rows) {   // checks every person's PIN in parallel
    const hits = await Promise.all(rows.map(async r => { const a = Buffer.from(await hashPinAsync(pin, r.salt), 'hex'), b = Buffer.from(r.hash, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b) ? r : null; }));
    return hits.find(Boolean) || null;
  }
  async function login(pin) {
    const c = need(); await ensure(c);
    if (lock.until > Date.now()) { const w = Math.ceil((lock.until - Date.now()) / 1000); return { error: 'Too many wrong PINs.', locked: true, waitSec: w }; }
    let row = await findPin(pin, await loadStaff(c));
    if (!row) row = await findPin(pin, await loadStaff(c, true));   // maybe someone was just added on another computer
    if (!row) {
      lock.n++; const left = 5 - lock.n;
      if (left <= 0) { lock.n = 0; lock.locks++; const ms = lock.locks >= 3 ? 15 * 60000 : 60000; lock.until = Date.now() + ms; return { error: 'Incorrect PIN.', locked: true, waitSec: Math.round(ms / 1000) }; }
      return { error: 'Incorrect PIN.', triesLeft: left };
    }
    lock.n = 0; lock.locks = 0; session = { name: row.name, admin: !!row.is_admin, last: Date.now() };
    return { ok: true, user: row.name, admin: !!row.is_admin };
  }
  function samePin(pin, row) { const a = Buffer.from(hashPin(pin, row.salt), 'hex'), b = Buffer.from(row.hash, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); }
  async function pinTakenBy(c, pin, exceptName) { const rows = (await query(c, 'SELECT * FROM staff')).rows; const r = rows.find(x => (!exceptName || x.name.toLowerCase() !== String(exceptName).toLowerCase()) && samePin(pin, x)); return r ? r.name : ''; }
  const okPin = p => /^\d{4}$/.test(String(p || ''));
  async function addStaff(name, pin, isAdmin) {
    const c = need(); await ensure(c); const n = await countStaff(c);
    name = str(name, 40).trim(); if (!name) return { error: 'Enter a name.' };
    if (!okPin(pin)) return { error: 'The PIN must be exactly 4 digits.' };
    if (n > 0) await actor(c, { admin: true });
    if (await pinTakenBy(c, pin)) return { error: 'Someone else already uses that PIN. Pick a different 4 digits.' };
    const salt = crypto.randomBytes(16).toString('hex'), first = n === 0;
    try { await query(c, 'INSERT INTO staff (name,salt,hash,is_admin,created_at) VALUES (?,?,?,?,?)', [name, salt, hashPin(pin, salt), first || isAdmin ? 1 : 0, new Date().toISOString()]); }
    catch (e) { if (/unique|constraint/i.test(e.sqlMessage || e.message)) return { error: 'That name is already on the list.' }; throw e; }
    staffCount = n + 1; staffRows = null;
    if (first) session = { name, admin: true, last: Date.now() };   // the first person set up becomes the admin and is signed in
    return { ok: true, first };
  }
  async function setPin(name, pin, oldPin) {
    const c = need(); await ensure(c); if (!okPin(pin)) return { error: 'The PIN must be exactly 4 digits.' };
    const me = await actor(c);
    const row = (await query(c, 'SELECT * FROM staff WHERE name=?', [str(name, 60)])).rows[0]; if (!row) return { error: 'No such person.' };
    if (!(session && session.admin)) {
      if (row.name.toLowerCase() !== me.toLowerCase()) return { error: 'You can only change your own PIN.' };
      const a = Buffer.from(hashPin(oldPin || '', row.salt), 'hex'), b = Buffer.from(row.hash, 'hex');
      if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) return { error: 'Your current PIN was not right.' };
    }
    if (await pinTakenBy(c, pin, row.name)) return { error: 'Someone else already uses that PIN. Pick a different 4 digits.' };
    const salt = crypto.randomBytes(16).toString('hex');
    await query(c, 'UPDATE staff SET salt=?, hash=? WHERE name=?', [salt, hashPin(pin, salt), row.name]); staffRows = null;
    return { ok: true };
  }
  async function removeStaff(name) {
    const c = need(); await ensure(c); const me = await actor(c, { admin: true });
    if (String(name).toLowerCase() === me.toLowerCase()) return { error: 'You cannot remove yourself.' };
    await query(c, 'DELETE FROM staff WHERE name=?', [str(name, 60)]); staffCount = null; staffRows = null; return { ok: true };
  }
  async function setAdmin(name, isAdmin) {
    const c = need(); await ensure(c); await actor(c, { admin: true });
    if (!isAdmin) { const n = (await query(c, 'SELECT COUNT(*) AS n FROM staff WHERE is_admin=1 AND name<>?', [str(name, 60)])).rows[0].n; if (!n) return { error: 'There must be at least one admin.' }; }
    await query(c, 'UPDATE staff SET is_admin=? WHERE name=?', [isAdmin ? 1 : 0, str(name, 60)]); staffRows = null; return { ok: true };
  }


  // ---------------- inventory ----------------
  // An item is a vendor + item number (the barcode text). Each item has one or more stock lines (a color/size/bin with its own count, cost and location).
  // Counts change with atomic SQL (qty = qty + n), so two computers scanning at once never overwrite each other.
  const iStr = (v, n) => str(v, n).replace(/\s+/g, ' ').trim();
  async function invPull() {
    const c = need(); await ensure(c);
    const items = (await query(c, 'SELECT id, code, vendor, name, category, min_qty FROM inv_items WHERE deleted=0')).rows;
    const stock = (await query(c, 'SELECT id, item_id, label, qty, cost, location, note, flag FROM inv_stock WHERE deleted=0')).rows;
    return { items, stock, at: new Date().toISOString() };
  }
  async function logMove(c, by, line, item, kind, delta, after, note) {
    await query(c, 'INSERT INTO inv_moves (id,at,by,item_id,stock_id,code,label,kind,delta,qty_after,note) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [newId(), new Date().toISOString(), by, line.item_id, line.id, item ? item.code : '', line.label, kind, delta, after, iStr(note, 200)]);
  }
  async function invMove(stockId, kind, amount, note) {
    const c = need(); await ensure(c); const by = await actor(c);
    const n = Math.round(Number(amount)); if (!isFinite(n) || n < 0 || n > 1000000) return { error: 'Enter a whole number.' };
    if (kind !== 'count' && n < 1) return { error: 'Enter a number of 1 or more.' };
    const row = (await query(c, 'SELECT * FROM inv_stock WHERE id=? AND deleted=0', [str(stockId, 40)])).rows[0]; if (!row) return { error: 'That stock line no longer exists. Refresh the list.' };
    const now = new Date().toISOString();
    if (kind === 'receive') await query(c, 'UPDATE inv_stock SET qty=qty+?, updated_at=?, updated_by=? WHERE id=?', [n, now, by, row.id]);
    else if (kind === 'use') {
      const r = await query(c, 'UPDATE inv_stock SET qty=qty-?, updated_at=?, updated_by=? WHERE id=? AND qty>=?', [n, now, by, row.id, n]);
      if (!r.changes) { const cur = (await query(c, 'SELECT qty FROM inv_stock WHERE id=?', [row.id])).rows[0]; return { error: 'Only ' + (cur ? cur.qty : 0) + ' on hand, so ' + n + ' cannot be used. If the count is wrong, use Count to fix it.', qty: cur ? cur.qty : 0 }; }
    } else if (kind === 'count') await query(c, 'UPDATE inv_stock SET qty=?, updated_at=?, updated_by=? WHERE id=?', [n, now, by, row.id]);
    else return { error: 'Unknown action.' };
    const after = (await query(c, 'SELECT qty FROM inv_stock WHERE id=?', [row.id])).rows[0].qty;
    const item = (await query(c, 'SELECT code FROM inv_items WHERE id=?', [row.item_id])).rows[0];
    await logMove(c, by, row, item, kind, kind === 'count' ? after - row.qty : (kind === 'use' ? -n : n), after, note);
    return { ok: true, qty: after, by };
  }
  async function invSaveItem(it) {
    const c = need(); await ensure(c); const by = await actor(c);
    const f = { code: iStr(it.code, 60), vendor: iStr(it.vendor, 60), name: iStr(it.name, 200), category: iStr(it.category, 60), min_qty: Math.max(0, Math.round(Number(it.min_qty) || 0)) };
    if (!f.code) return { error: 'Enter the item number (this is what the barcode says).' };
    if (!f.name) return { error: 'Enter a name.' };
    const now = new Date().toISOString();
    const dup = (await query(c, 'SELECT id FROM inv_items WHERE deleted=0 AND lower(code)=lower(?) AND lower(vendor)=lower(?) AND id<>?', [f.code, f.vendor, str(it.id, 40)])).rows[0];
    if (dup) return { error: 'That vendor already has an item with that number.' };
    if (it.id) { await query(c, 'UPDATE inv_items SET code=?, vendor=?, name=?, category=?, min_qty=?, updated_at=?, updated_by=? WHERE id=?', [f.code, f.vendor, f.name, f.category, f.min_qty, now, by, str(it.id, 40)]); return { ok: true, id: it.id }; }
    const id = newId();
    await query(c, 'INSERT INTO inv_items (id,code,vendor,name,category,min_qty,deleted,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,0,?,?,?)', [id, f.code, f.vendor, f.name, f.category, f.min_qty, now, now, by]);
    return { ok: true, id };
  }
  async function invSaveStock(l) {
    const c = need(); await ensure(c); const by = await actor(c);
    const f = { label: iStr(l.label, 200), cost: Math.max(0, Number(l.cost) || 0), location: iStr(l.location, 80), note: iStr(l.note, 300) };
    const now = new Date().toISOString();
    if (l.id) { await query(c, "UPDATE inv_stock SET label=?, cost=?, location=?, note=?, flag='', updated_at=?, updated_by=? WHERE id=?", [f.label, f.cost, f.location, f.note, now, by, str(l.id, 40)]); return { ok: true, id: l.id }; }
    const item = (await query(c, 'SELECT * FROM inv_items WHERE id=? AND deleted=0', [str(l.item_id, 40)])).rows[0]; if (!item) return { error: 'That item no longer exists.' };
    const q = Math.max(0, Math.round(Number(l.qty) || 0)), id = newId();
    await query(c, 'INSERT INTO inv_stock (id,item_id,label,qty,cost,location,note,flag,deleted,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,0,?,?)', [id, item.id, f.label, q, f.cost, f.location, f.note, '', now, by]);
    if (q) await logMove(c, by, { id, item_id: item.id, label: f.label }, item, 'receive', q, q, 'added');
    return { ok: true, id };
  }
  async function invDelete(kind, id) {
    const c = need(); await ensure(c); const by = await actor(c, { admin: true }); const now = new Date().toISOString();
    if (kind === 'item') { await query(c, 'UPDATE inv_stock SET deleted=1, updated_at=?, updated_by=? WHERE item_id=?', [now, by, str(id, 40)]); await query(c, 'UPDATE inv_items SET deleted=1, updated_at=?, updated_by=? WHERE id=?', [now, by, str(id, 40)]); }
    else { const row = (await query(c, 'SELECT * FROM inv_stock WHERE id=?', [str(id, 40)])).rows[0]; if (row && row.qty) { const item = (await query(c, 'SELECT code FROM inv_items WHERE id=?', [row.item_id])).rows[0]; await logMove(c, by, row, item, 'remove', -row.qty, 0, 'line deleted'); } await query(c, 'UPDATE inv_stock SET deleted=1, qty=0, updated_at=?, updated_by=? WHERE id=?', [now, by, str(id, 40)]); }
    return { ok: true };
  }
  async function invMoves(limit, itemId) {
    const c = need(); await ensure(c); const n = Math.max(1, Math.min(2000, Number(limit) || 200));
    const rows = itemId ? (await query(c, 'SELECT * FROM inv_moves WHERE item_id=? ORDER BY at DESC LIMIT ' + n, [str(itemId, 40)])).rows : (await query(c, 'SELECT * FROM inv_moves ORDER BY at DESC LIMIT ' + n)).rows;
    return { moves: rows };
  }
  // First-time load of the starter list (from the shop's spreadsheet). Only into an empty inventory; only an admin (or anyone before PINs exist).
  async function invImport(seed, progress) {
    const c = need(); await ensure(c); const by = await actor(c, { admin: true });
    const have = (await query(c, 'SELECT COUNT(*) AS n FROM inv_items WHERE deleted=0')).rows[0].n;
    if (have > 0) return { error: 'The inventory already has ' + have + ' items, so the starter list was not loaded again.' };
    if (!seed || !Array.isArray(seed.items) || !Array.isArray(seed.stock)) return { error: 'The starter list file is missing or damaged.' };
    const now = new Date().toISOString(), ids = seed.items.map(() => newId());
    const jobs = [];
    for (let i = 0; i < seed.items.length; i += 12) {
      const part = seed.items.slice(i, i + 12), p = [];
      part.forEach((it, j) => p.push(ids[i + j], iStr(it.code, 60), iStr(it.vendor, 60), iStr(it.name, 200), iStr(it.category, 60), now, now, by));
      jobs.push(['INSERT INTO inv_items (id,code,vendor,name,category,created_at,updated_at,updated_by) VALUES ' + part.map(() => '(?,?,?,?,?,?,?,?)').join(','), p]);
    }
    for (let i = 0; i < seed.stock.length; i += 9) {
      const part = seed.stock.slice(i, i + 9), p = [];
      part.forEach(l => p.push(newId(), ids[l.item], iStr(l.label, 200), Math.max(0, Math.round(Number(l.qty) || 0)), Math.max(0, Number(l.cost) || 0), iStr(l.location, 80), iStr(l.note, 300), iStr(l.flag, 200), now, by));
      jobs.push(['INSERT INTO inv_stock (id,item_id,label,qty,cost,location,note,flag,updated_at,updated_by) VALUES ' + part.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(','), p]);
    }
    let done = 0, next = 0;
    const worker = async () => { while (next < jobs.length) { const k = next++; await query(c, jobs[k][0], jobs[k][1]); done++; if (progress) progress(done, jobs.length); } };
    try { await Promise.all([worker(), worker(), worker(), worker(), worker()]); }
    catch (e) { next = jobs.length; try { await query(c, 'DELETE FROM inv_stock WHERE updated_at=?', [now]); await query(c, 'DELETE FROM inv_items WHERE created_at=?', [now]); } catch (e2) {} throw e; }   // half-loaded? undo it so it can be retried
    await query(c, 'INSERT INTO inv_moves (id,at,by,kind,note) VALUES (?,?,?,?,?)', [newId(), now, by, 'import', 'Loaded the starter list: ' + seed.items.length + ' items, ' + seed.stock.length + ' stock lines']);
    return { ok: true, items: seed.items.length, lines: seed.stock.length };
  }

  async function test(c) { await ensure(c); const r = await query(c, 'SELECT COUNT(*) AS n FROM notes'); return r.rows[0] ? r.rows[0].n : 0; }

  async function pull(includeArchived) {
    const c = need(); await ensure(c);
    const notes = (await query(c, 'SELECT * FROM notes WHERE deleted=0 ORDER BY pinned DESC, updated_at DESC LIMIT 1500')).rows;
    const jobs = (await query(c, includeArchived ? 'SELECT * FROM jobs WHERE deleted=0 ORDER BY updated_at DESC LIMIT 600' : 'SELECT * FROM jobs WHERE deleted=0 AND archived=0 ORDER BY due=\'\' , due, created_at LIMIT 600')).rows;
    const jobNotes = (await query(c, 'SELECT * FROM job_notes ORDER BY created_at DESC LIMIT 1500')).rows;
    const settings = {}; for (const s of (await query(c, 'SELECT k, v FROM settings')).rows) settings[s.k] = s.v;
    const staff = (await query(c, 'SELECT name, is_admin FROM staff ORDER BY name COLLATE NOCASE')).rows.map(s => ({ name: s.name, admin: !!s.is_admin }));
    staffCount = staff.length;
    const out = { notes, jobs, jobNotes, settings, staff, at: new Date().toISOString() };
    if (!includeArchived) saveCache(out);
    return out;
  }
  function cached() { return loadCache(); }

  // ---------------- activity feed (goes to one person: settings.updates_to) ----------------
  async function log(c, by, job, text) {
    try { await query(c, 'INSERT INTO activity (id,at,by,job_id,ref,text) VALUES (?,?,?,?,?,?)', [newId(), new Date().toISOString(), str(by, 60), str(job.id, 40), str(job.order_ref || job.title, 60), str(text, 400)]); } catch (e) {}
  }
  const lab = j => ((j.order_ref || '').trim() || (j.title || '').trim() || 'a job') + (j.customer ? ' (' + j.customer + ')' : '');
  async function updates() {
    const c = need(); await ensure(c);
    const to = ((await query(c, "SELECT v FROM settings WHERE k='updates_to'")).rows[0] || {}).v || '';
    await countStaff(c);
    if (staffCount > 0) { if (!live()) { const e = new Error('LOCKED: Please sign in with your PIN.'); e.locked = true; throw e; } if (!(session.admin || session.name.toLowerCase() === to.toLowerCase())) throw new Error('Job updates are only shown to ' + (to || 'the person chosen in Staff') + '.'); }
    return { to, rows: (await query(c, 'SELECT * FROM activity ORDER BY at DESC LIMIT 400')).rows };
  }

  // ---------------- notes (pads: "shop" or a person's name) ----------------
  async function saveNote(n) {
    const c = need(); await ensure(c); const by = await actor(c); const now = new Date().toISOString();
    const f = { title: str(n.title, 200), body: str(n.body, 20000), author: by || str(n.author, 60), pinned: n.pinned ? 1 : 0, pad: str(n.pad || 'shop', 60) };
    if (!n.id) {
      const id = newId();
      await query(c, 'INSERT INTO notes (id,title,body,author,pinned,deleted,pad,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,0,?,?,?,?)', [id, f.title, f.body, f.author, f.pinned, f.pad, now, now, by]);
      return { ok: true, id, updated_at: now };
    }
    const r = await query(c, 'UPDATE notes SET title=?,body=?,pinned=?,pad=?,updated_at=?,updated_by=? WHERE id=? AND updated_at=?', [f.title, f.body, f.pinned, f.pad, now, by || f.author, str(n.id, 40), str(n.base, 40)]);
    if (!r.changes) return { conflict: true };
    return { ok: true, id: n.id, updated_at: now };
  }
  async function deleteNote(id) {
    const c = need(); await ensure(c); const by = await actor(c);
    const row = (await query(c, 'SELECT author FROM notes WHERE id=?', [str(id, 40)])).rows[0];
    if (by && row && row.author.toLowerCase() !== by.toLowerCase() && !session.admin) return { error: 'Only ' + row.author + ' or an admin can delete this note.' };
    await query(c, 'UPDATE notes SET deleted=1, updated_at=?, updated_by=? WHERE id=?', [new Date().toISOString(), by, str(id, 40)]);
    return { ok: true };
  }

  // ---------------- jobs ----------------
  function cleanSections(m) {
    const out = {};
    if (m && typeof m === 'object') for (const k of SECTIONS) if (m[k]) out[k] = (STATUSES.includes(m[k]) || m[k] === 'done') ? m[k] : 'received';
    return out;
  }
  function cleanAssign(m, sec) { const out = {}; if (m && typeof m === 'object') for (const k of SECTIONS) if (sec[k] && m[k]) out[k] = str(m[k], 60); return out; }
  const parse = s => { try { const m = JSON.parse(s || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } };
  async function saveJob(j) {
    const c = need(); await ensure(c); const by = await actor(c); const now = new Date().toISOString();
    const sec = cleanSections(j.sections);
    if (!Object.keys(sec).length) return { error: 'Pick at least one section (Embroidery, Heat press, Sublimation, or Trophy & awards).' };
    const allDone = Object.values(sec).every(v => v === 'done');
    const first = Object.values(sec).find(v => v !== 'done') || 'received';
    const f = { order_ref: str(j.order_ref, 40), customer: str(j.customer, 120), title: str(j.title, 200), status: first, due: /^\d{4}-\d{2}-\d{2}$/.test(j.due || '') ? j.due : '', details: str(j.details, 5000), sections: JSON.stringify(sec), assign: JSON.stringify(cleanAssign(j.assign, sec)), archived: allDone ? 1 : 0 };
    if (!j.id) {
      const id = newId();
      await query(c, "INSERT INTO jobs (id,order_ref,customer,title,status,due,assigned,details,sections,assign,archived,deleted,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,'',?,?,?,?,0,?,?,?)", [id, f.order_ref, f.customer, f.title, f.status, f.due, f.details, f.sections, f.assign, f.archived, now, now, by]);
      await log(c, by, { id, order_ref: f.order_ref, title: f.title, customer: f.customer }, (by || 'Someone') + ' created ' + lab(f) + ' → ' + Object.keys(sec).map(k => SECNAME[k]).join(', '));
      return { ok: true, id };
    }
    const r = await query(c, 'UPDATE jobs SET order_ref=?,customer=?,title=?,status=?,due=?,details=?,sections=?,assign=?,archived=?,updated_at=?,updated_by=? WHERE id=? AND updated_at=?', [f.order_ref, f.customer, f.title, f.status, f.due, f.details, f.sections, f.assign, f.archived, now, by, str(j.id, 40), str(j.base, 40)]);
    if (!r.changes) return { conflict: true };
    await log(c, by, { id: j.id, order_ref: f.order_ref, title: f.title, customer: f.customer }, (by || 'Someone') + ' edited ' + lab(f) + (f.due ? ' (due ' + f.due + ')' : ''));
    return { ok: true, id: j.id };
  }
  // Read–change–write of ONE field on a job, retried if someone else saved at the same moment.
  async function mutate(c, id, by, fn) {
    for (let i = 0; i < 4; i++) {
      const row = (await query(c, 'SELECT * FROM jobs WHERE id=? AND deleted=0', [str(id, 40)])).rows[0];
      if (!row) throw new Error('That job no longer exists.');
      const set = await fn(row); if (!set) return { ok: true, row };
      const cols = Object.keys(set);
      const r = await query(c, 'UPDATE jobs SET ' + cols.map(k => k + '=?').join(', ') + ', updated_at=?, updated_by=? WHERE id=? AND updated_at=?', [...cols.map(k => set[k]), new Date().toISOString(), by || '', str(id, 40), row.updated_at]);
      if (r.changes) return { ok: true, row };
    }
    throw new Error('Someone else is changing that job right now. Please try again.');
  }
  async function moveSection(id, key, status) {
    if (!SECTIONS.includes(key)) throw new Error('Unknown section.');
    if (!STATUSES.includes(status) && status !== 'done') throw new Error('Unknown status.');
    const c = need(); await ensure(c); const by = await actor(c); let archived = false, lbl = null;
    let same = false;
    await mutate(c, id, by, row => {
      const sec = cleanSections(parse(row.sections)); lbl = row; if (sec[key] === status) { same = true; return null; } sec[key] = status;
      archived = Object.values(sec).every(v => v === 'done');
      return { sections: JSON.stringify(sec), status: Object.values(sec).find(v => v !== 'done') || 'received', archived: archived ? 1 : 0 };
    });
    if (same) return { ok: true, archived: false };
    await log(c, by, lbl, (by || 'Someone') + ' moved ' + lab(lbl) + ' — ' + SECNAME[key] + ': ' + STNAME[status] + (archived ? ' (all sections finished)' : ''));
    return { ok: true, archived };
  }
  async function setAssign(id, key, name) {
    if (!SECTIONS.includes(key)) throw new Error('Unknown section.');
    const c = need(); await ensure(c); const by = await actor(c); let lbl = null;
    await mutate(c, id, by, row => { const a = parse(row.assign); if (name) a[key] = str(name, 60); else delete a[key]; lbl = row; return { assign: JSON.stringify(a) }; });
    await log(c, by, lbl, (by || 'Someone') + (name ? ' assigned ' + SECNAME[key] + ' on ' + lab(lbl) + ' to ' + name : ' cleared the ' + SECNAME[key] + ' assignee on ' + lab(lbl)));
    return { ok: true };
  }
  async function deleteJob(id) {
    const c = need(); await ensure(c); const by = await actor(c); let lbl = null;
    await mutate(c, id, by, row => { lbl = row; return { deleted: 1 }; });
    await log(c, by, lbl, (by || 'Someone') + ' deleted ' + lab(lbl));
    return { ok: true };
  }
  async function archiveJob(id, archived) {
    const c = need(); await ensure(c); const by = await actor(c);
    await mutate(c, id, by, row => {
      if (archived) return { archived: 1 };
      const sec = cleanSections(parse(row.sections)); for (const k of Object.keys(sec)) if (sec[k] === 'done') sec[k] = 'received';
      return { sections: JSON.stringify(sec), archived: 0 };
    });
    return { ok: true };
  }
  async function addJobNote(jobId, body) {
    body = str(body, 4000).trim(); if (!body) return { error: 'Type a note first.' };
    const c = need(); await ensure(c); const by = await actor(c);
    const row = (await query(c, 'SELECT * FROM jobs WHERE id=? AND deleted=0', [str(jobId, 40)])).rows[0]; if (!row) return { error: 'That job no longer exists.' };
    const id = newId(), at = new Date().toISOString();
    await query(c, 'INSERT INTO job_notes (id,job_id,author,body,created_at) VALUES (?,?,?,?,?)', [id, row.id, by || 'Someone', body, at]);
    await log(c, by, row, (by || 'Someone') + ' added a note on ' + lab(row) + ': ' + body.replace(/\s+/g, ' ').slice(0, 160));
    return { ok: true, id, at };
  }
  async function saveSetting(k, v) {
    const c = need(); await ensure(c); const by = await actor(c);
    k = str(k, 40);
    if (by && k.startsWith('seen:')) { if (k.toLowerCase() !== ('seen:' + by).toLowerCase() && k.toLowerCase() !== ('seen:' + by + ':updates').toLowerCase()) return { error: 'Not allowed.' }; }
    else if (by) await actor(c, { admin: true });
    await query(c, 'INSERT INTO settings (k,v,updated_at) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at', [k, str(v, 5000), new Date().toISOString()]);
    return { ok: true };
  }
  function status() { const c = loadCreds(); return { configured: !!c, accountId: c ? c.accountId : '', databaseId: c ? c.databaseId : '' }; }
  return { loadCreds, saveCreds, clearCreds, test, pull, cached, authState, login, logout, ping, addStaff, setPin, removeStaff, setAdmin, updates, saveNote, deleteNote, saveJob, moveSection, setAssign, deleteJob, archiveJob, addJobNote, saveSetting, status, query, invPull, invMove, invSaveItem, invSaveStock, invDelete, invMoves, invImport };
}
module.exports = { makeCloud, STATUSES, SECTIONS };
