import { BrowserWindow } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import 'dotenv/config';

let running = false;
let isPaused = false;
let whisperProcess: ChildProcess | null = null;
let statsCallback: ((msg: string) => void) | null = null;

type CommandKey =
  | 'left'
  | 'double'
  | 'right'
  | 'scroll_up'
  | 'scroll_down'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'hold'
  | 'release';

type VoiceState = 'listening' | 'processing' | 'paused' | 'error';

function getMainWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows();
  return wins[0] ?? null;
}

function sendToRenderer(channel: string, payload?: any) {
  const win = getMainWindow();
  if (!win) {
    console.log('[voice] No hay ventana, pero comando sigue ejecutándose:', channel);
    return;
  }
  
  if (win.isMinimized()) {
    console.log('[voice] Ventana minimizada, enviando comando igual:', channel);
  }
  
  win.webContents.send(channel, payload);
}

function updateStatus(state: VoiceState, message: string) {
  sendToRenderer('voice:status', { state, message });
  statsCallback?.(message);
}

const PHRASES: [string, CommandKey][] = [
  // Doble clic
  ['doble clic', 'double'],
  ['doble click', 'double'],
  ['double click', 'double'],

  // Mantener / soltar click (drag & drop)
  ['agarrar clic', 'hold'],
  ['agarrar click', 'hold'],
  ['agarrar el clic', 'hold'],
  ['agarrar el click', 'hold'],
  ['mantener clic', 'hold'],
  ['mantener click', 'hold'],

  ['soltar clic', 'release'],
  ['soltar click', 'release'],
  ['soltar el clic', 'release'],
  ['soltar el click', 'release'],
  ['liberar clic', 'release'],
  ['liberar click', 'release'],

  // Click derecho
  ['clic derecho', 'right'],
  ['click derecho', 'right'],
  ['boton derecho', 'right'],
  ['botón derecho', 'right'],

  // Scroll con 2 palabras
  ['scroll arriba', 'scroll_up'],
  ['desplazar arriba', 'scroll_up'],
  ['scroll abajo', 'scroll_down'],
  ['desplazar abajo', 'scroll_down'],

  // Palabras sueltas
  ['doble', 'double'],

  ['derecha', 'right'],
  ['menu', 'right'],
  ['menú', 'right'],

  ['arriba', 'scroll_up'],
  ['subir', 'scroll_up'],

  ['abajo', 'scroll_down'],
  ['bajar', 'scroll_down'],

  ['click', 'left'],
  ['clic', 'left'],
  ['izquierda', 'left'],

  ['pausar', 'pause'],
  ['pausa', 'pause'],
  ['detener', 'pause'],

  ['reanudar', 'resume'],
  ['continuar', 'resume'],
  ['seguir', 'resume'],

  ['cancelar', 'cancel'],
  ['salir', 'cancel'],
];

function normalizeCommand(text: string): CommandKey | null {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();

  for (const [pattern, cmd] of PHRASES) {
    const p = pattern
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim();
    if (normalized === p) return cmd;
  }

  for (const [pattern, cmd] of PHRASES) {
    const p = pattern
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim();
    if (p && normalized.includes(p)) {
      return cmd;
    }
  }

  return null;
}


const USE_AI = !!process.env.OPENAI_API_KEY;
const openai = USE_AI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

console.log('[voice][INIT] USE_AI:', USE_AI);
console.log('[voice][INIT] API Key presente:', !!process.env.OPENAI_API_KEY);
console.log('[voice][INIT] Primeros caracteres:', process.env.OPENAI_API_KEY?.substring(0, 10));

const ALLOWED_COMMANDS: CommandKey[] = [
  'left',
  'double',
  'right',
  'scroll_up',
  'scroll_down',
  'pause',
  'resume',
  'cancel',
  'hold',
  'release',
];

async function aiInferCommand(text: string): Promise<CommandKey | null> {
  if (!USE_AI || !openai) {
    return null;
  }

  const trimmed = text.trim();
  if (trimmed.length < 3) return null;

  try {
    const prompt = `
Eres un clasificador de comandos de voz para un sistema de control de mouse accesible.

El usuario habla en español, de forma natural, y tú debes decidir qué comando ejecutar.

Comandos disponibles (campo "command"):
- "left"        → click izquierdo simple
- "double"      → doble click izquierdo
- "right"       → click derecho
- "scroll_up"   → hacer scroll hacia arriba
- "scroll_down" → hacer scroll hacia abajo
- "pause"       → pausar el sistema de seguimiento
- "resume"      → reanudar el sistema de seguimiento
- "cancel"      → cancelar la acción de permanencia actual
- "hold"        → mantener apretado el botón izquierdo (drag start)
- "release"     → soltar el botón izquierdo (drag end)

Instrucciones IMPORTANTES:
- Si el usuario dice algo como "agarrar clic", "mantener el click", "dejalo apretado", clasifícalo como "hold".
- Si dice "soltar clic", "liberar el click", "soltalo", clasifícalo como "release".
- Si el texto no expresa claramente uno de estos comandos, responde "none".

Responde SIEMPRE en JSON estricto, sin texto adicional, con este formato:
{"command": "left"}
o
{"command": "none"}
`;

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 20,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: trimmed },
      ],
    });

    const content = resp.choices[0]?.message?.content ?? '';
    let jsonStr = content.trim();

    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (match) jsonStr = match[0];

    const parsed = JSON.parse(jsonStr) as { command?: string };
    const cmd = (parsed.command || '').trim();

    if (cmd === 'none' || !cmd) return null;
    if (ALLOWED_COMMANDS.includes(cmd as CommandKey)) {
      console.log('[voice][AI] Mapeado a comando:', cmd);
      return cmd as CommandKey;
    }

    console.warn('[voice][AI] Comando no permitido:', cmd);
    return null;
  } catch (e) {
    console.error('[voice][AI] Error interpretando comando:', e);
    return null;
  }
}


async function executeCommand(cmd: CommandKey) {
  console.log('[voice] Ejecutando comando lógico:', cmd);

  try {
    switch (cmd) {
      case 'left':
        sendToRenderer('execute-command', {
          type: 'click',
          button: 'left',
        });
        statsCallback?.('✓ Click izquierdo');
        break;

      case 'double':
        sendToRenderer('execute-command', {
          type: 'click',
          button: 'double',
        });
        statsCallback?.('✓ Doble click');
        break;

      case 'right':
        sendToRenderer('execute-command', {
          type: 'click',
          button: 'right',
        });
        statsCallback?.('✓ Click derecho');
        break;

      case 'scroll_up':
        sendToRenderer('execute-command', {
          type: 'scroll',
          delta: +3,
        });
        statsCallback?.('✓ Scroll arriba');
        break;

      case 'scroll_down':
        sendToRenderer('execute-command', {
          type: 'scroll',
          delta: -3,
        });
        statsCallback?.('✓ Scroll abajo');
        break;

      case 'hold':
        sendToRenderer('execute-command', {
          type: 'hold',
          button: 'left',
        });
        statsCallback?.('🖱️ Agarrar clic (down)');
        break;

      case 'release':
        sendToRenderer('execute-command', {
          type: 'release',
          button: 'left',
        });
        statsCallback?.('🖱️ Soltar clic (up)');
        break;

      case 'pause':
        if (!isPaused) {
          isPaused = true;
          sendToRenderer('toggle-pause');
          updateStatus('paused', '⏸ Pausado por voz');
        }
        break;

      case 'resume':
        if (isPaused) {
          isPaused = false;
          sendToRenderer('toggle-pause');
          updateStatus('listening', '🎤 Escuchando');
        }
        break;

      case 'cancel':
        sendToRenderer('cancel-dwell');
        statsCallback?.('⛔ Acción cancelada');
        break;
    }
  } catch (e) {
    console.error('[voice] Error ejecutando comando', cmd, e);
    updateStatus('error', `❌ Error ejecutando ${cmd}`);
  }
}


export function initVoice(onStats?: (msg: string) => void) {
  if (running) {
    console.log('[voice] Ya está corriendo');
    return;
  }

  statsCallback = onStats || null;
  running = true;
  isPaused = false;

  console.log('[voice] Iniciando Whisper...');
  updateStatus('processing', '🎤 Iniciando reconocimiento de voz...');

  const whisperBin = path.join(
    process.cwd(),
    'whisper.cpp',
    'build',
    'bin',
    'whisper-stream'
  );
  const modelPath = path.join(process.cwd(), 'models', 'ggml-base.bin');

  if (!fs.existsSync(whisperBin)) {
    console.error('[voice] Error: No se encontró whisper-stream en:', whisperBin);
    statsCallback?.('❌ Error: Whisper no compilado');
    updateStatus('error', '❌ Whisper no compilado');
    running = false;
    return;
  }

  if (!fs.existsSync(modelPath)) {
    console.error('[voice] Error: No se encontró el modelo en:', modelPath);
    statsCallback?.('❌ Error: Modelo no descargado');
    updateStatus('error', '❌ Modelo no descargado');
    running = false;
    return;
  }

  const args = [
    '-m', modelPath,
    '-l', 'es',
    '-t', '4',
    '--step', '2000',
    '--length', '5000',
    '-vth', '0.6',
    '-ac', '512',
    '-kc',
  ];

  console.log('[voice] Ejecutando:', whisperBin, args.join(' '));

  whisperProcess = spawn(whisperBin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  whisperProcess.stdout?.on('data', (chunk: Buffer) => {
    const raw = chunk.toString('utf-8').trim();
    if (!raw) return;

    handleWhisperOutput(raw).catch((e) =>
      console.error('[voice] Error procesando salida Whisper:', e)
    );
  });

  whisperProcess.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim();
    if (!text) return;
    console.error('[voice] Whisper error:', text);
  });

  whisperProcess.on('error', (err) => {
    console.error('[voice] Error al iniciar Whisper:', err);
    statsCallback?.('❌ Error al iniciar Whisper');
    updateStatus('error', '❌ Error al iniciar Whisper');
    running = false;
  });

  whisperProcess.on('exit', (code) => {
    console.log(`[voice] Whisper terminó con código ${code}`);
    running = false;
    whisperProcess = null;
    updateStatus('paused', '⏸ Voz detenida');
    statsCallback?.('🛑 Reconocimiento de voz detenido');
  });

  updateStatus('listening', '🎤 Escuchando...');
}

let lastCommandTimestamp = 0;
const COMMAND_COOLDOWN_MS = 2000;

async function handleWhisperOutput(raw: string) {
  const lines = raw.split('\n');
  
  const validLines = lines
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      
      if (line.startsWith('...') || line.startsWith('[') || line.startsWith('main:')) return false;
      
      if (line.length < 3) return false;
      
      if (/whisper_|ggml_|main:|processing|samples|lang =|task =/.test(line)) return false;
      
      return true;
    });

  const uniqueLines = validLines.filter((line, idx, arr) => {
    if (idx === 0) return true; 
    return arr[idx - 1] !== line; 
  });

  for (const line of uniqueLines) {
    if (isPaused) {
      console.log('[voice] Sistema pausado, comando ignorado');
      continue;
    }

    const now = Date.now();
    if (now - lastCommandTimestamp < COMMAND_COOLDOWN_MS) {
      console.log('[voice] ⏳ Cooldown activo, ignorando comando');
      continue;
    }

    let commandToExecute: CommandKey | null = null;

    if (USE_AI) {
      console.log('[voice] Intentando interpretar con IA...');
      const aiCmd = await aiInferCommand(line);
      if (aiCmd) {
        console.log('[voice] ✅ Comando detectado por IA:', aiCmd);
        commandToExecute = aiCmd;
      }
    }

    if (!commandToExecute) {
      console.log('[voice] IA no detectó comando, probando reglas...');
      const ruleCmd = normalizeCommand(line);
      if (ruleCmd) {
        console.log('[voice] ✅ Comando detectado por regla:', ruleCmd);
        commandToExecute = ruleCmd;
      }
    }

    if (commandToExecute) {
      lastCommandTimestamp = now;
      await executeCommand(commandToExecute);
    } else {
      console.log('[voice] ⚠️ No se reconoció ningún comando en:', line);
      statsCallback?.('❓ Comando no reconocido');
    }
  }

  if (!isPaused) {
    updateStatus('listening', '🎤 Escuchando...');
  }
}

export function stopVoice() {
  const proc = whisperProcess;

  if (!running || !proc) {
    console.log('[voice] No hay proceso de voz corriendo');
    return;
  }

  console.log('[voice] Deteniendo Whisper...');

  try {
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    }, 1500);
  } catch (e) {
    console.error('[voice] Error deteniendo Whisper:', e);
  }

  whisperProcess = null;
  running = false;
  isPaused = false;
  updateStatus('paused', '⏸ Voz detenida');
  statsCallback?.('🛑 Comandos de voz detenidos');
}

export function pauseVoice() {
  if (!running) return;
  if (!isPaused) {
    isPaused = true;
    sendToRenderer('toggle-pause');
    updateStatus('paused', '⏸ Voz pausada');
  }
}

export function resumeVoice() {
  if (!running) return;
  if (isPaused) {
    isPaused = false;
    sendToRenderer('toggle-pause');
    updateStatus('listening', '🎤 Voz reanudada');
  }
}

export function getVoiceStats() {
  return {
    running,
    paused: isPaused,
  };
}
