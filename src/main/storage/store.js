import { ipcMain } from 'electron';
import ElectronStore from 'electron-store';
const schema = {
    profiles: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                createdAt: { type: 'number' },
                sensitivity: { type: 'number' },
                gain: { type: 'number' },
                dwellMs: { type: 'number' },
                voiceEnabled: { type: 'boolean' },
                headTrackingEnabled: { type: 'boolean' }
            }
        }
    },
    activeId: { type: ['string', 'null'] }
};
let store = null;
function getStore() {
    if (!store) {
        store = new ElectronStore({
            name: 'handsfree',
            schema: schema,
            defaults: {
                profiles: [{
                        id: 'default',
                        name: 'Perfil por defecto',
                        createdAt: Date.now(),
                        sensitivity: 1.5,
                        gain: 1.0,
                        dwellMs: 1000,
                        voiceEnabled: true,
                        headTrackingEnabled: true
                    }],
                activeId: 'default'
            }
        });
    }
    return store;
}
export function initStore() {
    const s = getStore();
    ipcMain.removeHandler('profiles:loadAll');
    ipcMain.removeHandler('profiles:saveAll');
    ipcMain.removeHandler('profiles:setActive');
    ipcMain.removeHandler('profiles:loadActive');
    ipcMain.removeHandler('profiles:saveActive');
    ipcMain.removeHandler('profiles:apply');
    ipcMain.handle('profiles:loadAll', () => {
        const profiles = s.get('profiles');
        const activeId = s.get('activeId');
        return { profiles, activeId };
    });
    ipcMain.handle('profiles:saveAll', (_e, profiles) => {
        s.set('profiles', profiles);
        if (!profiles.find(p => p.id === s.get('activeId'))) {
            s.set('activeId', profiles[0]?.id ?? null);
        }
        return true;
    });
    ipcMain.handle('profiles:setActive', (_e, id) => {
        s.set('activeId', id);
        return true;
    });
    ipcMain.handle('profiles:loadActive', () => {
        const activeId = s.get('activeId');
        const profiles = s.get('profiles');
        const active = profiles.find(p => p.id === activeId) ?? profiles[0];
        return active;
    });
    ipcMain.handle('profiles:saveActive', (_e, patch) => {
        const activeId = s.get('activeId');
        const profiles = s.get('profiles');
        const idx = profiles.findIndex(p => p.id === activeId);
        if (idx >= 0) {
            profiles[idx] = { ...profiles[idx], ...patch };
            s.set('profiles', profiles);
        }
        return true;
    });
    ipcMain.handle('profiles:apply', (_e, patch) => {
        const activeId = s.get('activeId');
        const profiles = s.get('profiles');
        const idx = profiles.findIndex(p => p.id === activeId);
        if (idx >= 0) {
            profiles[idx] = { ...profiles[idx], ...patch };
            s.set('profiles', profiles);
        }
        return true;
    });
}
