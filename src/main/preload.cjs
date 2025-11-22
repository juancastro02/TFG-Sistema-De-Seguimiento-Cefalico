// src/preload.cjs (CommonJS)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  move: (x, y) => ipcRenderer.invoke('native:move', { x, y }),
  click: (button) => ipcRenderer.invoke('native:click', { button }),
  scroll: (dx = 0, dy = 0) => ipcRenderer.invoke('native:scroll', { dx, dy }),

  getScreenSize: () => ipcRenderer.invoke('native:getScreenSize'),
  getEnabled: () => ipcRenderer.invoke('native:getEnabled'),
  setEnabled: (v) => ipcRenderer.invoke('native:setEnabled', v),

  onEnabledChanged: (cb) => {
    const listener = (_e, enabled) => cb(enabled);
    ipcRenderer.removeAllListeners('native:enabled-changed');
    ipcRenderer.on('native:enabled-changed', listener);
  },
});

contextBridge.exposeInMainWorld('api', {
  on: (channel, cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  off: (channel, cb) => ipcRenderer.removeListener(channel, cb),

  voiceToggle: (on) => ipcRenderer.invoke('voice:toggle', on),
  voicePause: () => ipcRenderer.invoke('voice:pause'),
  voiceResume: () => ipcRenderer.invoke('voice:resume'),
  voiceStats: () => ipcRenderer.invoke('voice:stats'),

  saveProfiles: (profiles) => ipcRenderer.invoke('profiles:saveAll', profiles),
  loadProfiles: () => ipcRenderer.invoke('profiles:loadAll'),
  setActiveProfile: (id) => ipcRenderer.invoke('profiles:setActive', id),
  applyProfile: (patch) => ipcRenderer.invoke('profiles:apply', patch),
});
