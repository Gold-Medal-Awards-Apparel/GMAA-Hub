
/* ===================== ABBREVIATIONS (safe to edit with Notepad) =====================
   SYNONYMS: every word in a group means the same as the others, in both directions.
   EXPANSIONS: typing the first word also searches for everything listed after it. */
const SYNONYMS = [
  ['cross country','cc','xc','x country','xcountry','mhsxc'],
  ['maconaquah','mac','maconoquah','braves'],
  ['shirt','tshirt','tee','tees'],
  ['hoodie','hoodies','hooded sweatshirt'],
  ['sweatshirt','crewneck','crew neck','crew'],
  ['quarter zip','1 4 zip','quarterzip','qtr zip'],
  ['name tag','nametag','name badge'],
  ['embroidery','embroidered','embroider','emb'],
  ['sublimated','sublimation','sublimate','sub'],
  ['heat press','heatpress','htv'],
  ['dtf','direct to film'],
  ['trophy','trophies'],
  ['engraved','engraving','engrave','engrav'],
  ['digitizing','digitization','digitize','digitiz'],
  ['senior','seniors','sr'],
  ['junior','jr'],
  ['junior high','jr high','jh','jhs'],
  ['junior varsity','jv'],
  ['elementary','elem','el'],
  ['middle school','middle','ms'],
  ['high school','hs','highschool'],
  ['left chest','lc'],
  ['right chest','rc'],
  ['fire department','fire dept','fd'],
  ['saint','st'],
  ['basketball','bball','bb'],
  ['volleyball','vball','vb'],
  ['wrestling','wrestle','wr'],
  ['ladies','lady','women','woman','womens'],
  ['jacket','coat'],
  ['hat','cap'],
  ['bella canvas','bella'],
  ['sport tek','sporttek'],
  ['port authority','pa'],
  ['2xl','xxl'],['3xl','xxxl'],['4xl','xxxxl'],
  ['lewis cass','lchs'],
  ['gfd','grissom fire department','grissom fire dept','grissom fd'],
  ['pfd','peru fire department','peru fire dept','peru fd'],
  ['pcfd','pipe creek fire department','pipe creek fire dept'],
  ['trc','three rivers conference','three rivers'],
  ['smdc','usasmdc','usmdc','army smdc'],
  ['arw','arefw','air refueling wing'],
  ['ifs','industrial fire services'],
  ['cdjr','chrysler dodge jeep ram','grissom chrysler dodge jeep ram'],
  ['ihc','indiana health center'],
  ['vca','victory christian academy'],
  ['smwc','saint mary of the woods','saint mary'],
  ['ckrr','club kokomo roadrunners','roadrunners'],
  ['fop','fraternal order of police'],
  ['ffa','future farmers of america']
];
const EXPANSIONS = {
  'mhs':  ['maconaquah high school','maconaquah hs','mac hs','maconaquah','mac','braves','mhsxc'],
  'mms':  ['maconaquah middle school','maconaquah ms','mac ms','mac middle','maconaquah','mac'],
  'mes':  ['maconaquah elementary','mac elementary','mac el','maconaquah','mac'],
  'phs':  ['peru high school','peru hs','peru'],
  'pjhs': ['peru junior high','peru jr high','peru jh','peru middle school','peru'],
  'ccfi': ['circus city']
};
/* ============================ END OF ABBREVIATIONS ============================ */

const DATA = window.__DATA__;
const BUILT = window.__BUILT__;
const ordTag = r => (r[10]===1?'New #':'Old #')+r[1];
const STORE = DATA.store || '';
const adminUrl = (kind,id) => (STORE && id) ? 'https://admin.shopify.com/store/'+encodeURIComponent(STORE)+'/'+kind+'/'+encodeURIComponent(id) : '';
function ordHtml(r){ const u = r[10]===1 ? adminUrl('orders',r[11]) : ''; return u ? '<a class="ext" data-url="'+esc(u)+'" title="Open this order in Shopify">'+esc(ordTag(r))+'</a>' : esc(ordTag(r)); }
function whoHtml(r, who, hres){ const u = r[10]===1 ? adminUrl('customers',r[12]) : ''; const t = hl(who,hres); return u && DATA.c[r[2]] ? '<a class="ext" data-url="'+esc(u)+'" title="Open this customer in Shopify">'+t+'</a>' : t; }
const STATUS = ['paid','pending','voided','refunded','partially refunded','imported'];
const STOP = new Set(('a an the of for on in at to from with by it its is are was were be been do did does done we they he she you i me my our his her their '+
  'what which who whom how much many paid pay price prices cost costs charge charged charges order orders check look up find show get '+
  'any all and or about this that please try need want like previous past history lookup search can could would should there than then').split(' '));

const $ = id => document.getElementById(id);
const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function norm(s){
  s = String(s||'').toLowerCase().replace(/[’‘`']/g,'');
  s = s.replace(/\btee[\s\-]?shirts?\b/g,'tshirt').replace(/\bt[\s\-]?shirts?\b/g,'tshirt').replace(/&/g,' and ');
  return s.replace(/[^a-z0-9]+/g,' ').trim();
}
const money = n => (n<0?'-':'') + '$' + Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
function fmtDate(d){ const [y,m,dd]=d.split('-'); return m+'/'+dd+'/'+y; }
function fmtLong(d){ const [y,m,dd]=d.split('-').map(Number); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]+' '+dd+', '+y; }
function median(a){ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y), n=s.length; return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2; }

/* ---------- build abbreviation index ---------- */
const TERMS = new Map(); let MAXW = 1;
function addTerm(t, variants){
  const ex = TERMS.get(t) || [t];
  variants.forEach(v => { if(!ex.includes(v)) ex.push(v); });
  TERMS.set(t, ex); MAXW = Math.max(MAXW, t.split(' ').length);
}
SYNONYMS.forEach(g => { const n = g.map(norm); n.forEach(t => addTerm(t, n)); });
Object.entries(EXPANSIONS).forEach(([k,v]) => addTerm(norm(k), v.map(norm)));

/* ---------- prepare data ---------- */
const ROWS = DATA.r;
const HAY = new Array(ROWS.length);
const NHAY = new Array(ROWS.length);   // customer + company names only
const WORDCOUNT = new Map();
for (let i=0;i<ROWS.length;i++){
  const r = ROWS[i];
  const h = norm(DATA.c[r[2]]+' '+DATA.co[r[3]]+' '+r[4]+' '+r[1]);
  HAY[i] = ' '+h+' ';
  NHAY[i] = ' '+norm(DATA.c[r[2]]+' '+DATA.co[r[3]])+' ';
}
let vocabBuilt = false;
function buildVocab(){ if(vocabBuilt) return; vocabBuilt = true;
  for (const h of HAY) for (const w of h.split(' ')) if(w.length>=4) WORDCOUNT.set(w,(WORDCOUNT.get(w)||0)+1); }

function hit(hay, v){
  if (v.length <= 3) return hay.includes(' '+v+' ') || hay.includes(' '+v+'s ');
  return hay.includes(' '+v);
}
// Short pieces that are not known abbreviations (e.g. the "f" in "bob f") also match the START of a customer/company name word.
function hitRow(i, v){
  if (hit(HAY[i], v)) return true;
  return v.length <= 3 && !/^\d+$/.test(v) && !TERMS.has(v) && NHAY[i].includes(' '+v);
}

/* ---------- query parsing ---------- */
const MONTHS = {jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
const pad = n => String(n).padStart(2,'0');
function lastDay(y,m){ return new Date(y,m,0).getDate(); }
function parseDates(text, ignore){
  let rest = text.toLowerCase(), from=null, to=null, labels=[];
  if (ignore) return {rest, from, to, labels};
  const now = new Date(), Y = now.getFullYear(), M = now.getMonth()+1;
  const take = (re, fn) => { const m = rest.match(re); if(!m) return false; fn(m); rest = rest.replace(re,' '); return true; };
  let got = false;
  got = take(/\blast year\b/, () => { from=(Y-1)+'-01-01'; to=(Y-1)+'-12-31'; labels.push('Last year ('+(Y-1)+')'); }) || got;
  got = take(/\bthis year\b/, () => { from=Y+'-01-01'; to=Y+'-12-31'; labels.push('This year ('+Y+')'); }) || got;
  got = take(/\blast month\b/, () => { let y=Y,m=M-1; if(m<1){m=12;y--;} from=y+'-'+pad(m)+'-01'; to=y+'-'+pad(m)+'-'+lastDay(y,m); labels.push('Last month'); }) || got;
  got = take(/\bthis month\b/, () => { from=Y+'-'+pad(M)+'-01'; to=Y+'-'+pad(M)+'-'+lastDay(Y,M); labels.push('This month'); }) || got;
  got = take(/\blast (\d{1,2}) years?\b/, m => { const d=new Date(now); d.setFullYear(d.getFullYear()-Number(m[1])); from=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); labels.push('Last '+m[1]+' years'); }) || got;
  got = take(/\b(?:since|after|from) (20[0-3]\d)\b(?!\s*(?:-|to|through|thru))/, m => { from=m[1]+'-01-01'; labels.push('Since '+m[1]); }) || got;
  got = take(/\b(?:before|prior to) (20[0-3]\d)\b/, m => { to=(Number(m[1])-1)+'-12-31'; labels.push('Before '+m[1]); }) || got;
  got = take(/\b(20[0-3]\d)\s*(?:-|–|to|through|thru)\s*(20[0-3]\d)\b/, m => { const a=Math.min(m[1],m[2]), b=Math.max(m[1],m[2]); from=a+'-01-01'; to=b+'-12-31'; labels.push(a+' to '+b); }) || got;
  const mre = new RegExp('\\b('+Object.keys(MONTHS).join('|')+')\\.?,?\\s+(20[0-3]\\d)\\b');
  got = take(mre, m => { const mo=MONTHS[m[1]], y=Number(m[2]); from=y+'-'+pad(mo)+'-01'; to=y+'-'+pad(mo)+'-'+lastDay(y,mo); labels.push(m[1].charAt(0).toUpperCase()+m[1].slice(1)+' '+y); }) || got;
  if (!got) take(/\b(20[0-3]\d)\b/, m => { from=m[1]+'-01-01'; to=m[1]+'-12-31'; labels.push(m[1]); });
  return {rest, from, to, labels};
}
function parseQuery(text, ignoreDates){
  const out = {units:[], from:null, to:null, labels:[]};
  let t = text||'';
  const quoted = [];
  t = t.replace(/"([^"]+)"/g, (m,p) => { const n=norm(p); if(n) quoted.push(n); return ' '; });
  const d = parseDates(t, ignoreDates);
  out.from=d.from; out.to=d.to; out.labels=d.labels;
  quoted.forEach(q => out.units.push({label:'"'+q+'"', variants:[q], exact:true}));
  const words = norm(d.rest).split(' ').filter(Boolean);
  for (let i=0;i<words.length;){
    let done=false;
    for (let len=Math.min(MAXW, words.length-i); len>=1; len--){
      const ph = words.slice(i,i+len).join(' ');
      const key = TERMS.has(ph) ? ph : (ph.length>3 && ph.endsWith('s') && TERMS.has(ph.slice(0,-1)) ? ph.slice(0,-1) : null);
      if (key) { const vs=TERMS.get(key).slice(); if(key!==ph) vs.unshift(ph); out.units.push({label:ph, variants:vs, abbr: TERMS.get(key).length>1}); i+=len; done=true; break; }
    }
    if (done) continue;
    const w = words[i++];
    if (STOP.has(w)) continue;
    const vs=[w];                                   // plural typed, singular on the order (medals -> medal)
    if (w.length>=5 && w.endsWith('s') && !w.endsWith('ss')) vs.push(w.slice(0,-1));
    if (w.length>=6 && w.endsWith('es')) vs.push(w.slice(0,-2));
    out.units.push({label:w, variants:vs});
  }
  return out;
}

/* ---------- state ---------- */
const S = { q:'', sort:'date:-1', limit:100, sel:new Set(), ignoreDates:false, res:[], parsed:{units:[],labels:[],from:null,to:null}, note:'' };

function levenshtein(a,b,max){
  if (Math.abs(a.length-b.length)>max) return max+1;
  let prev=new Array(b.length+1); for(let j=0;j<=b.length;j++) prev[j]=j;
  for(let i=1;i<=a.length;i++){
    const cur=[i]; let rowMin=i;
    for(let j=1;j<=b.length;j++){
      const v=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
      cur[j]=v; if(v<rowMin) rowMin=v;
    }
    if(rowMin>max) return max+1; prev=cur;
  }
  return prev[b.length];
}

function applyFilters(parsed){
  const hideFees=$('hideFees').checked, hideVoid=$('hideVoid').checked, ysel=$('yearSel').value, msel=$('monthSel').value, ssel=$('storeSel').value;
  let from=parsed.from, to=parsed.to;
  if (ysel){ const f=ysel+'-01-01', t=ysel+'-12-31'; from=(!from||f>from)?f:from; to=(!to||t<to)?t:to; }
  const idx=[];
  for (let i=0;i<ROWS.length;i++){
    const r=ROWS[i];
    if (ssel==='old' && r[10]===1) continue;
    if (ssel==='new' && r[10]!==1) continue;
    if (hideFees && r[8]===2) continue;
    if (hideVoid && r[9]===2) continue;
    if (msel && r[0].slice(5,7)!==msel) continue;
    if (from && r[0]<from) continue;
    if (to && r[0]>to) continue;
    idx.push(i);
  }
  return idx;
}

function search(){
  const parsed = parseQuery(S.q, S.ignoreDates);
  if ((parsed.from || parsed.to) && ($('yearSel').value || $('monthSel').value)) { $('yearSel').value = ''; $('monthSel').value = ''; }   // dates typed in the box win over the dropdown
  S.parsed = parsed; S.note=''; S.fuzzy=[];
  const base = applyFilters(parsed);
  const units = parsed.units;
  const run = () => {
    let cand = base; const score = new Map();
    for (const u of units){
      const next=[];
      for (const i of cand){
        const hay=HAY[i]; let best=0;
        for (let k=0;k<u.variants.length;k++){ if (hitRow(i,u.variants[k])) { best = k===0?3:2; break; } }
        if (best){ next.push(i); score.set(i,(score.get(i)||0)+best); }
      }
      cand = next; if(!cand.length) break;
    }
    return {cand, score};
  };
  let {cand, score} = run();
  if (!cand.length && units.length){
    buildVocab();
    let changed=false;
    for (const u of units){
      if (u.exact) continue;
      const anyHit = HAY.some((h,ix) => u.variants.some(v => hitRow(ix,v)));
      if (anyHit) continue;
      const w = u.variants[0]; if (w.length<4 || /^\d+$/.test(w)) continue;
      const max = w.length>=8?2:1, found=[];
      for (const [word,c] of WORDCOUNT){
        const d = levenshtein(w,word,max);
        if (d<=max) found.push([d,-c,word]);
      }
      found.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
      const top = found.slice(0,6).map(f=>f[2]);
      if (top.length){ u.variants = u.variants.concat(top); S.fuzzy.push(w+' → '+top.slice(0,3).join(', ')); changed=true; }
    }
    if (changed){ ({cand, score} = run()); }
  }
  // "bob f": when a short piece looks like part of a name, prefer rows where ALL pieces match the customer/company name.
  const shortName = units.some(u => u.variants.some(v => v.length<=3 && !/^\d+$/.test(v) && !TERMS.has(v)));
  if (shortName && units.length>=2 && cand.length){
    const nm = cand.filter(i => units.every(u => u.variants.some(v => NHAY[i].includes(' '+v))));
    if (nm.length){ cand = nm; S.note = 'Showing customers/companies whose name matches everything you typed.'; }
  }
  S.res = cand.map(i => ({i, s:score.get(i)||0}));
  if (!units.length && !parsed.labels.length && !$('yearSel').value && !$('monthSel').value && /^score:/.test(S.sort)) S.sort='date:-1';
  sortResults();
  S.limit = 100; S.sel.clear();
  if (!units.length && !parsed.labels.length && !$('yearSel').value && !$('monthSel').value){   // nothing typed: browse the newest orders
    const seen=new Set(); let n=0; for (; n<S.res.length; n++){ const r=ROWS[S.res[n].i], k=r[1]+':'+r[10]; if(!seen.has(k)){ if(seen.size>=100) break; seen.add(k); } }
    S.limit=Math.max(n,1);
  }
  render();
}

// Used by the Price Check tab: rows matching the typed words (no screen filters), real sales only.
function matchRows(text){
  const parsed = parseQuery(text, false), out = [];
  for (let i=0;i<ROWS.length;i++){
    const r=ROWS[i];
    if (r[8]===2 || r[9]===2 || r[9]===3 || !(r[6]>0)) continue;
    if (parsed.from && r[0]<parsed.from) continue;
    if (parsed.to && r[0]>parsed.to) continue;
    let ok=true;
    for (const u of parsed.units){ if(!u.variants.some(v=>hitRow(i,v))){ ok=false; break; } }
    if (ok) out.push(i);
  }
  return {rows:out, parsed};
}
function sortResults(){
  const [k,dirS]=S.sort.split(':'), dir=Number(dirS);
  const key = x => { const r=ROWS[x.i]; switch(k){
    case 'date': return r[0]; case 'order': return r[1];
    case 'name': return (DATA.c[r[2]]||DATA.co[r[3]]||'').toLowerCase();
    case 'item': return r[4].toLowerCase(); case 'qty': return r[5];
    case 'price': return r[6]; case 'total': return r[7]; case 'score': return x.s; } };
  S.res.sort((a,b)=>{ const A=key(a), B=key(b); if(A<B) return -dir; if(A>B) return dir;
    if (k==='score'){ const da=ROWS[a.i][0], db=ROWS[b.i][0]; if(da!==db) return da<db?1:-1; }
    return b.i-a.i; });
}

/* ---------- rendering ---------- */
function hlTerms(){
  const set=new Set();
  (S.parsed.units||[]).forEach(u => u.variants.forEach(v => { if(v.length>=2 && !STOP.has(v)) set.add(v); }));
  const arr=[...set].sort((a,b)=>b.length-a.length).slice(0,40);
  return arr.map(v => new RegExp('(^|[^a-z0-9])('+v.split(' ').map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[^a-z0-9]+')+')'+(v.length<=3?'(?![a-z0-9])':''),'gi'));
}
function hl(text, res){
  let out = esc(text); if(!res.length) return out;
  const ranges=[];
  res.forEach(re => { re.lastIndex=0; let m; while((m=re.exec(text))){ const s=m.index+m[1].length, e=s+m[2].length; ranges.push([s,e]); if(m[0].length===0) re.lastIndex++; } });
  if(!ranges.length) return out;
  ranges.sort((a,b)=>a[0]-b[0]);
  const merged=[]; ranges.forEach(r => { const l=merged[merged.length-1]; if(l && r[0]<=l[1]) l[1]=Math.max(l[1],r[1]); else merged.push(r.slice()); });
  let html='', pos=0; merged.forEach(([s,e]) => { html+=esc(text.slice(pos,s))+'<mark>'+esc(text.slice(s,e))+'</mark>'; pos=e; });
  return html+esc(text.slice(pos));
}
function badge(st){ return st===2?'<span class="badge void">voided</span>':st===3?'<span class="badge ref">refunded</span>':st===4?'<span class="badge ref">part refund</span>':st===1?'<span class="badge pend">pending</span>':''; }

function stats(rows){
  const items = rows.filter(r => r[8]===0 && r[6]>0);
  const prices = items.map(r => r[6]);
  const orders = new Set(rows.map(r => r[1]));
  const units = rows.reduce((a,r)=>a+(r[9]===2||r[8]===2?0:r[5]),0);
  let latest=null; items.forEach(r => { if(!latest || r[0]>latest[0] || (r[0]===latest[0] && r[1]>latest[1])) latest=r; });
  return {n:rows.length, orders:orders.size, units, prices, lo:prices.length?Math.min(...prices):null, hi:prices.length?Math.max(...prices):null, med:median(prices), latest};
}

function render(){
  const out=$('out'), p=S.parsed;
  // interpretation
  let ih='';
  if (p.units.length || p.labels.length){
    ih='Searching for: ';
    p.units.forEach(u => {
      if (u.abbr){ const others=u.variants.filter(v=>v!==u.label); ih+='<span class="chip"><b>'+esc(u.label.toUpperCase())+'</b> also finds '+esc(others.slice(0,5).join(', '))+(others.length>5?' +'+(others.length-5)+' more':'')+'</span>'; }
      else ih+='<span class="chip"><b>'+esc(u.label)+'</b></span>';
    });
    p.labels.forEach(l => ih+='<span class="chip date">'+esc(l)+' <span class="x" title="Search this as text instead" data-x="date">&times;</span></span>');
  }
  $('interp').innerHTML=ih;
  let nh='';
  if (S.fuzzy && S.fuzzy.length) nh+='<div class="notice">No exact matches, so I tried similar spellings: '+esc(S.fuzzy.join(' · '))+'</div>';
  $('notice').innerHTML=nh;

  const browse = !p.units.length && !p.labels.length && !$('yearSel').value && !$('monthSel').value;
  let hero='';
  if (browse){
    hero='<div class="empty"><h2>What are you looking for?</h2>Type a customer, school, item or order number above, for example <b>mhs cc shirts 2025</b>.<br>Dates like <b>last year</b> or <b>oct 2025</b> work too.</div>';
    if (!S.res.length){ out.innerHTML=hero; $('printMeta').textContent=''; return; }
  }
  const rows = S.res.map(x => ROWS[x.i]);
  if (!rows.length){
    let diag='';
    if (p.units.length>1){
      const base=applyFilters(p);
      diag='<div style="margin-top:14px;text-align:left;display:inline-block"><b>Lines matching each word on its own:</b><br>'+p.units.map(u => {
        let c=0; for(const i of base){ for(const v of u.variants){ if(hitRow(i,v)){c++;break;} } }
        return esc(u.label)+': '+c.toLocaleString(); }).join('<br>')+'<br><span style="color:#5d6980">Try removing the word with the lowest count.</span></div>';
    }
    out.innerHTML='<div class="empty"><h2>No matching lines</h2>Try fewer words, a different spelling, or turn off the filters above.'+diag+'</div>';
    $('printMeta').textContent=''; return;
  }
  const st=stats(rows);
  const cards=[];
  cards.push(['hero','Most recent price', st.latest?money(st.latest[6]):'—', st.latest?fmtLong(st.latest[0])+' · '+(DATA.c[st.latest[2]]||DATA.co[st.latest[3]]):'no priced lines']);
  cards.push(['','Typical price (median)', st.med!=null?money(st.med):'—', st.prices.length+' priced lines']);
  cards.push(['','Price range', st.lo!=null?money(st.lo)+' – '+money(st.hi):'—', 'lowest to highest']);
  cards.push(['','Lines found', st.n.toLocaleString(), st.orders.toLocaleString()+' orders']);
  cards.push(['','Total quantity', st.units.toLocaleString(), 'excluding voided']);
  let html=browse?hero+'<h3 style="margin:18px 0 8px;color:var(--navy)">Latest orders</h3>':'<div class="cards">'+cards.map(c=>'<div class="card '+c[0]+'"><div class="k">'+c[1]+'</div><div class="v">'+esc(c[2])+'</div><div class="s">'+esc(c[3])+'</div></div>').join('')+'</div>';
  // by year
  const by={}; rows.filter(r=>r[8]===0&&r[6]>0).forEach(r => { const y=r[0].slice(0,4); (by[y]=by[y]||[]).push(r[6]); });
  const ys=Object.keys(by).sort().reverse();
  if (!browse && ys.length>1){
    html+='<details class="years noprint"><summary>Price by year</summary><table class="t"><tr><th>Year</th><th>Lines</th><th>Lowest</th><th>Typical</th><th>Highest</th></tr>'+
      ys.map(y=>'<tr><td>'+y+'</td><td>'+by[y].length+'</td><td>'+money(Math.min(...by[y]))+'</td><td>'+money(median(by[y]))+'</td><td>'+money(Math.max(...by[y]))+'</td></tr>').join('')+'</table></details>';
  }
  // toolbar
  const shown=Math.min(S.limit,rows.length);
  html+='<div class="toolbar noprint"><span class="count" id="countTxt"></span><span class="grow"></span>'+
    '<button class="btn" id="selAll">Select shown</button><button class="btn" id="selNone">Clear ticks</button>'+
    '<button class="btn" id="copyBtn">Copy as text</button><button class="btn" id="csvBtn">Save as spreadsheet</button><button class="btn primary" id="printBtn">Print</button></div>';
  // table
  const hres=hlTerms();
  const arrow = k => { const [sk,sd]=S.sort.split(':'); return sk===k?(sd==='1'?' ▲':' ▼'):''; };
  html+='<div class="tablewrap"><table class="t res'+(S.sel.size?' hassel':'')+'"><thead><tr><th class="chk noprint"></th>'+
    '<th class="sortable" data-s="date">Date'+arrow('date')+'</th><th class="sortable" data-s="order">Order'+arrow('order')+'</th>'+
    '<th class="sortable" data-s="name">Customer'+arrow('name')+'</th><th class="sortable" data-s="item">Item'+arrow('item')+'</th>'+
    '<th class="sortable num" data-s="qty">Qty'+arrow('qty')+'</th><th class="sortable num" data-s="price">Unit price'+arrow('price')+'</th><th class="sortable num" data-s="total">Line total'+arrow('total')+'</th></tr></thead><tbody id="tb">';
  html+=rowsHtml(0,shown,hres);
  html+='</tbody></table></div>';
  html+='<div class="more noprint" id="moreWrap"></div>';
  out.innerHTML=html;
  updateCounts();
  $('printMeta').textContent = 'Search: "'+S.q+'"  ·  Printed '+new Date().toLocaleDateString()+'  ·  '+rows.length.toLocaleString()+' matching lines'+
    (rows.length>500?' (first 500 printed)':'')+'  ·  Prices are unit prices from old-store order lines.';
}
function rowsHtml(a,b,hres){
  let h='';
  for (let k=a;k<b;k++){
    const x=S.res[k], r=ROWS[x.i], cust=DATA.c[r[2]], co=DATA.co[r[3]];
    const who = cust||co||'(unknown)', sub = cust && co ? co : '';
    const sel=S.sel.has(x.i);
    h+='<tr data-i="'+x.i+'" class="'+(r[8]===2?'fee ':'')+(sel?'sel':'unsel')+'"><td class="chk noprint"><input type="checkbox" data-i="'+x.i+'"'+(sel?' checked':'')+'></td>'+
      '<td class="date">'+fmtDate(r[0])+'</td><td>'+ordHtml(r)+badge(r[9])+'</td>'+
      '<td class="who">'+whoHtml(r,who,hres)+(sub?'<div class="co">'+hl(sub,hres)+'</div>':'')+'</td>'+
      '<td class="item">'+hl(r[4],hres)+'</td><td class="num">'+r[5]+'</td>'+
      '<td class="num">'+(r[6]>0?money(r[6]):'—')+'</td><td class="num">'+(r[7]>0?money(r[7]):'—')+'</td></tr>';
  }
  return h;
}
function updateCounts(){
  const total=S.res.length, shown=Math.min(S.limit,total);
  const rt=document.querySelector('table.res'); if(rt) rt.classList.toggle('hassel',S.sel.size>0);
  $('out').classList.toggle('hassel',S.sel.size>0);
  const ct=$('countTxt'); if(ct) ct.textContent='Showing '+shown.toLocaleString()+' of '+total.toLocaleString()+' lines'+(S.sel.size?'  ·  '+S.sel.size+' ticked':'');
  const mw=$('moreWrap'); if(mw) mw.innerHTML = total>shown ? '<button class="btn" id="moreBtn">Show 100 more</button> <button class="btn" id="allBtn">Show all '+total.toLocaleString()+'</button>' : '';
}
function appendMore(n){
  const tb=$('tb'), a=Math.min(S.limit,S.res.length); S.limit = n===Infinity?S.res.length:S.limit+n;
  const b=Math.min(S.limit,S.res.length);
  tb.insertAdjacentHTML('beforeend', rowsHtml(a,b,hlTerms())); updateCounts();
}

/* ---------- actions ---------- */
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(toast.h); toast.h=setTimeout(()=>t.classList.remove('on'),2200); }
function pickedRows(defN){
  if (S.sel.size) return S.res.filter(x=>S.sel.has(x.i)).map(x=>ROWS[x.i]);
  return S.res.slice(0,defN).map(x=>ROWS[x.i]);
}
function copyText(){
  const rows=pickedRows(10); if(!rows.length) return;
  const lines=rows.map(r => {
    const who=[DATA.c[r[2]],DATA.co[r[3]]].filter(Boolean); const w=who.length?(who[0]+(who[1]?' / '+who[1]:'')):'unknown';
    const price=r[6]>0?(r[5]>1?r[5]+' × '+money(r[6])+' each':money(r[6])):'no charge';
    return '• '+fmtLong(r[0])+' – '+r[4]+': '+price+' ('+w+', '+ordTag(r)+')';
  });
  const txt='Past orders for "'+S.q+'":\n'+lines.join('\n');
  const done=()=>toast('Copied '+rows.length+' line'+(rows.length===1?'':'s')+' – ready to paste');
  const fallback=()=>{ const ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); done(); }catch(e){ toast('Could not copy – select the lines and press Ctrl+C'); } document.body.removeChild(ta); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done,fallback); else fallback();
}
function csvEsc(v){ v=String(v==null?'':v); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; }
function saveCsv(){
  const rows=S.sel.size?S.res.filter(x=>S.sel.has(x.i)).map(x=>ROWS[x.i]):S.res.map(x=>ROWS[x.i]);
  const head=['Date','Order #','Customer','Company','Item','Qty','Unit Price','Line Total','Order Status'];
  const lines=[head.join(',')].concat(rows.map(r=>[r[0],r[1],DATA.c[r[2]],DATA.co[r[3]],r[4],r[5],r[6],r[7],STATUS[r[9]]].map(csvEsc).join(',')));
  const blob=new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='order-search-'+(S.q.replace(/[^a-z0-9]+/gi,'-').slice(0,40)||'results')+'.csv'; document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},500); toast('Saved '+rows.length+' lines');
}
let savedLimit=null;
window.addEventListener('beforeprint',()=>{ if(!S.res.length) return; savedLimit=S.limit; const need=Math.min(S.res.length,500);
  if(S.sel.size===0 && S.limit<need){ S.limit=need; $('tb').innerHTML=rowsHtml(0,need,hlTerms()); } else if(S.sel.size){ S.limit=S.res.length; $('tb').innerHTML=rowsHtml(0,S.res.length,hlTerms()); } });
window.addEventListener('afterprint',()=>{ if(savedLimit!=null && S.res.length){ S.limit=savedLimit; $('tb').innerHTML=rowsHtml(0,Math.min(S.limit,S.res.length),hlTerms()); updateCounts(); } savedLimit=null; });

/* ---------- wiring ---------- */
let timer=null;
function trigger(now){ clearTimeout(timer); const go=()=>{ S.q=$('q').value; search(); }; if(now) go(); else timer=setTimeout(go,350); }
$('q').addEventListener('input',()=>{ S.ignoreDates=false; trigger(false); });
$('form').addEventListener('submit',e=>{ e.preventDefault(); trigger(true); });
$('clearBtn').addEventListener('click',()=>{ $('q').value=''; $('yearSel').value=''; $('monthSel').value=''; S.ignoreDates=false; trigger(true); $('q').focus(); });
['hideFees','hideVoid','storeSel','monthSel'].forEach(id=>$(id).addEventListener('change',()=>trigger(true)));
$('yearSel').addEventListener('change',()=>{ // picking a year replaces any date words typed in the box
  if ($('yearSel').value && !S.ignoreDates){ const d=parseDates($('q').value,false); if(d.labels.length) $('q').value=d.rest.replace(/\s+/g,' ').trim(); }
  trigger(true); });
$('sortSel').addEventListener('change',()=>{ S.sort=$('sortSel').value; sortResults(); S.limit=100; render(); });
document.querySelectorAll('.examples a').forEach(a=>a.addEventListener('click',()=>{ $('q').value=a.dataset.q; S.ignoreDates=false; trigger(true); }));
$('interp').addEventListener('click',e=>{ if(e.target.dataset.x==='date'){ S.ignoreDates=true; trigger(true); } });
$('out').addEventListener('click',e=>{
  const t=e.target;
  if (t.id==='moreBtn') appendMore(100); else if (t.id==='allBtn') appendMore(Infinity);
  else if (t.id==='copyBtn') copyText(); else if (t.id==='csvBtn') saveCsv(); else if (t.id==='printBtn') window.print();
  else if (t.id==='selAll'){ S.res.slice(0,S.limit).forEach(x=>S.sel.add(x.i)); document.querySelectorAll('#tb tr').forEach(tr=>{ tr.className=tr.className.replace(/\b(un)?sel\b/,'sel'); const c=tr.querySelector('input'); if(c) c.checked=true; }); updateCounts(); }
  else if (t.id==='selNone'){ S.sel.clear(); document.querySelectorAll('#tb tr').forEach(tr=>{ tr.className=tr.className.replace(/\b(un)?sel\b/,'unsel'); const c=tr.querySelector('input'); if(c) c.checked=false; }); updateCounts(); }
  else if (t.matches('input[type=checkbox][data-i]')){ const i=Number(t.dataset.i); const tr=t.closest('tr'); if(t.checked){S.sel.add(i); tr.className=tr.className.replace(/\b(un)?sel\b/,'sel');} else {S.sel.delete(i); tr.className=tr.className.replace(/\b(un)?sel\b/,'unsel');} updateCounts(); }
  else if (t.dataset && t.dataset.s){ const k=t.dataset.s, [sk,sd]=S.sort.split(':'); const nd=(sk===k && sd==='-1')?1:(sk===k?-1:(k==='date'||k==='price'||k==='total'||k==='qty'?-1:1)); S.sort=k+':'+nd; sortResults(); S.limit=100; render(); }
});
document.addEventListener('click',e=>{ const l=e.target.closest && e.target.closest('a.ext'); if(l){ e.preventDefault(); window.api.openExternal(l.dataset.url).then(ok=>{ if(!ok) toast('That link was blocked for safety.'); }); } });
$('helpBtn').addEventListener('click',()=>$('help').classList.add('on'));
$('helpClose').addEventListener('click',()=>$('help').classList.remove('on'));
$('help').addEventListener('click',e=>{ if(e.target===$('help')) $('help').classList.remove('on'); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') $('help').classList.remove('on'); });

/* ---------- init ---------- */
(function init(){
  const dates=ROWS.map(r=>r[0]).sort(); const orders=ROWS.filter(r=>r[10]!==1).map(r=>r[1]);
  $('coverage').textContent = ROWS.length.toLocaleString()+' order lines · old-store orders #'+Math.min(...orders)+'–#'+Math.max(...orders)+' · '+fmtLong(dates[0])+' to '+fmtLong(dates[dates.length-1])+' · data built '+BUILT+(DATA.newOrders?' · '+DATA.newOrders.toLocaleString()+' new-store orders synced':'');
  const years=[...new Set(ROWS.map(r=>r[0].slice(0,4)))].sort().reverse();
  $('yearSel').innerHTML='<option value="">All years</option>'+years.map(y=>'<option>'+y+'</option>').join('');
  const groups={}; // abbreviation table
  let t='';
  Object.entries(EXPANSIONS).forEach(([k,v])=>{ t+='<tr><td><b>'+esc(k.toUpperCase())+'</b></td><td>'+esc(v.join(', '))+'</td></tr>'; });
  SYNONYMS.forEach(g=>{ t+='<tr><td><b>'+esc(g[0])+'</b></td><td>'+esc(g.slice(1).join(', '))+'</td></tr>'; });
  $('abbrTable').innerHTML=t;
  S.q=''; search();
})();
