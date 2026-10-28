// Customer analytics: pure functions (works in the browser and in Node tests).
(function (root) {
  const SEGMENTS = ['School', 'Fire / EMS / Police', 'Government / Military', 'Church', 'Sports team / Club / Band', 'Nonprofit / Community', 'Business', 'Individual', 'Other'];
  const RX = [
    ['Fire / EMS / Police', /\b(fire\s*(dept|department|district|protection|co|company)|volunteer fire|vfd|\bfd\b|pfd|gfd|pcfd|ems|ambulance|police|sheriff|law enforcement|rescue|firefighters?|fop)\b/],
    ['School', /\b(school|schools|elementary|middle|high school|junior high|jr high|jrhs|\bhs\b|mhs|phs|pjhs|mms|mes|academy|college|university|k12|pta|pto|teachers?|district|isd|corporation of|ivy tech|homestead)\b/],
    ['Nonprofit / Community', /\b(foundation|rotary|lions|kiwanis|chamber|museum|library|historical|society|association|assoc|humane|shelter|fair|festival|committee|council|united way|scouts?|lodge|masonic|elks|moose|charity|community|reunion|alumni|memorial|park|foods?\s*bank|ymca|we care|conference)\b/],
    ['Church', /\b(church|churches|ministr(y|ies)|parish|chapel|baptist|methodist|lutheran|catholic|bible|christian|saint|st\.? bernard|congregation|diocese)\b/],
    ['Business', /\b(inc|llc|co|company|corp|corporation|ltd|enterprises|industries|services|service|auto|automotive|motors|motor|ford|chrysler|dodge|chevrolet|toyota|restaurant|bank|credit union|insurance|construction|plumbing|electric|electrical|supply|farm|farms|bakery|salon|dental|dentist|clinic|hospital|health|law|realty|real estate|group|trucking|transport|products|solutions|manufacturing|machine|repair|tire|pizza|cafe|shop|store|market|hardware|roofing|heating|cooling|hvac|landscaping|excavating|storage|printing|signs?|graphics|design|creative|studio|media|marketing|fitness|physical therapy|veterinary|vet|pharmacy|realtors?|funeral|brewing|distillery|tavern|bar|grill|diner|motel|hotel|inn|outdoors|tradeshows?|steam|movers|rv sales|sales|tree|rentals?|cleaning|maids)\b/],
    ['Government / Military', /\b(county|city of|town of|township|state of|dept of|department of|army|navy|air force|air refueling|wing|squadron|usasmdc|smdc|usmdc|marines?|national guard|grissom|veterans|vfw|american legion|courthouse|clerk|prosecutor|highway|utilities|utility)\b/],
    ['Sports team / Club / Band', /\b(booster|boosters|club|team|league|athletic|athletics|band|cheer|cheerleading|football|basketball|baseball|softball|soccer|track|wrestling|swim|volleyball|cross country|xc|gym|gymnastics|dance|4-?h|tennis|golf|bowling|racing|speedway|dragstrip|drag strip|derby|rodeo|kick ?boxing|jackrabbits?|roadrunners|flipsters|braves|ironman)\b/]
  ];
  const clean = s => String(s == null ? '' : s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9@\.\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Folding makes "Maconaquah HS" / "Maconaquah High School" and "Sly Fox" / "SlyFox" the same customer.
  // Same-customer rules, applied in order to the lower-case name before comparing. Safe to extend:
  // [pattern, replacement]. Example: GFD -> "grissom fire department" makes "GFD" and "Grissom Fire Dept." one customer.
  const ALIAS_RULES = [
    [/\bgrossom\b|\bgrisom\b/g, 'grissom'],
    [/\bgrissom (arb|afb|air reserve base|air force base)\b/g, 'grissom'],
    [/\bdepartments?\b|\bdept\b\.?/g, 'department'],
    [/\bgfd\b/g, 'grissom fire department'],
    [/\bpfd\b/g, 'peru fire department'],
    [/\bpcfd\b/g, 'pipe creek fire department'],
    [/\bpd\b/g, 'police department'],
    [/\b(grissom|peru|pipe creek|roann|amboy|mexico|miami county|converse|bunker hill|denver|macy|walton|logansport|kokomo)(?! fire| police)( [a-z]+)? fd\b/g, '$1$2 fire department'],
    [/^(.*)\bfd$/g, '$1fire department'],
    [/\b(township|twp|volunteer|vol|community)\b(?=.*\bfire\b)/g, ''],
    [/\bfire$/g, 'fire department'],
    [/\bsheriffs?\b (department|office)\b/g, 'sheriff office'],
    [/\bin(diana)? state (fire )?marshall?\b/g, 'indiana state fire marshal'],
    [/\bindiana state fire marshall\b/g, 'indiana state fire marshal'],
    [/\bmhs\b/g, 'maconaquah hs'],
    [/\bclub kokomo\b(?! roadrunners)(?!.*coyote)/g, 'club kokomo roadrunners'],
    [/^.*\bivy tech\b.*/g, 'ivy tech community college'],
    [/^jackrabbits\b/g, 'kokomo jackrabbits'], [/\broad runners\b/g, 'roadrunners'],
    [/\b(grace pointe|mcgrawsville)\b.*\bchurch\b.*/g, '$1 church'],
    [/\blewis cass\b.*\bmarching kings\b.*/g, 'lewis cass hs marching kings'],
    [/\bnorth miami hs\b.*/g, 'north miami hs'],
    [/\bmaconaqauah\b/g, 'maconaquah'], [/\bhight\b/g, 'high'], [/\bmarchnig\b/g, 'marching'],
    [/\belem\b/g, 'elementary'],
    [/\bchariot (auto|automotive)( group)?\b/g, 'chariot automotive'],
    [/\bhigh school\b/g, 'hs'], [/\b(jr|junior) high( school)?\b/g, 'jh'], [/\bmiddle school\b/g, 'ms'], [/\belementary( school)?\b/g, 'es'],
    [/\b(the|inc|llc|co|company|corp|corporation|ltd)\b/g, ' ']
  ];
  // PARENT organizations: sub-groups roll up into one parent when the toggle "Parent organization" is on.
  // [pattern on the lower-case name, parent display name]. Names with "Something - Team" roll up to "Something" automatically.
  const PARENT_RULES = [
    [/\bmaconaquah\b|\bmhs\b|^mac /, 'Maconaquah Schools'],
    [/\bivy tech\b/, 'Ivy Tech Community College'],
    [/\bclub kokomo\b|\bcoyote kids\b/, 'Club Kokomo'],
    [/\bmiami county automotive\b|\bgrissom chrysler\b|\bperu ford\b/, 'Miami County Automotive Group'],
    [/\bmike anderson\b/, 'Mike Anderson'],
    [/\blewis cass\b/, 'Lewis Cass'],
    [/\bnorth miami\b/, 'North Miami'],
    [/\b(grace pointe|mcgrawsville)\b.*\bchurch\b/, null]
  ];
  function parentName(name) {
    const t = clean(name);
    for (const [rx, p] of PARENT_RULES) if (p && rx.test(t)) return p;
    const m = String(name).match(/^(.+?\S)\s*[-–]\s*(\S.*)$/);
    if (m && m[1].trim().split(/\s+/).length >= 2 && m[2].replace(/[^a-z]/gi, '').length >= 3) return m[1].trim();
    return name;
  }
  function fold(name) {
    let t = clean(name).replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
    for (const [rx, rep] of ALIAS_RULES) t = t.replace(rx, rep).replace(/\s+/g, ' ').trim();
    t = t.replace(/[^a-z0-9@]+/g, ' ').trim().replace(/\b(.{6,}?)(?: \1)+\b/g, '$1');   // "x fire department x fire department" -> one
    return t.replace(/[^a-z0-9@]+/g, '');
  }
  const DEFAULT_MERGES = { slyfox: 'slyfoxcreative', gnrock: 'grarock' };
  function guessSegment(cust, co) {
    const text = clean((co || '') + ' ' + (cust || ''));
    for (const [seg, rx] of RX) if (rx.test(text)) return seg;
    const c = clean(cust);
    if (!co && c && !/@/.test(c) && !/\d/.test(c) && c.split(' ').length <= 4) return 'Individual';
    return 'Other';
  }

  // opts: {mode:'org'|'cust', store:''|'old'|'new', from:'YYYY-MM-DD'|'', to:'', overrides:{key:segment}}
  function aggregate(DATA, opts) {
    opts = opts || {}; const mode = opts.mode || 'org', ov = opts.overrides || {};
    const ents = new Map(); let total = 0;
    for (const r of DATA.r) {
      if (r[8] === 2) continue;                       // tax / fee / shipping lines are not product sales
      if (r[9] === 2 || r[9] === 3) continue;         // voided or fully refunded orders do not count as sales
      if (opts.store === 'old' && r[10] === 1) continue;
      if (opts.store === 'new' && r[10] !== 1) continue;
      if (opts.from && r[0] < opts.from) continue;
      if (opts.to && r[0] > opts.to) continue;
      const cust = DATA.c[r[2]] || '', co = DATA.co[r[3]] || '';
      const specific = mode === 'cust' ? (cust || co) : (co || cust);
      if (!specific) continue;
      const name = mode === 'parent' ? parentName(specific) : specific;
      const fk = fold(name); const key = (opts.merges && opts.merges[fk]) || DEFAULT_MERGES[fk] || fk;
      let e = ents.get(key);
      if (!e) { e = { key, name, cust, co, revenue: 0, lines: 0, orders: new Map(), items: new Map(), years: new Map(), contacts: new Set(), variants: new Map(), subs: new Map(), first: r[0], last: r[0] }; ents.set(key, e); }
      if (mode === 'parent') { const sk = fold(specific); const sv = e.subs.get(sk) || { name: specific, revenue: 0 }; sv.revenue += (r[7] > 0 ? r[7] : 0); e.subs.set(sk, sv); }
      e.variants.set(name, (e.variants.get(name) || 0) + (r[7] > 0 ? r[7] : 0) + 0.001);
      const amt = r[7] > 0 ? r[7] : 0;
      e.revenue += amt; total += amt; e.lines++;
      if (r[0] < e.first) e.first = r[0]; if (r[0] > e.last) e.last = r[0];
      if (cust) e.contacts.add(cust);
      const ok = (r[10] === 1 ? 'N' : 'O') + r[1];
      let o = e.orders.get(ok); if (!o) { o = { id: ok, num: r[1], src: r[10] === 1 ? 'new' : 'old', date: r[0], total: 0, lines: 0, oid: r[11] || '', cid: r[12] || '' }; e.orders.set(ok, o); }
      o.total += amt; o.lines++;
      const y = r[0].slice(0, 4); e.years.set(y, (e.years.get(y) || 0) + amt);
      if (r[4]) {
        const ik = clean(r[4]); let it = e.items.get(ik);
        if (!it) { it = { item: r[4], qty: 0, revenue: 0, prices: [], orders: new Set(), last: r[0], lastPrice: r[6] }; e.items.set(ik, it); }
        it.qty += r[5]; it.revenue += amt; if (r[6] > 0) it.prices.push(r[6]); it.orders.add(ok); if (r[0] >= it.last) { it.last = r[0]; it.lastPrice = r[6]; }
      }
    }
    const list = [];
    for (const e of ents.values()) {
      { let best = '', bv = -1; for (const [n, v] of e.variants) if (v > bv) { bv = v; best = n; } e.name = best; e.alsoKnownAs = [...e.variants.keys()].filter(n => n !== best); }
      e.subList = [...e.subs.values()].sort((a, b) => b.revenue - a.revenue);
      e.nOrders = e.orders.size; e.avgOrder = e.nOrders ? e.revenue / e.nOrders : 0;
      e.segment = ov[e.key] || guessSegment(e.cust, mode !== 'cust' ? e.name : e.co);
      if (mode === 'org' && !e.co) e.segment = ov[e.key] || guessSegment(e.cust, '');
      e.activeYears = [...e.years.entries()].filter(([, v]) => v > 0).length;
      list.push(e);
    }
    list.sort((a, b) => b.revenue - a.revenue);
    list.forEach((e, i) => { e.rank = i + 1; e.share = total ? e.revenue / total : 0; });
    return { list, total };
  }
  function bySegment(agg) {
    const m = new Map();
    for (const e of agg.list) { let s = m.get(e.segment); if (!s) { s = { segment: e.segment, customers: 0, revenue: 0, orders: 0 }; m.set(e.segment, s); } s.customers++; s.revenue += e.revenue; s.orders += e.nOrders; }
    const out = [...m.values()]; out.forEach(s => { s.share = agg.total ? s.revenue / agg.total : 0; s.avg = s.customers ? s.revenue / s.customers : 0; });
    return out.sort((a, b) => b.revenue - a.revenue);
  }
  const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const api = { SEGMENTS, parentName, fold, guessSegment, aggregate, bySegment, median, clean };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CustLogic = api;
})(typeof window !== 'undefined' ? window : this);
