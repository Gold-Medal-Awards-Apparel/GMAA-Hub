// Order Board + Shared Notes + Job updates (Cloudflare D1 via the main process). Staff sign in with a PIN (5-minute timeout).
(function(){
  const D = window.__DATA__, $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const COLS = [['received','Received','#222222','#fff'],['hold','On Hold','#F2C94C','#222'],['material','Material Ordered','#3B82C4','#fff'],['progress','In Progress','#E8872B','#fff'],['pickup','Ready for Pickup','#3F9A5B','#fff'],['delivery','Ready for Delivery / Shipping','#7B4FA3','#fff']];
  const SECS = [['embroidery', 'Embroidery'], ['heatpress', 'Heat press'], ['sublimation', 'Sublimation'], ['trophy', 'Trophy & awards']];
  const SECNAME = Object.fromEntries(SECS);
  const STNAME = Object.fromEntries(COLS.map(c => [c[0], c[1]])); STNAME.done = 'Finished';
  const IDLE_MS = 5 * 60 * 1000;
  const st = { tab: null, cfg: false, notes: [], jobs: [], jobNotes: [], settings: {}, staff: [], auth: { required: false, user: '', admin: false, bootstrap: false },
    pad: '', sel: null, sec: 'all', tv: false, tvTimers: [], nq: '', arch: false, editing: null, err: '', loaded: false, busy: false, lastAct: Date.now(), updates: null };
  const vB = $('boardView'), vN = $('notesView'), vU = $('updatesView');
  const who = () => st.auth.user || '';
  const staffNames = () => { const n = st.staff.map(s => s.name); if (n.length) return n; return (st.settings.staff || '').split('\n').map(s => s.trim()).filter(Boolean); };
  const fmtT = iso => { try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
  const toast = t => { const el = $('toast'); if (!el) return; el.textContent = t; el.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), 4500); };
  const parseJ = s => { try { const m = JSON.parse(s || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } };
  const secOf = j => parseJ(j.sections), assignOf = j => parseJ(j.assign);
  const seenKey = () => 'seen:' + who();
  const seenAt = suffix => st.settings[seenKey() + (suffix || '')] || '';
  const isRecipient = () => !!who() && !!st.settings.updates_to && (st.settings.updates_to.toLowerCase() === who().toLowerCase() || st.auth.admin);

  // ---------------- sign-in ----------------
  async function refreshAuth() { const a = await window.api.authState(); if (a && !a.error) st.auth = a; paintTop(); return st.auth; }
  function paintTop() {
    const t = $('tabUpdates'); if (t) t.style.display = isRecipient() ? '' : 'none';
    const n = $('tabNotes'), nn = unseenNotes().length; if (n) n.innerHTML = 'Notes' + (nn ? ' <span class="bdg">' + nn + '</span>' : '');
    const u = $('tabUpdates'); if (u && isRecipient()) { const c = st.updatesNew || 0; u.innerHTML = 'Job updates' + (c ? ' <span class="bdg">' + c + '</span>' : ''); }
  }
  function ensureAuth() {
    return new Promise(async resolve => {
      const a = await refreshAuth();
      if (!a.required || a.user) return resolve(true);
      const box = document.createElement('div'); box.className = 'wmodal'; box.style.zIndex = 120;
      box.innerHTML = '<div class="wbox pinbox" id="liBox" style="width:min(340px,94vw);text-align:center;position:relative"><h3>Enter your PIN</h3><input id="liPin" type="password" inputmode="numeric" autocomplete="off" maxlength="4" aria-label="4-digit PIN" style="font-size:30px;letter-spacing:.5em;text-align:center;width:9ch"><div class="pinerr" id="liErr"></div><div style="margin-top:10px"><button class="btn" id="liNo">Cancel</button></div><div class="note" style="margin-top:8px">You are signed out after 5 minutes of no activity.</div></div>';
      document.body.appendChild(box); $('liPin').focus();
      let busy = false, tmr = null;
      const done = ok => { clearInterval(tmr); box.remove(); resolve(ok); };
      const flash = txt => { const e = $('liErr'); e.textContent = txt; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); };
      const wrong = txt => { flash(txt); const b = $('liBox'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); $('liPin').value = ''; };
      const lockUntil = sec => {
        const end = Date.now() + sec * 1000; $('liPin').disabled = true; clearInterval(tmr);
        tmr = setInterval(() => { const left = Math.ceil((end - Date.now()) / 1000);
          if (left <= 0) { clearInterval(tmr); $('liPin').disabled = false; $('liErr').textContent = ''; $('liErr').classList.remove('on'); $('liPin').focus(); }
          else { const e = $('liErr'); e.classList.add('on', 'hold'); e.textContent = 'Locked. Try again in ' + (left > 90 ? Math.ceil(left / 60) + ' minutes' : left + ' seconds') + '.'; } }, 500);
      };
      const go = async () => {
        if (busy) return; busy = true; const pin = $('liPin').value;
        try {
          const r = await window.api.login(pin);
          if (r.error) {
            wrong('');
            if (r.locked) { $('liErr').classList.remove('hold'); const m = r.waitSec > 90 ? Math.ceil(r.waitSec / 60) + ' minutes' : '1 minute'; flash('Incorrect PIN. Locked for ' + m + '.'); lockUntil(r.waitSec); }
            else if (r.triesLeft) flash('Incorrect PIN. You have ' + r.triesLeft + ' ' + (r.triesLeft === 1 ? 'try' : 'tries') + ' left before a 1 minute lock out.');
            else flash(r.error);
            return;
          }
          st.lastAct = Date.now(); done(true); await refreshAuth(); draw(); pull(true).then(draw); whatsNew();
        } finally { busy = false; }
      };
      $('liNo').onclick = () => done(false);
      $('liPin').addEventListener('input', () => { const p = $('liPin'); p.value = p.value.replace(/\D/g, '').slice(0, 4); if (p.value.length === 4) go(); });
      $('liPin').addEventListener('keydown', e => { if (e.key === 'Escape') done(false); });
    });
  }
  async function lockNow(msg) { await window.api.logout(); await refreshAuth(); if (msg) toast(msg); draw(); }
  // Any activity keeps the 5-minute timer alive; with no activity the user is signed out.
  ['mousemove', 'keydown', 'click', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { st.lastAct = Date.now(); }, { passive: true }));
  setInterval(async () => {
    if (!st.auth.user || st.tv) return;
    if (Date.now() - st.lastAct > IDLE_MS) { await lockNow('Signed out after 5 minutes without activity.'); return; }
    if (Date.now() - st.lastAct < 60000) window.api.ping();
  }, 15000);

  // ---------------- data ----------------
  async function pull(quiet) {
    if (st.busy) return; st.busy = true;
    const r = await window.api.cloudPull(st.arch);
    st.busy = false;
    if (r.error) {
      st.err = r.error;
      if (!st.loaded) { const c = await window.api.cloudCached(); st.notes = c.notes || []; st.jobs = c.jobs || []; st.jobNotes = c.jobNotes || []; st.settings = c.settings || {}; st.staff = c.staff || []; st.loaded = true; st.err += ' Showing the last copy saved on this computer.'; }
    } else { st.err = ''; st.notes = r.notes; st.jobs = r.jobs; st.jobNotes = r.jobNotes || []; st.settings = r.settings; st.staff = r.staff || []; st.loaded = true; }
    await refreshAuth();
    if (isRecipient()) { const u = await window.api.getUpdates(); if (u && u.rows) { st.updates = u.rows; st.updatesNew = u.rows.filter(x => x.at > seenAt(':updates') && x.by !== who()).length; } }
    paintTop(); paintDue(true);
    if (!quiet || !st.editing) draw();
  }
  async function write(fn, okMsg) {   // runs a change; asks for the PIN first if needed, then shows any message
    if (!(await ensureAuth())) return null;
    let r = await fn();
    if (r && r.locked === undefined && r.error && /^LOCKED/.test(r.error)) { await refreshAuth(); if (!(await ensureAuth())) return null; r = await fn(); }
    if (r && r.error) { toast(r.error.replace(/^LOCKED: /, '')); return r; }
    if (okMsg) toast(okMsg);
    return r;
  }
  function banner() {
    let h = '';
    if (st.err) h += '<div class="card" style="margin:8px 0;background:var(--warn)">' + esc(st.err) + '</div>';
    if (st.auth.bootstrap) h += '<div class="card" style="margin:8px 0;background:var(--warn)">Nobody has a PIN yet, so anyone can change things. <button class="btn primary" data-act="staff">Set up staff and PINs</button></div>';
    return h;
  }
  function head(title) {
    const a = st.auth;
    return '<div class="wbar"><h2>' + title + '</h2><span class="grow"></span>' +
      (a.required ? (a.user ? '<span class="who2">Signed in: <b>' + esc(a.user) + '</b></span> <button class="btn" data-act="lock">Lock</button>' : '<button class="btn primary" data-act="signin">Sign in with PIN</button>') : '') +
      ' <button class="btn" data-act="staff">' + (a.admin || a.bootstrap ? 'Staff &amp; PINs' : 'My PIN') + '</button></div>' + banner();
  }
  async function draw() {
    const s = await window.api.cloudStatus();
    if (!s.configured) { [vB, vN, vU].forEach(v => { v.innerHTML = '<div class="wbar"><h2>Shared database</h2></div><div class="card">The shared database is not connected on this computer yet.<br><br><button class="btn primary" data-act="connect">Connect shared database</button></div>'; }); return; }
    if (st.cfg) { openStaff(); st.cfg = false; }
    if (st.tab === 'board') drawBoard();
    if (st.tab === 'notes') drawNotes();
    if (st.tab === 'updates') drawUpdates();
  }
  // ---------------- due-date warnings (shown on every tab, every computer) ----------------
  const warnDays = () => { const n = parseInt(st.settings.due_warn_days, 10); return n >= 1 && n <= 14 ? n : 2; };
  function dueJobs() {   // one entry per job that still has work to do (ready-for-pickup/delivery jobs are not counted)
    const today = new Date(new Date().toDateString()), lim = warnDays(), out = [];
    for (const j of st.jobs) {
      if (j.archived || !j.due || !/^\d{4}-\d\d-\d\d$/.test(j.due)) continue;
      const s = secOf(j), open = Object.keys(s).filter(k => s[k] && s[k] !== 'done');
      if (!open.length || open.every(k => s[k] === 'pickup' || s[k] === 'delivery')) continue;
      const days = Math.round((new Date(j.due + 'T00:00:00') - today) / 86400000);
      if (days <= lim) out.push({ j, days, level: days < 0 ? 'late' : days === 0 ? 'today' : 'soon' });
    }
    return out.sort((a, b) => a.days - b.days || (a.j.customer || '').localeCompare(b.j.customer || ''));
  }
  const dueWords = d => d.days < 0 ? (-d.days) + (d.days === -1 ? ' day' : ' days') + ' late' : d.days === 0 ? 'due today' : d.days === 1 ? 'due tomorrow' : 'due in ' + d.days + ' days';
  const dueName = j => (j.order_ref ? j.order_ref + ' ' : '') + (j.customer || j.title || 'job');
  function notifyDue(list) {   // one Windows notification per job, per level, per day, on this computer
    let seen = {}; const day = new Date().toDateString();
    try { seen = JSON.parse(localStorage.getItem('dueSeen') || '{}'); } catch (e) {}
    if (seen.day !== day) seen = { day, k: {} };
    const fresh = list.filter(d => !seen.k[d.j.id + ':' + d.level]);
    if (!fresh.length) return;
    fresh.forEach(d => { seen.k[d.j.id + ':' + d.level] = 1; });
    try { localStorage.setItem('dueSeen', JSON.stringify(seen)); } catch (e) {}
    try {
      const body = fresh.slice(0, 4).map(d => dueName(d.j) + ' — ' + dueWords(d)).join('\n') + (fresh.length > 4 ? '\n+ ' + (fresh.length - 4) + ' more' : '');
      const n = new Notification(fresh.length === 1 ? 'Job needs attention' : fresh.length + ' jobs need attention', { body, silent: false });
      n.onclick = () => { try { window.focus(); $('tabBoard').click(); } catch (e) {} };
    } catch (e) {}
  }
  function paintDue(notify) {
    const bar = $('dueBar'), tb = $('tabBoard'); if (!bar) return;
    const list = st.loaded ? dueJobs() : [];
    if (tb) { const base = tb.dataset.label || (tb.dataset.label = tb.textContent.replace(/\s*\d+$/, '').trim()); tb.innerHTML = esc(base) + (list.length ? ' <span class="bdg">' + list.length + '</span>' : ''); }
    if (!list.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    const late = list.filter(d => d.level === 'late').length;
    bar.className = 'duebar' + (late || list.some(d => d.level === 'today') ? ' hot' : '');
    bar.innerHTML = '<span class="dueic">⚠</span><span class="duetx"><b>' + list.length + (list.length === 1 ? ' job needs' : ' jobs need') + ' attention</b>' + (late ? ' (' + late + ' late)' : '') + ': ' +
      list.slice(0, 3).map(d => esc(dueName(d.j)) + ' <i>' + dueWords(d) + '</i>').join(' · ') + (list.length > 3 ? ' · + ' + (list.length - 3) + ' more' : '') + '</span><button class="btn" data-act="duego">View board</button>';
    bar.style.display = 'flex';
    if (notify) notifyDue(list);
  }
  // ---------------- board ----------------
  function dueInfo(j) {
    if (!j.due) return '';
    const days = Math.round((new Date(j.due + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
    const [y, m, d] = j.due.split('-'); const late = days < 0;
    return '<div class="due' + (late ? ' late' : '') + '">Due ' + m + '/' + d + (late ? ' · ' + (-days) + ' day' + (days === -1 ? '' : 's') + ' late' : days === 0 ? ' · today' : days === 1 ? ' · tomorrow' : '') + '</div>';
  }
  function cards() {
    const out = [];
    for (const j of st.jobs) { if (j.archived) continue; const s = secOf(j); for (const [k] of SECS) if (s[k] && s[k] !== 'done') out.push({ j, key: k, status: s[k] }); }
    return out;
  }
  const noteCount = id => st.jobNotes.filter(n => n.job_id === id).length;
  function assignSel(j, key, cls) {
    const cur = assignOf(j)[key] || '', names = staffNames();
    if (st.tv) return cur ? '<div class="who">👤 ' + esc(cur) + '</div>' : '';
    const opts = names.slice(); if (cur && !opts.includes(cur)) opts.push(cur);
    return '<select class="' + (cls || 'asg') + '" data-act="assign" data-id="' + esc(j.id) + '" data-key="' + key + '" title="Who is working on this section"><option value="">👤 unassigned</option>' + opts.map(n => '<option' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>';
  }
  function colsHtml(vis, showChip) {
    return '<div class="cols">' + COLS.map(c => {
      const list = vis.filter(x => x.status === c[0]).sort((a, b) => (a.j.due || '9999').localeCompare(b.j.due || '9999'));
      return '<div class="col" data-col="' + c[0] + '"><div class="colh" style="background:' + c[2] + ';color:' + c[3] + '">' + c[1] + ' <span>' + list.length + '</span></div>' +
        list.map(x => { const j = x.j, s = secOf(j), others = SECS.filter(([k]) => k !== x.key && s[k] && s[k] !== 'done'), nc = noteCount(j.id);
          return '<div class="job" draggable="' + (st.tv ? 'false' : 'true') + '" data-id="' + esc(j.id) + '" data-key="' + x.key + '" style="border-left:6px solid ' + c[2] + '">' + (showChip ? '<span class="chip">' + esc(SECNAME[x.key]) + '</span>' : '') + '<b>' + esc(j.order_ref || '') + (j.order_ref && j.customer ? ' · ' : '') + esc(j.customer) + '</b>' + (nc ? ' <span class="nc" title="' + nc + ' job note' + (nc === 1 ? '' : 's') + '">📝' + nc + '</span>' : '') + '<div>' + esc(j.title) + '</div>' + dueInfo(j) + (st.tv ? assignSel(j, x.key) : '') +
            (others.length ? '<div class="also">Also: ' + others.map(([k, n]) => esc(n) + (assignOf(j)[k] ? ' – ' + esc(assignOf(j)[k]) : '') + ' (' + esc(STNAME[s[k]] || s[k]) + ')').join(', ') + '</div>' : '') +
            '<div class="jb"><select data-act="move" data-id="' + esc(j.id) + '" data-key="' + x.key + '">' + COLS.map(y => '<option value="' + y[0] + '"' + (y[0] === x.status ? ' selected' : '') + '>' + (y[0] === x.status ? 'Move…' : '→ ' + y[1]) + '</option>').join('') + '</select>' +
            (x.status === 'pickup' || x.status === 'delivery' ? ' <button class="btn" data-act="done" data-id="' + esc(j.id) + '" data-key="' + x.key + '">Finished</button>' : '') + (st.tv ? '' : '<div class="jrow">' + assignSel(j, x.key) + '</div>') + '</div></div>'; }).join('') + '</div>';
    }).join('') + '</div>';
  }
  function tvBar() {
    const n = new Set(cards().map(c => c.j.id)).size;
    return '<div class="tvbar"><div><b>Gold Medal Awards &amp; Apparel</b> — Order Board<span class="tvsub">' + n + ' open order' + (n === 1 ? '' : 's') + ' · updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '</span></div><div class="tvbtns"><button class="btn" data-act="tvz" data-d="-1">A−</button><button class="btn" data-act="tvz" data-d="1">A+</button><button class="btn" data-act="tvexit">Exit TV</button></div></div>';
  }
  function drawBoard() {
    const keepY = window.scrollY;
    const all = cards(), vis = st.sec === 'all' ? all : all.filter(c => c.key === st.sec);
    const cnt = k => k === 'all' ? new Set(all.map(c => c.j.id)).size : all.filter(c => c.key === k).length;
    const archived = st.jobs.filter(j => j.archived);
    vB.innerHTML = (st.tv ? tvBar() : head('Order board')) +
      (st.tv ? '' : '<div class="wbar"><button class="btn primary" data-act="newjob">+ New job</button> <label><input type="checkbox" data-act="arch"' + (st.arch ? ' checked' : '') + '> Show finished jobs</label> <button class="btn" data-act="refresh">Refresh</button> <button class="btn" data-act="tv">📺 TV display</button><span class="note">Tip: right-click a card to edit or delete it.</span></div>') +
      (st.tv ? '' : '<div class="stabs">' + [['all', 'All sections']].concat(SECS).map(s => '<button class="stab' + (st.sec === s[0] ? ' on' : '') + '" data-act="sec" data-key="' + s[0] + '">' + s[1] + ' <span>' + cnt(s[0]) + '</span></button>').join('') + '</div>') +
      (st.sec === 'all' ? SECS.map(([k, n]) => '<div class="secband"><h3 class="sech">' + n + ' <span>' + all.filter(x => x.key === k).length + '</span></h3>' + colsHtml(all.filter(x => x.key === k), false) + '</div>').join('') : colsHtml(vis, false)) +
      (st.arch ? '<h3>Finished jobs</h3>' + (archived.length ? '<table class="wt"><tr><th>Order</th><th>Customer</th><th>Job</th><th>Sections</th><th>Finished</th><th></th></tr>' + archived.slice(0, 100).map(j => '<tr><td>' + esc(j.order_ref) + '</td><td>' + esc(j.customer) + '</td><td>' + esc(j.title) + '</td><td>' + esc(Object.keys(secOf(j)).map(k => SECNAME[k]).filter(Boolean).join(', ')) + '</td><td>' + fmtT(j.updated_at) + '</td><td><button class="btn" data-act="restore" data-id="' + esc(j.id) + '">Put back</button></td></tr>').join('') + '</table>' : '<div class="note">None yet.</div>') : '') +
      (st.editing && st.editing.kind === 'job' ? jobModal(st.editing.job) : '');
    if (st.tv) window.scrollTo(0, keepY);
  }
  function threadHtml(jobId) {
    const list = st.jobNotes.filter(n => n.job_id === jobId).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return list.length ? list.map(n => '<div class="jn"><b>' + esc(n.author) + '</b> <span class="sm">' + fmtT(n.created_at) + '</span><div>' + esc(n.body).replace(/\n/g, '<br>') + '</div></div>').join('') : '<div class="note">No job notes yet.</div>';
  }
  function jobModal(j) {
    const names = staffNames(), sec = secOf(j), asg = assignOf(j);
    return '<div class="wmodal"><div class="wbox" style="width:min(680px,96vw)"><h3>' + (j.id ? 'Edit job' : 'New job') + '</h3>' +
      '<label>Order # (optional) <span style="color:var(--muted);font-weight:400">type the number and press Enter — customer and items fill in</span></label><div style="display:flex;gap:6px"><input id="jRef" value="' + esc(j.order_ref) + '" style="flex:1"><button class="btn" data-act="lookup">Look up</button></div>' +
      '<label>Customer</label><input id="jCust" value="' + esc(j.customer) + '">' +
      '<label>Job</label><input id="jTitle" value="' + esc(j.title) + '" placeholder="e.g. 40 homecoming shirts, 2 colors">' +
      '<label>Sections — tick every department this order goes through, and who is on each</label><div class="secpick">' + SECS.map(([k, n]) => '<div class="secrow"><label><input type="checkbox" id="sc_' + k + '" data-act="secchk" data-key="' + k + '"' + (sec[k] ? ' checked' : '') + '> ' + n + '</label><select id="ss_' + k + '"' + (sec[k] ? '' : ' disabled') + '>' + COLS.map(c => '<option value="' + c[0] + '"' + (sec[k] === c[0] ? ' selected' : '') + '>' + c[1] + '</option>').join('') + '<option value="done"' + (sec[k] === 'done' ? ' selected' : '') + '>Finished</option></select><select id="sa_' + k + '"' + (sec[k] ? '' : ' disabled') + '><option value="">👤 unassigned</option>' + names.map(x => '<option' + (x === asg[k] ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>').join('') + '</div>' +
      '<label>Due date</label><input id="jDue" type="date" value="' + esc(j.due) + '" style="max-width:200px">' +
      '<label>Details</label><textarea id="jDet" rows="4">' + esc(j.details) + '</textarea>' +
      (j.id ? '<label>Job notes <span style="color:var(--muted);font-weight:400">— updates about this order; saved right away and sent to ' + esc(st.settings.updates_to || 'the person chosen in Staff') + '</span></label><div class="jnadd"><textarea id="jnBody" rows="2" placeholder="Type an update, e.g. Customer approved the proof"></textarea><button class="btn" data-act="jnAdd" data-id="' + esc(j.id) + '">Add note</button></div><div id="jNotes" class="jnlist">' + threadHtml(j.id) + '</div>' : '<div class="note" style="margin-top:8px">Save the job first, then you can add job notes.</div>') +
      '<div class="row" style="display:flex;gap:8px;margin-top:12px"><button class="btn primary" data-act="jobSave">Save</button><button class="btn" data-act="cancelEdit">Close</button></div></div></div>';
  }

  // Guess departments from item names; only used to pre-tick boxes when none are ticked yet.
  function suggestSections(text) {
    const t = String(text).toLowerCase(), out = [];
    if (/embroider|digitiz|\bcap\b|\bhat\b|beanie/.test(t)) out.push('embroidery');
    if (/\bdtf\b|heat press|transfer|vinyl|t-?shirt|sweatshirt|hoodie|\btee\b/.test(t)) out.push('heatpress');
    if (/sublim/.test(t)) out.push('sublimation');
    if (/trophy|trophies|medal|plaque|award|engrav|glass|figure|column|\bcup\b|ribbon/.test(t)) out.push('trophy');
    return out;
  }
  // Builds the job fields from an order (Shopify live, or the local order history as a fallback).
  function fromShopify(o) {
    const items = o.items.filter(i => i.qty > 0);
    const big = items.slice().sort((a, b) => b.qty - a.qty)[0];
    const cust = o.co && o.cust ? o.co + ' (' + o.cust + ')' : (o.co || o.cust);
    const title = big ? (big.qty + ' × ' + big.name).slice(0, 110) + (items.length > 1 ? ' + ' + (items.length - 1) + ' more item' + (items.length > 2 ? 's' : '') : '') : '';
    const det = [items.map(i => i.qty + ' × ' + i.name + (i.sku ? ' [' + i.sku + ']' : '')).join('\n')];
    if (o.shipping) det.push('Shipping method: ' + o.shipping);
    if (o.note) det.push('Order note: ' + o.note);
    det.push('Ordered ' + o.created + ' · Total $' + o.total.toFixed(2) + (o.paid ? ' · ' + o.paid.toLowerCase().replace(/_/g, ' ') : ''));
    return { tag: o.tag, customer: cust, title, details: det.filter(Boolean).join('\n'), shipping: o.shipping, cancelled: o.cancelled };
  }
  function fromLocal(ref) {
    const num = (String(ref).match(/\d+/) || [''])[0]; if (!num) return null;
    const wantNew = /new/i.test(ref), wantOld = /old/i.test(ref);
    let src = null; const rows = [];
    for (const r of D.r) { if (String(r[1]) !== num) continue; if (wantNew && r[10] !== 1) continue; if (wantOld && r[10] === 1) continue; if (src === null) src = r[10] === 1 ? 1 : 0; if ((r[10] === 1 ? 1 : 0) !== src) continue; rows.push(r); }
    if (!rows.length) return null;
    const h = rows[0], cust = D.c[h[2]] || '', co = D.co[h[3]] || '';
    const items = rows.filter(r => r[8] !== 2 && r[5] > 0).map(r => ({ name: r[4], qty: r[5], sku: '' }));
    const o = fromShopify({ tag: (src === 1 ? 'New #' : 'Old #') + num, cust, co, items, shipping: '', note: '', created: h[0], total: rows.reduce((s, r) => s + (r[7] > 0 ? r[7] : 0), 0), paid: '' });
    return o;
  }
  async function lookupOrder(ref) {
    const wantOld = /old/i.test(ref);
    if (!wantOld) {
      const r = await window.api.shopifyOrder(ref);
      if (r && r.ok && r.found) return fromShopify(r);
      if (r && r.error && !/not connected/i.test(r.error)) toast(r.error + ' Trying the saved order history instead.');
    }
    return fromLocal(ref);
  }
  async function doLookup() {
    const ref = $('jRef').value; if (!ref.trim()) { toast('Type an order number first.'); return; }
    $('jRef').disabled = true; const r = await lookupOrder(ref).catch(() => null); $('jRef').disabled = false;
    const af = st.autofill || {};
    if (!r) {   // not found: clear anything the PREVIOUS lookup filled in (but never text you typed yourself)
      if ($('jCust').value === af.cust) $('jCust').value = '';
      if ($('jTitle').value === af.title) $('jTitle').value = '';
      if ($('jDet').value === af.det) $('jDet').value = '';
      st.autofill = null;
      toast('No order with that number was found in Shopify or the old-store history.'); return;
    }
    // A lookup replaces customer, job and details completely, so changing 1055 to 1056 leaves nothing of 1055 behind.
    $('jRef').value = r.tag; $('jCust').value = r.customer; $('jTitle').value = r.title; $('jDet').value = r.details;
    st.autofill = { cust: r.customer, title: r.title, det: r.details };
    const sg = suggestSections(r.details);
    if (sg.length) SECS.forEach(([k]) => { const on = sg.includes(k); $('sc_' + k).checked = on; $('ss_' + k).disabled = !on; $('sa_' + k).disabled = !on; });
    if (r.cancelled) toast('Note: this order is cancelled in Shopify.');
    else toast('Filled in from ' + r.tag + (sg.length ? ' and set sections to ' + sg.map(k => SECNAME[k]).join(', ') : '') + '. Check them, then set the due date.');
  }

  // ---------------- TV display (read-only, big, refreshes itself) ----------------
  function setTvZoom(z) { st.tvZoom = Math.max(0.7, Math.min(2.6, z)); vB.style.zoom = st.tvZoom; try { localStorage.setItem('gmaa.tvzoom', st.tvZoom); } catch (e) {} }
  function enterTv() {
    st.tv = true; st.sec = 'all'; st.editing = null; document.body.classList.add('tv');
    st.tvZoom = Math.round(window.innerWidth / 1250 * 20) / 20 || 1.4;   // fit the screen width by default (about 1.5 on a 1080p TV)
    try { const z = parseFloat(localStorage.getItem('gmaa.tvzoom')); if (z) st.tvZoom = z; } catch (e) {}
    setTvZoom(st.tvZoom); drawBoard(); window.scrollTo(0, 0);
    window.api.tvAwake(true);
    try { document.documentElement.requestFullscreen().catch(() => {}); } catch (e) {}
    st.tvTimers.push(setInterval(() => pull(true), 30000));
    let dir = 1, hold = 100;   // slow auto-scroll when the board is taller than the screen
    st.tvTimers.push(setInterval(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 4) return;
      if (hold > 0) { hold--; return; }
      const y = window.scrollY + dir * 2;
      if (y >= max) { dir = -1; hold = 120; } else if (y <= 0) { dir = 1; hold = 120; }
      window.scrollTo(0, Math.max(0, Math.min(max, y)));
    }, 50));
  }
  function exitTv() {
    st.tv = false; document.body.classList.remove('tv'); vB.style.zoom = '';
    st.tvTimers.forEach(clearInterval); st.tvTimers = []; window.api.tvAwake(false);
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
    drawBoard();
  }
  document.addEventListener('fullscreenchange', () => { if (st.tv && !document.fullscreenElement) exitTv(); });

  // ---------------- notes (pads) ----------------
  const padList = () => [['shop', 'Shop-wide notes']].concat(staffNames().map(n => [n, n + (n.toLowerCase() === who().toLowerCase() ? ' (my pad)' : '')]));
  const isNew = n => n.updated_at > seenAt() && (n.updated_by || n.author) !== who();
  function unseenNotes() { if (!who()) return []; return st.notes.filter(n => (n.pad === 'shop' || (n.pad || '').toLowerCase() === who().toLowerCase()) && isNew(n)); }
  const curPad = () => st.pad || (who() || 'shop');
  function drawNotes() {
    const q = st.nq.toLowerCase(), pad = curPad();
    const list = st.notes.filter(n => (n.pad || 'shop').toLowerCase() === pad.toLowerCase() && (!q || (n.title + ' ' + n.body + ' ' + n.author).toLowerCase().includes(q)));
    const cur = st.sel === 'new' ? { id: '', title: '', body: '', author: who(), pinned: 0, pad } : st.notes.find(n => n.id === st.sel);
    const cnt = p => who() ? st.notes.filter(n => (n.pad || 'shop').toLowerCase() === p.toLowerCase() && isNew(n)).length : 0;
    const padSel = (id, val) => '<select id="' + id + '" data-act="' + (id === 'nPad' ? 'nopad' : 'pad') + '">' + padList().map(([k, n]) => '<option value="' + esc(k) + '"' + (k.toLowerCase() === val.toLowerCase() ? ' selected' : '') + '>' + esc(n) + (id === 'padPick' && cnt(k) ? '  (' + cnt(k) + ' new)' : '') + '</option>').join('') + '</select>';
    vN.innerHTML = head('Shared notes') +
      '<div class="wbar"><label><b>Pad</b> ' + padSel('padPick', pad) + '</label><span class="note">A pad is one person\'s notes. Pick a name to leave a note for them; pick "Shop-wide" for everyone.</span></div>' +
      '<div class="nwrap"><div class="nlist"><div style="display:flex;gap:6px"><input id="nSearch" type="search" placeholder="Search this pad…" value="' + esc(st.nq) + '" style="flex:1"><button class="btn primary" data-act="newnote">+ New</button></div>' +
      (list.length ? list.map(n => '<div class="ni' + (n.id === st.sel ? ' on' : '') + '" data-nid="' + esc(n.id) + '">' + (n.pinned ? '📌 ' : '') + (isNew(n) ? '<span class="bdg">new</span> ' : '') + '<b>' + esc(n.title || '(untitled)') + '</b><div class="sm">' + esc((n.body || '').slice(0, 70)) + '</div><div class="sm">' + esc(n.updated_by || n.author) + ' · ' + fmtT(n.updated_at) + '</div></div>').join('') : '<div class="note">No notes on this pad yet.</div>') + '</div>' +
      '<div class="nedit">' + (cur ? '<input id="nTitle" value="' + esc(cur.title) + '" placeholder="Title" style="font-size:17px;font-weight:600"><textarea id="nBody" rows="15" placeholder="Write anything — reminders, supplier info, customer details…">' + esc(cur.body) + '</textarea>' +
        '<div class="wbar"><label>On pad ' + padSel('nPad', cur.pad || pad) + '</label><label><input type="checkbox" id="nPin"' + (cur.pinned ? ' checked' : '') + '> Pin to top</label><span class="grow"></span>' +
        (cur.id ? '<button class="btn" data-act="delnote" data-id="' + esc(cur.id) + '">' + (st.confirmDel === cur.id ? 'Click again to delete' : 'Delete') + '</button>' : '') + '<button class="btn primary" data-act="noteSave" data-base="' + esc(cur.updated_at || '') + '" data-id="' + esc(cur.id) + '">Save</button></div>' +
        '<div class="note">' + (cur.id ? 'Written by ' + esc(cur.author) + ' · last saved by ' + esc(cur.updated_by) + ' · ' + fmtT(cur.updated_at) : 'Your name goes on the note automatically when you save.') + '</div>' : '<div class="note" style="padding:30px">Pick a note on the left, or click + New.</div>') + '</div></div>';
  }
  // ---------------- job updates (only for the person chosen in Staff) ----------------
  function drawUpdates() {
    if (!isRecipient()) { vU.innerHTML = head('Job updates') + '<div class="card">Job updates are shown to ' + esc(st.settings.updates_to || 'the person chosen in Staff & PINs') + ' after signing in with a PIN.' + (who() ? '' : '<br><br><button class="btn primary" data-act="signin">Sign in with PIN</button>') + '</div>'; return; }
    const rows = st.updates || [], seen = seenAt(':updates'); let lastDay = '';
    vU.innerHTML = head('Job updates') + '<div class="wbar"><span class="note">Everything that happens on the order board — new jobs, moves, assignments, job notes, deletions — newest first.</span><span class="grow"></span><button class="btn" data-act="updRead">Mark all as read</button></div>' +
      (rows.length ? rows.map(r => { const day = new Date(r.at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); const h = day !== lastDay ? '<h3 class="uday">' + esc(day) + '</h3>' : ''; lastDay = day;
        return h + '<div class="upd' + (r.at > seen && r.by !== who() ? ' new' : '') + '"><span class="sm">' + new Date(r.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '</span> ' + esc(r.text) + '</div>'; }).join('') : '<div class="note">Nothing yet.</div>');
  }
  async function markUpdatesRead() { if (!isRecipient()) return; const now = new Date().toISOString(); await window.api.saveSetting(seenKey() + ':updates', now); st.settings[seenKey() + ':updates'] = now; st.updatesNew = 0; paintTop(); }

  // ---------------- staff & PINs ----------------
  function openStaff() {
    const box = document.createElement('div'); box.className = 'wmodal'; box.style.zIndex = 110; box.id = 'staffBox';
    document.body.appendChild(box); renderStaff();
  }
  function renderStaff() {
    const box = $('staffBox'); if (!box) return;
    const a = st.auth, admin = a.admin || a.bootstrap, names = st.staff.map(s => s.name);
    box.innerHTML = '<div class="wbox" style="width:min(640px,96vw)"><h3>' + (admin ? 'Staff &amp; PINs' : 'My PIN') + '</h3>' +
      (admin ? (a.bootstrap ? '<div class="note">Nobody has a PIN yet. <b>The first person you add becomes the admin</b> (they can add everyone else) and is signed in.</div>' : '') +
        (names.length ? '<table class="wt"><tr><th>Name</th><th>Role</th><th></th></tr>' + st.staff.map(s => '<tr><td>' + esc(s.name) + '</td><td>' + (s.admin ? 'Admin' : 'Staff') + '</td><td><button class="btn" data-sx="admin" data-n="' + esc(s.name) + '" data-v="' + (s.admin ? 0 : 1) + '">' + (s.admin ? 'Remove admin' : 'Make admin') + '</button> <button class="btn" data-sx="rm" data-n="' + esc(s.name) + '">Remove</button></td></tr>').join('') + '</table>' : '') +
        '<label>Add a person</label><div class="srow"><input id="sNm" placeholder="Name (as it should appear)"><input id="sPin" type="password" inputmode="numeric" maxlength="4" placeholder="4-digit PIN"><label class="chk"><input type="checkbox" id="sAdm"> admin</label><button class="btn primary" data-sx="add">Add</button></div>' : '') +
      (names.length ? '<label>' + (admin ? 'Set or reset someone\'s PIN' : 'Change my PIN') + '</label><div class="srow">' + (admin ? '<select id="pNm">' + names.map(n => '<option>' + esc(n) + '</option>').join('') + '</select>' : '<input id="pNm" value="' + esc(a.user) + '" disabled>') + (admin ? '' : '<input id="pOld" type="password" inputmode="numeric" maxlength="4" placeholder="Current PIN">') + '<input id="pNew" type="password" inputmode="numeric" maxlength="4" placeholder="New PIN"><button class="btn" data-sx="pin">Set PIN</button></div>' : '') +
      (admin && names.length ? '<label>Send job updates to</label><div class="srow"><select id="uTo"><option value="">(nobody)</option>' + names.map(n => '<option' + (n.toLowerCase() === (st.settings.updates_to || '').toLowerCase() ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select><button class="btn" data-sx="to">Save</button></div><div class="note">Only this person sees the "Job updates" tab (and admins).</div>' : '') +
      (admin ? '<label>Warn about jobs due within</label><div class="srow"><select id="dw">' + [1, 2, 3, 5, 7].map(n => '<option value="' + n + '"' + (n === warnDays() ? ' selected' : '') + '>' + n + (n === 1 ? ' day' : ' days') + '</option>').join('') + '</select><button class="btn" data-sx="dw">Save</button></div><div class="note">Everyone sees a warning banner (and a Windows notification) for unfinished jobs due within this many days, and for late ones.</div>' : '') +
      '<div class="note" id="sMsg" style="min-height:18px;margin-top:8px"></div><div style="display:flex;justify-content:flex-end"><button class="btn" data-sx="close">Close</button></div></div>';
  }
  async function staffClick(t) {
    const x = t.dataset.sx, msg = m => { const e = $('sMsg'); if (e) e.textContent = m; };
    if (x === 'close') { $('staffBox').remove(); draw(); return; }
    let r = null;
    if (x === 'add') { r = await window.api.addStaff($('sNm').value, $('sPin').value, $('sAdm').checked); if (r && r.error && /^LOCKED/.test(r.error)) { if (!(await ensureAuth())) return; r = await window.api.addStaff($('sNm').value, $('sPin').value, $('sAdm').checked); } }
    else if (x === 'pin') { const call = () => window.api.setPin($('pNm').value, $('pNew').value, $('pOld') ? $('pOld').value : ''); r = await call(); if (r && r.error && /^LOCKED/.test(r.error)) { if (!(await ensureAuth())) return; r = await call(); } }
    else if (x === 'rm') { if (t.dataset.arm !== '1') { t.dataset.arm = '1'; t.textContent = 'Click again to remove'; return; } r = await window.api.removeStaff(t.dataset.n); }
    else if (x === 'admin') r = await window.api.setAdmin(t.dataset.n, t.dataset.v === '1');
    else if (x === 'to') r = await window.api.saveSetting('updates_to', $('uTo').value);
    else if (x === 'dw') r = await window.api.saveSetting('due_warn_days', $('dw').value);
    if (!r) return;
    if (r.error) { msg(r.error.replace(/^LOCKED: /, '')); return; }
    await pull(true); await refreshAuth(); renderStaff(); msg(x === 'add' ? 'Added.' : x === 'pin' ? 'PIN saved.' : 'Saved.');
  }
  // ---------------- right-click menu on cards ----------------
  let ctx = null;
  function closeCtx() { const m = $('ctxMenu'); if (m) m.remove(); ctx = null; }
  function openCtx(x, y, id, key) {
    closeCtx(); ctx = { id, key, arm: false };
    const m = document.createElement('div'); m.id = 'ctxMenu'; m.className = 'ctxmenu'; m.style.left = Math.min(x, window.innerWidth - 220) + 'px'; m.style.top = Math.min(y, window.innerHeight - 140) + 'px';
    m.innerHTML = '<button data-cx="edit">✏️ Edit job</button><button data-cx="note">📝 Add a job note</button><button data-cx="del" class="danger">🗑 Delete job</button>';
    document.body.appendChild(m);
  }
  async function ctxClick(t) {
    const act = t.dataset.cx; if (!ctx) return; const { id } = ctx;
    if (act === 'edit' || act === 'note') { closeCtx(); const j = st.jobs.find(x => x.id === id); if (j) { st.editing = { kind: 'job', job: Object.assign({}, j) }; drawBoard(); if (act === 'note') setTimeout(() => { const e = $('jnBody'); if (e) e.focus(); }, 50); } }
    else if (act === 'del') {
      if (!ctx.arm) { ctx.arm = true; t.textContent = 'Click again to delete the whole job'; return; }
      closeCtx(); const r = await write(() => window.api.deleteJob(id), 'Job deleted.'); if (r && !r.error) await pull();
    }
  }
  document.addEventListener('click', e => { if (!e.target.closest('#ctxMenu')) closeCtx(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCtx(); });
  window.addEventListener('scroll', closeCtx, true);
  vB.addEventListener('contextmenu', e => { if (st.tv) return; const j = e.target.closest && e.target.closest('.job'); if (!j) return; e.preventDefault(); openCtx(e.clientX, e.clientY, j.dataset.id, j.dataset.key); });
  document.addEventListener('click', e => { const t = e.target.closest('[data-cx]'); if (t) { e.stopPropagation(); ctxClick(t); } }, true);

  // ---------------- events ----------------
  async function onClick(e) {
    const t = e.target.closest('[data-act],[data-nid]'); if (!t) return;
    if (t.dataset.nid) { st.sel = t.dataset.nid; st.confirmDel = null; drawNotes(); return; }
    const a = t.dataset.act, id = t.dataset.id;
    if (a === 'connect') window.openCloud();
    else if (a === 'staff') openStaff();
    else if (a === 'signin') { await ensureAuth(); }
    else if (a === 'lock') lockNow('Locked.');
    else if (a === 'refresh') { await pull(); toast('Refreshed.'); }
    else if (a === 'newjob') { st.editing = { kind: 'job', job: { id: '', order_ref: '', customer: '', title: '', sections: '', assign: '', due: '', details: '' } }; draw(); }
    else if (a === 'tv') enterTv();
    else if (a === 'tvexit') exitTv();
    else if (a === 'tvz') setTvZoom((st.tvZoom || 1.4) + (t.dataset.d > 0 ? 0.1 : -0.1));
    else if (a === 'sec') { st.sec = t.dataset.key; drawBoard(); }
    else if (a === 'cancelEdit') { st.editing = null; draw(); }
    else if (a === 'lookup') await doLookup();
    else if (a === 'jobSave') {
      const sections = Object.fromEntries(SECS.filter(([k]) => $('sc_' + k).checked).map(([k]) => [k, $('ss_' + k).value]));
      const assign = Object.fromEntries(SECS.filter(([k]) => $('sc_' + k).checked && $('sa_' + k).value).map(([k]) => [k, $('sa_' + k).value]));
      const j = Object.assign({}, st.editing.job, { order_ref: $('jRef').value, customer: $('jCust').value, title: $('jTitle').value, sections, assign, due: $('jDue').value, details: $('jDet').value, base: st.editing.job.updated_at });
      if (!j.customer.trim() && !j.title.trim()) { toast('Enter a customer or a job description.'); return; }
      if (!Object.keys(sections).length) { toast('Tick at least one section (Embroidery, Heat press, Sublimation, Trophy & awards).'); return; }
      const r = await write(() => window.api.saveJob(j));
      if (!r || r.error) return;
      st.editing = null; toast(r.conflict ? 'Someone else changed that job a moment ago. It was reloaded — please check and redo your change.' : 'Saved.'); await pull();
    }
    else if (a === 'jnAdd') {
      const body = $('jnBody').value; if (!body.trim()) { toast('Type a note first.'); return; }
      const r = await write(() => window.api.addJobNote(id, body)); if (!r || r.error) return;
      st.jobNotes.unshift({ id: r.id, job_id: id, author: who() || 'Someone', body: body.trim(), created_at: r.at }); $('jnBody').value = ''; $('jNotes').innerHTML = threadHtml(id); toast('Note added.');
    }
    else if (a === 'done') { const r = await write(() => window.api.moveSection(id, t.dataset.key, 'done')); if (r && !r.error && r.archived) toast('All sections finished — job moved to Finished jobs.'); await pull(true); }
    else if (a === 'restore') { await write(() => window.api.archiveJob(id, false)); await pull(true); }
    else if (a === 'newnote') { st.sel = 'new'; drawNotes(); }
    else if (a === 'noteSave') {
      const n = { id: id || '', title: $('nTitle').value, body: $('nBody').value, pad: $('nPad').value, pinned: $('nPin').checked, base: t.dataset.base };
      const r = await write(() => window.api.saveNote(n)); if (!r || r.error) return;
      if (r.conflict) { toast('Someone else edited this note while you were typing. Their version was loaded — copy your text first if you need it.'); await pull(); return; }
      st.pad = n.pad; st.sel = r.id; toast('Note saved.'); await pull(true);
    }
    else if (a === 'delnote') { if (st.confirmDel !== id) { st.confirmDel = id; drawNotes(); return; } const r = await write(() => window.api.deleteNote(id), 'Note deleted.'); st.sel = null; st.confirmDel = null; if (r && !r.error) await pull(true); else drawNotes(); }
    else if (a === 'updRead') { await markUpdatesRead(); drawUpdates(); }
  }
  async function onChange(e) {
    const a = e.target.dataset && e.target.dataset.act;
    if (a === 'arch') { st.arch = e.target.checked; await pull(); }
    else if (a === 'move') { if (e.target.value) { const r = await write(() => window.api.moveSection(e.target.dataset.id, e.target.dataset.key, e.target.value)); await pull(true); if (!r) draw(); } }
    else if (a === 'assign') { const r = await write(() => window.api.setAssign(e.target.dataset.id, e.target.dataset.key, e.target.value)); await pull(true); if (!r) draw(); }
    else if (a === 'secchk') { const k = e.target.dataset.key; $('ss_' + k).disabled = !e.target.checked; $('sa_' + k).disabled = !e.target.checked; }
    else if (a === 'pad') { st.pad = e.target.value; st.sel = null; drawNotes(); }
  }
  [vB, vN, vU].forEach(v => {
    v.addEventListener('click', onClick); v.addEventListener('change', onChange);
    v.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'jRef') { e.preventDefault(); doLookup(); } });
  });
  vN.addEventListener('input', e => { if (e.target.id === 'nSearch') { st.nq = e.target.value; const pos = e.target.selectionStart; drawNotes(); const s = $('nSearch'); s.focus(); s.setSelectionRange(pos, pos); } });
  document.addEventListener('click', e => { const t = e.target.closest('[data-sx]'); if (t) staffClick(t); });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'jRef') { e.preventDefault(); doLookup(); } });
  // drag a card to another column
  vB.addEventListener('dragstart', e => { if (st.tv) { e.preventDefault(); return; } const j = e.target.closest && e.target.closest('.job'); if (j) e.dataTransfer.setData('text/plain', j.dataset.id + '|' + j.dataset.key); });
  vB.addEventListener('dragover', e => { if (e.target.closest && e.target.closest('.col')) e.preventDefault(); });
  vB.addEventListener('drop', async e => {
    const c = e.target.closest('.col'); if (!c) return; e.preventDefault();
    const [id, key] = e.dataTransfer.getData('text/plain').split('|'); const j = st.jobs.find(x => x.id === id);
    if (j && key && secOf(j)[key] !== c.dataset.col) { const r = await write(() => window.api.moveSection(id, key, c.dataset.col)); await pull(true); if (!r) draw(); }
  });
  vB.addEventListener('dblclick', e => { if (st.tv) return; const j = e.target.closest && e.target.closest('.job'); if (!j || e.target.closest('select,button')) return; const job = st.jobs.find(x => x.id === j.dataset.id); if (job) { st.editing = { kind: 'job', job: Object.assign({}, job) }; drawBoard(); } });

  // ---------------- "what's new" after signing in ----------------
  async function whatsNew() {
    if (!who()) return;
    const fresh = unseenNotes(), pinned = st.notes.filter(n => n.pinned && (n.pad === 'shop' || (n.pad || '').toLowerCase() === who().toLowerCase())), upd = isRecipient() ? (st.updatesNew || 0) : 0;
    const stamp = async () => { const now = new Date().toISOString(); await window.api.saveSetting(seenKey(), now); st.settings[seenKey()] = now; paintTop(); };
    if (!fresh.length && !pinned.length && !upd) { await stamp(); return; }
    const box = document.createElement('div'); box.className = 'wmodal'; box.style.display = 'flex';
    const li = n => '<li><b>' + esc(n.title || '(untitled)') + '</b> — ' + esc(n.updated_by || n.author) + ', ' + fmtT(n.updated_at) + (n.pad && n.pad !== 'shop' ? ' <span class="sm">(' + esc(n.pad) + '\'s pad)</span>' : '') + '<div class="sm">' + esc((n.body || '').slice(0, 160)) + '</div></li>';
    box.innerHTML = '<div class="wbox"><h3>Welcome, ' + esc(who()) + '</h3>' + (fresh.length ? '<b>New or changed notes for you / the shop</b><ul>' + fresh.slice(0, 12).map(li).join('') + '</ul>' : '') + (upd ? '<p><b>' + upd + ' new job update' + (upd === 1 ? '' : 's') + '</b> are waiting in the Job updates tab.</p>' : '') + (pinned.length ? '<b>📌 Pinned</b><ul>' + pinned.slice(0, 8).map(li).join('') + '</ul>' : '') + '<div class="row" style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" id="wnOpen">Open notes</button>' + (upd ? '<button class="btn" id="wnUpd">Open job updates</button>' : '') + '<button class="btn" id="wnClose">Got it</button></div></div>';
    document.body.appendChild(box);
    const done = async () => { box.remove(); await stamp(); };
    box.querySelector('#wnClose').onclick = done;
    box.querySelector('#wnOpen').onclick = async () => { await done(); st.pad = who(); show('notes'); };
    const u = box.querySelector('#wnUpd'); if (u) u.onclick = async () => { await done(); show('updates'); };
  }
  async function show(which) {
    if (st.tab === 'updates' && which !== 'updates') markUpdatesRead();
    st.tab = which; if (st.tv) exitTv();
    ['main', '#custView', '#priceView', '#invView', '#catView'].forEach(sel => { const el = document.querySelector(sel); if (el) el.style.display = 'none'; });
    vB.style.display = which === 'board' ? 'block' : 'none'; vN.style.display = which === 'notes' ? 'block' : 'none'; vU.style.display = which === 'updates' ? 'block' : 'none';
    ['tabSearch', 'tabCust', 'tabPrice', 'tabInv', 'tabCat'].forEach(i => $(i) && $(i).classList.remove('on'));
    $('tabBoard').classList.toggle('on', which === 'board'); $('tabNotes').classList.toggle('on', which === 'notes'); $('tabUpdates').classList.toggle('on', which === 'updates');
    await draw(); if ((await window.api.cloudStatus()).configured) pull();
  }
  window.__hideWork = () => { if (st.tv) exitTv(); [vB, vN, vU].forEach(v => v.style.display = 'none'); ['tabBoard', 'tabNotes', 'tabUpdates'].forEach(i => $(i) && $(i).classList.remove('on')); if (st.tab === 'updates') markUpdatesRead(); st.tab = null; };
  $('tabBoard').onclick = () => show('board'); $('tabNotes').onclick = () => show('notes'); $('tabUpdates').onclick = () => show('updates');
  setInterval(() => { if (st.tab && !document.hidden && !st.editing && !st.tv) pull(true); }, 60000);
  window.__gm = { write, toast, auth: () => st.auth };   // used by the Inventory tab
  window.__cloudChanged = async () => { st.loaded = false; if (st.tab) show(st.tab); else { await pull(true); } };
  (async () => {   // on opening: load, then ask for the PIN if staff PINs are set up
    try { const s = await window.api.cloudStatus(); if (!s.configured) return; await pull(true); if (st.auth.required && !st.auth.user) await ensureAuth(); } catch (e) {}
  })();
  // Keep the warnings current even when nobody has the Order board open.
  async function bgPull() { try { if (st.busy || st.editing) return; const s = await window.api.cloudStatus(); if (s && s.configured) await pull(true); } catch (e) {} }
  setTimeout(bgPull, 4000);
  setInterval(() => { if (!st.tab) bgPull(); }, 5 * 60 * 1000);
  setInterval(() => paintDue(true), 60 * 1000);   // also catches the date rolling over at midnight
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('#dueBar [data-act="duego"]'); if (b) $('tabBoard').click(); });
})();
