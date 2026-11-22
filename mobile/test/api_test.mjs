import assert from 'node:assert';
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const require = createRequire(import.meta.url);
const { makeCloud } = require('../../cloud.js');
const mod = await import('../src/worker.js'); const worker = mod.default;
let pass = 0; const ok = (c, m) => { assert(c, m); pass++; console.log('ok', m); };
globalThis.ASSETS = { '/': '<html>app</html>', '/app.js': 'x', '/app.css': 'x', '/manifest.webmanifest': '{}' };

// ---- fake Cloudflare Access: keys + signer
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = Object.assign(await crypto.subtle.exportKey('jwk', kp.publicKey), { kid: 'k1', alg: 'RS256', use: 'sig' });
const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
async function sign(claims, key = kp.privateKey, kid = 'k1') {
  const h = b64({ alg: 'RS256', kid, typ: 'JWT' }), p = b64(claims), sig = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + p))).toString('base64url');
  return h + '.' + p + '.' + sig;
}
const TEAM = 'shopteam', AUD = 'aud123', ORIGIN = 'https://hub.example.workers.dev';
const claims = (o) => Object.assign({ iss: 'https://' + TEAM + '.cloudflareaccess.com', aud: [AUD], email: 'katrina@example.com', exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000) }, o);
const realFetch = globalThis.fetch; let certHits = 0;
globalThis.fetch = async (u, o) => { if (String(u) === 'https://' + TEAM + '.cloudflareaccess.com/cdn-cgi/access/certs') { certHits++; return new Response(JSON.stringify({ keys: [jwk] })); } return realFetch(u, o); };

// ---- D1 binding shim -> test database
const URL_ = 'http://127.0.0.1:8799/client/v4/accounts/' + 'a'.repeat(32) + '/d1/database/8dee9967-8e8a-44e5-8373-7cfebdb0363d/query';
const DB = { prepare: sql => ({ bind: (...p) => ({ all: async () => { const r = await realFetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer goodtoken', 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params: p }) }); const j = await r.json(); if (!j.success) throw new Error(j.errors[0].message); return { results: j.result[0].results, meta: j.result[0].meta }; } }) }) };
const env = { DB, ACCESS_TEAM: TEAM, ACCESS_AUD: AUD, USERS: JSON.stringify({ 'katrina@example.com': { name: 'Katrina', admin: true } }) };

// ---- desktop code sets up schema + data
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-'));
const ss = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from('E' + s), decryptString: b => b.toString().slice(1) };
const C = makeCloud({ dir, safeStorage: ss, baseUrl: 'http://127.0.0.1:8799/client/v4' });
C.saveCreds({ accountId: 'a'.repeat(32), databaseId: '8dee9967-8e8a-44e5-8373-7cfebdb0363d', token: 'goodtoken' });
await C.addStaff('Boss', '1111', true); await C.login('1111'); await C.addStaff('Katrina', '2222', true); await C.addStaff('Amy', '3333', false);
const dj = await C.saveJob({ order_ref: 'New #1150', customer: 'Desktop Co', title: '10 × Shirt', due: '2026-12-01', sections: { heatpress: 'received' }, assign: {} });
await C.inboxImport(async () => [{ gid: 'gid://shopify/Order/1', kind: 'order', ref: 'New #1300', customer: 'Inbox Co', title: 'Job', details: '5 × glass award', created: '2026-11-20', tags: [] }, { gid: 'gid://shopify/Order/2', kind: 'order', ref: 'New #1301', customer: 'Inbox Two', title: 'Job2', details: 'x', created: '2026-11-19', tags: [] }], async () => ({}));

let tok = await sign(claims());
const call = async (method, p, body, o = {}) => { const h = Object.assign({ 'Cf-Access-Jwt-Assertion': o.token === undefined ? tok : o.token }, method === 'POST' ? { 'Content-Type': 'application/json', 'X-GM': '1', Origin: ORIGIN } : {}, o.headers || {}); if (o.noJwt) delete h['Cf-Access-Jwt-Assertion']; const r = await worker.fetch(new Request(ORIGIN + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), o.env || env); let j = null; try { j = await r.clone().json(); } catch (e) {} return { s: r.status, j, r }; };

// 1) sign-in checks
ok((await call('GET', '/api/me', null, { noJwt: true })).s === 401, 'no sign-in token -> 401');
ok((await call('GET', '/api/me', null, { token: await sign(claims({ aud: ['other'] })) })).s === 401, 'wrong audience -> 401');
ok((await call('GET', '/api/me', null, { token: await sign(claims({ exp: Math.floor(Date.now() / 1000) - 10 })) })).s === 401, 'expired token -> 401');
ok((await call('GET', '/api/me', null, { token: await sign(claims({ iss: 'https://evil.cloudflareaccess.com' })) })).s === 401, 'wrong issuer -> 401');
ok((await call('GET', '/api/me', null, { token: await sign(claims(), other.privateKey) })).s === 401, 'token signed by someone else -> 401');
const parts = tok.split('.'); const forged = parts[0] + '.' + b64(claims({ email: 'attacker@example.com' })) + '.' + parts[2];
ok((await call('GET', '/api/me', null, { token: forged })).s === 401, 'edited token (swapped email) -> 401');
ok((await call('GET', '/api/me', null, { token: await sign(claims({ email: 'stranger@example.com' })) })).s === 403, 'signed in but not on the allowed list -> 403');
ok((await call('GET', '/api/me', null, { env: Object.assign({}, env, { ACCESS_AUD: '' }) })).s === 503, 'unconfigured -> refuses (503)');
ok((await call('GET', '/api/me')).j.name === 'Katrina', 'valid sign-in -> /api/me gives the name');
ok(certHits <= 3, 'sign-in keys are cached (' + certHits + ' fetches)');
const home = await call('GET', '/'); ok(home.s === 200 && /CONTENT|default-src 'none'/i.test(home.r.headers.get('content-security-policy')) && home.r.headers.get('x-frame-options') === 'DENY', 'page served with security headers');
ok((await call('GET', '/', null, { noJwt: true })).s === 401, 'the page itself needs sign-in too');
ok((await call('GET', '/api/prices')).s === 404 && (await call('GET', '/api/timesheet')).s === 404, 'no price/timesheet endpoints exist');

// 2) board
let bd = (await call('GET', '/api/board')).j;
ok(bd.jobs.some(j => j.id === dj.id) && bd.staff.includes('Amy'), 'board shows desktop job + staff');
// 3) csrf
ok((await call('POST', '/api/job/note', { id: dj.id, body: 'x' }, { headers: { 'X-GM': '0' } })).s === 403, 'POST without header blocked');
ok((await call('POST', '/api/job/note', { id: dj.id, body: 'x' }, { headers: { Origin: 'https://evil.com' } })).s === 403, 'POST from another site blocked');
ok((await call('POST', '/api/job/note', { id: dj.id, body: 'x' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).s === 403, 'cross-site POST blocked');

// 4) job actions
let r = (await call('POST', '/api/job/save', { order_ref: 'New #1400', customer: 'Phone Co', title: 'Made on phone', due: '2026-12-10', sections: { trophy: 'received' }, assign: { trophy: 'Amy' } })).j;
ok(r.ok && r.id, 'create job from phone'); const pid = r.id;
bd = (await call('GET', '/api/board')).j; let pj = bd.jobs.find(j => j.id === pid);
ok(pj.updated_by === 'Katrina (phone)' && JSON.parse(pj.assign).trophy === 'Amy', 'stored with "(phone)" name and worker');
r = (await call('POST', '/api/job/save', { id: pid, base: pj.updated_at, order_ref: 'New #1400', customer: 'Phone Co 2', title: 'edited', due: '2026-12-11', sections: { trophy: 'progress', heatpress: 'received' }, assign: {} })).j; ok(r.ok, 'edit job');
r = (await call('POST', '/api/job/save', { id: pid, base: pj.updated_at, sections: { trophy: 'progress' } })).j; ok(r.conflict, 'stale edit -> conflict, nothing overwritten');
r = (await call('POST', '/api/job/save', { id: pid, base: 'x', sections: {} })).j; ok(/section/i.test(r.error || ''), 'needs a section');
ok((await call('POST', '/api/job/section', { id: pid, key: 'trophy', status: 'pickup' })).j.ok, 'move section status');
ok((await call('POST', '/api/job/section', { id: pid, key: 'bogus', status: 'pickup' })).s === 400, 'bad section rejected');
ok((await call('POST', '/api/job/assign', { id: pid, key: 'heatpress', name: 'Amy' })).j.ok, 'assign worker');
ok((await call('POST', '/api/job/note', { id: pid, body: 'Customer called' })).j.ok, 'add note');
ok((await call('POST', '/api/job/note', { id: 'nope', body: 'x' })).s === 404, 'note on missing job -> 404');
let m = (await call('POST', '/api/job/section', { id: pid, key: 'trophy', status: 'done' })).j; ok(m.ok && !m.archived, 'finish one section');
m = (await call('POST', '/api/job/section', { id: pid, key: 'heatpress', status: 'done' })).j; ok(m.archived, 'finishing all sections archives it');
ok(!(await call('GET', '/api/board')).j.jobs.some(j => j.id === pid), 'archived job leaves the board');
// 5) desktop sees the phone's work (same data)
const dp = await C.pull(true); const dj2 = dp.jobs.find(j => j.id === pid);
ok(dj2 && dj2.customer === 'Phone Co 2' && dp.jobNotes.some(n => n.job_id === pid && n.author === 'Katrina (phone)'), 'desktop sees the phone job and note');
const act = (await C.updates()); ok(JSON.stringify(act).includes('Katrina (phone)'), 'activity feed credits "Katrina (phone)"');
// 6) inbox
let ib = (await call('GET', '/api/inbox')).j; ok(ib.rows.length === 2, 'inbox lists imported rows');
const row = ib.rows.find(x => x.ref === 'New #1300');
r = (await call('POST', '/api/inbox/save', { id: row.id, base: row.updated_at, ref: row.ref, customer: 'Fixed Inbox Co', title: 'Fixed', details: 'd', due: '2026-12-02', sections: { trophy: 'received' }, assign: { trophy: 'Amy' } })).j; ok(r.ok, 'inbox edit + assign');
r = (await call('POST', '/api/inbox/save', { id: row.id, base: row.updated_at, sections: {} })).j; ok(r.conflict, 'inbox stale save -> conflict');
ib = (await call('GET', '/api/inbox')).j; const r1 = ib.rows.find(x => x.id === row.id);
const pay = { id: r1.id, ref: r1.ref, customer: r1.customer, title: r1.title, details: r1.details, due: r1.due, sections: { trophy: 'received' }, assign: { trophy: 'Amy' } };
const two = await Promise.all([call('POST', '/api/inbox/send', pay), call('POST', '/api/inbox/send', pay)]);
ok(two.filter(t => t.j.ok).length === 1 && two.filter(t => t.j.error).length === 1, 'double send -> exactly one job');
ok((await call('GET', '/api/board')).j.jobs.filter(j => j.order_ref === 'New #1300').length === 1, 'sent inbox order is on the board once');
const r2 = ib.rows.find(x => x.ref === 'New #1301');
ok((await call('POST', '/api/inbox/dismiss', { id: r2.id })).j.ok && (await call('POST', '/api/inbox/dismiss', { id: r2.id, undo: true })).j.ok, 'dismiss and restore');
// 7) errors don't leak
const bad = { prepare: () => ({ bind: () => ({ all: async () => { throw new Error('SQLITE secret table detail'); } }) }) };
const e500 = await call('GET', '/api/board', null, { env: Object.assign({}, env, { DB: bad }) }); ok(e500.s === 500 && !JSON.stringify(e500.j).includes('SQLITE'), 'server errors do not leak details');
console.log('PASS', pass);
