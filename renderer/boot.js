// Loads the data through the main process, starts the search app, and handles Shopify sync.
(async function(){
  const $=id=>document.getElementById(id);
  const scr=$('importScreen'), msg=$('importMsg');
  let syncing=false;

  function ago(iso){
    if(!iso) return 'never synced';
    const m=Math.round((Date.now()-new Date(iso))/60000);
    if(m<2) return 'synced just now'; if(m<90) return 'synced '+m+' min ago';
    const h=Math.round(m/60); if(h<48) return 'synced '+h+' hr ago'; return 'synced '+Math.round(h/24)+' days ago';
  }
  async function refreshStatus(){
    const s=await window.api.shopifyStatus();
    $('syncStatus').textContent = s.configured ? ('New store: '+s.orders.toLocaleString()+' orders, '+ago(s.syncedAt)) : 'New store not connected';
    $('syncBtn').style.display = s.configured ? '' : 'none';
    return s;
  }
  function banner(text){
    let b=$('refreshBanner');
    if(!b){ b=document.createElement('div'); b.id='refreshBanner'; document.querySelector('main').prepend(b); }
    b.innerHTML=''; b.appendChild(document.createTextNode(text));
    const btn=document.createElement('button'); btn.className='btn primary'; btn.textContent='Refresh now'; btn.onclick=()=>location.reload(); b.appendChild(btn);
    b.style.display='block';
  }
  function say(t){ const el=$('toast'); if(!el) return; el.textContent=t; el.classList.add('on'); clearTimeout(say.h); say.h=setTimeout(()=>el.classList.remove('on'),4000); }

  async function doSync(auto){
    if(syncing) return; syncing=true; $('syncBtn').disabled=true; $('syncBtn').textContent='Syncing…';
    const r=await window.api.shopifySync();
    syncing=false; $('syncBtn').disabled=false; $('syncBtn').textContent='Sync new orders';
    await refreshStatus();
    if(r.error){ if(!(auto&&r.offline)) say(r.error); return; }
    if(r.changed>0) banner(r.changed+' new or updated order'+(r.changed===1?'':'s')+' from Shopify. Refresh to include '+(r.changed===1?'it':'them')+' in searches.');
    else if(!auto) say('Shopify returned '+r.seen+' order'+(r.seen===1?'':'s')+' this time; '+r.total+' saved in total. Nothing new since the last sync.');
    if(r.partial>0) say(r.partial+' order(s) have more than 60 items; only the first 60 were saved.');
  }

  // ---- Shopify connection window ----
  async function openShopify(){
    const s=await refreshStatus(); $('shShop').value=s.shop||''; $('shId').value=''; $('shSecret').value='';
    $('shMsg').textContent = s.configured ? 'Connected to '+s.shop+'. Leave the fields as they are, or enter new details to replace the connection.' : 'Not connected yet.';
    $('shopModal').classList.add('on');
  }
  window.openShopify=openShopify;
  $('shopBtn').addEventListener('click',openShopify);
  $('shClose').addEventListener('click',()=>$('shopModal').classList.remove('on'));
  $('shSave').addEventListener('click',async()=>{
    $('shMsg').textContent='Checking with Shopify…'; $('shSave').disabled=true;
    const r=await window.api.shopifySave({shop:$('shShop').value,clientId:$('shId').value,clientSecret:$('shSecret').value});
    $('shSave').disabled=false;
    if(r.error){ $('shMsg').textContent=r.error; return; }
    $('shSecret').value=''; $('shMsg').textContent='Connected to '+r.shop+'. Getting your orders…';
    await refreshStatus(); const sr=await window.api.shopifySync(); await refreshStatus();
    $('shMsg').textContent = sr.error ? sr.error : ('Connected. Shopify returned '+sr.seen+' order'+(sr.seen===1?'':'s')+' ('+sr.total+' saved). '+(sr.changed>0?'Close this window and click Refresh now.':'If you expected more, check the Orders page in Shopify.'));
    if(sr.changed>0) banner(sr.changed+' order'+(sr.changed===1?'':'s')+' downloaded from Shopify. Refresh to include '+(sr.changed===1?'it':'them')+' in searches.');
  });
  $('shDisc').addEventListener('click',async()=>{ await window.api.shopifyDisconnect(); await refreshStatus(); $('shMsg').textContent='Disconnected. Orders already downloaded stay searchable.'; });
  $('shopModal').addEventListener('click',e=>{ if(e.target===$('shopModal')) $('shopModal').classList.remove('on'); });
  $('syncBtn').addEventListener('click',()=>doSync(false));

  // ---- shared database connection window ----
  async function openCloud(){
    const s=await window.api.cloudStatus(); $('clAcct').value=s.accountId||''; if(s.databaseId) $('clDb').value=s.databaseId; $('clTok').value='';
    $('clMsg').textContent = s.configured ? 'Connected. Leave the fields as they are, or enter new details to replace the connection.' : 'Not connected yet.';
    $('cloudModal').classList.add('on');
  }
  window.openCloud=openCloud;
  $('clClose').addEventListener('click',()=>$('cloudModal').classList.remove('on'));
  $('clSave').addEventListener('click',async()=>{
    $('clMsg').textContent='Checking…'; $('clSave').disabled=true;
    const r=await window.api.cloudSave({accountId:$('clAcct').value,databaseId:$('clDb').value,token:$('clTok').value});
    $('clSave').disabled=false;
    if(r.error){ $('clMsg').textContent=r.error; return; }
    $('clTok').value=''; $('clMsg').textContent='Connected. The shared notes and order board are ready.';
    if(window.__cloudChanged) window.__cloudChanged();
  });
  $('clDisc').addEventListener('click',async()=>{ await window.api.cloudDisconnect(); $('clMsg').textContent='Disconnected from the shared database.'; if(window.__cloudChanged) window.__cloudChanged(); });
  $('cloudModal').addEventListener('click',e=>{ if(e.target===$('cloudModal')) $('cloudModal').classList.remove('on'); });

  async function start(){
    const d=await window.api.getData();
    if(!d.ok){ scr.style.display='flex'; if(d.error) msg.textContent=d.error; return; }
    scr.style.display='none';
    window.__DATA__=d.data; window.__BUILT__=d.built;
    const s=document.createElement('script'); s.src='app.js'; document.body.appendChild(s);
    s.onload=async()=>{
      const cs=document.createElement('script'); cs.src='customers.js'; document.body.appendChild(cs); const ps=document.createElement('script'); ps.src='pricecheck.js'; document.body.appendChild(ps); const ws=document.createElement('script'); ws.src='workboard.js'; ws.onload=()=>{ const is=document.createElement('script'); is.src='inventory.js'; is.onload=()=>{ const cv=document.createElement('script'); cv.src='catalogview.js'; document.body.appendChild(cv); }; document.body.appendChild(is); }; document.body.appendChild(ws);
      const st=await refreshStatus();
      if(st.configured){ const stale=!st.syncedAt || (Date.now()-new Date(st.syncedAt))>6*3600*1000; if(stale) doSync(true); }   // auto-sync on open if older than 6 hours
    };
  }
  $('importBtn').addEventListener('click', async()=>{
    const r=await window.api.importData();
    if(r && r.canceled) return;
    if(r && r.error){ msg.textContent=r.error; return; }
    start();
  });
  start();
})();
