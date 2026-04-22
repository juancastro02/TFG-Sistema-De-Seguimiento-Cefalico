const { contextBridge, ipcRenderer } = require('electron');

const listenerMap = new Map();
const enabledListenerMap = new WeakMap();

function rememberListener(channel, listener, wrapped) {
  if (!listenerMap.has(channel)) {
    listenerMap.set(channel, new WeakMap());
  }
  listenerMap.get(channel).set(listener, wrapped);
}

function getRememberedListener(channel, listener) {
  return listenerMap.get(channel)?.get(listener);
}

contextBridge.exposeInMainWorld('native', {
  move: (x, y) => ipcRenderer.invoke('native:move', { x, y }),
  click: (button) => ipcRenderer.invoke('native:click', { button }),
  scroll: (dx = 0, dy = 0) => ipcRenderer.invoke('native:scroll', { dx, dy }),
  mouseDown: (button) => ipcRenderer.invoke('native:mouseDown', { button }),
  mouseUp: (button) => ipcRenderer.invoke('native:mouseUp', { button }),
  typeText: (text) => ipcRenderer.invoke('native:typeText', { text }),
  pressKey: (key) => ipcRenderer.invoke('native:pressKey', { key }),
  deleteLastWord: () => ipcRenderer.invoke('native:deleteLastWord'),
  getScreenSize: () => ipcRenderer.invoke('native:getScreenSize'),
  getEnabled: () => ipcRenderer.invoke('native:getEnabled'),
  setEnabled: (v) => ipcRenderer.invoke('native:setEnabled', v),
  onEnabledChanged: (cb) => {
    const previous = enabledListenerMap.get(cb);
    if (previous) {
      ipcRenderer.removeListener('native:enabled-changed', previous);
    }

    const listener = (_e, enabled) => cb(enabled);
    enabledListenerMap.set(cb, listener);
    ipcRenderer.on('native:enabled-changed', listener);

    return () => {
      const stored = enabledListenerMap.get(cb);
      if (stored) {
        ipcRenderer.removeListener('native:enabled-changed', stored);
        enabledListenerMap.delete(cb);
      }
    };
  },
});

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  on: (channel, cb) => {
    const listener = (_event, payload) => cb(payload);
    rememberListener(channel, cb, listener);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
      listenerMap.get(channel)?.delete(cb);
    };
  },
  off: (channel, cb) => {
    const listener = getRememberedListener(channel, cb);
    if (listener) {
      ipcRenderer.removeListener(channel, listener);
      listenerMap.get(channel)?.delete(cb);
    }
  },
  loadProfiles: () => ipcRenderer.invoke('profiles:loadAll'),
  saveProfiles: (profiles) => ipcRenderer.invoke('profiles:saveAll', profiles),
  setActiveProfile: (id) => ipcRenderer.invoke('profiles:setActive', id),
  applyProfile: (patch) => ipcRenderer.invoke('profiles:apply', patch),
  loadActive: () => ipcRenderer.invoke('profiles:loadActive'),
  saveActive: (patch) => ipcRenderer.invoke('profiles:saveActive', patch),
  voiceToggle: (on) => ipcRenderer.invoke('voice:toggle', on),
  voicePause: () => ipcRenderer.invoke('voice:pause'),
  voiceResume: () => ipcRenderer.invoke('voice:resume'),
  voiceStats: () => ipcRenderer.invoke('voice:stats'),
  voiceChunk: (audioChunk, mimeType) => ipcRenderer.invoke('voice:chunk', { audioChunk, mimeType }),
});
