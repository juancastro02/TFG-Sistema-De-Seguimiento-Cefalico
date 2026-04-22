import { ipcMain } from 'electron';
import ElectronStore from 'electron-store';
import { createProfile, normalizeProfile, type Profile } from '../../types/profile.js';

type StoreShape = {
  profiles: Profile[];
  activeId: string | null;
};

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
        deadzone: { type: 'number' },
        maxSpeed: { type: 'number' },
        gazeAmplification: { type: 'number' },
        neutralX: { type: 'number' },
        neutralY: { type: 'number' },
        voiceEnabled: { type: 'boolean' },
        headTrackingEnabled: { type: 'boolean' },
        autoClickEnabled: { type: 'boolean' }
      }
    }
  },
  activeId: { type: ['string', 'null'] }
} as const;

let store: ElectronStore<StoreShape> | null = null;

function sanitizeProfiles(rawProfiles: unknown): Profile[] {
  const input = Array.isArray(rawProfiles) ? rawProfiles : [];
  const profiles = input.map((profile, index) => normalizeProfile(profile as Partial<Profile>, `profile-${index + 1}`));
  return profiles.length > 0 ? profiles : [createProfile()];
}

function sanitizeActiveId(rawActiveId: unknown, profiles: Profile[]) {
  const activeId = typeof rawActiveId === 'string' ? rawActiveId : null;
  return profiles.some((profile) => profile.id === activeId) ? activeId : profiles[0]?.id ?? null;
}

function snapshot() {
  const s = getStore();
  const profiles = sanitizeProfiles(s.get('profiles'));
  const activeId = sanitizeActiveId(s.get('activeId'), profiles);

  s.set('profiles', profiles);
  s.set('activeId', activeId);

  return { profiles, activeId };
}

function getStore() {
  if (!store) {
    store = new ElectronStore<StoreShape>({
      name: 'handsfree',
      schema: schema as any,
      defaults: {
        profiles: [createProfile()],
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
    return snapshot();
  });

  ipcMain.handle('profiles:saveAll', (_e, profiles: Profile[]) => {
    const safeProfiles = sanitizeProfiles(profiles);
    s.set('profiles', safeProfiles);
    s.set('activeId', sanitizeActiveId(s.get('activeId'), safeProfiles));
    return true;
  });

  ipcMain.handle('profiles:setActive', (_e, id: string) => {
    const { profiles } = snapshot();
    s.set('activeId', sanitizeActiveId(id, profiles));
    return true;
  });

  ipcMain.handle('profiles:loadActive', () => {
    const { profiles, activeId } = snapshot();
    const active = profiles.find((profile) => profile.id === activeId) ?? profiles[0];
    return active;
  });

  ipcMain.handle('profiles:saveActive', (_e, patch: Partial<Profile>) => {
    const { profiles, activeId } = snapshot();
    const idx = profiles.findIndex((profile) => profile.id === activeId);
    if (idx >= 0) {
      profiles[idx] = normalizeProfile({ ...profiles[idx], ...patch }, profiles[idx].id);
      s.set('profiles', profiles);
    }
    return true;
  });

  ipcMain.handle('profiles:apply', (_e, patch: Partial<Profile>) => {
    const { profiles, activeId } = snapshot();
    const idx = profiles.findIndex((profile) => profile.id === activeId);
    if (idx >= 0) {
      profiles[idx] = normalizeProfile({ ...profiles[idx], ...patch }, profiles[idx].id);
      s.set('profiles', profiles);
    }
    return true;
  });
}
