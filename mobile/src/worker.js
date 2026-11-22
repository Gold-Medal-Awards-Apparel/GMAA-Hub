// Gold Medal Hub — phone version (Cloudflare Worker).
// Cloudflare Access signs the person in; this code double-checks that sign-in, maps the verified email to a staff name,
// and then does the same job / Inbox work the desktop Hub does, straight against the shared D1 database.
// It holds no passwords. Nothing here can read price lists, customer history, or the timesheet.
// ASSETS is filled in by build.js.

const STATUSES = ['received', 'hold', 'material', 'progress', 'pickup', 'delivery'];
const SECTIONS = ['embroidery', 'heatpress', 'sublimation', 'trophy'];
const SECNAME = { embroidery: 'Embroidery', heatpress: 'Heat press', sublimation: 'Sublimation', trophy: 'Trophy & awards' };
const STNAME = { received: 'Received', hold: 'On Hold', material: 'Material Ordered', progress: 'In Progress', pickup: 'Ready for Pickup', delivery: 'Ready for Delivery/Shipping', done: 'Finished' };
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const parse = s => { try { const m = JSON.parse(s || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } };
const YMD = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// ---------------- Cloudflare Access sign-in check ----------------
const b64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const jsonPart = s => JSON.parse(new TextDecoder().decode(b64u(s)));
let jwksCache = { at: 0, keys: [], team: '' };
async function getKeys(team, force) {
  if (!force && jwksCache.team === team && Date.now() - jwksCache.at < 3600000 && jwksCache.keys.length) return jwksCache.keys;
  const r = await fetch('https://' + team + '.cloudflareaccess.com/cdn-cgi/access/certs');
  if (!r.ok) throw new HttpError(503, 'Could not load the sign-in keys.');
  const j = await r.json(); jwksCache = { at: Date.now(), keys: j.keys || [], team };
  return jwksCache.keys;
}
async function verifyAccess(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  const p = token.split('.'); if (p.length !== 3) throw new HttpError(401, 'Sign-in required.');
  let head, body; try { head = jsonPart(p[0]); body = jsonPart(p[1]); } catch (e) { throw new HttpError(401, 'Sign-in required.'); }
  if (head.alg !== 'RS256') throw new HttpError(401, 'Sign-in required.');
  let keys = await getKeys(env.ACCESS_TEAM, false), jwk = keys.find(k => k.kid === head.kid);
  if (!jwk) { keys = await getKeys(env.ACCESS_TEAM, true); jwk = keys.find(k => k.kid === head.kid); }
  if (!jwk) throw new HttpError(401, 'Sign-in required.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(p[2]), new TextEncoder().encode(p[0] + '.' + p[1]));
  if (!ok) throw new HttpError(401, 'Sign-in required.');
  const now = Math.floor(Date.now() / 1000), aud = [].concat(body.aud || []);
  if (!body.exp || body.exp < now || (body.nbf && body.nbf > now + 60)) throw new HttpError(401, 'Your sign-in expired. Reload the page.');
  if (body.iss !== 'https://' + env.ACCESS_TEAM + '.cloudflareaccess.com') throw new HttpError(401, 'Sign-in required.');
  if (!aud.includes(env.ACCESS_AUD)) throw new HttpError(401, 'Sign-in required.');
  const email = String(body.email || '').toLowerCase(); if (!email) throw new HttpError(401, 'Sign-in required.');
  return email;
}
function usersOf(env) { try { const u = JSON.parse(env.USERS || '{}'); return u && typeof u === 'object' ? u : {}; } catch (e) { return {}; } }
function configProblem(env) {
  if (!env.DB) return 'the database connection (DB)';
  if (!env.ACCESS_TEAM || !/^[a-z0-9-]+$/i.test(env.ACCESS_TEAM)) return 'ACCESS_TEAM';
  if (!env.ACCESS_AUD) return 'ACCESS_AUD';
  if (!Object.keys(usersOf(env)).length) return 'USERS';
  return '';
}

// ---------------- database ----------------
function makeDb(env) {
  return async (sql, params) => {
    const r = await env.DB.prepare(sql).bind(...(params || [])).all();
    return { rows: r.results || [], changes: (r.meta && r.meta.changes) || 0 };
  };
}
const lab = j => ((j.order_ref || '').trim() || (j.title || '').trim() || 'a job') + (j.customer ? ' (' + j.customer + ')' : '');
async function log(q, by, job, text) {
  try { await q('INSERT INTO activity (id,at,by,job_id,ref,text) VALUES (?,?,?,?,?,?)', [newId(), new Date().toISOString(), str(by, 60), str(job.id, 40), str(job.order_ref || job.title, 60), str(text, 400)]); } catch (e) {}
}
function cleanSections(m) {
  const out = {};
  if (m && typeof m === 'object') for (const k of SECTIONS) if (m[k]) out[k] = (STATUSES.includes(m[k]) || m[k] === 'done') ? m[k] : 'received';
  return out;
}
const cleanAssign = (m, sec) => { const out = {}; if (m && typeof m === 'object') for (const k of SECTIONS) if (sec[k] && m[k]) out[k] = str(m[k], 60); return out; };

async function saveJob(q, by, j) {
  const now = new Date().toISOString(), sec = cleanSections(j.sections);
  if (!Object.keys(sec).length) return { error: 'Pick at least one section (Embroidery, Heat press, Sublimation, or Trophy & awards).' };
  const allDone = Object.values(sec).every(v => v === 'done'), first = Object.values(sec).find(v => v !== 'done') || 'received';
  const f = { order_ref: str(j.order_ref, 40), customer: str(j.customer, 120), title: str(j.title, 200), status: first, due: YMD.test(j.due || '') ? j.due : '', details: str(j.details, 5000), sections: JSON.stringify(sec), assign: JSON.stringify(cleanAssign(j.assign, sec)), archived: allDone ? 1 : 0 };
  if (!j.id) {
    const id = newId();
    await q("INSERT INTO jobs (id,order_ref,customer,title,status,due,assigned,details,sections,assign,archived,deleted,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,'',?,?,?,?,0,?,?,?)", [id, f.order_ref, f.customer, f.title, f.status, f.due, f.details, f.sections, f.assign, f.archived, now, now, by]);
    await log(q, by, { id, order_ref: f.order_ref, title: f.title, customer: f.customer }, by + ' created ' + lab(f) + ' → ' + Object.keys(sec).map(k => SECNAME[k]).join(', '));
    return { ok: true, id };
  }
  const r = await q('UPDATE jobs SET order_ref=?,customer=?,title=?,status=?,due=?,details=?,sections=?,assign=?,archived=?,updated_at=?,updated_by=? WHERE id=? AND deleted=0 AND updated_at=?', [f.order_ref, f.customer, f.title, f.status, f.due, f.details, f.sections, f.assign, f.archived, now, by, str(j.id, 40), str(j.base, 40)]);
  if (!r.changes) return { conflict: true };
  await log(q, by, { id: j.id, order_ref: f.order_ref, title: f.title, customer: f.customer }, by + ' edited ' + lab(f) + (f.due ? ' (due ' + f.due + ')' : ''));
  return { ok: true, id: j.id };
}
async function mutate(q, id, by, fn) {
  for (let i = 0; i < 4; i++) {
    const row = (await q('SELECT * FROM jobs WHERE id=? AND deleted=0', [str(id, 40)])).rows[0];
    if (!row) throw new HttpError(404, 'That job no longer exists.');
    const set = await fn(row); if (!set) return row;
    const cols = Object.keys(set);
    const r = await q('UPDATE jobs SET ' + cols.map(k => k + '=?').join(', ') + ', updated_at=?, updated_by=? WHERE id=? AND updated_at=?', [...cols.map(k => set[k]), new Date().toISOString(), by, str(id, 40), row.updated_at]);
    if (r.changes) return row;
  }
  throw new HttpError(409, 'Someone else is changing that job right now. Please try again.');
}
async function moveSection(q, by, id, key, status) {
  if (!SECTIONS.includes(key)) throw new HttpError(400, 'Unknown section.');
  if (!STATUSES.includes(status) && status !== 'done') throw new HttpError(400, 'Unknown status.');
  let archived = false, lbl = null, same = false;
  await mutate(q, id, by, row => {
    const sec = cleanSections(parse(row.sections)); lbl = row; if (sec[key] === status) { same = true; return null; } sec[key] = status;
    archived = Object.values(sec).every(v => v === 'done');
    return { sections: JSON.stringify(sec), status: Object.values(sec).find(v => v !== 'done') || 'received', archived: archived ? 1 : 0 };
  });
  if (!same) await log(q, by, lbl, by + ' moved ' + lab(lbl) + ' — ' + SECNAME[key] + ': ' + STNAME[status] + (archived ? ' (all sections finished)' : ''));
  return { ok: true, archived: archived && !same };
}
async function setAssign(q, by, id, key, name) {
  if (!SECTIONS.includes(key)) throw new HttpError(400, 'Unknown section.');
  let lbl = null;
  await mutate(q, id, by, row => { const a = parse(row.assign); if (name) a[key] = str(name, 60); else delete a[key]; lbl = row; return { assign: JSON.stringify(a) }; });
  await log(q, by, lbl, by + (name ? ' assigned ' + SECNAME[key] + ' on ' + lab(lbl) + ' to ' + name : ' cleared the ' + SECNAME[key] + ' assignee on ' + lab(lbl)));
  return { ok: true };
}
async function addJobNote(q, by, jobId, body) {
  body = str(body, 4000).trim(); if (!body) return { error: 'Type a note first.' };
  const row = (await q('SELECT * FROM jobs WHERE id=? AND deleted=0', [str(jobId, 40)])).rows[0]; if (!row) throw new HttpError(404, 'That job no longer exists.');
  const id = newId(), at = new Date().toISOString();
  await q('INSERT INTO job_notes (id,job_id,author,body,created_at) VALUES (?,?,?,?,?)', [id, row.id, by, body, at]);
  await log(q, by, row, by + ' added a note on ' + lab(row) + ': ' + body.replace(/\s+/g, ' ').slice(0, 160));
  return { ok: true, id, at };
}
async function archiveJob(q, by, id, archived) {
  let lbl = null;
  await mutate(q, id, by, row => {
    lbl = row;
    if (archived) return { archived: 1 };
    const sec = cleanSections(parse(row.sections)); for (const k of Object.keys(sec)) if (sec[k] === 'done') sec[k] = 'received';
    return { sections: JSON.stringify(sec), archived: 0 };
  });
  await log(q, by, lbl, by + (archived ? ' archived ' : ' restored ') + lab(lbl));
  return { ok: true };
}
async function board(q) {
  const jobs = (await q("SELECT * FROM jobs WHERE deleted=0 AND archived=0 ORDER BY due='' , due, created_at LIMIT 400")).rows;
  const jobNotes = (await q('SELECT * FROM job_notes ORDER BY created_at DESC LIMIT 400')).rows;
  const staff = (await q('SELECT name FROM staff ORDER BY name COLLATE NOCASE')).rows.map(s => s.name);
  const warn = (await q("SELECT v FROM settings WHERE k='due_warn_days'")).rows[0];
  return { jobs, jobNotes, staff, dueWarnDays: warn ? warn.v : '2', now: new Date().toISOString() };
}

// ---------------- Inbox ----------------
async function inboxList(q) {
  await q("UPDATE inbox SET state='new' WHERE state='sending' AND updated_at < ?", [new Date(Date.now() - 600000).toISOString()]);
  const rows = (await q("SELECT * FROM inbox WHERE state IN ('new','dismissed') ORDER BY created DESC, ref DESC LIMIT 400")).rows;
  const staff = (await q('SELECT name FROM staff ORDER BY name COLLATE NOCASE')).rows.map(r => r.name);
  return { rows, staff };
}
async function inboxSave(q, by, j) {
  const sec = cleanSections(j.sections), due = YMD.test(j.due || '') ? j.due : '';
  const r = await q("UPDATE inbox SET ref=?,customer=?,title=?,details=?,due=?,sections=?,assign=?,updated_at=?,updated_by=? WHERE id=? AND state='new' AND updated_at=?",
    [str(j.ref, 40), str(j.customer, 120), str(j.title, 200), str(j.details, 5000), due, JSON.stringify(sec), JSON.stringify(cleanAssign(j.assign, sec)), new Date().toISOString(), by, str(j.id, 40), str(j.base, 40)]);
  return r.changes ? { ok: true } : { conflict: true };
}
async function inboxSend(q, by, j) {
  const sec = cleanSections(j.sections);
  if (!Object.keys(sec).length) return { error: 'Pick at least one section (Embroidery, Heat press, Sublimation, or Trophy & awards) before sending it to the board.' };
  const claim = await q("UPDATE inbox SET state='sending', updated_at=?, updated_by=? WHERE id=? AND state='new'", [new Date().toISOString(), by, str(j.id, 40)]);
  if (!claim.changes) return { error: 'Someone else already sent this one to the board, or removed it. Refresh the Inbox.' };
  let res;
  try { res = await saveJob(q, by, { id: '', order_ref: j.ref, customer: j.customer, title: j.title, details: j.details, due: j.due, sections: j.sections, assign: j.assign }); }
  catch (e) { await q("UPDATE inbox SET state='new' WHERE id=? AND state='sending'", [str(j.id, 40)]); throw e; }
  if (!res || !res.ok) { await q("UPDATE inbox SET state='new' WHERE id=? AND state='sending'", [str(j.id, 40)]); return res || { error: 'Could not create the job.' }; }
  await q("UPDATE inbox SET state='sent', job_id=?, updated_at=? WHERE id=?", [res.id, new Date().toISOString(), str(j.id, 40)]);
  return { ok: true, id: res.id };
}
async function inboxDismiss(q, by, id, undo) {
  const r = await q('UPDATE inbox SET state=?, updated_at=?, updated_by=? WHERE id=? AND state=?', [undo ? 'new' : 'dismissed', new Date().toISOString(), by, str(id, 40), undo ? 'dismissed' : 'new']);
  if (!r.changes) return { error: 'That one has already changed. Refresh the Inbox.' };
  const row = (await q('SELECT ref,title,customer FROM inbox WHERE id=?', [str(id, 40)])).rows[0];
  if (row) await log(q, by, { id: str(id, 40), order_ref: row.ref, title: row.title }, by + (undo ? ' restored ' : ' dismissed ') + lab({ order_ref: row.ref, title: row.title, customer: row.customer }) + (undo ? ' to the Inbox' : ' from the Inbox (not an order)'));
  return { ok: true };
}

// ---------------- requests ----------------
const SEC_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Strict-Transport-Security': 'max-age=31536000'
};
const reply = (body, status, type, extra) => new Response(body, { status: status || 200, headers: Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SEC_HEADERS, extra || {}) });
const json = (o, status) => reply(JSON.stringify(o), status);
const ASSET_TYPES = { '/': 'text/html; charset=utf-8', '/app.js': 'application/javascript; charset=utf-8', '/app.css': 'text/css; charset=utf-8', '/manifest.webmanifest': 'application/manifest+json' };

async function handle(request, env) {
  const url = new URL(request.url), path = url.pathname;
  const problem = configProblem(env);
  if (problem) return reply('This page is not set up yet (missing ' + problem + ').', 503, 'text/plain; charset=utf-8');
  const email = await verifyAccess(request, env);
  const users = usersOf(env), me = users[email];
  if (!me || !me.name) throw new HttpError(403, 'This email is not allowed to use the Hub.');
  if (request.method === 'GET' && ASSET_TYPES[path] && typeof ASSETS !== 'undefined' && ASSETS[path] != null) return reply(ASSETS[path], 200, ASSET_TYPES[path]);
  if (!path.startsWith('/api/')) throw new HttpError(404, 'Not found.');
  const q = makeDb(env);
  // a staff row keeps the exact spelling of the name used elsewhere in the Hub
  const sr = (await q('SELECT name FROM staff WHERE name = ? COLLATE NOCASE', [str(me.name, 60)])).rows[0];
  const who = (sr ? sr.name : str(me.name, 60)), by = who + ' (phone)';
  if (request.method === 'GET') {
    if (path === '/api/me') return json({ name: who });
    if (path === '/api/board') return json(await board(q));
    if (path === '/api/inbox') return json(await inboxList(q));
    throw new HttpError(404, 'Not found.');
  }
  if (request.method !== 'POST') throw new HttpError(405, 'Not allowed.');
  // changes must come from this page itself
  const origin = request.headers.get('Origin'), site = request.headers.get('Sec-Fetch-Site');
  if (request.headers.get('X-GM') !== '1' || !/^application\/json/i.test(request.headers.get('Content-Type') || '') || (origin && origin !== url.origin) || (site && !/^(same-origin|none)$/.test(site))) throw new HttpError(403, 'Blocked.');
  const len = parseInt(request.headers.get('Content-Length') || '0', 10); if (len > 100000) throw new HttpError(413, 'Too large.');
  let b; try { b = await request.json(); } catch (e) { throw new HttpError(400, 'Bad request.'); }
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Bad request.');
  switch (path) {
    case '/api/job/save': return json(await saveJob(q, by, b));
    case '/api/job/section': return json(await moveSection(q, by, b.id, b.key, b.status));
    case '/api/job/assign': return json(await setAssign(q, by, b.id, b.key, b.name));
    case '/api/job/note': return json(await addJobNote(q, by, b.id, b.body));
    case '/api/job/archive': return json(await archiveJob(q, by, b.id, !!b.archived));
    case '/api/inbox/save': return json(await inboxSave(q, by, b));
    case '/api/inbox/send': return json(await inboxSend(q, by, b));
    case '/api/inbox/dismiss': return json(await inboxDismiss(q, by, b.id, !!b.undo));
  }
  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      return json({ error: 'Something went wrong on the server. Try again.' }, 500);   // details stay out of the response
    }
  }
};
export { verifyAccess, handle };
