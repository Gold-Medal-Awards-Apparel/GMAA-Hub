// Timesheet tab: clock in/out with your own PIN, see your own hours by pay period. Admins see and fix everyone's hours.
// All permission checks happen in the main process; this screen only shows what it is given.
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const view = $('tsView'), gm = window.__gm || {};
  const S = { mode: 'clock', off: 0, mine: null, all: null, who: '', msg: null, busy: false, err: '' };   // mode: clock | mine | all
  const pad = n => String(n).padStart(2, '0');
  const fdate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };
  const ftime = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
  const hm = m => Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm';
  const dec = m => (m / 60).toFixed(2);
  const local = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const mins = (e, now) => { const a = Date.parse(e.in), b = e.out ? Date.parse(e.out) : now; return b > a ? Math.round((b - a) / 60000) : 0; };
  const rng = p => { const f = s => { const [y, m, d] = s.split('-'); return new Date(+y, +m - 1, +d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }; return f(p.first) + ' to ' + f(p.last); };
  const pname = o => o === 0 ? 'This pay period' : o === -1 ? 'Last pay period' : (-o) + ' pay periods ago';
  const isAdmin = () => { const a = gm.auth ? gm.auth() : {}; return !!(a && (a.admin || a.bootstrap || !a.required)); };
  const signedInNonAdmin = () => { const a = gm.auth ? gm.auth() : {}; return !!(a && a.required && a.user && !a.admin); };

  function shell() {
    view.innerHTML = '<div class="wbar"><h2>Timesheet</h2><span class="grow"></span><span id="tsTabs"></span></div><div id="tsOut"></div>';
    paint();
  }
  function tabs() {
    const b = (m, t) => '<button class="btn' + (S.mode === m ? ' primary' : '') + '" data-a="mode" data-m="' + m + '">' + t + '</button>';
    $('tsTabs').innerHTML = b('clock', 'Clock in / out') + ' ' + b('mine', 'My hours') + (signedInNonAdmin() ? '' : ' ' + b('all', 'All employees (admin)'));
  }
  function paint() {
    if (!$('tsOut')) return; tabs();
    $('tsOut').innerHTML = S.mode === 'clock' ? clockHtml() : S.mode === 'mine' ? mineHtml() : allHtml();
    if (S.mode === 'clock') { const p = $('tsPin'); if (p && !S.msg) p.focus(); }
  }

  // ---------- clock in / out ----------
  function clockHtml() {
    const m = S.msg, box = m ? '<div class="card" style="margin-top:12px;background:' + (m.error ? 'var(--warn)' : '#E6F4EA') + ';font-size:17px">' + m.html + '</div>' : '';
    return '<div class="card" style="max-width:460px"><div class="note" style="margin-top:0">Type <b>your own</b> 4-digit PIN, then press the button. It records the time for you, and only you.</div>' +
      '<input id="tsPin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="Your PIN" style="font-size:24px;letter-spacing:8px;text-align:center;width:100%;box-sizing:border-box;margin:6px 0 10px">' +
      '<div class="srow" style="gap:10px"><button class="btn primary" data-a="in" style="flex:1;font-size:17px;padding:12px">Clock in</button><button class="btn" data-a="out" style="flex:1;font-size:17px;padding:12px">Clock out</button></div></div>' + box;
  }
  async function doClock(kind) {
    const pin = ($('tsPin') || {}).value || ''; if (S.busy) return;
    if (!/^\d{4}$/.test(pin)) { S.msg = { error: 1, html: 'Enter your 4-digit PIN first.' }; paint(); return; }
    S.busy = true; $('tsOut').style.opacity = .6;
    let r; try { r = await window.api.tsClock(pin, kind); } catch (e) { r = { error: String(e.message || e) }; }
    S.busy = false; $('tsOut').style.opacity = 1;
    if (r && r.offline) r = { error: 'No internet connection right now, so nothing was recorded. Try again when it is back.' };
    if (!r || r.error) S.msg = { error: 1, html: esc((r && r.error) || 'Something went wrong.') + (r && r.already && r.since ? ' (since ' + esc(ftime(r.since)) + ')' : '') + (r && r.waitSec ? ' Wait ' + r.waitSec + ' seconds.' : r && r.triesLeft != null ? ' ' + r.triesLeft + ' tries left.' : '') + ' <b>Nothing was recorded.</b>' };
    else if (r.kind === 'in') S.msg = { html: '<b>' + esc(r.name) + '</b>, you are clocked <b>in</b> at <b>' + esc(ftime(r.at)) + '</b>. Have a good shift.' };
    else S.msg = { html: '<b>' + esc(r.name) + '</b>, you are clocked <b>out</b> at <b>' + esc(ftime(r.at)) + '</b>.<br>This shift: <b>' + hm(r.shiftMin) + '</b> &nbsp;·&nbsp; This pay period so far: <b>' + hm(r.periodMin) + '</b> (' + dec(r.periodMin) + ' hours)' };
    paint(); const p = $('tsPin'); if (p) { p.value = ''; }
    clearTimeout(S.t); if (r && r.ok) S.t = setTimeout(() => { S.msg = null; if (S.mode === 'clock') paint(); }, 12000);
  }

  // ---------- my hours ----------
  function entryRows(list, now, admin) {
    if (!list.length) return '<tr><td colspan="' + (admin ? 7 : 6) + '" class="muted" style="padding:12px">No hours in this pay period.</td></tr>';
    return list.map(e => '<tr>' + (admin ? '<td><b>' + esc(e.person) + '</b></td>' : '') + '<td>' + esc(fdate(e.in)) + '</td><td>' + esc(ftime(e.in)) + '</td><td>' + (e.out ? esc(ftime(e.out) + (new Date(e.out).toDateString() !== new Date(e.in).toDateString() ? ' (' + fdate(e.out) + ')' : '')) : '<span class="up" style="color:#067647"><b>still clocked in</b></span>') + '</td><td class="n">' + hm(mins(e, now)) + '</td><td class="n">' + dec(mins(e, now)) + '</td><td>' + esc(e.note) + (e.edited_by ? ' <span class="muted">(edited by ' + esc(e.edited_by) + ')</span>' : '') + (admin ? ' <button class="btn" data-a="edit" data-id="' + esc(e.id) + '">Edit</button>' : '') + '</td></tr>').join('');
  }
  function nav(p) {
    return '<div class="srow" style="margin:8px 0;gap:8px"><button class="btn" data-a="prev">&larr; Earlier</button><b>' + esc(pname(p.offset)) + ': ' + esc(rng(p)) + '</b><button class="btn" data-a="next"' + (p.offset >= 0 ? ' disabled' : '') + '>Later &rarr;</button></div>';
  }
  function mineHtml() {
    const d = S.mine;
    if (!d) return '<div class="card">' + (S.err ? esc(S.err) : 'Loading your hours…') + '<br><br><button class="btn primary" data-a="reload">Sign in with PIN and show my hours</button></div>';
    const now = Date.parse(d.now);
    return '<div class="note" style="margin-top:0">Showing hours for <b>' + esc(d.me) + '</b> only.</div>' + nav(d.period) +
      '<table class="wt tst"><tr><th>Date</th><th>In</th><th>Out</th><th class="n">Time</th><th class="n">Hours</th><th>Note</th></tr>' + entryRows(d.entries, now, false) + '</table>' +
      '<div class="card" style="margin-top:10px;max-width:360px">Total for this pay period: <b style="font-size:19px">' + hm(d.totalMin) + '</b> (' + dec(d.totalMin) + ' hours)</div>' +
      '<div class="note">If a time is wrong or you forgot to clock out, ask an admin to fix it.</div>';
  }
  async function loadMine() {
    S.err = ''; const r = await gm.write(() => window.api.tsMine(S.off), null);
    if (!r) { S.mine = null; S.err = 'Sign in with your PIN to see your hours.'; }
    else if (r.error) { S.mine = null; S.err = r.error.replace(/^LOCKED: /, ''); if (r.offline) S.err = 'No internet connection right now.'; }
    else S.mine = r;
    paint();
  }

  // ---------- admin: all employees ----------
  function allHtml() {
    const d = S.all;
    if (!d) return '<div class="card">' + (S.err ? esc(S.err) : 'Loading…') + '<br><br><button class="btn primary" data-a="reload">Sign in with PIN and show everyone</button></div>';
    const now = Date.parse(d.now), who = S.who;
    const list = who ? d.entries.filter(e => e.person.toLowerCase() === who.toLowerCase()) : d.entries;
    const names = Array.from(new Set(d.staff.map(s => s.name).concat(d.entries.map(e => e.person))));
    const tot = names.map(n => ({ n, m: d.totals[n.toLowerCase()] || 0 })), grand = tot.reduce((a, x) => a + x.m, 0);
    const clockedIn = d.open.length ? '<div class="note"><b>Clocked in right now:</b> ' + d.open.map(o => esc(o.person) + ' since ' + esc(ftime(o.in))).join(', ') + '</div>' : '';
    return nav(d.period) + clockedIn +
      '<div class="srow" style="gap:8px;margin:6px 0"><select id="tsWho"><option value="">All employees</option>' + names.map(n => '<option' + (n === who ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select><span class="grow"></span><button class="btn" data-a="add">+ Add missing hours</button><button class="btn" data-a="csv">Save as spreadsheet</button><button class="btn" data-a="payset">Pay period…</button></div>' +
      '<table class="wt tst" style="max-width:520px"><tr><th>Employee</th><th class="n">Time</th><th class="n">Hours</th></tr>' + tot.map(x => '<tr><td>' + esc(x.n) + '</td><td class="n">' + hm(x.m) + '</td><td class="n">' + dec(x.m) + '</td></tr>').join('') + '<tr><td><b>Everyone</b></td><td class="n"><b>' + hm(grand) + '</b></td><td class="n"><b>' + dec(grand) + '</b></td></tr></table>' +
      '<h3 style="margin:14px 0 4px">Every entry</h3><table class="wt tst"><tr><th>Employee</th><th>Date</th><th>In</th><th>Out</th><th class="n">Time</th><th class="n">Hours</th><th>Note</th></tr>' + entryRows(list, now, true) + '</table>' +
      (d.settings.isDefault ? '<div class="note"><b>The pay period has not been set yet.</b> It is using a two-week default. Use "Pay period…" to enter your real first day.</div>' : '');
  }
  async function loadAll() {
    S.err = ''; const r = await gm.write(() => window.api.tsAll(S.off), null);
    if (!r) { S.all = null; S.err = 'Sign in with an admin PIN to see everyone.'; }
    else if (r.error) { S.all = null; S.err = r.error.replace(/^LOCKED: /, ''); if (r.offline) S.err = 'No internet connection right now.'; }
    else S.all = r;
    paint();
  }
  const reload = () => S.mode === 'mine' ? loadMine() : S.mode === 'all' ? loadAll() : paint();

  // ---------- modals ----------
  const modal = () => $('tsModal');
  function openModal(html) { let m = modal(); if (!m) { m = document.createElement('div'); m.id = 'tsModal'; m.className = 'wmodal'; m.style.zIndex = 110; document.body.appendChild(m); } m.innerHTML = '<div class="card" style="width:min(480px,94vw);max-height:90vh;overflow:auto">' + html + '</div>'; }
  function closeModal() { const m = modal(); if (m) m.remove(); }
  function entryForm(e) {
    const d = S.all, names = d.staff.map(s => s.name);
    const nowL = local(new Date().toISOString());
    openModal('<h3 style="margin:0 0 6px">' + (e ? 'Edit hours' : 'Add missing hours') + '</h3>' +
      '<label>Employee</label><select id="tfWho">' + names.map(n => '<option' + (e && e.person.toLowerCase() === n.toLowerCase() ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>' +
      '<label>Clocked in</label><input id="tfIn" type="datetime-local" value="' + esc(e ? local(e.in) : '') + '" max="' + nowL + '">' +
      '<label>Clocked out <span class="muted">(leave empty if they are still on the clock)</span></label><input id="tfOut" type="datetime-local" value="' + esc(e && e.out ? local(e.out) : '') + '" max="' + nowL + '">' +
      '<label>Note <span class="muted">(why it was changed)</span></label><input id="tfNote" maxlength="300" value="' + esc(e ? e.note : '') + '">' +
      '<div class="srow" style="margin-top:12px;gap:8px"><button class="btn primary" data-a="tsave" data-id="' + esc(e ? e.id : '') + '">Save</button>' + (e ? '<button class="btn" data-a="tdel" data-id="' + esc(e.id) + '" style="color:#B42318">Delete entry</button>' : '') + '<span class="grow"></span><button class="btn" data-a="tclose">Cancel</button></div><div class="note" id="tfMsg" style="min-height:18px"></div>');
  }
  function periodForm() {
    const s = S.all.settings;
    openModal('<h3 style="margin:0 0 6px">Pay period</h3><div class="note">Pick the <b>first day</b> of any pay period (past or future). Every other period is counted from it.</div>' +
      '<label>First day of a pay period</label><input id="tpDate" type="date" value="' + esc(s.anchor) + '"><label>Length</label><select id="tpDays"><option value="14"' + (s.days === 14 ? ' selected' : '') + '>Every 2 weeks</option><option value="7"' + (s.days === 7 ? ' selected' : '') + '>Every week</option></select>' +
      '<div class="srow" style="margin-top:12px;gap:8px"><button class="btn primary" data-a="tpsave">Save</button><span class="grow"></span><button class="btn" data-a="tclose">Cancel</button></div><div class="note" id="tfMsg" style="min-height:18px"></div>');
  }
  function csv() {
    const d = S.all, now = Date.parse(d.now), q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Employee', 'Date', 'Clock in', 'Clock out', 'Minutes', 'Hours', 'Note', 'Edited by']];
    d.entries.forEach(e => { const m = mins(e, now); rows.push([e.person, new Date(e.in).toLocaleDateString(), new Date(e.in).toLocaleTimeString(), e.out ? new Date(e.out).toLocaleString() : 'STILL CLOCKED IN', m, dec(m), e.note, e.edited_by]); });
    rows.push([]); Object.keys(d.totals).forEach(k => { const n = (d.staff.find(s => s.name.toLowerCase() === k) || { name: k }).name; rows.push(['TOTAL ' + n, '', '', '', d.totals[k], dec(d.totals[k])]); });
    const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'timesheet ' + d.period.first + ' to ' + d.period.last + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const fmsg = t => { const e = $('tfMsg'); if (e) e.textContent = t; };

  async function onClick(e) {
    const t = e.target.closest('[data-a]'); if (!t) return; const a = t.dataset.a;
    if (a === 'mode') { S.mode = t.dataset.m; S.off = 0; S.msg = null; S.err = ''; if (S.mode === 'clock') paint(); else { S.mine = null; S.all = null; paint(); reload(); } }
    else if (a === 'in' || a === 'out') doClock(a);
    else if (a === 'prev') { S.off--; reload(); }
    else if (a === 'next') { if (S.off < 0) { S.off++; reload(); } }
    else if (a === 'reload') reload();
    else if (a === 'add') entryForm(null);
    else if (a === 'edit') { const x = S.all.entries.find(z => z.id === t.dataset.id); if (x) entryForm(x); }
    else if (a === 'payset') periodForm();
    else if (a === 'csv') csv();
    else if (a === 'tclose') closeModal();
    else if (a === 'tsave') {
      const inV = $('tfIn').value, outV = $('tfOut').value;
      if (!inV) { fmsg('Enter the clock-in date and time.'); return; }
      const f = { id: t.dataset.id || '', person: $('tfWho').value, in: new Date(inV).toISOString(), out: outV ? new Date(outV).toISOString() : '', note: $('tfNote').value };
      const r = await gm.write(() => window.api.tsSave(f), null);
      if (!r) return; if (r.error) { fmsg(r.error.replace(/^LOCKED: /, '')); return; }
      closeModal(); gm.toast && gm.toast('Saved.'); loadAll();
    }
    else if (a === 'tdel') {
      if (!confirm('Delete this entry? The hours will no longer count.')) return;
      const r = await gm.write(() => window.api.tsDelete(t.dataset.id), null);
      if (!r) return; if (r.error) { fmsg(r.error.replace(/^LOCKED: /, '')); return; }
      closeModal(); gm.toast && gm.toast('Deleted.'); loadAll();
    }
    else if (a === 'tpsave') {
      const r = await gm.write(() => window.api.tsPeriod($('tpDate').value, +$('tpDays').value), null);
      if (!r) return; if (r.error) { fmsg(r.error.replace(/^LOCKED: /, '')); return; }
      closeModal(); gm.toast && gm.toast('Pay period saved.'); S.off = 0; loadAll();
    }
  }
  view.addEventListener('click', onClick);
  document.addEventListener('click', e => { if (modal() && modal().contains(e.target)) onClick(e); });
  view.addEventListener('change', e => { if (e.target.id === 'tsWho') { S.who = e.target.value; paint(); } });
  view.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'tsPin') { e.preventDefault(); } });

  function show() {
    if (window.__hideWork) window.__hideWork();
    ['main', '#custView', '#priceView'].forEach(sel => { const el = document.querySelector(sel); if (el) el.style.display = 'none'; });
    ['tabSearch', 'tabCust', 'tabPrice'].forEach(i => $(i) && $(i).classList.remove('on'));
    view.style.display = 'block'; $('tabTime').classList.add('on');
    S.mode = 'clock'; S.msg = null; S.mine = null; S.all = null; S.off = 0; S.who = ''; shell();
  }
  const prevHide = window.__hideWork;
  window.__hideWork = () => { if (prevHide) prevHide(); if (view.style.display !== 'none') view.style.display = 'none'; $('tabTime').classList.remove('on'); closeModal(); };
  // When the sign-in times out, hours disappear from the screen (the clock screen needs no sign-in).
  setInterval(() => { if (view.style.display === 'none' || S.mode === 'clock') return; const a = gm.auth ? gm.auth() : null; if (a && a.required && !a.user && (S.mine || S.all)) { S.mine = null; S.all = null; S.err = 'Signed out after being idle. Sign in again to see hours.'; paint(); closeModal(); } }, 10000);
  window.__showTimesheet = show; $('tabTime').onclick = show;
})();
