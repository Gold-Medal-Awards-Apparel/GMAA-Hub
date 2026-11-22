(function () {
'use strict';
var SECTIONS = ['embroidery', 'heatpress', 'sublimation', 'trophy'];
var SECNAME = { embroidery: 'Embroidery', heatpress: 'Heat press', sublimation: 'Sublimation', trophy: 'Trophy & awards' };
var STATUSES = ['received', 'hold', 'material', 'progress', 'pickup', 'delivery', 'done'];
var STNAME = { received: 'Received', hold: 'On Hold', material: 'Material Ordered', progress: 'In Progress', pickup: 'Ready for Pickup', delivery: 'Ready for Delivery/Shipping', done: 'Finished' };
var RED_DAYS = 7;
var S = { tab: 'board', board: null, inbox: null, filter: 'all', q: '', sheet: null, showDismissed: false, err: '', who: '' };
var app = document.getElementById('app'), toastEl = document.getElementById('toast'), toastT = 0;

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function pj(s) { try { var m = JSON.parse(s || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } }
function toast(m) { toastEl.textContent = m; toastEl.className = 'on'; clearTimeout(toastT); toastT = setTimeout(function () { toastEl.className = ''; }, Math.min(8000, 2200 + m.length * 40)); }
function api(method, path, body) {
  var o = { method: method, credentials: 'same-origin', headers: {} };
  if (method === 'POST') { o.headers['Content-Type'] = 'application/json'; o.headers['X-GM'] = '1'; o.body = JSON.stringify(body || {}); }
  return fetch(path, o).then(function (r) {
    if (r.status === 401 || r.status === 403 && method === 'GET') { throw new Error('Your sign-in expired. Reload the page.'); }
    return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; });
  });
}
function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function parseYmd(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
function daysFrom(s) { var d = parseYmd(s); return d ? Math.round((d - today()) / 86400000) : null; }
function fmtDue(s) { var d = parseYmd(s); return d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' }) : ''; }
function warnDays() { var n = parseInt(S.board && S.board.dueWarnDays, 10); return n >= 1 && n <= 14 ? n : 2; }
function level(j) {
  if (j.archived || !j.due) return '';
  var secs = pj(j.sections), vals = Object.keys(secs).map(function (k) { return secs[k]; });
  if (vals.length && vals.every(function (v) { return v === 'done' || v === 'pickup' || v === 'delivery'; })) return '';
  var d = daysFrom(j.due); if (d == null) return '';
  return d <= 0 ? 'hot' : d <= warnDays() ? 'soon' : '';
}
function dueText(j) {
  var d = daysFrom(j.due); if (d == null) return '';
  var t = d < 0 ? Math.abs(d) + (Math.abs(d) === 1 ? ' day late' : ' days late') : d === 0 ? 'today' : d === 1 ? 'tomorrow' : '';
  return 'Due ' + fmtDue(j.due) + (t ? ' · ' + t : '');
}
function inboxRed(r) { var a = pj(r.assign), secs = pj(r.sections); var assigned = Object.keys(secs).length && Object.keys(secs).every(function (k) { return a[k]; }); if (assigned) return false; var d = daysFrom(r.created); return d != null && -d > RED_DAYS; }

function load(which) {
  S.err = '';
  var ps = [];
  if (which !== 'inbox') ps.push(api('GET', '/api/board').then(function (b) { S.board = b; }));
  if (which !== 'board') ps.push(api('GET', '/api/inbox').then(function (b) { S.inbox = b; }));
  return Promise.all(ps).then(render, function (e) { S.err = e.message; render(); });
}

function top(title, right) { return '<div class="top"><h1>' + esc(title) + '</h1>' + (right || '') + '</div>'; }
function secLines(j) {
  var secs = pj(j.sections), a = pj(j.assign);
  return Object.keys(secs).map(function (k) { return '<div class="sec"><span class="sn">' + esc(SECNAME[k]) + '</span><span class="ss">' + esc(STNAME[secs[k]] || secs[k]) + '</span>' + (secs[k] === 'done' ? '' : a[k] ? '<span class="sa">' + esc(a[k]) + '</span>' : '<span class="sa none">no one assigned</span>') + '</div>'; }).join('');
}
function boardHtml() {
  var b = S.board; if (!b) return '<div class="empty">Loading…</div>';
  var q = S.q.trim().toLowerCase();
  var jobs = b.jobs.filter(function (j) {
    if (S.filter !== 'all' && !pj(j.sections)[S.filter]) return false;
    return !q || (j.order_ref + ' ' + j.customer + ' ' + j.title + ' ' + j.details).toLowerCase().indexOf(q) >= 0;
  });
  var late = b.jobs.filter(function (j) { return level(j) === 'hot'; }).length;
  var h = (late ? '<div class="bar hot"><b>' + late + '</b> due today or late</div>' : '');
  h += '<div class="chips">' + [['all', 'All']].concat(SECTIONS.map(function (k) { return [k, SECNAME[k]]; })).map(function (c) { return '<button class="chip' + (S.filter === c[0] ? ' on' : '') + '" data-a="filter" data-v="' + c[0] + '">' + esc(c[1]) + '</button>'; }).join('') + '</div>';
  h += '<input class="search" id="q" type="search" placeholder="Search orders" value="' + esc(S.q) + '">';
  if (!jobs.length) h += '<div class="empty">Nothing here.</div>';
  jobs.forEach(function (j) {
    var lv = level(j), d = daysFrom(j.due);
    h += '<div class="job' + (lv ? ' dl-' + lv : '') + '" data-a="job" data-id="' + esc(j.id) + '"><div class="ref">' + esc(j.order_ref || '(no number)') + '</div><div class="cust">' + esc(j.customer) + '</div><div class="ttl">' + esc(j.title) + '</div>' + (j.due ? '<div class="due' + (d != null && d < 0 ? ' late' : '') + '">' + esc(dueText(j)) + '</div>' : '') + '<div class="secs">' + secLines(j) + '</div></div>';
  });
  return '<div class="wrap">' + h + '</div><button class="fab" data-a="newjob" aria-label="New job">+</button>';
}
function inboxHtml() {
  var b = S.inbox; if (!b) return '<div class="empty">Loading…</div>';
  var rows = b.rows.filter(function (r) { return r.state === 'new'; }), dis = b.rows.filter(function (r) { return r.state === 'dismissed'; });
  rows.sort(function (a, c) { return (inboxRed(c) - inboxRed(a)) || String(a.created).localeCompare(String(c.created)); });
  var red = rows.filter(inboxRed).length, h = red ? '<div class="bar hot"><b>' + red + '</b> unassigned more than ' + RED_DAYS + ' days</div>' : '';
  if (!rows.length) h += '<div class="empty">Inbox is empty. New Shopify orders appear here when a Hub on the shop computers checks Shopify.</div>';
  rows.forEach(function (r) {
    h += '<div class="inc' + (inboxRed(r) ? ' red' : '') + '" data-a="inc" data-id="' + esc(r.id) + '"><div class="ref">' + (r.kind === 'draft' ? '<span class="draft">DRAFT</span>' : '') + esc(r.ref) + '</div><div class="cust">' + esc(r.customer) + '</div><div class="ttl">' + esc(r.title) + '</div><div class="due">Ordered ' + esc(r.created) + (r.due ? ' · ' + esc(dueText(r)) : '') + '</div>' + (r.flag ? '<div class="flag">Shopify: ' + esc(r.flag) + '</div>' : '') + '<div class="secs">' + secLines(r) + '</div></div>';
  });
  if (dis.length) { h += '<div class="btns"><button class="btn" data-a="togdis">' + (S.showDismissed ? 'Hide' : 'Show') + ' dismissed (' + dis.length + ')</button></div>'; if (S.showDismissed) dis.forEach(function (r) { h += '<div class="inc" data-id="' + esc(r.id) + '"><div class="ref">' + esc(r.ref) + '</div><div class="cust">' + esc(r.customer) + '</div><div class="btns"><button class="btn" data-a="restore" data-id="' + esc(r.id) + '">Put back in Inbox</button></div></div>'; }); }
  return '<div class="wrap">' + h + '</div>';
}
function staffOpts(sel) { return '<option value="">— no one —</option>' + (S.board ? S.board.staff : S.inbox.staff).map(function (n) { return '<option' + (n === sel ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join(''); }
function secEditor(secs, a) {
  return SECTIONS.map(function (k) {
    var on = !!secs[k];
    return '<div class="secedit"><div class="h"><input type="checkbox" data-k="' + k + '" data-f="on"' + (on ? ' checked' : '') + '><span>' + esc(SECNAME[k]) + '</span></div><div class="sel"><select data-k="' + k + '" data-f="st">' + STATUSES.map(function (s) { return '<option value="' + s + '"' + ((secs[k] || 'received') === s ? ' selected' : '') + '>' + esc(STNAME[s]) + '</option>'; }).join('') + '</select><select data-k="' + k + '" data-f="as">' + staffOpts(a[k]) + '</select></div></div>';
  }).join('');
}
function sheetHtml() {
  var sh = S.sheet; if (!sh) return '';
  var j = sh.data, secs = pj(j.sections), a = pj(j.assign), isInbox = sh.kind === 'inbox', ref = isInbox ? j.ref : j.order_ref;
  var h = top(sh.kind === 'new' ? 'New job' : ref || 'Job', '<button class="ibtn" data-a="close">Close</button>') + '<div class="wrap">';
  if (isInbox && j.flag) h += '<div class="flag">Shopify: ' + esc(j.flag) + '</div>';
  h += '<label>Order number</label><input id="f_ref" value="' + esc(ref) + '"><label>Customer</label><input id="f_customer" value="' + esc(j.customer) + '"><label>Job title</label><input id="f_title" value="' + esc(j.title) + '"><label>Due date</label><input id="f_due" type="date" value="' + esc(j.due) + '"><label>Details</label><textarea id="f_details" rows="5">' + esc(j.details) + '</textarea><label>Sections, status and who is working on it</label>' + secEditor(secs, a);
  h += '<div class="btns"><button class="btn primary grow" data-a="' + (isInbox ? 'incsave' : 'jobsave') + '">Save</button>' + (isInbox ? '<button class="btn primary grow" data-a="incsend">Send to board</button>' : '') + '</div>';
  if (isInbox) h += '<div class="btns"><button class="btn danger grow" data-a="incdismiss">' + (j.kind === 'draft' ? 'Not an order' : 'Not for the board') + '</button></div>';
  if (sh.kind === 'job') {
    h += '<label>Notes</label>' + (S.board.jobNotes.filter(function (n) { return n.job_id === j.id; }).map(function (n) { return '<div class="note">' + esc(n.body) + '<div class="by">' + esc(n.author) + ' · ' + esc(new Date(n.created_at).toLocaleString()) + '</div></div>'; }).join('') || '<div class="empty">No notes yet.</div>') + '<textarea id="f_note" rows="2" placeholder="Add a note"></textarea><div class="btns"><button class="btn grow" data-a="addnote">Add note</button></div><div class="btns"><button class="btn danger grow" data-a="archive">Archive this job</button></div>';
  }
  return '<div class="sheet">' + h + '</div></div>';
}
function render() {
  var keepQ = document.activeElement && document.activeElement.id === 'q';
  var nIn = S.inbox ? S.inbox.rows.filter(function (r) { return r.state === 'new'; }).length : 0;
  var h = top('Gold Medal Hub', '<span class="who">' + esc(S.who) + '</span><button class="ibtn" data-a="refresh">Refresh</button>');
  h += S.err ? '<div class="wrap"><div class="err">' + esc(S.err) + '</div></div>' : (S.tab === 'board' ? boardHtml() : inboxHtml());
  h += '<div class="tabs"><button data-a="tab" data-v="board" class="' + (S.tab === 'board' ? 'on' : '') + '">Order board</button><button data-a="tab" data-v="inbox" class="' + (S.tab === 'inbox' ? 'on' : '') + '">Inbox' + (nIn ? '<span class="bdg">' + nIn + '</span>' : '') + '</button></div>' + sheetHtml();
  app.innerHTML = h;
  if (keepQ) { var q = document.getElementById('q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
}
function readSheet() {
  var d = S.sheet.data, v = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
  var secs = {}, as = {};
  SECTIONS.forEach(function (k) { var on = document.querySelector('input[data-k="' + k + '"]'); if (on && on.checked) { secs[k] = document.querySelector('select[data-k="' + k + '"][data-f="st"]').value; var w = document.querySelector('select[data-k="' + k + '"][data-f="as"]').value; if (w) as[k] = w; } });
  return { id: d.id, base: d.updated_at, order_ref: v('f_ref'), ref: v('f_ref'), customer: v('f_customer'), title: v('f_title'), due: v('f_due'), details: v('f_details'), sections: secs, assign: as };
}
var busy = false;
function act(p, okMsg, after) {
  if (busy) return; busy = true;
  p.then(function (r) { busy = false; if (r && r.error) { toast(r.error); return; } if (r && r.conflict) { toast('Someone else changed this. Reloading — redo your edit.'); S.sheet = null; return load(); } if (okMsg) toast(okMsg); if (after) after(r); return load(); }, function (e) { busy = false; toast(e.message); });
}
function empty() { return { id: '', updated_at: '', order_ref: '', customer: '', title: '', due: '', details: '', sections: '{}', assign: '{}' }; }
document.addEventListener('click', function (ev) {
  var t = ev.target.closest('[data-a]'); if (!t) return;
  var a = t.getAttribute('data-a'), id = t.getAttribute('data-id');
  if (a === 'tab') { S.tab = t.getAttribute('data-v'); render(); load(S.tab); }
  else if (a === 'filter') { S.filter = t.getAttribute('data-v'); render(); }
  else if (a === 'refresh') load().then(function () { toast('Refreshed'); });
  else if (a === 'job') { var j = S.board.jobs.filter(function (x) { return x.id === id; })[0]; if (j) { S.sheet = { kind: 'job', data: j }; render(); } }
  else if (a === 'newjob') { S.sheet = { kind: 'new', data: empty() }; render(); }
  else if (a === 'inc') { var r = S.inbox.rows.filter(function (x) { return x.id === id; })[0]; if (r) { S.sheet = { kind: 'inbox', data: r }; render(); } }
  else if (a === 'close') { S.sheet = null; render(); }
  else if (a === 'togdis') { S.showDismissed = !S.showDismissed; render(); }
  else if (a === 'restore') act(api('POST', '/api/inbox/dismiss', { id: id, undo: true }), 'Put back in the Inbox');
  else if (a === 'jobsave') { var d = readSheet(); act(api('POST', '/api/job/save', d), 'Saved', function () { S.sheet = null; }); }
  else if (a === 'incsave') act(api('POST', '/api/inbox/save', readSheet()), 'Saved', function () { S.sheet = null; });
  else if (a === 'incsend') act(api('POST', '/api/inbox/send', readSheet()), 'Sent to the order board', function () { S.sheet = null; });
  else if (a === 'incdismiss') { if (window.confirm('Remove this from the Inbox? (Shopify is not changed. You can put it back later.)')) act(api('POST', '/api/inbox/dismiss', { id: S.sheet.data.id }), 'Removed from the Inbox', function () { S.sheet = null; }); }
  else if (a === 'addnote') { var n = document.getElementById('f_note').value; act(api('POST', '/api/job/note', { id: S.sheet.data.id, body: n }), 'Note added', function () { }); }
  else if (a === 'archive') { if (window.confirm('Archive this job? It leaves the board; the desktop Hub can restore it.')) act(api('POST', '/api/job/archive', { id: S.sheet.data.id, archived: true }), 'Archived', function () { S.sheet = null; }); }
});
document.addEventListener('input', function (ev) { if (ev.target.id === 'q') { S.q = ev.target.value; var keep = ev.target.selectionStart; render(); } });
// keep the open sheet's typed values if the list reloads: the sheet is only re-rendered by load() after a save/close, so edits are not lost mid-typing
document.addEventListener('visibilitychange', function () { if (!document.hidden && !S.sheet) load(); });
api('GET', '/api/me').then(function (m) { S.who = m.name; render(); return load(); }, function (e) { S.err = e.message; render(); });
})();
