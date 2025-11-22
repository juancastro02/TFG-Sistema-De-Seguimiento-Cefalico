import { ipcRenderer } from 'electron';
import { clickFromGesture, scrollFromGesture, setPaused } from '../tracking/headTracker.js';

ipcRenderer.on('voice-command', (_event, msg: { type: string; payload?: any }) => {
  const { type, payload } = msg || {};
  console.log('[renderer][voice-command]', type, payload);

  switch (type) {
    case 'click':
      void clickFromGesture(payload?.button ?? 'left');
      break;

    case 'double':
      void clickFromGesture('left');
      setTimeout(() => {
        void clickFromGesture('left');
      }, 120);
      break;

    case 'right':
      void clickFromGesture('right');
      break;

    case 'scroll':
      void scrollFromGesture(payload?.dx ?? 0, payload?.dy ?? 0);
      break;

    case 'pause':
      setPaused(true);
      break;

    case 'resume':
      setPaused(false);
      break;

    case 'cancel':
      break;

    default:
      console.warn('[renderer] voice-command desconocido:', type);
  }
});
