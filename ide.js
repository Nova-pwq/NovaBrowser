// NovaIDE: проєкти, локальний сервер, запуск Python/Node/Shell
const fs = require('fs'), path = require('path'), http = require('http'), { spawn } = require('child_process');
module.exports = function (ipcMain, app, shell) {
  let ROOT, server, port, ver = 1, proc;
  const win = process.platform === 'win32';
  const seed = () => {
    const f = {
      'index.html': '<!DOCTYPE html>\n<html lang="uk">\n<head>\n  <meta charset="utf-8">\n  <title>Мій сайт</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Привіт, NovaIDE!</h1>\n  <button id="b">Натисни мене</button>\n  <script src="script.js"></script>\n</body>\n</html>\n',
      'style.css': 'body{font-family:sans-serif;background:#16161d;color:#fff;text-align:center;padding-top:60px}\nbutton{padding:10px 20px;border:0;border-radius:10px;background:#6c3df5;color:#fff;font-size:16px;cursor:pointer}\n',
      'script.js': "document.getElementById('b').onclick=()=>alert('Працює!');\n",
      'hello.py': 'name = input("Як вас звати? ") if False else "світе"\nprint(f"Привіт, {name}!")\nfor i in range(1, 4):\n    print("Рядок", i)\n'
    };
    for (const [n, t] of Object.entries(f)) fs.writeFileSync(path.join(ROOT, n), t);
  };
  const root = () => { if (!ROOT) { ROOT = path.join(app.getPath('documents'), 'NovaProjects'); if (!fs.existsSync(ROOT)) { fs.mkdirSync(ROOT, { recursive: true }); seed(); } } return ROOT; };
  const safe = p => { const r = path.resolve(root(), String(p || '')); if (r !== ROOT && !r.startsWith(ROOT + path.sep)) throw new Error('Шлях поза проєктом'); return r; };

  ipcMain.handle('ide:root', () => root());
  ipcMain.handle('ide:list', () => {
    const out = [];
    const walk = (d, rel, depth) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.git', '__pycache__'].includes(e.name)) continue;
      const p = rel ? rel + '/' + e.name : e.name; out.push({ p, dir: e.isDirectory() });
      if (e.isDirectory() && depth < 4) walk(path.join(d, e.name), p, depth + 1); } };
    walk(root(), '', 0); return out;
  });
  ipcMain.handle('ide:read', (_, p) => { const f = safe(p); if (fs.statSync(f).size > 2e6) throw new Error('Файл завеликий'); return fs.readFileSync(f, 'utf8'); });
  ipcMain.handle('ide:write', (_, p, t) => { const f = safe(p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, String(t)); ver++; return true; });
  ipcMain.handle('ide:new', (_, p, dir) => { const f = safe(p); if (dir) fs.mkdirSync(f, { recursive: true }); else { fs.mkdirSync(path.dirname(f), { recursive: true }); if (!fs.existsSync(f)) fs.writeFileSync(f, ''); } ver++; return true; });
  ipcMain.handle('ide:del', (_, p) => { const f = safe(p); if (f === ROOT) return false; fs.rmSync(f, { recursive: true, force: true }); ver++; return true; });
  ipcMain.handle('ide:folder', () => shell.openPath(root()));

  // локальний сайт (тільки 127.0.0.1) з автооновленням сторінки
  const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain' };
  const LR = '<script>(()=>{let v;setInterval(()=>fetch("/__nova_v").then(r=>r.text()).then(x=>{if(v&&v!==x)location.reload();v=x}).catch(()=>{}),700)})()</script>';
  ipcMain.handle('ide:serve', () => new Promise(res => {
    if (server) return res('http://localhost:' + port);
    server = http.createServer((req, rs) => {
      try {
        const u = decodeURIComponent(req.url.split('?')[0]);
        if (u === '/__nova_v') return rs.end(String(ver));
        let f = path.resolve(root(), '.' + path.normalize('/' + u));
        if (f !== ROOT && !f.startsWith(ROOT + path.sep)) { rs.writeHead(403); return rs.end('403'); }
        if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
        if (!fs.existsSync(f)) { rs.writeHead(404); return rs.end('404 Not found'); }
        const ext = path.extname(f).toLowerCase(); let body = fs.readFileSync(f);
        if (ext === '.html') { let t = body.toString('utf8'); t = /<\/body>/i.test(t) ? t.replace(/<\/body>/i, LR + '</body>') : t + LR; body = Buffer.from(t); }
        rs.writeHead(200, { 'Content-Type': (MIME[ext] || 'application/octet-stream') + (['.html', '.css', '.js'].includes(ext) ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store' });
        rs.end(body);
      } catch (e) { rs.writeHead(500); rs.end(String(e.message)); }
    });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; res('http://localhost:' + port); });
  }));

  // запуск скриптів
  const py = a => win ? [['py', ['-u', ...a]], ['python', ['-u', ...a]]] : [['python3', ['-u', ...a]], ['python', ['-u', ...a]]];
  function plan(kind, f) {
    if (kind === 'js') return [[process.execPath, [f], { ELECTRON_RUN_AS_NODE: '1' }]];
    if (kind === 'py') return py([f]);
    if (kind === 'pysrv') return py(['-m', 'http.server', '8765', '--bind', '127.0.0.1']);
    const e = path.extname(f).toLowerCase();
    if (e === '.bat' || e === '.cmd') return [['cmd', ['/c', f]]];
    if (e === '.ps1') return [['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f]]];
    return [[win ? 'powershell' : 'bash', win ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f] : [f]]];
  }
  const stop = () => { if (!proc) return; try { win ? spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']) : proc.kill(); } catch {} proc = null; };
  ipcMain.handle('ide:stop', () => { stop(); return true; });
  app.on('before-quit', stop);
  ipcMain.handle('ide:run', (e, p, kind) => {
    stop();
    const f = kind === 'pysrv' ? root() : safe(p), wc = e.sender, list = plan(kind, f);
    const send = (t, d) => { if (!wc.isDestroyed()) wc.send('ide-out', { t, d }); };
    const next = () => {
      const c = list.shift();
      if (!c) { send('err', 'Інтерпретатор не знайдено. Для Python встановіть його з python.org (позначте Add to PATH).\n'); return send('end', -1); }
      const pr = spawn(c[0], c[1], { cwd: kind === 'pysrv' ? root() : path.dirname(f), env: { ...process.env, ...(c[2] || {}), PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
      proc = pr; let failed = false;
      pr.on('error', err => { failed = true; if (err.code === 'ENOENT') next(); else { send('err', String(err) + '\n'); send('end', -1); } });
      pr.stdout.on('data', d => send('out', d.toString()));
      pr.stderr.on('data', d => send('err', d.toString()));
      pr.on('close', code => { if (failed) return; if (proc === pr) proc = null; send('end', code); });
    };
    next(); return true;
  });
};
