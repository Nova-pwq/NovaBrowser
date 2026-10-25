const { app, BrowserWindow, ipcMain, session, safeStorage } = require('electron');
const fs = require('fs');
const { pathToFileURL } = require('url');
const path = require('path');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// ===== Блокування реклами/трекерів (простий список доменів, вмикається в Налаштуваннях) =====
const BLOCKLIST = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com',
  'googletagmanager.com', 'googletagservices.com', 'adservice.google.', 'facebook.com/tr', 'connect.facebook.net',
  'ads-twitter.com', 'analytics.twitter.com', 'scorecardresearch.com', 'outbrain.com', 'taboola.com',
  'adnxs.com', 'rubiconproject.com', 'pubmatic.com', 'criteo.com', 'criteo.net', 'moatads.com', 'amazon-adsystem.com',
  'bat.bing.com', 'yandex.ru/clck', 'mc.yandex.ru', 'hotjar.com', 'mixpanel.com', 'segment.io', 'segment.com',
  'adsafeprotected.com', 'serving-sys.com', 'quantserve.com', 'adform.net', 'adroll.com'];
let blockEnabled = true;
function hookBlock(ses) {
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (d, cb) => {
    if (!blockEnabled) return cb({ cancel: false });
    try { const h = new URL(d.url).hostname; cb({ cancel: BLOCKLIST.some(b => h.includes(b)) }); }
    catch { cb({ cancel: false }); }
  });
}

const ENGINES = {
  google: {
    url: q => 'https://www.google.com/search?hl=uk&pws=0&q=' + encodeURIComponent(q),
    script: `(()=>{
      const out=[];document.querySelectorAll('#search a h3, #rso a h3, a h3').forEach(h=>{
        const a=h.closest('a');if(!a||!a.href.startsWith('http'))return;
        const box=a.closest('div.g, div[data-hveid], div[jscontroller]');
        const sn=box&&box.querySelector('.VwiC3b, div[data-sncf], div[style*="-webkit-line-clamp"]');
        out.push({title:h.innerText,url:a.href,snippet:sn?sn.innerText:''});});
      return out;})()`
  },
  bing: {
    url: q => 'https://www.bing.com/search?setlang=uk&q=' + encodeURIComponent(q),
    script: `[...document.querySelectorAll('li.b_algo')].map(li=>{const a=li.querySelector('h2 a');
      const p=li.querySelector('.b_caption p, .b_lineclamp2, p');
      return a&&{title:a.innerText,url:a.href,snippet:p?p.innerText:''}}).filter(Boolean)`
  },
  firefox: { // третій рушій (відображається як Firefox)
    url: q => 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q),
    script: `[...document.querySelectorAll('.result, article[data-testid="result"]')].map(r=>{
      const a=r.querySelector('.result__a, a[data-testid="result-title-a"]');
      const s=r.querySelector('.result__snippet, [data-result="snippet"]'); if(!a) return null;
      let u=a.href; try{const x=new URL(u); if(x.searchParams.get('uddg')) u=x.searchParams.get('uddg');}catch(e){}
      return {title:a.innerText,url:u,snippet:s?s.innerText:''}}).filter(Boolean)`
  }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runEngine(name, q) {
  const e = ENGINES[name];
  const ses = session.fromPartition('nova-' + name);
  if (name === 'google') { // обхід вікна згоди cookie (ЄС)
    for (const c of [{ name: 'SOCS', value: 'CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiAo_CmBg' }, { name: 'CONSENT', value: 'YES+' }])
      try { await ses.cookies.set({ url: 'https://www.google.com', domain: '.google.com', path: '/', secure: true, ...c }); } catch {}
  }
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { session: ses, backgroundThrottling: false } });
  win.webContents.setUserAgent(UA);
  try {
    win.loadURL(e.url(q)).catch(() => {}); // ігноруємо ERR_ABORTED при редиректах
    const t0 = Date.now();
    while (Date.now() - t0 < 14000) {
      await sleep(700);
      if (win.isDestroyed()) break;
      const url = win.webContents.getURL();
      if (url.includes('consent.google')) {
        win.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/accept all|прийняти все|alles accepteren/i.test(b.innerText));b&&b.click()})()`).catch(() => {});
        continue;
      }
      let res = [];
      try { res = await win.webContents.executeJavaScript(e.script); } catch { continue; }
      res = (res || []).filter(r => /^https?:/.test(r.url) && !/google\.[a-z.]+\/(search|url)\?/.test(r.url));
      if (res.length) return res.slice(0, 10).map(r => ({ ...r, engine: name }));
    }
    return [];
  } catch (err) { return []; }
  finally { if (!win.isDestroyed()) win.destroy(); }
}

ipcMain.handle('search', async (_, q) => {
  const names = Object.keys(ENGINES);
  const lists = await Promise.all(names.map(n => runEngine(n, q)));
  const stats = {}; names.forEach((n, i) => stats[n] = lists[i].length);
  const map = new Map(), out = [];
  for (let i = 0; i < 10; i++) for (const l of lists) {
    const r = l[i]; if (!r) continue;
    let key; try { const u = new URL(r.url); key = u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, ''); } catch { key = r.url; }
    if (map.has(key)) { const x = map.get(key); if (!x.engines.includes(r.engine)) x.engines.push(r.engine); continue; }
    const item = { title: r.title, url: r.url, snippet: r.snippet, engines: [r.engine] };
    map.set(key, item); out.push(item);
  }
  return { results: out, stats };
});

const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), f), 'utf8')); } catch { return d; } };
const wr = (f, o) => fs.writeFileSync(path.join(app.getPath('userData'), f), JSON.stringify(o));
ipcMain.on('web-preload', e => { e.returnValue = pathToFileURL(path.join(__dirname, 'webview-preload.js')).href; });
ipcMain.handle('state:get', () => rd('state.json', {}));
ipcMain.handle('state:set', (_, st) => { wr('state.json', st); });
// паролі шифруються засобами ОС (Windows DPAPI / Keychain)
ipcMain.handle('pass:save', (_, { origin, user, pass }) => {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const db = rd('passwords.json', {});
  db[origin + '|' + user] = safeStorage.encryptString(pass).toString('base64');
  wr('passwords.json', db); return true;
});
ipcMain.handle('pass:get', (_, origin) => {
  const db = rd('passwords.json', {});
  return Object.keys(db).filter(k => k.startsWith(origin + '|')).map(k => {
    try { return { user: k.slice(origin.length + 1), pass: safeStorage.decryptString(Buffer.from(db[k], 'base64')) }; } catch { return null; }
  }).filter(Boolean);
});
ipcMain.handle('pass:list', () => Object.keys(rd('passwords.json', {})).map(k => { const i = k.indexOf('|'); return { origin: k.slice(0, i), user: k.slice(i + 1) }; }));
ipcMain.handle('pass:del', (_, o, u) => { const db = rd('passwords.json', {}); delete db[o + '|' + u]; wr('passwords.json', db); });
ipcMain.handle('data:clear', async () => { for (const p of [...spaceParts]) { const ses = session.fromPartition(p); await ses.clearStorageData(); await ses.clearCache(); } });

const { Menu, clipboard, shell, webContents } = require('electron');
process.on('uncaughtException', err => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), new Date().toISOString() + ' ' + (err && err.stack || err) + '\n'); } catch {} });
require('./ide')(ipcMain, app, shell);
require('./auth')(ipcMain, app, safeStorage);
function createWindow(priv) {
  const win = new BrowserWindow({
    width: 1280, height: 820, backgroundColor: '#141414', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets/icon.png'), title: priv ? 'NovaBrowser — приватне вікно' : 'NovaBrowser',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), webviewTag: true, contextIsolation: true, spellcheck: true, plugins: true }
  });
  win.loadFile('index.html', priv ? { query: { private: '1' } } : {});
}
ipcMain.handle('win:new', () => createWindow(false));
ipcMain.handle('win:private', () => createWindow(true));
ipcMain.handle('win:full', e => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setFullScreen(!w.isFullScreen()); });
ipcMain.handle('dl:show', (_, f) => shell.showItemInFolder(f));

// Простори: кожен має власну ізольовану сесію (cookies, логіни, кеш). Кількість не обмежена двома — до MAX_SPACES.
const MAX_SPACES = 8;
const spacePart = i => i === 0 ? 'persist:nova' : 'persist:nova-' + (i + 1);
const spaceParts = new Set([spacePart(0), spacePart(1)]);
const okPart = p => p === 'nova-private' || spaceParts.has(p);
const allParts = () => [...spaceParts, 'nova-private'];
let proxyRules = null;
const hooked = new Set();
function prepSession(p) { // одноразово підключає блокування, завантаження, мережеві події
  if (hooked.has(p)) return;
  hooked.add(p);
  const ses = session.fromPartition(p);
  hookDownloads(ses); hookNet(ses); hookBlock(ses);
  try { ses.setSpellCheckerLanguages(['uk', 'en-US']); } catch {}
  if (proxyRules) ses.setProxy({ proxyRules }).catch(() => {});
}
function ensureSpaces(n) {
  n = Math.max(2, Math.min(MAX_SPACES, parseInt(n) || 2));
  for (let i = 0; i < n; i++) { spaceParts.add(spacePart(i)); prepSession(spacePart(i)); }
  return n;
}
ipcMain.handle('space:ensure', (_, n) => ensureSpaces(n));
// видалення останнього простору: стираємо його сесію
ipcMain.handle('space:clear', async (_, i) => {
  i = parseInt(i); if (!(i >= 2 && i < MAX_SPACES)) return false;
  const p = spacePart(i), ses = session.fromPartition(p);
  await ses.clearStorageData(); await ses.clearCache(); spaceParts.delete(p); hooked.delete(p); return true;
});
ipcMain.handle('dev:cookies', (_, p, url) => okPart(p) ? session.fromPartition(p).cookies.get({ url }) : []);
ipcMain.handle('dev:delcookie', (_, p, url, name) => okPart(p) ? session.fromPartition(p).cookies.remove(url, name) : null);
ipcMain.handle('dev:proxy', async (_, rules) => { proxyRules = rules ? String(rules) : null; for (const p of allParts()) await session.fromPartition(p).setProxy(rules ? { proxyRules: String(rules) } : { mode: 'system' }); return true; });
ipcMain.handle('dev:adblock', (_, on) => { blockEnabled = !!on; return blockEnabled; });
ipcMain.handle('dev:spelllang', (_, langs) => {
  try { for (const p of allParts()) session.fromPartition(p).setSpellCheckerLanguages(langs && langs.length ? langs : ['uk']); return true; } catch { return false; }
});

const downloads = new Map();
ipcMain.handle('dl:cancel', (_, id) => { const it = downloads.get(id); if (it) { try { it.cancel(); } catch {} return true; } return false; });
ipcMain.handle('dl:clear', (_, id) => { downloads.delete(id); return true; });
ipcMain.handle('dev:shot', async (_, id, pdf) => {
  const wc = webContents.fromId(id); if (!wc) return null;
  const f = path.join(app.getPath('downloads'), 'nova-' + Date.now() + (pdf ? '.pdf' : '.png'));
  fs.writeFileSync(f, pdf ? await wc.printToPDF({}) : (await wc.capturePage()).toPNG());
  shell.showItemInFolder(f); return f;
});
function hookNet(ses) {
  ses.webRequest.onCompleted(d => {
    if (typeof d.webContentsId !== 'number') return;
    const wc = webContents.fromId(d.webContentsId), host = wc && wc.hostWebContents;
    if (host && !host.isDestroyed()) host.send('net', { id: d.webContentsId, m: d.method, u: d.url, s: d.statusCode, t: d.resourceType, h: d.resourceType === 'mainFrame' ? d.responseHeaders : null });
  });
}
function hookDownloads(ses) {
  ses.on('will-download', (_, item, wc) => {
    const host = wc && wc.hostWebContents, id = String(Date.now() + Math.random());
    const file = path.join(app.getPath('downloads'), item.getFilename()); item.setSavePath(file);
    downloads.set(id, item);
    const send = st => host && !host.isDestroyed() && host.send('dl', { id, name: item.getFilename(), file, received: item.getReceivedBytes(), total: item.getTotalBytes(), state: st });
    send('progressing');
    item.on('updated', (__, st) => send(st === 'interrupted' ? 'interrupted' : 'progressing'));
    item.once('done', (__, st) => { send(st); downloads.delete(id); });
  });
}

const HOT = new Set(['t', 'w', 'l', 'r', 'd', 'h', 'j', 'f', 'p', 'n', 'o', 'u', 'i', 'e', 'tab', '=', '+', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8']);
app.on('web-contents-created', (_, wc) => {
  if (wc.getType() !== 'webview') return;
  const host = () => wc.hostWebContents;
  wc.setWindowOpenHandler(({ url }) => { host() && host().send('open-tab', { url }); return { action: 'deny' }; });
  wc.on('before-input-event', (ev, i) => {
    if (i.type !== 'keyDown') return;
    const k = i.key.toLowerCase();
    if (k === 'escape') return host() && host().send('key', { key: k });
    const hit = ((i.control || i.meta) && HOT.has(k)) || (i.alt && (k === 'arrowleft' || k === 'arrowright')) || ['f5', 'f11', 'f12'].includes(k);
    if (!hit) return;
    ev.preventDefault();
    host() && host().send('key', { key: k, ctrl: i.control || i.meta, shift: i.shift, alt: i.alt });
  });
  wc.on('context-menu', (_, p) => {
    const t = [], open = o => host() && host().send('open-tab', o);
    if (p.linkURL) t.push({ label: 'Відкрити посилання в новій вкладці', click: () => open({ url: p.linkURL }) }, { label: 'Копіювати адресу посилання', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
    if (p.mediaType === 'image') t.push({ label: 'Зберегти зображення', click: () => wc.downloadURL(p.srcURL) }, { label: 'Копіювати зображення', click: () => wc.copyImageAt(p.x, p.y) }, { type: 'separator' });
    if (p.selectionText) t.push({ label: 'Копіювати', role: 'copy' }, { label: 'Шукати «' + p.selectionText.slice(0, 25) + '»', click: () => open({ q: p.selectionText }) }, { type: 'separator' });
    if (p.isEditable && p.misspelledWord) {
      (p.dictionarySuggestions || []).slice(0, 5).forEach(s => t.push({ label: s, click: () => wc.replaceMisspelling(s) }));
      t.push({ label: 'Додати «' + p.misspelledWord + '» у словник', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' });
    }
    if (p.isEditable) t.push({ label: 'Вирізати', role: 'cut' }, { label: 'Копіювати', role: 'copy' }, { label: 'Вставити', role: 'paste' }, { type: 'separator' });
    t.push({ label: 'Назад', enabled: wc.canGoBack(), click: () => wc.goBack() }, { label: 'Вперед', enabled: wc.canGoForward(), click: () => wc.goForward() },
      { label: 'Оновити', click: () => wc.reload() }, { type: 'separator' }, { label: 'Переглянути код елемента', click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(t).popup();
  });
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  // Тримати сесії в пам'яті з самого старту — інакше cookies можуть не записуватися на диск
  ensureSpaces(rd('state.json', {}).spaceCount);
  prepSession('nova-private');
  createWindow(false);
});
app.on('window-all-closed', () => app.quit());

// Надійне збереження cookies/сесій перед виходом (щоб входи в акаунти не зникали після вимкнення ПК)
let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  try {
    for (const p of [...spaceParts]) await session.fromPartition(p).cookies.flushStore();
  } catch (err) {
    try { fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), new Date().toISOString() + ' flush: ' + (err && err.stack || err) + '\n'); } catch {}
  }
  app.exit(0);
});

