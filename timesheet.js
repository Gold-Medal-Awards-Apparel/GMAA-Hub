// Timesheet: clock in/out and pay-period hours. Main process only; every rule is enforced here, not on screen.
//  - Clocking in or out needs the person's own 4-digit PIN each time, and always records for the person who owns that PIN.
//  - A signed-in person can only ever read their own hours. Only an admin can read anyone's, add, change or delete hours.
//  - Times are stored as UTC; pay periods are counted in the computer's local time (the shop's clock).
const DAY = 86400000;
const DEFAULT_ANCHOR = '2026-11-02', DEFAULT_DAYS = 14;   // until an admin sets the real pay period
const MAX_SHIFT_MS = 24 * 3600000;

function makeTimesheet({ need, ensure, query, actor, newId, str, verify, isAdmin }) {
  const dnum = d => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  const fromDnum = n => { const u = new Date(n * DAY); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()); };   // local midnight of that calendar day
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const parseYmd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); if (!m) return null; const d = new Date(+m[1], +m[2] - 1, +m[3]); return d.getMonth() === +m[2] - 1 ? d : null; };

  async function settings(c) {
    const rows = (await query(c, "SELECT k, v FROM settings WHERE k IN ('pay_anchor','pay_days')")).rows;
    const m = {}; rows.forEach(r => { m[r.k] = r.v; });
    const anchor = parseYmd(m.pay_anchor) ? m.pay_anchor : DEFAULT_ANCHOR;
    const days = [7, 14].includes(+m.pay_days) ? +m.pay_days : DEFAULT_DAYS;
    return { anchor, days, isDefault: !parseYmd(m.pay_anchor) };
  }
  // offset 0 = the pay period we are in, -1 = the one before, and so on.
  function periodOf(s, offset, now) {
    now = now || new Date(); offset = Math.max(-260, Math.min(1, Math.round(+offset || 0)));
    const a = dnum(parseYmd(s.anchor)), k = Math.floor((dnum(now) - a) / s.days) + offset;
    const start = fromDnum(a + k * s.days), endEx = fromDnum(a + (k + 1) * s.days), last = fromDnum(a + (k + 1) * s.days - 1);
    return { offset, start: start.toISOString(), end: endEx.toISOString(), first: ymd(start), last: ymd(last), days: s.days };
  }
  const minutes = (e, nowMs) => { const a = Date.parse(e.in), b = e.out ? Date.parse(e.out) : nowMs; return isFinite(a) && isFinite(b) && b > a ? Math.round((b - a) / 60000) : 0; };
  const shape = r => ({ id: r.id, person: r.person, in: r.clock_in, out: r.clock_out || '', note: r.note || '', edited_by: r.edited_by || '', edited_at: r.edited_at || '' });
  async function entriesIn(c, p, person) {
    const sql = 'SELECT * FROM time_entries WHERE deleted=0 AND clock_in>=? AND clock_in<?' + (person ? ' AND person=? COLLATE NOCASE' : '') + ' ORDER BY clock_in';
    return (await query(c, sql, person ? [p.start, p.end, person] : [p.start, p.end])).rows.map(shape);
  }
  const total = (list, nowMs) => list.reduce((a, e) => a + minutes(e, nowMs), 0);

  // ----- clock in / out (PIN every time; never accepts a name) -----
  async function clock(pin, kind) {
    const c = need(); await ensure(c);
    if (kind !== 'in' && kind !== 'out') return { error: 'Choose Clock in or Clock out.' };
    const v = await verify(pin, true);
    if (!v.row) return v;
    const name = v.row.name, now = new Date(), nowIso = now.toISOString();
    if (kind === 'in') {
      try { await query(c, "INSERT INTO time_entries (id,person,clock_in,clock_out,note,edited_by,edited_at,deleted,created_at) VALUES (?,?,?,'','','','',0,?)", [newId(), name, nowIso, nowIso]); }
      catch (e) {
        if (/unique|constraint/i.test(e.sqlMessage || e.message)) {
          const o = (await query(c, "SELECT clock_in FROM time_entries WHERE person=? COLLATE NOCASE AND clock_out='' AND deleted=0", [name])).rows[0];
          return { error: name + ', you are already clocked in.', already: true, since: o ? o.clock_in : '' };
        }
        throw e;
      }
    } else {
      const r = await query(c, "UPDATE time_entries SET clock_out=? WHERE person=? COLLATE NOCASE AND clock_out='' AND deleted=0", [nowIso, name]);
      if (!r.changes) return { error: name + ', you are not clocked in.', notIn: true };
    }
    const p = periodOf(await settings(c), 0, now), mine = await entriesIn(c, p, name);
    const last = [...mine].reverse()[0];
    return { ok: true, kind, name, at: nowIso, since: kind === 'out' && last ? last.in : '', shiftMin: kind === 'out' && last ? minutes(last, now.getTime()) : 0, periodMin: total(mine, now.getTime()) };
  }

  // ----- a signed-in person's own hours -----
  async function mine(offset) {
    const c = need(); await ensure(c); const by = await actor(c);
    if (!by) return { error: 'Staff PINs are not set up yet, so hours cannot be shown. Ask an admin to set them up.' };
    const now = new Date(), s = await settings(c), p = periodOf(s, offset, now), list = await entriesIn(c, p, by);
    const open = (await query(c, "SELECT * FROM time_entries WHERE person=? COLLATE NOCASE AND clock_out='' AND deleted=0", [by])).rows.map(shape)[0] || null;
    return { me: by, period: p, entries: list, totalMin: total(list, now.getTime()), open, now: now.toISOString() };
  }

  // ----- admin: everyone -----
  async function all(offset) {
    const c = need(); await ensure(c); await actor(c, { admin: true });
    const now = new Date(), s = await settings(c), p = periodOf(s, offset, now), list = await entriesIn(c, p, '');
    const staff = (await query(c, 'SELECT name, is_admin FROM staff ORDER BY name COLLATE NOCASE')).rows.map(r => ({ name: r.name, admin: !!r.is_admin }));
    const open = (await query(c, "SELECT * FROM time_entries WHERE clock_out='' AND deleted=0 ORDER BY clock_in")).rows.map(shape);
    const totals = {}; list.forEach(e => { const k = e.person.toLowerCase(); totals[k] = (totals[k] || 0) + minutes(e, now.getTime()); });
    return { period: p, settings: s, staff, entries: list, totals, open, now: now.toISOString() };
  }
  async function save(f) {
    const c = need(); await ensure(c); const by = await actor(c, { admin: true });
    f = f || {};
    const person = (await query(c, 'SELECT name FROM staff WHERE name=? COLLATE NOCASE', [str(f.person, 60)])).rows[0];
    if (!person) return { error: 'Pick a person from the staff list.' };
    const a = Date.parse(f.in), b = f.out ? Date.parse(f.out) : NaN;
    if (!isFinite(a)) return { error: 'Enter the clock-in date and time.' };
    if (f.out && !isFinite(b)) return { error: 'The clock-out time is not a valid date and time.' };
    if (a > Date.now() + 5 * 60000) return { error: 'The clock-in time is in the future.' };
    if (f.out) {
      if (b <= a) return { error: 'The clock-out time must be after the clock-in time.' };
      if (b - a > MAX_SHIFT_MS) return { error: 'One entry cannot be longer than 24 hours. Split it into two entries.' };
      if (b > Date.now() + 5 * 60000) return { error: 'The clock-out time is in the future.' };
    }
    const inIso = new Date(a).toISOString(), outIso = f.out ? new Date(b).toISOString() : '', far = '9999-12-31T00:00:00.000Z';
    const clash = (await query(c, "SELECT clock_in, clock_out FROM time_entries WHERE deleted=0 AND person=? COLLATE NOCASE AND id<>? AND clock_in<? AND (clock_out='' OR clock_out>?) LIMIT 1", [person.name, str(f.id, 40), outIso || far, inIso])).rows[0];
    if (clash) return { error: person.name + ' already has hours that overlap this time (' + clash.clock_in + ' to ' + (clash.clock_out || 'still clocked in') + ').' };
    const note = str(f.note, 300).replace(/\s+/g, ' ').trim(), now = new Date().toISOString();
    try {
      if (f.id) {
        const r = await query(c, 'UPDATE time_entries SET person=?, clock_in=?, clock_out=?, note=?, edited_by=?, edited_at=? WHERE id=? AND deleted=0', [person.name, inIso, outIso, note, by || 'admin', now, str(f.id, 40)]);
        if (!r.changes) return { error: 'That entry no longer exists. Refresh the list.' };
        return { ok: true, id: f.id };
      }
      const id = newId();
      await query(c, 'INSERT INTO time_entries (id,person,clock_in,clock_out,note,edited_by,edited_at,deleted,created_at) VALUES (?,?,?,?,?,?,?,0,?)', [id, person.name, inIso, outIso, note, by || 'admin', now, now]);
      return { ok: true, id };
    } catch (e) {
      if (/unique|constraint/i.test(e.sqlMessage || e.message)) return { error: person.name + ' is already clocked in. Close that entry first (give it a clock-out time).' };
      throw e;
    }
  }
  async function del(id) {
    const c = need(); await ensure(c); const by = await actor(c, { admin: true });
    const r = await query(c, 'UPDATE time_entries SET deleted=1, edited_by=?, edited_at=? WHERE id=? AND deleted=0', [by || 'admin', new Date().toISOString(), str(id, 40)]);
    return r.changes ? { ok: true } : { error: 'That entry no longer exists.' };
  }
  async function setPeriod(anchor, days) {
    const c = need(); await ensure(c); await actor(c, { admin: true });
    if (!parseYmd(anchor)) return { error: 'Pick the first day of a pay period.' };
    if (![7, 14].includes(+days)) return { error: 'The pay period must be 7 or 14 days.' };
    const now = new Date().toISOString();
    for (const [k, v] of [['pay_anchor', anchor], ['pay_days', String(+days)]])
      await query(c, 'INSERT INTO settings (k,v,updated_at) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at', [k, v, now]);
    return { ok: true };
  }
  return { clock, mine, all, save, del, setPeriod, _periodOf: periodOf, _minutes: minutes };
}
module.exports = { makeTimesheet };
