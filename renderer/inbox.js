// Inbox tab: new Shopify orders and open drafts land here automatically. Fix anything the import got wrong,
// pick sections and workers, then send the job to the Order board. Nothing here changes Shopify.
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const view = $('inView'), gm = window.__gm || {};
  if (!view || !$('tabInbox')) return;
  const SECS = [['embroidery', 'Embroidery'], ['heatpress', 'Heat press'], ['sublimation', 'Sublimation'], ['trophy', 'Trophy & awards']];
  const RED_DAYS = 7;
  const S = { rows: [], staff: [], settings: { skipTags: '', dueDays: 14 }, showDismissed: false, showSettings: false, busy: false, err: '', msg: '', loaded: false, checkedAt: 0 };

  const parse = s => { try { const m = JSON.parse(s || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } };
  const today = () => new Date(new Date().toDateString());
  const ageDays = r => { const d = new Date((r.created || '') + 'T00:00:00'); return isNaN(d) ? 0 : Math.round((today() - d) / 86400000); };
  const hasWorker = r => Object.values(parse(r.assign)).some(Boolean);
  const isRed = r => r.state === 'new' && !hasWorker(r) && ageDays(r) > RED_DAYS;
  // Same keyword rules the Order board uses when you look up an order.
  function suggest(text) {
    const t = String(text).toLowerCase(), out = [];
    if (/embroider|digitiz|\bcap\b|\bhat\b|beanie/.test(t)) out.push('embroidery');
    if (/\bdtf\b|heat press|transfer|vinyl|t-?shirt|sweatshirt|hoodie|\btee\b/.test(t)) out.push('heatpress');
    if (/sublim/.test(t)) out.push('sublimation');
    if (/trophy|trophies|medal|plaque|award|engrav|glass|figure|column|\bcup\b|ribbon/.test(t)) out.push('trophy');
    return out;
  }
  const chosen = r => { const s = parse(r.sections), k = Object.keys(s); return k.length ? { keys: k, suggested: false } : { keys: suggest(r.details || ''), suggested: true }; };
  const when = r => { const n = ageDays(r); return n <= 0 ? 'today' : n === 1 ? '1 day ago' : n + ' days ago'; };

  // ---------- data ----------
  async function load() {
    const r = await window.api.inboxList();
    if (r && r.error) { S.err = r.error; paint(); return; }
    S.err = ''; S.rows = r.rows || []; S.staff = r.staff || []; S.settings = r.settings || S.settings; S.loaded = true; badge(); paint();
  }
  async function check(manual) {
    if (S.busy) return; S.busy = true; if (manual) { S.msg = 'Checking Shopify...'; paint(); }
    try {
      const r = await window.api.inboxCheck();
      if (r && r.error) { if (manual) S.err = r.error; }
      else { S.err = ''; S.checkedAt = Date.now(); S.msg = manual ? (r.added ? r.added + ' new from Shopify.' : 'Nothing new from Shopify.') : ''; }
    } catch (e) { if (manual) S.err = 'Could not check Shopify.'; }
    S.busy = false;
    try { if (!editing()) await load(); else badge(); } catch (e) {}
  }
  const editing = () => view.style.display !== 'none' && (view.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || view.querySelector('.inc.dirty'));

  // ---------- badge + red bar ----------
  function badge() {
    const tb = $('tabInbox'), live = S.rows.filter(r => r.state === 'new');
    tb.innerHTML = 'Inbox' + (live.length ? ' <span class="bdg">' + live.length + '</span>' : '');
    let bar = $('inBar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'inBar'; const d = $('dueBar'); d.parentNode.insertBefore(bar, d.nextSibling); bar.addEventListener('click', e => { if (e.target.closest('[data-a=open]')) show(); }); }
    const red = live.filter(isRed);
    if (!red.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    bar.innerHTML = '<span class="dueic">⚠</span><span class="duetx"><b>' + red.length + (red.length === 1 ? ' Inbox order has' : ' Inbox orders have') + ' no worker assigned after more than ' + RED_DAYS + ' days</b>: ' +
      red.slice(0, 3).map(r => esc(r.ref + (r.customer ? ' ' + r.customer : ''))).join(' · ') + (red.length > 3 ? ' · + ' + (red.length - 3) + ' more' : '') + '</span><button class="btn" data-a="open">Open Inbox</button>';
  }

  // ---------- screen ----------
  function card(r) {
    const c = chosen(r), asg = parse(r.assign), red = isRed(r), dismissed = r.state === 'dismissed', draft = r.kind === 'draft';
    const tags = String(r.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const secs = SECS.map(([k, n]) => '<div class="insec"><label><input type="checkbox" data-f="sec" data-k="' + k + '"' + (c.keys.includes(k) ? ' checked' : '') + (dismissed ? ' disabled' : '') + '> ' + n + '</label>' +
      '<select data-f="asg" data-k="' + k + '"' + (c.keys.includes(k) && !dismissed ? '' : ' disabled') + '><option value="">Unassigned</option>' +
      S.staff.map(p => '<option' + (asg[k] === p ? ' selected' : '') + '>' + esc(p) + '</option>').join('') + (asg[k] && !S.staff.includes(asg[k]) ? '<option selected>' + esc(asg[k]) + '</option>' : '') + '</select></div>').join('');
    return '<div class="inc' + (red ? ' red' : '') + (dismissed ? ' gone' : '') + '" data-id="' + esc(r.id) + '" data-base="' + esc(r.updated_at) + '">' +
      '<div class="inhead"><span class="inref">' + (draft ? '<span class="indraft">DRAFT</span> ' : '') + esc(r.ref) + '</span><span class="inage' + (red ? ' hot' : '') + '">' + (draft ? 'draft created ' : 'ordered ') + esc(r.created) + ' · ' + when(r) + (red ? ' · no worker for more than ' + RED_DAYS + ' days' : '') + '</span>' +
      tags.map(t => '<span class="intag">' + esc(t) + '</span>').join('') + '</div>' +
      (r.flag ? '<div class="inflag">⚠ ' + esc(r.flag) + '. Check it, then send it to the board or dismiss it.</div>' : '') +
      '<div class="ingrid"><label>Order # <input data-f="ref" value="' + esc(r.ref) + '"' + (dismissed ? ' disabled' : '') + '></label>' +
      '<label>Customer <input data-f="customer" value="' + esc(r.customer) + '"' + (dismissed ? ' disabled' : '') + '></label>' +
      '<label>Job <input data-f="title" value="' + esc(r.title) + '"' + (dismissed ? ' disabled' : '') + '></label>' +
      '<label>Due <input type="date" data-f="due" value="' + esc(r.due) + '"' + (dismissed ? ' disabled' : '') + '></label></div>' +
      '<label class="indet">Details <textarea data-f="details" rows="4"' + (dismissed ? ' disabled' : '') + '>' + esc(r.details) + '</textarea></label>' +
      '<div class="insecs">' + secs + '</div>' + (c.suggested && c.keys.length && !dismissed ? '<div class="innote">Sections were picked from the items. Change them if they are wrong.</div>' : '') +
      '<div class="inbtns">' + (dismissed ? '<button class="btn" data-a="restore">Put back in Inbox</button>' :
        '<button class="btn primary" data-a="send">Send to board</button><button class="btn" data-a="save">Save changes</button><span class="grow"></span><button class="btn" data-a="dismiss" title="Removes it from the Inbox only. Nothing changes in Shopify.">' + (draft ? 'Not an order' : 'Not for the board') + '</button>') + '</div></div>';
  }
  function paint() {
    const live = S.rows.filter(r => r.state === 'new'), gone = S.rows.filter(r => r.state === 'dismissed'), a = gm.auth ? gm.auth() : {};
    const list = (S.showDismissed ? gone : live).slice().sort((x, y) => (isRed(y) - isRed(x)) || String(x.created).localeCompare(String(y.created)) || String(x.ref).localeCompare(String(y.ref)));   // red first, then oldest first
    view.innerHTML = '<div class="wbar"><h2>Inbox</h2><span class="note" style="margin:0">' + live.length + ' waiting' + (S.checkedAt ? ' · checked ' + new Date(S.checkedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '') + '</span><span class="grow"></span>' +
      '<button class="btn" data-a="check"' + (S.busy ? ' disabled' : '') + '>Check Shopify now</button> <button class="btn' + (S.showDismissed ? ' primary' : '') + '" data-a="dis">Dismissed (' + gone.length + ')</button> <button class="btn" data-a="settings">Settings</button></div>' +
      (S.msg ? '<div class="note">' + esc(S.msg) + '</div>' : '') + (S.err ? '<div class="card" style="background:var(--warn);margin:8px 0">' + esc(S.err) + '</div>' : '') +
      (S.showSettings ? '<div class="card" style="margin:8px 0"><b>Orders and drafts with any of these Shopify tags are skipped</b> (separate with commas; capital letters do not matter).' +
        '<textarea id="inSkip" rows="2" style="width:100%;box-sizing:border-box;margin-top:6px"' + (a && a.required && !a.admin ? ' disabled' : '') + '>' + esc(S.settings.skipTags) + '</textarea>' +
        '<div class="note">Due dates are set ' + S.settings.dueDays + ' days after the order date. Fulfilled and cancelled orders are never imported.' + (a && a.required && !a.admin ? ' Only an admin can change this.' : '') + '</div>' +
        '<button class="btn primary" data-a="saveskip">Save</button> <button class="btn" data-a="closeset">Close</button></div>' : '') +
      (S.loaded ? '' : '<div class="note">Loading...</div>') +
      (S.loaded && !list.length ? '<div class="card" style="margin:10px 0">' + (S.showDismissed ? 'Nothing has been dismissed.' : 'Nothing is waiting. New orders from Shopify will show up here by themselves.') + '</div>' : '') +
      '<div class="inlist">' + list.map(card).join('') + '</div>';
  }

  // ---------- actions ----------
  function read(el) {
    const v = f => { const e = el.querySelector('[data-f=' + f + ']'); return e ? e.value : ''; }, sections = {}, assign = {};
    el.querySelectorAll('[data-f=sec]').forEach(cb => { if (cb.checked) sections[cb.dataset.k] = 'received'; });
    el.querySelectorAll('[data-f=asg]').forEach(s => { if (s.value && sections[s.dataset.k]) assign[s.dataset.k] = s.value; });
    return { id: el.dataset.id, base: el.dataset.base, ref: v('ref'), customer: v('customer'), title: v('title'), details: v('details'), due: v('due'), sections, assign };
  }
  async function onClick(e) {
    const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a, el = b.closest('.inc');
    if (a === 'check') { await check(true); return; }
    if (a === 'dis') { S.showDismissed = !S.showDismissed; paint(); return; }
    if (a === 'settings') { S.showSettings = !S.showSettings; paint(); return; }
    if (a === 'closeset') { S.showSettings = false; paint(); return; }
    if (a === 'saveskip') {
      const val = ($('inSkip') || {}).value || '';
      const r = await gm.write(() => window.api.saveSetting('inbox_skip_tags', val), 'Skip tags saved.');
      if (r && !r.error) { S.settings.skipTags = val; S.showSettings = false; paint(); }
      return;
    }
    if (!el) return;
    if (a === 'save') {
      const r = await gm.write(() => window.api.inboxSave(read(el)), 'Saved.');
      if (r && r.conflict) { gm.toast('Someone else changed this one. Showing the latest.'); await load(); } else if (r && !r.error) await load();
    } else if (a === 'send') {
      const p = read(el);
      if (!Object.keys(p.sections).length) { gm.toast('Pick at least one section first.'); return; }
      const r = await gm.write(() => window.api.inboxSend(p), p.ref + ' sent to the Order board.');
      if (r && !r.error) await load(); else if (r && r.error) await load();
    } else if (a === 'dismiss') {
      const r = await gm.write(() => window.api.inboxDismiss(el.dataset.id, false), 'Removed from the Inbox. Nothing changed in Shopify.');
      if (r) await load();
    } else if (a === 'restore') {
      const r = await gm.write(() => window.api.inboxDismiss(el.dataset.id, true), 'Back in the Inbox.');
      if (r) await load();
    }
  }
  view.addEventListener('click', onClick);
  view.addEventListener('input', e => { const el = e.target.closest('.inc'); if (el) el.classList.add('dirty'); });
  view.addEventListener('change', e => {
    const el = e.target.closest('.inc'); if (!el) return; el.classList.add('dirty');
    if (e.target.dataset && e.target.dataset.f === 'sec') { const s = el.querySelector('[data-f=asg][data-k=' + e.target.dataset.k + ']'); if (s) { s.disabled = !e.target.checked; if (!e.target.checked) s.value = ''; } }
  });

  function show() {
    if (window.__hideWork) window.__hideWork();
    ['main', '#custView', '#priceView'].forEach(sel => { const el = document.querySelector(sel); if (el) el.style.display = 'none'; });
    ['tabSearch', 'tabCust', 'tabPrice'].forEach(i => $(i) && $(i).classList.remove('on'));
    view.style.display = 'block'; $('tabInbox').classList.add('on');
    S.showDismissed = false; S.msg = ''; paint(); load().then(() => check(false));
  }
  const prevHide = window.__hideWork;
  window.__hideWork = () => { if (prevHide) prevHide(); if (view.style.display !== 'none') view.style.display = 'none'; $('tabInbox').classList.remove('on'); };
  $('tabInbox').onclick = show; window.__showInbox = show;

  // Background: look for new orders when the app opens and every 5 minutes afterwards.
  async function tick() {
    try { const s = await window.api.cloudStatus(); if (!(s && s.configured)) return; await check(false); } catch (e) {}
  }
  setTimeout(tick, 8000);
  setInterval(tick, 5 * 60 * 1000);
  setInterval(() => { badge(); }, 60 * 1000);
})();
