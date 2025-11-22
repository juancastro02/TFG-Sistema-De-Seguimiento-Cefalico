import { contextBridge, ipcRenderer } from 'electron'

type Listener = (...args:any[]) => void

const api = {
  on: (channel: string, listener: Listener) => ipcRenderer.on(channel, (_ev, ...args) => listener(...args)),
  off: (channel: string, listener: Listener) => ipcRenderer.removeListener(channel, (_ev, ..._a) => listener),

  getScreenSize: () => ipcRenderer.invoke('native:getScreenSize'),

  move: (x: number, y: number) => ipcRenderer.invoke('native:move', { x, y }),
  click: (button: 'left'|'right'|'double') => ipcRenderer.invoke('native:click', { button }),
  mouse: (action: 'down'|'up') => ipcRenderer.invoke('native:mouse', { action }),
  scroll: (delta: number) => ipcRenderer.invoke('native:scroll', { delta }),

  voiceToggle: (on: boolean) => ipcRenderer.invoke('voice:toggle', on),
  voicePause: () => ipcRenderer.invoke('voice:pause'),
  voiceResume: () => ipcRenderer.invoke('voice:resume'),
  voiceStats: () => ipcRenderer.invoke('voice:stats'),

  saveProfiles: (profiles:any[]) => ipcRenderer.invoke('profiles:saveAll', profiles),
  loadProfiles: () => ipcRenderer.invoke('profiles:loadAll'),
  setActiveProfile: (id: string) => ipcRenderer.invoke('profiles:setActive', id),
  applyProfile: (profile:any) => ipcRenderer.invoke('profiles:apply', profile),

  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
