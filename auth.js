// Authenticator: TOTP-коди (RFC 6238), як Google/Microsoft Authenticator. Секрети шифруються засобами ОС (safeStorage).
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s) {
  s = String(s).toUpperCase().replace(/[\s=-]/g, '');
  if (!s || /[^A-Z2-7]/.test(s)) return null;
  let bits = 0, val = 0; const out = [];
  for (const c of s) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return out.length ? Buffer.from(out) : null;
}

function totp(secretB32, { algo = 'SHA1', digits = 6, period = 30 } = {}, now = Date.now()) {
  const key = b32decode(secretB32); if (!key) throw new Error('bad secret');
  const counter = Math.floor(now / 1000 / period);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac(algo.toLowerCase(), key).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

// Приймає або otpauth://totp/Label?secret=..&issuer=.., або просто секретний ключ (base32)
function parseInput(input) {
  input = String(input || '').trim();
  if (/^otpauth:\/\//i.test(input)) {
    const u = new URL(input);
    if (u.hostname.toLowerCase() !== 'totp') throw new Error('Підтримуються лише TOTP-коди');
    const label = decodeURIComponent(u.pathname.replace(/^\//, ''));
    const p = u.searchParams;
    let issuer = p.get('issuer') || '', name = label;
    if (label.includes(':')) { const i = label.indexOf(':'); issuer = issuer || label.slice(0, i); name = label.slice(i + 1); }
    const algo = (p.get('algorithm') || 'SHA1').toUpperCase();
    if (!['SHA1', 'SHA256', 'SHA512'].includes(algo)) throw new Error('Невідомий алгоритм');
    return { secret: p.get('secret') || '', issuer, name: name.trim(), algo, digits: [6, 7, 8].includes(+p.get('digits')) ? +p.get('digits') : 6, period: +p.get('period') > 0 ? Math.min(+p.get('period'), 300) : 30 };
  }
  return { secret: input, issuer: '', name: '', algo: 'SHA1', digits: 6, period: 30 };
}

module.exports = function (ipcMain, app, safeStorage) {
  const file = () => path.join(app.getPath('userData'), 'authenticator.json');
  const rd = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
  const wr = o => fs.writeFileSync(file(), JSON.stringify(o));

  ipcMain.handle('auth:add', (_, d) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Шифрування недоступне в цій системі' };
      const a = parseInput(d && d.uri);
      if (d && d.name && d.name.trim()) a.name = d.name.trim();
      if (!b32decode(a.secret)) return { ok: false, error: 'Невірний секретний ключ (потрібен base32, літери A–Z та цифри 2–7)' };
      totp(a.secret, a); // перевірка, що код обчислюється
      if (!a.name && !a.issuer) a.name = 'Акаунт';
      const db = rd(), id = crypto.randomUUID();
      db[id] = { name: a.name, issuer: a.issuer, algo: a.algo, digits: a.digits, period: a.period, secret: safeStorage.encryptString(a.secret.replace(/[\s=-]/g, '').toUpperCase()).toString('base64') };
      wr(db); return { ok: true };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // Секрети не залишають головний процес — у вікно йдуть лише поточні коди
  ipcMain.handle('auth:list', () => {
    const db = rd(), now = Date.now();
    return Object.keys(db).map(id => {
      const x = db[id];
      try {
        const secret = safeStorage.decryptString(Buffer.from(x.secret, 'base64'));
        return { id, name: x.name, issuer: x.issuer, digits: x.digits, period: x.period, code: totp(secret, x, now), left: x.period - (Math.floor(now / 1000) % x.period) };
      } catch { return null; }
    }).filter(Boolean);
  });

  ipcMain.handle('auth:del', (_, id) => { const db = rd(); delete db[id]; wr(db); return true; });
};
module.exports.totp = totp; module.exports.parseInput = parseInput;
