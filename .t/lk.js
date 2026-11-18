const path=require('path');const root=require('child_process').execSync('npm root -g').toString().trim();
const {chromium}=require(path.join(root,'playwright'));const fs=require('fs'),os=require('os');
const {makeCloud}=require('/home/claude/gmaa-hub/cloud.js');
(async()=>{
 const old={c:[],co:[],r:[]};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cl-'));
 const ss={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('E'+s),decryptString:b=>b.toString().slice(1)};
 const C=makeCloud({dir,safeStorage:ss,baseUrl:'http://127.0.0.1:8799/client/v4'});
 const cr={accountId:'a'.repeat(32),databaseId:'8dee9967-8e8a-44e5-8373-7cfebdb0363d',token:'goodtoken'};C.saveCreds(cr);
 for(const t of ['jobs','staff','notes','settings','activity','job_notes','time_entries'])await C.query(cr,'DROP TABLE IF EXISTS '+t);
 const f=n=>{const d=new Date();d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
 const mk=async(ref,cust,due,sec)=>{const r=await C.saveJob({order_ref:ref,customer:cust,title:'t',due,sections:{heatpress:'received'}});if(r.error)console.log('mk',r);return r};
 await mk('#1','Late Co',f(-2));await mk('#2','Today Co',f(0));await mk('#3','Tomorrow Co',f(1));await mk('#4','Soon Co',f(2));await mk('#5','Far Co',f(6));const j6=await mk('#6','Ready Co',f(-1));await mk('#7','NoDue Co','');
 const jobs=(await C.pull()).jobs;const rj=jobs.find(j=>j.order_ref==='#6');await C.moveSection(rj.id,'heatpress','pickup');
 const wrap=fn=>async(...a)=>{try{return await fn(...a)}catch(e){return {error:e.message}}};
 const mode=process.argv[2]||'ok';
 const M={cloudStatus:async()=>({configured:true}),cloudPull:wrap(a=>C.pull(!!a)),cloudCached:async()=>C.cached(),authState:wrap(()=>C.authState()),login:wrap(p=>C.login(p)),logout:async()=>C.logout(),ping:async()=>C.ping(),getUpdates:wrap(()=>C.updates()),saveSetting:wrap((k,v)=>C.saveSetting(k,v)),
  shopifyOrder:async(ref)=>mode==='err'?{error:'Shopify denied access to some data: x'}:{ok:true,found:true,tag:'Draft #D112',cust:'Bill Hoffman',co:'Buck Wild',created:'11/12/2026',note:'',cancelled:false,paid:'Draft - not an order yet',shipping:'',total:384.13,items:[{name:'Eagle',qty:12,sku:''}]},
  syncDrafts:async()=>({checked:0,changed:0})};
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox','--allow-file-access-from-files']});
 const pg=await b.newPage({viewport:{width:1500,height:900}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));pg.on('console',m=>{if(m.type()==='error')errs.push('console:'+m.text())});
 await pg.exposeFunction('__bridge',async(name,args)=>M[name]?M[name](...args):{});
 await pg.addInitScript(p=>{const base={getData:async()=>({ok:true,data:p,built:'x'}),importData:async()=>({}),shopifyStatus:async()=>({configured:true}),openExternal:async()=>true,getSegments:async()=>({}),getProducts:async()=>({products:[]})};window.api=new Proxy(base,{get:(t,k)=>k in t?t[k]:(...a)=>window.__bridge(k,a)})},old);
 await pg.goto('file:///home/claude/gmaa-hub/renderer/index.html');await pg.waitForTimeout(2500);
 for(const id of ['#liNo','#wnClose']){const e=await pg.$(id);if(e)await e.click().catch(()=>{})}
 await pg.click('#tabBoard');await pg.waitForTimeout(1000);
 await pg.click('[data-act=newjob]');await pg.waitForTimeout(500);
 await pg.fill('#jRef','D112');await pg.click('[data-act=lookup]');await pg.waitForTimeout(1500);
 console.log('jRef=',await pg.inputValue('#jRef'),'cust=',await pg.inputValue('#jCust'),'disabled=',await pg.$eval('#jRef',e=>e.disabled));
 console.log('toast=',await pg.$$eval('.toast,#toast',e=>e.map(x=>x.textContent)));
 console.log('errs',errs);await b.close();
})();