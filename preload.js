const { contextBridge, ipcRenderer: r } = require('electron');
const inv = (c, ...a) => r.invoke(c, ...a);
contextBridge.exposeInMainWorld('nova', {
  search: q => inv('search', q), getState: () => inv('state:get'), setState: s => inv('state:set', s),
  savePass: o => inv('pass:save', o), getPass: o => inv('pass:get', o), listPass: () => inv('pass:list'),
  delPass: (o, u) => inv('pass:del', o, u), clearData: () => inv('data:clear'),
  newWin: () => inv('win:new'), privWin: () => inv('win:private'), fullscreen: () => inv('win:full'), showFile: f => inv('dl:show', f),
  cancelDl: id => inv('dl:cancel', id), clearDl: id => inv('dl:clear', id),
  ide: (c, ...a) => ['root', 'list', 'read', 'write', 'new', 'del', 'folder', 'serve', 'run', 'stop'].includes(c) ? inv('ide:' + c, ...a) : null,
  dev: (c, ...a) => ['cookies', 'delcookie', 'proxy', 'shot', 'adblock', 'spelllang'].includes(c) ? inv('dev:' + c, ...a) : null,
  spaces: n => inv('space:ensure', n), clearSpace: i => inv('space:clear', i),
  auth: (c, ...a) => ['add', 'list', 'del'].includes(c) ? inv('auth:' + c, ...a) : null,
  on: (ch, cb) => { if (['dl', 'key', 'open-tab', 'net', 'ide-out'].includes(ch)) r.on(ch, (_, d) => cb(d)); },
  webPreload: r.sendSync('web-preload')
});
