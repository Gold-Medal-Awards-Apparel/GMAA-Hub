const { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage, powerSaveBlocker } = require('electron');
const { makeSync, normShop } = require('./sync');
const { makeCloud } = require('./cloud');
const path = require('path');
const fs = require('fs');

app.setName('Gold Medal Hub');
// Keep the data folder stable even though the app name changed.
app.setPath('userData', path.join(app.getPath('appData'), 'order-history-search'));
const DATA_DIR = () => path.join(app.getPath('userData'), 'data');
const OLD_FILE = () => path.join(DATA_DIR(), 'old-store.json');
// Only links that start with these prefixes may be opened (future Shopify order/customer links).
const ALLOWED_LINKS = ['https://admin.shopify.com/'];

let SY = null;
let CL = null;
const cl = () => CL || (CL = makeCloud({ dir: app.getPath('userData'), safeStorage }));
const sy = () => SY || (SY = makeSync({ dir: app.getPath('userData'), safeStorage }));

function validate(obj) {
  return obj && Array.isArray(obj.c) && Array.isArray(obj.co) && Array.isArray(obj.r) && obj.r.length > 1000 &&
    Array.isArray(obj.r[0]) && obj.r[0].length >= 10;
}
function readOld() {
  try {
    const raw = JSON.parse(fs.readFileSync(OLD_FILE(), 'utf8'));
    const d = raw.data || raw;
    if (!validate(d)) return { ok: false, error: 'The saved data file looks damaged. Please choose the data file again.' };
    let merged = d;
    try { merged = sy().merge(d); } catch (e) { merged = d; }   // old store + any synced new-store orders
    return { ok: true, data: merged, built: raw.built || 'unknown' };
  } catch (e) {
    return { ok: false };
  }
}

ipcMain.handle('data:get', () => readOld());
ipcMain.handle('data:import', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const r = await dialog.showOpenDialog(win, { title: 'Choose OrderHistory-OldStore.json', properties: ['openFile'], filters: [{ name: 'Order history data', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  try {
    const raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    const d = raw.data || raw;
    if (!validate(d)) return { error: 'That file is not an order-history data file. Please choose OrderHistory-OldStore.json.' };
    fs.mkdirSync(DATA_DIR(), { recursive: true });
    fs.writeFileSync(OLD_FILE(), JSON.stringify(raw));
    return { ok: true };
  } catch (e) {
    return { error: 'Could not read that file: ' + e.message };
  }
});
const SEG_FILE = () => path.join(DATA_DIR(), 'segments.json');
let AWAKE = null;
ipcMain.handle('tv:awake', (e, on) => {   // keeps the TV screen from sleeping while the order board is on display
  try {
    if (on && AWAKE === null) AWAKE = powerSaveBlocker.start('prevent-display-sleep');
    if (!on && AWAKE !== null) { powerSaveBlocker.stop(AWAKE); AWAKE = null; }
    return { ok: true };
  } catch (err) { return { ok: false }; }
});
ipcMain.handle('segments:get', () => { try { return JSON.parse(fs.readFileSync(SEG_FILE(), 'utf8')); } catch (e) { return {}; } });
ipcMain.handle('segments:save', (e, obj) => {
  try {
    const clean = {};
    for (const [k, v] of Object.entries(obj || {})) if (typeof k === 'string' && typeof v === 'string' && k.length < 200 && v.length < 60) clean[k] = v;
    fs.mkdirSync(DATA_DIR(), { recursive: true }); fs.writeFileSync(SEG_FILE(), JSON.stringify(clean)); return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

// ---- shared notes + order board (Cloudflare D1) ----
const ME_FILE = () => path.join(DATA_DIR(), 'me.json');
const readMe = () => { try { return JSON.parse(fs.readFileSync(ME_FILE(), 'utf8')); } catch (e) { return {}; } };
const cloudWrap = fn => async (e, ...a) => { try { return await fn(...a); } catch (err) { return { error: err.message, offline: !!err.offline }; } };
ipcMain.handle('cloud:status', () => cl().status());
ipcMain.handle('cloud:save', cloudWrap(async f => {
  const c = { accountId: String((f && f.accountId) || '').trim(), databaseId: String((f && f.databaseId) || '').trim(), token: String((f && f.token) || '').trim() };
  if (!/^[0-9a-f]{32}$/i.test(c.accountId)) return { error: 'The Account ID is 32 letters and numbers (find it in the Cloudflare dashboard URL or on the Workers & Pages page).' };
  if (!/^[0-9a-f-]{36}$/i.test(c.databaseId)) return { error: 'The Database ID looks like 8dee9967-8e8a-44e5-8373-7cfebdb0363d (36 characters with dashes).' };
  if (c.token.length < 20) return { error: 'Paste the API token.' };
  const n = await cl().test(c); cl().saveCreds(c); return { ok: true, notes: n };
}));
ipcMain.handle('cloud:disconnect', () => { cl().clearCreds(); return { ok: true }; });
ipcMain.handle('cloud:pull', cloudWrap(a => cl().pull(!!a)));
ipcMain.handle('cloud:cached', () => cl().cached());
ipcMain.handle('inv:pull', cloudWrap(() => cl().invPull()));
ipcMain.handle('inv:move', cloudWrap((id, k, n, note) => cl().invMove(id, k, n, note)));
ipcMain.handle('inv:saveItem', cloudWrap(it => cl().invSaveItem(it)));
ipcMain.handle('inv:saveStock', cloudWrap(l => cl().invSaveStock(l)));
ipcMain.handle('inv:delete', cloudWrap((k, id) => cl().invDelete(k, id)));
ipcMain.handle('inv:moves', cloudWrap((n, id) => cl().invMoves(n, id)));
ipcMain.handle('inv:import', cloudWrap(async () => { let seed; for (const d of [DATA_DIR(), __dirname]) { try { seed = JSON.parse(fs.readFileSync(path.join(d, 'inventory-seed.json'), 'utf8')); break; } catch (e) {} } if (!seed) return { error: 'The starter list file (inventory-seed.json) was not found. Put it in the app folder or in ' + DATA_DIR() + ' and try again.' }; return cl().invImport(seed); }));
ipcMain.handle('cat:status', cloudWrap(() => cl().catalog.status()));
ipcMain.handle('cat:search', cloudWrap(o => cl().catalog.search(o)));
ipcMain.handle('cat:pick', cloudWrap(async () => {
  await cl().catalog.guard();   // admins only; checked before the file window opens
  const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { title: 'Choose a supplier price list', properties: ['openFile'], filters: [{ name: 'Price lists (.csv, .xlsx)', extensions: ['csv', 'xlsx'] }] });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  return cl().catalog.pick(r.filePaths[0]);
}));
ipcMain.handle('cat:import', cloudWrap((tok, m) => cl().catalog.importPending(tok, m, (done, total) => { try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('cat:progress', { done, total }); } catch (e) {} })));
ipcMain.handle('cat:remove', cloudWrap(n => cl().catalog.remove(n)));
ipcMain.handle('auth:state', cloudWrap(() => cl().authState()));
ipcMain.handle('auth:login', cloudWrap((n, p) => cl().login(p === undefined ? n : p)));
ipcMain.handle('auth:logout', () => cl().logout());
ipcMain.handle('auth:ping', () => cl().ping());
ipcMain.handle('staff:add', cloudWrap((n, p, adm) => cl().addStaff(n, p, !!adm)));
ipcMain.handle('staff:setPin', cloudWrap((n, p, o) => cl().setPin(n, p, o)));
ipcMain.handle('staff:remove', cloudWrap(n => cl().removeStaff(n)));
ipcMain.handle('staff:setAdmin', cloudWrap((n, v) => cl().setAdmin(n, !!v)));
ipcMain.handle('cloud:updates', cloudWrap(() => cl().updates()));
ipcMain.handle('cloud:saveNote', cloudWrap(n => cl().saveNote(n)));
ipcMain.handle('cloud:deleteNote', cloudWrap(id => cl().deleteNote(id)));
ipcMain.handle('cloud:saveJob', cloudWrap(j => cl().saveJob(j)));
ipcMain.handle('cloud:moveSection', cloudWrap((id, key, st) => cl().moveSection(id, key, st)));
ipcMain.handle('cloud:setAssign', cloudWrap((id, key, name) => cl().setAssign(id, key, name)));
ipcMain.handle('cloud:deleteJob', cloudWrap(id => cl().deleteJob(id)));
ipcMain.handle('cloud:archiveJob', cloudWrap((id, v) => cl().archiveJob(id, v)));
ipcMain.handle('cloud:addJobNote', cloudWrap((id, body) => cl().addJobNote(id, body)));
ipcMain.handle('cloud:saveSetting', cloudWrap((k, v) => cl().saveSetting(k, v)));
ipcMain.handle('me:get', () => readMe());
ipcMain.handle('me:save', (e, o) => { try { const cur = readMe(); const n = Object.assign(cur, { name: String(o.name != null ? o.name : cur.name || '').slice(0, 60), seen: String(o.seen != null ? o.seen : cur.seen || '').slice(0, 40) }); fs.mkdirSync(DATA_DIR(), { recursive: true }); fs.writeFileSync(ME_FILE(), JSON.stringify(n)); return { ok: true }; } catch (err) { return { ok: false }; } });
ipcMain.handle('shopify:status', () => sy().status());
ipcMain.handle('shopify:save', async (e, f) => {
  const shop = normShop(f && f.shop), clientId = String((f && f.clientId) || '').trim(), clientSecret = String((f && f.clientSecret) || '').trim();
  if (!shop) return { error: 'Enter the store address, like gold-medal-awards.myshopify.com (it must end in .myshopify.com).' };
  if (!clientId || !clientSecret) return { error: 'Enter both the Client ID and the Client secret.' };
  try { await sy().getToken({ shop, clientId, clientSecret }); } catch (err) { return { error: err.message }; }
  try { sy().saveCreds({ shop, clientId, clientSecret }); } catch (err) { return { error: err.message }; }
  return { ok: true, shop };
});
ipcMain.handle('shopify:sync', async () => {
  try { const r = await sy().sync(); return Object.assign({ ok: true }, r); }
  catch (err) { const offline = /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|network/i.test(String(err && (err.message + (err.cause && err.cause.code || '')))); return { error: offline ? 'Could not reach Shopify. The computer may be offline. Your saved orders are still searchable.' : err.message, offline }; }
});
ipcMain.handle('shopify:order', async (e, num) => {
  try { return Object.assign({ ok: true }, await sy().lookupOrder(num)); }
  catch (err) { const offline = /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|network/i.test(String(err && (err.message + (err.cause && err.cause.code || '')))); return { error: offline ? 'Could not reach Shopify. The computer may be offline.' : err.message, offline }; }
});
ipcMain.handle('products:get', () => sy().loadProducts());
ipcMain.handle('products:sync', async () => {
  try { const r = await sy().syncProducts(); return Object.assign({ ok: true }, r, { data: sy().loadProducts() }); }
  catch (err) { const offline = /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|network/i.test(String(err && (err.message + (err.cause && err.cause.code || '')))); return { error: offline ? 'Could not reach Shopify. The computer may be offline.' : err.message, offline }; }
});
ipcMain.handle('shopify:disconnect', () => { sy().clearCreds(); return { ok: true }; });
ipcMain.handle('open:external', (e, url) => {
  if (typeof url === 'string' && ALLOWED_LINKS.some(p => url.startsWith(p))) { shell.openExternal(url); return true; }
  return false;
});

// ---- Automatic updates (installed copies only; checks GitHub Releases when online) ----
let updateInfo = { state: 'idle' };
function setupUpdates(getWin) {
  if (!app.isPackaged) return null;          // never runs from the dev folder
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { return null; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;   // installs the downloaded update when the app is closed
  autoUpdater.on('update-available', i => { updateInfo = { state: 'downloading', version: i.version }; });
  autoUpdater.on('update-downloaded', i => {
    updateInfo = { state: 'ready', version: i.version };
    const w = getWin();
    dialog.showMessageBox(w, { type: 'info', buttons: ['Restart now', 'Later'], defaultId: 1,
      title: 'Update ready', message: 'Gold Medal Hub ' + i.version + ' is ready.',
      detail: 'Restart now to finish updating, or it will install the next time you close the app.' })
      .then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on('update-not-available', () => { updateInfo = { state: 'current' }; });
  autoUpdater.on('error', e => { updateInfo = { state: 'offline-or-error', error: String(e && e.message || e) }; });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});   // offline computers simply skip
  setTimeout(check, 4000);
  return check;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860, title: 'Gold Medal Hub', icon: path.join(__dirname, 'assets', 'icon.ico'), backgroundColor: '#ffffff',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}
let mainWin = null, runCheck = null;
app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Shared database connection…', click: (_, w) => { if (w) w.webContents.executeJavaScript('window.openCloud && window.openCloud()'); } },
      { label: 'Shopify connection…', click: (_, w) => { if (w) w.webContents.executeJavaScript('window.openShopify && window.openShopify()'); } },
      { label: 'Import old-store data file…', click: (_, w) => { if (w) w.webContents.executeJavaScript("window.api.importData().then(r=>{ if(!r||!r.canceled) location.reload(); })"); } },
      { role: 'quit' } ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [
      { label: 'Check for updates', click: () => {
          if (!app.isPackaged) { dialog.showMessageBox(mainWin, { message: 'Updates only work in the installed version.' }); return; }
          if (runCheck) runCheck();
          dialog.showMessageBox(mainWin, { message: 'Checking for updates…', detail: 'If an update is found it downloads in the background and you will be asked to restart. If nothing appears, you are up to date or the computer is offline.' }); } },
      { label: 'About Gold Medal Hub', click: () => dialog.showMessageBox(mainWin, { title: 'About', message: 'Gold Medal Hub (GMAA)', detail: 'Version ' + app.getVersion() + '\nGold Medal Awards & Apparel\n\nBuilt by WiseFaro' }) } ] }
  ]));
  mainWin = createWindow();
  runCheck = setupUpdates(() => mainWin);
});
app.on('window-all-closed', () => app.quit());
