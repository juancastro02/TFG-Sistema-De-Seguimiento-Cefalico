export {};

declare global {
  interface Window {
    native: {
      mouseDown: (button?: string) => Promise<void>;
      mouseUp: (button?: string) => Promise<void>;
      
      move: (x: number, y: number) => Promise<void>;
      click: (button?: 'left'|'right'|'middle'|'double') => Promise<void>;
      scroll: (dx?: number, dy?: number) => Promise<void>;
      getScreenSize: () => Promise<{ width:number; height:number }>;
      getEnabled: () => Promise<boolean>;
      setEnabled: (v: boolean) => Promise<boolean>;
      onEnabledChanged: (cb: (enabled:boolean)=>void) => void;
    };

    api: {
      // perfiles
      loadProfiles: () => Promise<{profiles:any[]; activeId:string|null}>;
      saveProfiles: (profiles:any[]) => Promise<boolean>;
      setActiveProfile: (id:string) => Promise<boolean>;
      applyProfile: (patch:Partial<any>) => Promise<boolean>;

      // voz
      voiceToggle: (on:boolean) => Promise<boolean>;
      voicePause: () => Promise<boolean>;
      voiceResume: () => Promise<boolean>;
      voiceStats: () => Promise<any>;

      // eventos desde main -> renderer
      on: (ch:string, listener:(payload:any)=>void) => void;
      off: (ch:string, listener:(payload:any)=>void) => void;
    };
  }
}
