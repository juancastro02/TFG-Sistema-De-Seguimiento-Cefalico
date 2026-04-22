import type { Profile } from './profile.js';

export {};

declare global {
  type VoiceRuntimeInfo = {
    running: boolean;
    paused: boolean;
    provider: 'local' | 'openai';
    chunkMs: number;
    requiresRendererCapture: boolean;
    useAI: boolean;
    transcribeModel: string;
    intentModel: string;
  };

  type VoiceToggleResponse = {
    ok: boolean;
    active: boolean;
    error?: string;
    stats?: VoiceRuntimeInfo;
  };

  interface Window {
    native: {
      mouseDown: (button?: string) => Promise<boolean>;
      mouseUp: (button?: string) => Promise<boolean>;
      
      move: (x: number, y: number) => Promise<boolean>;
      click: (button?: 'left'|'right'|'middle'|'double') => Promise<boolean>;
      scroll: (dx?: number, dy?: number) => Promise<boolean>;
      typeText: (text: string) => Promise<boolean>;
      pressKey: (key: string) => Promise<boolean>;
      deleteLastWord: () => Promise<boolean>;
      getScreenSize: () => Promise<{ width:number; height:number }>;
      getEnabled: () => Promise<boolean>;
      setEnabled: (v: boolean) => Promise<boolean>;
      onEnabledChanged: (cb: (enabled:boolean)=>void) => () => void;
    };

    api: {
      loadProfiles: () => Promise<{profiles: Profile[]; activeId:string|null}>;
      saveProfiles: (profiles:Profile[]) => Promise<boolean>;
      setActiveProfile: (id:string) => Promise<boolean>;
      applyProfile: (patch:Partial<Profile>) => Promise<boolean>;
      loadActive: () => Promise<Profile>;
      saveActive: (patch:Partial<Profile>) => Promise<boolean>;

      voiceToggle: (on:boolean) => Promise<VoiceToggleResponse>;
      voicePause: () => Promise<VoiceToggleResponse>;
      voiceResume: () => Promise<VoiceToggleResponse>;
      voiceStats: () => Promise<VoiceRuntimeInfo>;
      voiceChunk: (audioChunk: Uint8Array, mimeType?: string) => Promise<{ ok: boolean; accepted: boolean; error?: string }>;

      on: (ch:string, listener:(payload:any)=>void) => () => void;
      off: (ch:string, listener:(payload:any)=>void) => void;
      platform: string;
    };
  }
}
