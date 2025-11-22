const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  move: (x, y) => ipcRenderer.invoke('native:move', { x, y }),
  click: (button) => ipcRenderer.invoke('native:click', { button }),
  scroll: (dx = 0, dy = 0) => ipcRenderer.invoke('native:scroll', { dx, dy }),
  
  mouseDown: (button) => ipcRenderer.invoke('native:mouseDown', { button }),
  mouseUp: (button) => ipcRenderer.invoke('native:mouseUp', { button }),

  getScreenSize: () => ipcRenderer.invoke('native:getScreenSize'),
  getEnabled: () => ipcRenderer.invoke('native:getEnabled'),
  setEnabled: (v) => ipcRenderer.invoke('native:setEnabled', v),

  onEnabledChanged: (cb) => {
    const listener = (_e, enabled) => cb(enabled);
    ipcRenderer.removeAllListeners('native:enabled-changed');
    ipcRenderer.on('native:enabled-changed', listener);
  },
});

const subs = new Map(); 

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  on:  (channel, listener) => {
    const wrapped = (_e, ...args) => listener(...args);
    subs.set(listener, wrapped);
    ipcRenderer.on(channel, wrapped);
  },
  off: (channel, listener) => {
    const wrapped = subs.get(listener);
    if (wrapped) {
      ipcRenderer.removeListener(channel, wrapped);
      subs.delete(listener);
    }
  },

  loadProfiles:   ()              => ipcRenderer.invoke('profiles:loadAll'),
  saveProfiles:   (profiles)      => ipcRenderer.invoke('profiles:saveAll', profiles),
  setActiveProfile:(id)           => ipcRenderer.invoke('profiles:setActive', id),
  applyProfile:   (patch)         => ipcRenderer.invoke('profiles:apply', patch),
  loadActive:     ()              => ipcRenderer.invoke('profiles:loadActive'),
  saveActive:     (patch)         => ipcRenderer.invoke('profiles:saveActive', patch),

  voiceToggle: (on) => ipcRenderer.invoke('voice:toggle', on),
  voicePause:  ()   => ipcRenderer.invoke('voice:pause'),
  voiceResume: ()   => ipcRenderer.invoke('voice:resume'),
  voiceStats:  ()   => ipcRenderer.invoke('voice:stats'),
});
