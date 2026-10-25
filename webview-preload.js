const { ipcRenderer } = require('electron');
const send = (c, d) => ipcRenderer.sendToHost(c, d);
const pw = () => document.querySelector('input[type=password]');
function userField(p) {
  const c = [...(p.form || document).querySelectorAll('input')], i = c.indexOf(p);
  for (let k = i - 1; k >= 0; k--) if (['text', 'email', 'tel'].includes((c[k].type || 'text').toLowerCase()) && c[k].offsetParent) return c[k];
  return null;
}
function grab() {
  const p = [...document.querySelectorAll('input[type=password]')].find(x => x.value);
  if (!p) return;
  const u = userField(p);
  send('cred', { user: u ? u.value : '', pass: p.value });
}
addEventListener('submit', grab, true);
addEventListener('click', e => { if (e.target.closest && e.target.closest('button,input[type=submit],[role=button]')) grab(); }, true);
addEventListener('keydown', e => { if (e.key === 'Enter') grab(); }, true);
const check = () => { if (pw()) send('has-login', {}); };
addEventListener('DOMContentLoaded', () => { check(); setTimeout(check, 1500); });
function setVal(el, v) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}
ipcRenderer.on('fill', (_, d) => { const p = pw(); if (!p) return; const u = userField(p); if (u && d.user) setVal(u, d.user); setVal(p, d.pass); });

// Поле для коду 2FA: повідомляємо браузер, щоб він запропонував код з Authenticator
const otpEl = () => [...document.querySelectorAll('input')].find(i => i.offsetParent && !['password', 'hidden', 'checkbox', 'radio', 'submit', 'button'].includes(i.type) &&
  (i.autocomplete === 'one-time-code' || /otp|totp|2fa|mfa|verification.?code|security.?code|authenticator/i.test(i.name + ' ' + i.id + ' ' + i.placeholder + ' ' + (i.getAttribute('aria-label') || ''))));
let otpTries = 0;
const otpPoll = setInterval(() => { if (otpEl()) { send('has-otp', {}); clearInterval(otpPoll); } else if (++otpTries > 14) clearInterval(otpPoll); }, 1500);
