const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  ready: () => ipcRenderer.invoke('pet:ready'),
  press: (p) => ipcRenderer.send('pet:press', p),
  release: () => ipcRenderer.invoke('pet:release'),
  menu: (open) => ipcRenderer.send('pet:menu', open),
  cmd: (type, value) => ipcRenderer.send('pet:cmd', { type, value }),
  onSync: (fn) => ipcRenderer.on('pet:sync', (_e, d) => fn(d)),
  onAction: (fn) => ipcRenderer.on('pet:action', (_e, d) => fn(d))
});
