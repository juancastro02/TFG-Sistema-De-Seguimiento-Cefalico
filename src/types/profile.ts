export type Profile = {
  id: string;
  name: string;
  createdAt: number;
  sensitivity: number;
  gain: number;
  dwellMs: number;
  deadzone: number;
  maxSpeed: number;
  gazeAmplification: number;
  neutralX: number;
  neutralY: number;
  voiceEnabled: boolean;
  headTrackingEnabled: boolean;
  autoClickEnabled: boolean;
};

export const DEFAULT_PROFILE_VALUES: Omit<Profile, 'id' | 'name' | 'createdAt'> = {
  sensitivity: 2.0,
  gain: 1.15,
  dwellMs: 1000,
  deadzone: 0.0045,
  maxSpeed: 2.0,
  gazeAmplification: 2.0,
  neutralX: 0.5,
  neutralY: 0.5,
  voiceEnabled: false,
  headTrackingEnabled: true,
  autoClickEnabled: false,
};

export function createProfile(overrides: Partial<Profile> = {}): Profile {
  const id = overrides.id ?? 'default';
  const name = overrides.name ?? (id === 'default' ? 'Perfil por defecto' : 'Nuevo perfil');

  return {
    id,
    name,
    createdAt: overrides.createdAt ?? Date.now(),
    ...DEFAULT_PROFILE_VALUES,
    ...overrides,
  };
}

export function normalizeProfile(input: Partial<Profile> | null | undefined, fallbackId = 'default'): Profile {
  return createProfile({
    id: input?.id ?? fallbackId,
    name: input?.name,
    createdAt: input?.createdAt,
    sensitivity: typeof input?.sensitivity === 'number' ? input.sensitivity : undefined,
    gain: typeof input?.gain === 'number' ? input.gain : undefined,
    dwellMs: typeof input?.dwellMs === 'number' ? input.dwellMs : undefined,
    deadzone: typeof input?.deadzone === 'number' ? input.deadzone : undefined,
    maxSpeed: typeof input?.maxSpeed === 'number' ? input.maxSpeed : undefined,
    gazeAmplification: typeof input?.gazeAmplification === 'number' ? input.gazeAmplification : undefined,
    neutralX: typeof input?.neutralX === 'number' ? input.neutralX : undefined,
    neutralY: typeof input?.neutralY === 'number' ? input.neutralY : undefined,
    voiceEnabled: typeof input?.voiceEnabled === 'boolean' ? input.voiceEnabled : undefined,
    headTrackingEnabled: typeof input?.headTrackingEnabled === 'boolean' ? input.headTrackingEnabled : undefined,
    autoClickEnabled: typeof input?.autoClickEnabled === 'boolean' ? input.autoClickEnabled : undefined,
  });
}
