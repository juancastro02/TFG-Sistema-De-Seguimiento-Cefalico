import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Resp = { id?: number; ok: boolean; error?: string; result?: any };

export type PythonMouseDriver = {
  move(x: number, y: number): Promise<void>;
  click(button?: 'left' | 'right' | 'middle'): Promise<void>;
  scroll(dx?: number, dy?: number): Promise<void>;
  down(button?: 'left' | 'right' | 'middle'): Promise<void>;
  up(button?: 'left' | 'right' | 'middle'): Promise<void>;
  dispose(): void;
};

export async function getPythonMouseDriver(): Promise<PythonMouseDriver> {
  const here = path.dirname(fileURLToPath(import.meta.url)); 
  const appBase = app.isPackaged ? process.resourcesPath : app.getAppPath();

  const candidates = [
    path.join(process.cwd(), 'py', 'mouse_server.py'),  
    path.join(here, '..', 'py', 'mouse_server.py'),  
    path.join(appBase, 'py', 'mouse_server.py'),      
  ];
  const scriptPath = candidates.find(p => fs.existsSync(p)) ?? candidates[0];

  const venvPy = path.resolve(process.cwd(), 'py', '.venv', 'bin', 'python3');
  const pythonBin = fs.existsSync(venvPy) ? venvPy : 'python3';

  if (!fs.existsSync(scriptPath)) {
    const msg = `mouse_server.py no encontrado.\nBuscado en:\n${candidates.join('\n')}`;
    console.error(msg);
    throw new Error(msg);
  }

  const child: ChildProcessWithoutNullStreams = spawn(pythonBin, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  child.stderr.on('data', d => {
    const msg = d.toString().trim();
    if (msg) console.error('[PY]', msg);
  });

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: any) => void; timer: NodeJS.Timeout }
  >();
  let buf = '';

  child.stdout.on('data', chunk => {
    buf += chunk.toString();
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;

      let resp: Resp;
      try {
        resp = JSON.parse(line);
      } catch {
        console.error('[PY bad json]', line);
        continue;
      }

      const id = typeof resp.id === 'number' ? resp.id : -1;
      const slot = pending.get(id);
      if (!slot) continue;

      clearTimeout(slot.timer);
      pending.delete(id);

      if (resp.ok) {
        slot.resolve(resp.result);
      } else {
        slot.reject(new Error(resp.error || 'python error'));
      }
    }
  });

  const rpc = <T = any>(
    method: string,
    params: Record<string, any> = {},
    timeoutMs = 1200,
  ) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }, timeoutMs);

      pending.set(id, { resolve, reject, timer });

      try {
        child.stdin.write(JSON.stringify({ id, method, ...params }) + '\n');
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        reject(e);
      }
    });

  try {
    await rpc('ready', {}, 800);
    console.log('[native-driver] PY ready');
  } catch (e) {
    console.warn('[native-driver] ready falló', e);
  }

  let moving = false;
  let last: { x: number; y: number } | null = null;

  const moveCoalesced = async (x: number, y: number) => {
    last = { x, y };
    if (moving) return;
    moving = true;
    try {
      while (last) {
        const t = last;
        last = null;
        await rpc('move', { x: Math.round(t.x), y: Math.round(t.y) }, 800);
      }
    } finally {
      moving = false;
    }
  };

  return {
    async move(x, y) {
      await moveCoalesced(x, y);
    },
    async click(button = 'left') {
      await rpc('click', { button }, 1000);
    },
    async scroll(dx = 0, dy = 0) {
      await rpc('scroll', { dx: Math.round(dx), dy: Math.round(dy) }, 1000);
    },
    async down(button = 'left') {
      await rpc('down', { button }, 1000);
    },
    async up(button = 'left') {
      await rpc('up', { button }, 1000);
    },
    dispose() {
      try {
        child.kill();
      } catch {
      }
    },
  };
}
