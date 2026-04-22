import { app, BrowserWindow } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import OpenAI, { toFile } from 'openai';
import 'dotenv/config';

let running = false;
let isPaused = false;
let whisperProcess: ChildProcess | null = null;
let whisperStdoutBuffer = '';
let statsCallback: ((msg: string) => void) | null = null;
let recentTranscriptContext: Array<{ text: string; timestamp: number }> = [];
let pendingCommandTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCommand:
  | {
      cmd: CommandKey;
      transcription: string;
      timestamp: number;
    }
  | null = null;
let lastObservedTranscript:
  | {
      normalized: string;
      timestamp: number;
    }
  | null = null;
let lastRejectedTranscript:
  | {
      normalized: string;
      timestamp: number;
    }
  | null = null;
let lastExecutedCommand:
  | {
      cmd: CommandKey;
      normalizedTranscript: string;
      timestamp: number;
    }
  | null = null;
let voiceProvider: VoiceProvider = 'local';
let queuedAudioChunk:
  | {
      buffer: Buffer;
      mimeType: string;
      createdAt: number;
      id: number;
    }
  | null = null;
let isProcessingAudioChunk = false;
let audioChunkSeq = 0;
let dictationMode = false;

type CommandKey =
  | 'left'
  | 'double'
  | 'right'
  | 'scroll_up'
  | 'scroll_down'
  | 'pause'
  | 'resume'
  | 'dictate'
  | 'typed_text'
  | 'delete_word'
  | 'submit_text'
  | 'cancel_text'
  | 'hide_window'
  | 'show_window'
  | 'dwell_on'
  | 'dwell_off'
  | 'cancel'
  | 'hold'
  | 'release';
type VoiceProvider = 'local' | 'openai';

type VoiceState = 'listening' | 'processing' | 'paused' | 'error';
type VoiceCommandEvent = {
  transcription: string;
  recognized: boolean;
  action?: CommandKey;
  message: string;
  timestamp: number;
};

function getMainWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows();
  return wins[0] ?? null;
}

function hideMainWindow() {
  const win = getMainWindow();
  if (!win) return false;

  if (!win.isMinimized()) {
    win.minimize();
  }
  return true;
}

function showMainWindow() {
  const win = getMainWindow();
  if (!win) return false;

  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
  return true;
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

function getListeningStatusMessage() {
  if (dictationMode) {
    return '✍️ Dictado activo. Habla para escribir y di "borrar", "enter" o "listo" para terminar.';
  }

  return voiceProvider === 'openai' ? '🎧 Escuchando con IA...' : '🎤 Escuchando...';
}

function publishCommand(payload: VoiceCommandEvent) {
  sendToRenderer('voice:command', payload);
}

function emitError(message: string) {
  sendToRenderer('voice:error', message);
  updateStatus('error', message);
}

function readNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readOptionalIntEnv(name: string) {
  const raw = process.env[name]?.trim();
  if (!raw) return null;

  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function readBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on', 'si'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function readVoiceProviderEnv(): VoiceProvider {
  const raw = process.env.VOICE_PROVIDER?.trim().toLowerCase();
  if (raw === 'openai' || raw === 'remote' || raw === 'api') return 'openai';
  if (raw === 'local' || raw === 'whisper') return 'local';
  return process.env.OPENAI_API_KEY ? 'openai' : 'local';
}

function resolveExistingPath(candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveWhisperBinary() {
  const appBase = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return resolveExistingPath([
    process.env.WHISPER_BIN,
    path.join(process.cwd(), 'whisper.cpp', 'build', 'bin', 'whisper-stream'),
    path.join(process.cwd(), 'whisper.cpp', 'build', 'bin', 'stream'),
    path.join(appBase, 'whisper.cpp', 'build', 'bin', 'whisper-stream'),
    path.join(appBase, 'whisper.cpp', 'build', 'bin', 'stream'),
  ]);
}

function resolveWhisperModel() {
  const appBase = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return resolveExistingPath([
    process.env.WHISPER_MODEL,
    path.join(process.cwd(), 'models', 'ggml-base.bin'),
    path.join(process.cwd(), 'models', 'ggml-large-v3-turbo.bin'),
    path.join(process.cwd(), 'models', 'ggml-large-v3.bin'),
    path.join(appBase, 'models', 'ggml-base.bin'),
    path.join(appBase, 'models', 'ggml-large-v3-turbo.bin'),
    path.join(appBase, 'models', 'ggml-large-v3.bin'),
  ]);
}

const PHRASES: [string, CommandKey][] = [
  // Doble clic
  ['doble clic', 'double'],
  ['doble click', 'double'],
  ['double click', 'double'],
  ['doble toque', 'double'],
  ['abrir', 'double'],
  ['abre', 'double'],

  // Mantener / soltar click (drag & drop)
  ['agarrar clic', 'hold'],
  ['agarrar click', 'hold'],
  ['agarrar el clic', 'hold'],
  ['agarrar el click', 'hold'],
  ['mantener clic', 'hold'],
  ['mantener click', 'hold'],
  ['mantener el clic', 'hold'],
  ['mantener el click', 'hold'],
  ['mantener', 'hold'],
  ['mantener apretado', 'hold'],
  ['mantener presionado', 'hold'],
  ['mantener pulsado', 'hold'],
  ['sostener', 'hold'],
  ['sujetar', 'hold'],
  ['agarrar', 'hold'],
  ['arrastrar', 'hold'],
  ['arrastra', 'hold'],
  ['dejar apretado', 'hold'],

  ['soltar clic', 'release'],
  ['soltar click', 'release'],
  ['soltar el clic', 'release'],
  ['soltar el click', 'release'],
  ['soltar', 'release'],
  ['soltarlo', 'release'],
  ['liberar clic', 'release'],
  ['liberar click', 'release'],
  ['liberar', 'release'],
  ['soltalo', 'release'],
  ['suelta', 'release'],
  ['dejar', 'release'],
  ['deja', 'release'],
  ['dejar de arrastrar', 'release'],
  ['terminar arrastre', 'release'],

  // Click derecho
  ['clic derecho', 'right'],
  ['click derecho', 'right'],
  ['clique derecho', 'right'],
  ['clic secundario', 'right'],
  ['click secundario', 'right'],
  ['boton derecho', 'right'],
  ['botón derecho', 'right'],
  ['menu contextual', 'right'],
  ['menú contextual', 'right'],

  // Scroll con 2 palabras
  ['scroll arriba', 'scroll_up'],
  ['desplazar arriba', 'scroll_up'],
  ['scroll abajo', 'scroll_down'],
  ['desplazar abajo', 'scroll_down'],

  // Palabras sueltas
  ['doble', 'double'],

  ['derecha', 'right'],
  ['derecho', 'right'],
  ['menu', 'right'],
  ['menú', 'right'],
  ['contextual', 'right'],

  ['arriba', 'scroll_up'],
  ['subir', 'scroll_up'],

  ['abajo', 'scroll_down'],
  ['bajar', 'scroll_down'],

  ['click', 'left'],
  ['clic', 'left'],
  ['clique', 'left'],
  ['clic izquierdo', 'left'],
  ['click izquierdo', 'left'],
  ['boton izquierdo', 'left'],
  ['botón izquierdo', 'left'],
  ['izquierda', 'left'],
  ['izquierdo', 'left'],
  ['clik', 'left'],
  ['klik', 'left'],
  ['seleccionar', 'left'],
  ['selecciona', 'left'],

  ['activar autoclick', 'dwell_on'],
  ['activar auto click', 'dwell_on'],
  ['activar clic automatico', 'dwell_on'],
  ['activar click automatico', 'dwell_on'],
  ['activar permanencia', 'dwell_on'],

  ['desactivar autoclick', 'dwell_off'],
  ['desactivar auto click', 'dwell_off'],
  ['desactivar clic automatico', 'dwell_off'],
  ['desactivar click automatico', 'dwell_off'],
  ['desactivar permanencia', 'dwell_off'],

  ['pausar mouse', 'pause'],
  ['pausar cursor', 'pause'],
  ['pausar', 'pause'],
  ['pausa', 'pause'],
  ['detener', 'pause'],

  ['escribir', 'dictate'],
  ['escribe', 'dictate'],
  ['dictar', 'dictate'],
  ['dicta', 'dictate'],
  ['modo escritura', 'dictate'],
  ['modo dictado', 'dictate'],

  ['reanudar mouse', 'resume'],
  ['reanudar cursor', 'resume'],
  ['despausar mouse', 'resume'],
  ['despausar cursor', 'resume'],
  ['reanudar', 'resume'],
  ['reanuda', 'resume'],
  ['continuar', 'resume'],
  ['continua', 'resume'],
  ['seguir', 'resume'],
  ['sigue', 'resume'],

  ['ocultar ventana', 'hide_window'],
  ['esconder ventana', 'hide_window'],
  ['minimizar ventana', 'hide_window'],
  ['minimiza ventana', 'hide_window'],
  ['oculta ventana', 'hide_window'],

  ['mostrar ventana', 'show_window'],
  ['mostrar aplicacion', 'show_window'],
  ['mostrar app', 'show_window'],
  ['restaurar ventana', 'show_window'],
  ['restaura ventana', 'show_window'],
  ['abrir ventana', 'show_window'],

  ['cancelar', 'cancel'],
  ['salir', 'cancel'],
];

const LEFT_CLICK_ALIASES = new Set(['click', 'clic', 'clik', 'klik']);
const LEFT_CLICK_FUZZY_ALIASES = new Set(['clique']);
const NORMALIZED_PHRASES = PHRASES
  .map(([pattern, cmd]) => {
    const normalized = normalizeTranscriptForCommand(pattern);
    return {
      pattern: normalized,
      cmd,
      tokens: normalized.split(' ').filter(Boolean),
      score: normalized.length,
    };
  })
  .sort((a, b) => b.score - a.score);
const COMMAND_HINT_TOKENS = new Set(
  [...NORMALIZED_PHRASES.flatMap(({ tokens }) => tokens), ...LEFT_CLICK_ALIASES, ...LEFT_CLICK_FUZZY_ALIASES].filter((token) => token.length >= 3)
);
const TRANSCRIPT_CONTEXT_WINDOW_MS = readNumberEnv('VOICE_TRANSCRIPT_CONTEXT_MS', 1800);
const DUPLICATE_TRANSCRIPT_WINDOW_MS = readNumberEnv('VOICE_DUPLICATE_WINDOW_MS', 1200);
const REJECTED_TRANSCRIPT_WINDOW_MS = readNumberEnv('VOICE_REJECTED_WINDOW_MS', 6000);
const AMBIGUOUS_CLICK_DELAY_MS = readNumberEnv('VOICE_AMBIGUOUS_CLICK_DELAY_MS', 700);
const COMMAND_REPEAT_WINDOW_MS = readNumberEnv('VOICE_COMMAND_REPEAT_WINDOW_MS', 2800);
const FUZZY_COMMAND_TOKENS = [...new Set([
  ...COMMAND_HINT_TOKENS,
  'izquierdo',
  'izquierda',
  'doble',
  'derecho',
  'mantener',
  'soltar',
])];
const NOISE_PATTERNS = [
  /^(www|http|https)\b/,
  /\b(www|http|https)\b/,
  /\b(com|net|org|io)\b/,
  /\b(aplausos|susurro|blank audio)\b/,
];
const PROMPT_ECHO_PATTERNS = [
  /\bel audio pertenece a una app de accesibilidad\b/,
  /\bprefiere siempre estas palabras exactas\b/,
  /\bsi dudas entre una palabra ruidosa\b/,
  /\bcontexto?\b/,
];
const DICTATION_COMMIT_PHRASES = [
  'enter',
  'intro',
  'listo',
  'enviar',
  'manda',
  'mandar',
];
const DICTATION_DELETE_PHRASES = [
  'borrar',
  'borra',
  'borrar palabra',
  'borrar ultima palabra',
  'borra ultima palabra',
  'eliminar ultima palabra',
];
const DICTATION_CANCEL_PHRASES = [
  'cancelar escritura',
  'cancelar dictado',
  'salir de escritura',
  'salir de dictado',
  'terminar escritura',
  'terminar dictado',
];

function stripAnsi(text: string) {
  return text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, ' ')
    .replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F\u007F]/g, ' ');
}

function sanitizeWhisperLine(text: string) {
  const latestFrame = text.split('\r').pop() ?? text;

  return stripAnsi(latestFrame)
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^>>\s*/, '')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTranscript(text: string) {
  return sanitizeWhisperLine(text);
}

function normalizeTranscriptForCommand(text: string) {
  return stripAnsi(normalizeTranscript(text))
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeTranscript(text: string) {
  return normalizeTranscriptForCommand(text)
    .split(' ')
    .filter(Boolean)
    .map((token) => normalizeCommandToken(token));
}

function hasCommandHints(text: string) {
  const tokens = tokenizeTranscript(text);
  return tokens.some((token) => COMMAND_HINT_TOKENS.has(token));
}

function countDistinctCommandHints(text: string) {
  return new Set(tokenizeTranscript(text).filter((token) => COMMAND_HINT_TOKENS.has(token))).size;
}

function isSyntheticCatalogTranscript(text: string) {
  const normalized = normalizeTranscriptForCommand(text);
  if (!normalized) return true;

  if (PROMPT_ECHO_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const hintCount = countDistinctCommandHints(normalized);
  if (hintCount >= 5) return true;
  if (hintCount >= 4 && normalized.length >= 45) return true;

  return false;
}

function shouldIgnoreTranscript(text: string) {
  const normalized = normalizeTranscriptForCommand(text);
  if (!normalized) return true;

  if (isSyntheticCatalogTranscript(normalized)) return true;

  if (NOISE_PATTERNS.some((pattern) => pattern.test(normalized))) return true;

  const tokens = tokenizeTranscript(text);
  if (tokens.length === 0) return true;

  if (tokens.every((token) => token.length <= 2)) return true;

  if (tokens.length === 1 && !COMMAND_HINT_TOKENS.has(tokens[0]) && normalized.length <= 8) {
    return true;
  }

  return false;
}

function shouldIgnoreDictationTranscript(text: string) {
  const normalized = normalizeTranscriptForCommand(text);
  if (!normalized) return true;
  if (PROMPT_ECHO_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  if (/\b(blank audio|aplausos|susurro)\b/.test(normalized)) return true;
  return false;
}

function matchesPhraseGroup(normalized: string, phrases: string[]) {
  return phrases.some((phrase) => normalized === phrase || normalized.includes(phrase));
}

function extractInlineDictationText(text: string) {
  const cleaned = sanitizeWhisperLine(text).trim();
  const lowered = normalizeTranscriptForCommand(cleaned);
  const prefixes = ['escribir', 'escribe', 'dictar', 'dicta'];

  for (const prefix of prefixes) {
    if (lowered === prefix) {
      return '';
    }

    if (lowered.startsWith(`${prefix} `)) {
      return cleaned.split(/\s+/).slice(1).join(' ').trim();
    }
  }

  return '';
}

function normalizeDictationText(text: string) {
  return sanitizeWhisperLine(text)
    .replace(/\[(blank_audio|BLANK_AUDIO)\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(a: string, b: string) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }

  return dp[a.length][b.length];
}

function similarityScore(a: string, b: string) {
  if (!a || !b) return 0;
  const aa = a.replace(/\s+/g, '');
  const bb = b.replace(/\s+/g, '');
  if (!aa || !bb) return 0;

  const distance = levenshteinDistance(aa, bb);
  return 1 - distance / Math.max(aa.length, bb.length);
}

function fuzzyTokenThreshold(token: string) {
  if (token.length <= 4) return 0.84;
  if (token.length <= 6) return 0.8;
  if (token.length <= 8) return 0.76;
  return 0.72;
}

function findClosestCanonicalToken(token: string) {
  if (!token || token.length < 4) return null;

  let best: { token: string; score: number } | null = null;

  for (const candidate of FUZZY_COMMAND_TOKENS) {
    const score = similarityScore(token, candidate);
    if (!best || score > best.score) {
      best = { token: candidate, score };
    }
  }

  if (!best) return null;
  return best.score >= fuzzyTokenThreshold(best.token) ? best.token : null;
}

function normalizeCommandToken(token: string) {
  if (LEFT_CLICK_ALIASES.has(token) || LEFT_CLICK_FUZZY_ALIASES.has(token)) {
    return 'click';
  }

  if (token === 'manteli' || token === 'manteni' || token.startsWith('manten')) {
    return 'mantener';
  }

  if (token === 'sodar' || token === 'soldar' || token === 'solta' || token.startsWith('solt')) {
    return 'soltar';
  }

  if (token.startsWith('izquier')) {
    return 'izquierdo';
  }

  if (token.startsWith('derech') || token === 'direcho' || token === 'dereja') {
    return 'derecho';
  }

  if (token === 'bole') {
    return 'doble';
  }

  return findClosestCanonicalToken(token) ?? token;
}

function matchNormalizedCommand(normalized: string) {
  if (!normalized) return null;

  const originalTokens = normalized.split(' ').filter(Boolean);
  const tokens = originalTokens.map((token) => normalizeCommandToken(token));
  const tokenSet = new Set(tokens);
  const canonicalNormalized = tokens.join(' ');

  for (const phrase of NORMALIZED_PHRASES) {
    if (canonicalNormalized === phrase.pattern || normalized === phrase.pattern) {
      return {
        cmd: phrase.cmd,
        score: phrase.score + 2000,
      };
    }
  }

  for (const phrase of NORMALIZED_PHRASES) {
    if (phrase.tokens.length > 1 && (canonicalNormalized.includes(phrase.pattern) || normalized.includes(phrase.pattern))) {
      return {
        cmd: phrase.cmd,
        score: phrase.score + 1000,
      };
    }
  }

  for (const phrase of NORMALIZED_PHRASES) {
    if (phrase.tokens.every((token) => tokenSet.has(token))) {
      return {
        cmd: phrase.cmd,
        score: phrase.score + 500,
      };
    }
  }

  let bestFuzzy: { cmd: CommandKey; score: number } | null = null;
  for (const phrase of NORMALIZED_PHRASES) {
    const exactScore = Math.max(
      similarityScore(canonicalNormalized, phrase.pattern),
      similarityScore(normalized, phrase.pattern),
    );

    const threshold = phrase.tokens.length > 1 ? 0.72 : 0.8;
    if (exactScore < threshold) continue;

    const fuzzyMatch = {
      cmd: phrase.cmd,
      score: Math.round(exactScore * 100),
    };

    if (!bestFuzzy || fuzzyMatch.score > bestFuzzy.score) {
      bestFuzzy = fuzzyMatch;
    }
  }

  if (bestFuzzy) {
    return bestFuzzy;
  }

  if (tokens.some((token) => LEFT_CLICK_ALIASES.has(token) || token === 'click')) {
    return {
      cmd: 'left' as const,
      score: 10,
    };
  }

  return null;
}

function buildTranscriptCandidates(currentLine: string, timestamp: number) {
  if (isSyntheticCatalogTranscript(currentLine)) {
    recentTranscriptContext = [];
    return [];
  }

  recentTranscriptContext = recentTranscriptContext
    .filter((entry) => timestamp - entry.timestamp <= TRANSCRIPT_CONTEXT_WINDOW_MS)
    .filter((entry) => !isSyntheticCatalogTranscript(entry.text))
    .slice(-2);

  recentTranscriptContext.push({ text: currentLine, timestamp });

  const contextTexts = recentTranscriptContext.map((entry) => entry.text);
  const candidates = new Set<string>();

  for (let start = contextTexts.length - 1; start >= 0; start -= 1) {
    candidates.add(contextTexts.slice(start).join(' ').trim());
  }

  candidates.add(currentLine);
  return [...candidates]
    .map((candidate) => candidate.trim())
    .filter((candidate) => Boolean(candidate) && !isSyntheticCatalogTranscript(candidate))
    .sort((a, b) => b.length - a.length);
}

function candidatesHaveCommandHints(candidates: string[]) {
  return candidates.some((candidate) => hasCommandHints(candidate));
}

function findBestCommandCandidate(candidates: string[]) {
  let best: { cmd: CommandKey; score: number; transcript: string } | null = null;

  for (const candidate of candidates) {
    const match = matchNormalizedCommand(normalizeTranscriptForCommand(candidate));
    if (!match) continue;

    if (!best || match.score > best.score) {
      best = {
        cmd: match.cmd,
        score: match.score,
        transcript: candidate,
      };
    }
  }

  return best;
}

function clearPendingCommand() {
  if (pendingCommandTimer) {
    clearTimeout(pendingCommandTimer);
    pendingCommandTimer = null;
  }
  pendingCommand = null;
}

async function commitRecognizedCommand(cmd: CommandKey, transcription: string, timestamp: number) {
  lastCommandTimestamp = timestamp;
  recentTranscriptContext = [];
  lastExecutedCommand = {
    cmd,
    normalizedTranscript: normalizeTranscriptForCommand(transcription),
    timestamp,
  };
  publishCommand({
    transcription,
    recognized: true,
    action: cmd,
    message: `✓ ${cmd} ejecutado`,
    timestamp,
  });
  await executeCommand(cmd);
}

function isAmbiguousLeftCommand(cmd: CommandKey, transcription: string) {
  if (cmd !== 'left') return false;
  const tokens = normalizeTranscriptForCommand(transcription).split(' ').filter(Boolean);
  return tokens.length === 1 && (LEFT_CLICK_ALIASES.has(tokens[0]) || LEFT_CLICK_FUZZY_ALIASES.has(tokens[0]));
}

function schedulePendingCommand(cmd: CommandKey, transcription: string, timestamp: number) {
  clearPendingCommand();
  pendingCommand = {
    cmd,
    transcription,
    timestamp,
  };
  pendingCommandTimer = setTimeout(() => {
    const currentPending = pendingCommand;
    clearPendingCommand();
    if (!currentPending) return;
    void commitRecognizedCommand(currentPending.cmd, currentPending.transcription, Date.now()).catch((error) => {
      console.error('[voice] Error ejecutando comando pendiente:', error);
    });
  }, AMBIGUOUS_CLICK_DELAY_MS);
}

async function handleDictationLine(text: string, timestamp: number) {
  const normalized = normalizeTranscriptForCommand(text);

  if (matchesPhraseGroup(normalized, DICTATION_DELETE_PHRASES)) {
    publishCommand({
      transcription: text,
      recognized: true,
      action: 'delete_word',
      message: '✍️ Ultima palabra borrada',
      timestamp,
    });
    sendToRenderer('execute-command', {
      type: 'edit',
      action: 'delete_last_word',
    });
    return;
  }

  if (matchesPhraseGroup(normalized, DICTATION_COMMIT_PHRASES)) {
    dictationMode = false;
    publishCommand({
      transcription: text,
      recognized: true,
      action: 'submit_text',
      message: '✍️ Dictado finalizado',
      timestamp,
    });
    sendToRenderer('execute-command', {
      type: 'key',
      key: 'enter',
    });
    updateStatus('listening', voiceProvider === 'openai' ? '🎧 Escuchando con IA...' : '🎤 Escuchando...');
    return;
  }

  if (matchesPhraseGroup(normalized, DICTATION_CANCEL_PHRASES)) {
    dictationMode = false;
    publishCommand({
      transcription: text,
      recognized: true,
      action: 'cancel_text',
      message: '✍️ Dictado cancelado',
      timestamp,
    });
    updateStatus('listening', voiceProvider === 'openai' ? '🎧 Escuchando con IA...' : '🎤 Escuchando...');
    return;
  }

  const normalizedText = normalizeDictationText(text);
  if (!normalizedText) return;

  publishCommand({
    transcription: normalizedText,
    recognized: true,
    action: 'typed_text',
    message: '✍️ Texto escrito',
    timestamp,
  });
  sendToRenderer('execute-command', {
    type: 'text',
    text: normalizedText,
  });
  updateStatus('listening', '✍️ Dictado activo. Di "borrar", "enter" o "listo" para terminar.');
}

function getRuntimeVoiceProvider(): VoiceProvider {
  return readVoiceProviderEnv();
}

function getChunkFilename(mimeType: string, id: number) {
  if (mimeType.includes('webm')) return `voice-chunk-${id}.webm`;
  if (mimeType.includes('ogg')) return `voice-chunk-${id}.ogg`;
  if (mimeType.includes('mp4') || mimeType.includes('mpeg')) return `voice-chunk-${id}.mp4`;
  if (mimeType.includes('wav')) return `voice-chunk-${id}.wav`;
  return `voice-chunk-${id}.webm`;
}

async function transcribeOpenAIChunk(buffer: Buffer, mimeType: string, id: number) {
  if (!openai) {
    throw new Error('OpenAI no esta configurado');
  }

  const file = await toFile(buffer, getChunkFilename(mimeType, id), {
    type: mimeType || 'audio/webm',
  });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: OPENAI_TRANSCRIBE_MODEL,
    language: process.env.WHISPER_LANGUAGE ?? 'es',
    response_format: 'json',
  });

  return typeof transcription === 'string' ? transcription : transcription.text ?? '';
}

async function processQueuedAudioChunk() {
  if (isProcessingAudioChunk || !queuedAudioChunk || !running || isPaused || voiceProvider !== 'openai') {
    return;
  }

  const nextChunk = queuedAudioChunk;
  queuedAudioChunk = null;
  isProcessingAudioChunk = true;

  try {
    updateStatus('processing', '🧠 Interpretando tu voz...');
    const transcript = await transcribeOpenAIChunk(nextChunk.buffer, nextChunk.mimeType, nextChunk.id);
    const cleaned = sanitizeWhisperLine(transcript);
    if (cleaned) {
      await handleWhisperOutput(cleaned);
    }
  } catch (error: any) {
    console.error('[voice][openai] Error transcribiendo audio:', error);
    emitError(`❌ Error de transcripcion: ${error?.message ?? 'desconocido'}`);
  } finally {
    isProcessingAudioChunk = false;
    if (queuedAudioChunk) {
      void processQueuedAudioChunk();
    } else if (!isPaused && running) {
      updateStatus('listening', getListeningStatusMessage());
    }
  }
}

export async function submitVoiceChunk(buffer: Buffer, mimeType = 'audio/webm') {
  if (!running || isPaused || voiceProvider !== 'openai') {
    return { ok: false, accepted: false };
  }

  if (!buffer.length || buffer.length < 512) {
    return { ok: true, accepted: false };
  }

  queuedAudioChunk = {
    buffer,
    mimeType,
    createdAt: Date.now(),
    id: ++audioChunkSeq,
  };

  void processQueuedAudioChunk();
  return { ok: true, accepted: true };
}

const DEFAULT_VOICE_PROVIDER = readVoiceProviderEnv();
const OPENAI_API_AVAILABLE = !!process.env.OPENAI_API_KEY;
const USE_AI = readBooleanEnv('VOICE_USE_AI', DEFAULT_VOICE_PROVIDER === 'openai') && OPENAI_API_AVAILABLE;
const openai = OPENAI_API_AVAILABLE ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const OPENAI_TRANSCRIBE_MODEL = process.env.VOICE_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe';
const OPENAI_INTENT_MODEL = process.env.VOICE_INTENT_MODEL ?? 'gpt-4o-mini';
const OPENAI_CHUNK_MS = readNumberEnv('VOICE_CHUNK_MS', 950);

console.log('[voice][INIT] PROVIDER:', DEFAULT_VOICE_PROVIDER);
console.log('[voice][INIT] USE_AI:', USE_AI);
console.log('[voice][INIT] API Key presente:', OPENAI_API_AVAILABLE);

const ALLOWED_COMMANDS: CommandKey[] = [
  'left',
  'double',
  'right',
  'scroll_up',
  'scroll_down',
  'pause',
  'resume',
  'dictate',
  'hide_window',
  'show_window',
  'dwell_on',
  'dwell_off',
  'cancel',
  'hold',
  'release',
];

async function aiInferCommand(text: string, candidates: string[] = []): Promise<CommandKey | null> {
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
- "dictate"     → activar el modo escritura o dictado
- "hide_window" → minimizar u ocultar la ventana principal
- "show_window" → mostrar o restaurar la ventana principal
- "dwell_on"    → activar el autoclick por permanencia
- "dwell_off"   → desactivar el autoclick por permanencia
- "cancel"      → cancelar la acción de permanencia actual
- "hold"        → mantener apretado el botón izquierdo (drag start)
- "release"     → soltar el botón izquierdo (drag end)

Instrucciones IMPORTANTES:
- Si dice "click" o "clic" de forma aislada, clasifícalo como "left".
- Si el usuario dice algo como "agarrar clic", "mantener", "mantener el click", "dejalo apretado" o "arrastrar", clasifícalo como "hold".
- Si dice "soltar", "soltar clic", "liberar el click", "soltalo", "soltarlo" o "dejar", clasifícalo como "release".
- Si dice "clic derecho", "click secundario", "boton derecho" o "menu contextual", clasifícalo como "right".
- Si dice "activar autoclick", "activar click automatico" o "activar permanencia", clasifícalo como "dwell_on".
- Si dice "desactivar autoclick", "desactivar click automatico" o "desactivar permanencia", clasifícalo como "dwell_off".
- Si dice "escribir", "escribe", "dictar" o "modo escritura", clasifícalo como "dictate".
- Si dice "ocultar ventana", "minimizar ventana" o "esconder ventana", clasifícalo como "hide_window".
- Si dice "mostrar ventana", "restaurar ventana", "abrir ventana" o "mostrar aplicacion", clasifícalo como "show_window".
- Si el texto no expresa claramente uno de estos comandos, responde "none".

Responde SIEMPRE en JSON estricto, sin texto adicional, con este formato:
{"command": "left"}
o
{"command": "none"}
`;

    const payload = JSON.stringify({
      latest_text: trimmed,
      recent_candidates: candidates.slice(0, 4),
    });

    const resp = await openai.chat.completions.create({
      model: OPENAI_INTENT_MODEL,
      temperature: 0,
      max_tokens: 20,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: payload },
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
        sendToRenderer('execute-command', {
          type: 'system',
          action: 'pause_tracking',
        });
        statsCallback?.('⏸ Seguimiento pausado');
        updateStatus('listening', voiceProvider === 'openai' ? '🎧 Voz activa. Seguimiento pausado.' : '🎤 Voz activa. Seguimiento pausado.');
        break;

      case 'resume':
        sendToRenderer('execute-command', {
          type: 'system',
          action: 'resume_tracking',
        });
        statsCallback?.('▶ Seguimiento reanudado');
        updateStatus('listening', voiceProvider === 'openai' ? '🎧 Escuchando con IA...' : '🎤 Escuchando...');
        break;

      case 'dictate':
        dictationMode = true;
        statsCallback?.('✍️ Modo escritura activado');
        updateStatus('listening', '✍️ Dictado activo. Habla para escribir y di "listo" o "enter" para terminar.');
        break;

      case 'hide_window':
        if (hideMainWindow()) {
          statsCallback?.('🪟 Ventana minimizada');
        } else {
          throw new Error('No se pudo minimizar la ventana');
        }
        break;

      case 'show_window':
        if (showMainWindow()) {
          statsCallback?.('🪟 Ventana restaurada');
        } else {
          throw new Error('No se pudo restaurar la ventana');
        }
        break;

      case 'dwell_on':
        sendToRenderer('execute-command', {
          type: 'dwell',
          enabled: true,
        });
        statsCallback?.('✓ Autoclick activado');
        break;

      case 'dwell_off':
        sendToRenderer('execute-command', {
          type: 'dwell',
          enabled: false,
        });
        statsCallback?.('✓ Autoclick desactivado');
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
    return true;
  }

  statsCallback = onStats || null;
  running = true;
  isPaused = false;
  whisperStdoutBuffer = '';
  recentTranscriptContext = [];
  clearPendingCommand();
  lastObservedTranscript = null;
  lastRejectedTranscript = null;
  lastExecutedCommand = null;
  dictationMode = false;
  queuedAudioChunk = null;
  isProcessingAudioChunk = false;
  audioChunkSeq = 0;
  voiceProvider = getRuntimeVoiceProvider();

  console.log('[voice] Iniciando voz con proveedor:', voiceProvider);
  updateStatus('processing', voiceProvider === 'openai' ? '🧠 Preparando voz con OpenAI...' : '🎤 Iniciando reconocimiento local...');

  if (voiceProvider === 'openai') {
    if (!OPENAI_API_AVAILABLE || !openai) {
      console.error('[voice] Error: OPENAI_API_KEY ausente para voz remota');
      statsCallback?.('❌ Falta OPENAI_API_KEY para voz remota');
      emitError('❌ Falta OPENAI_API_KEY para voz remota');
      running = false;
      return false;
    }

    whisperProcess = null;
    updateStatus('listening', getListeningStatusMessage());
    statsCallback?.(`🎧 OpenAI listo (${OPENAI_TRANSCRIBE_MODEL})`);
    return true;
  }

  const whisperBin = resolveWhisperBinary();
  const modelPath = resolveWhisperModel();
  const voiceThreads = readNumberEnv('VOICE_THREADS', 6);
  const voiceStepMs = readNumberEnv('VOICE_STEP_MS', 600);
  const voiceLengthMs = readNumberEnv('VOICE_LENGTH_MS', 1400);
  const voiceKeepMs = readNumberEnv('VOICE_KEEP_MS', 100);
  const voiceMaxTokens = readNumberEnv('VOICE_MAX_TOKENS', 6);
  const voiceFreqThreshold = Number(process.env.VOICE_FREQ_THRESHOLD ?? '120');
  const voiceVadThreshold = Number(process.env.VOICE_VAD_THRESHOLD ?? '0.75');
  const voiceCaptureId = readOptionalIntEnv('VOICE_CAPTURE_ID');
  const whisperUseGpu = readBooleanEnv('WHISPER_USE_GPU', false);
  const modelBasename = modelPath ? path.basename(modelPath) : 'desconocido';

  if (!whisperBin) {
    console.error('[voice] Error: No se encontró whisper-stream en:', whisperBin);
    statsCallback?.('❌ Error: Whisper no compilado');
    emitError('❌ Whisper no compilado');
    running = false;
    return false;
  }

  if (!modelPath) {
    console.error('[voice] Error: No se encontró el modelo en:', modelPath);
    statsCallback?.('❌ Error: Modelo no descargado');
    emitError('❌ Modelo no descargado');
    running = false;
    return false;
  }

  if (!whisperUseGpu && /large/i.test(modelBasename)) {
    console.warn('[voice] Modelo grande detectado sin GPU:', modelBasename);
    statsCallback?.(`⚠️ ${modelBasename} en CPU puede tardar bastante. Usa ggml-base.bin para comandos rapidos.`);
  }

  const args = [
    '-m', modelPath,
    '-l', process.env.WHISPER_LANGUAGE ?? 'es',
    '-t', String(voiceThreads),
    '--step', String(voiceStepMs),
    '--length', String(voiceLengthMs),
    '--keep', String(voiceKeepMs),
    '-mt', String(voiceMaxTokens),
    '-vth', String(Number.isFinite(voiceVadThreshold) ? voiceVadThreshold : 0.75),
    '-fth', String(Number.isFinite(voiceFreqThreshold) ? voiceFreqThreshold : 120),
    '-ac', '512',
    '-kc',
  ];

  if (!whisperUseGpu) {
    args.push('-ng');
  }

  if (voiceCaptureId !== null) {
    args.push('-c', String(voiceCaptureId));
  } else {
    console.warn('[voice] VOICE_CAPTURE_ID no definido: Whisper usara el microfono predeterminado');
    statsCallback?.('ℹ️ Usando micro predeterminado. Configura VOICE_CAPTURE_ID si no coincide.');
  }

  console.log('[voice] Modelo:', modelBasename);
  console.log('[voice] Ejecutando:', whisperBin, args.join(' '));

  whisperProcess = spawn(whisperBin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  whisperProcess.stdout?.on('data', (chunk: Buffer) => {
    whisperStdoutBuffer += chunk.toString('utf-8');

    // whisper-stream suele emitir resultados parciales usando '\r' en lugar de '\n'.
    const parts = whisperStdoutBuffer.split(/\r?\n|\r/g);
    whisperStdoutBuffer = parts.pop() ?? '';

    const completedLines = parts
      .map((line) => sanitizeWhisperLine(line))
      .filter(Boolean);

    if (completedLines.length === 0) return;

    handleWhisperOutput(completedLines.join('\n')).catch((e) =>
      console.error('[voice] Error procesando salida Whisper:', e)
    );
  });

  whisperProcess.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim();
    if (!text) return;
    console.log('[voice][whisper]', text);
  });

  whisperProcess.on('error', (err) => {
    console.error('[voice] Error al iniciar Whisper:', err);
    statsCallback?.('❌ Error al iniciar Whisper');
    emitError('❌ Error al iniciar Whisper');
    running = false;
  });

  whisperProcess.on('exit', (code) => {
    const pendingLine = sanitizeWhisperLine(whisperStdoutBuffer);
    whisperStdoutBuffer = '';
    recentTranscriptContext = [];
    clearPendingCommand();
    lastObservedTranscript = null;
    lastRejectedTranscript = null;
    lastExecutedCommand = null;
    dictationMode = false;
    if (pendingLine) {
      handleWhisperOutput(pendingLine).catch((e) =>
        console.error('[voice] Error procesando salida Whisper pendiente:', e)
      );
    }

    console.log(`[voice] Whisper terminó con código ${code}`);
    running = false;
    whisperProcess = null;
    updateStatus('paused', '⏸ Voz detenida');
    statsCallback?.('🛑 Reconocimiento de voz detenido');
  });

  updateStatus('listening', getListeningStatusMessage());
  return true;
}

let lastCommandTimestamp = 0;
const COMMAND_COOLDOWN_MS = readNumberEnv('VOICE_COMMAND_COOLDOWN_MS', 1500);

async function handleWhisperOutput(raw: string) {
  const lines = raw.split('\n');
  
  const validLines = lines
    .map((line) => sanitizeWhisperLine(line))
    .filter(line => {
      if (!line) return false;
      
      if (line.startsWith('...') || line.startsWith('main:')) return false;
      
      if (line.length < 3) return false;
      
      if (/whisper_|ggml_|main:|processing|samples|lang =|task =/.test(line)) return false;

      if (line === '[Start speaking]') return false;
      if (/^#+\s*Transcription\b/.test(line)) return false;
      if (/^[¿?!.,"'`-]+$/.test(line)) return false;
      
      return true;
    });

  const uniqueLines = validLines.filter((line, idx, arr) => {
    if (idx === 0) return true; 
    return arr[idx - 1] !== line; 
  });

  for (const line of uniqueLines) {
    const now = Date.now();
    const ignoreCurrentLine = dictationMode
      ? shouldIgnoreDictationTranscript(line)
      : shouldIgnoreTranscript(line);

    if (ignoreCurrentLine) {
      console.log('[voice] Ignorando transcripcion sintetica o sin senal:', JSON.stringify(line));
      continue;
    }

    const normalizedLine = dictationMode
      ? normalizeTranscriptForCommand(line)
      : tokenizeTranscript(line).join(' ');

    if (
      normalizedLine &&
      lastObservedTranscript &&
      lastObservedTranscript.normalized === normalizedLine &&
      now - lastObservedTranscript.timestamp < DUPLICATE_TRANSCRIPT_WINDOW_MS
    ) {
      continue;
    }

    lastObservedTranscript = {
      normalized: normalizedLine,
      timestamp: now,
    };

    if (dictationMode) {
      console.log('[voice] Dictado recibido:', JSON.stringify(line));
      await handleDictationLine(line, now);
      continue;
    }

    if (
      normalizedLine &&
      lastExecutedCommand &&
      lastExecutedCommand.cmd !== 'resume' &&
      lastExecutedCommand.normalizedTranscript === normalizedLine &&
      now - lastExecutedCommand.timestamp < COMMAND_REPEAT_WINDOW_MS
    ) {
      console.log('[voice] Ignorando repeticion del ultimo comando:', JSON.stringify(line));
      continue;
    }

    console.log('[voice] Transcripcion recibida:', JSON.stringify(line));
    const candidates = buildTranscriptCandidates(line, now);
    const hasHints = candidatesHaveCommandHints(candidates);
    let commandToExecute: CommandKey | null = null;
    const ruleMatch = findBestCommandCandidate(candidates);
    const ruleCmd = ruleMatch?.cmd ?? null;
    const recognizedTranscription = ruleMatch?.transcript ?? line;

    if (ruleCmd) {
      if (ruleMatch && ruleMatch.transcript !== line) {
        console.log('[voice] ✅ Comando detectado por regla con contexto:', ruleCmd, '=>', JSON.stringify(ruleMatch.transcript));
      } else {
        console.log('[voice] ✅ Comando detectado por regla:', ruleCmd);
      }
      commandToExecute = ruleCmd;
    }

    if (isPaused && (ruleCmd === 'resume' || ruleCmd === 'dwell_on' || ruleCmd === 'dwell_off')) {
      clearPendingCommand();
      commandToExecute = ruleCmd;
    }

    if (!commandToExecute && USE_AI && !isPaused && (hasHints || tokenizeTranscript(line).length > 1)) {
      console.log('[voice] Intentando interpretar con IA...');
      const aiCmd = await aiInferCommand(line, candidates);
      if (aiCmd) {
        console.log('[voice] ✅ Comando detectado por IA:', aiCmd);
        commandToExecute = aiCmd;
      }
    }

    if (isPaused && commandToExecute !== 'resume' && commandToExecute !== 'dwell_on' && commandToExecute !== 'dwell_off') {
      console.log('[voice] Sistema pausado, esperando comando de reanudacion');
      publishCommand({
        transcription: line,
        recognized: false,
        message: 'Sistema pausado. Deci "reanudar" para continuar.',
        timestamp: now,
      });
      continue;
    }

    const bypassCooldown = commandToExecute
      ? ['resume', 'dictate', 'hide_window', 'show_window', 'pause'].includes(commandToExecute)
      : false;

    if (!bypassCooldown && now - lastCommandTimestamp < COMMAND_COOLDOWN_MS) {
      console.log('[voice] ⏳ Cooldown activo, ignorando comando');
      continue;
    }

    if (!commandToExecute) {
      if (
        lastRejectedTranscript &&
        lastRejectedTranscript.normalized === normalizedLine &&
        now - lastRejectedTranscript.timestamp < REJECTED_TRANSCRIPT_WINDOW_MS
      ) {
        continue;
      }

      lastRejectedTranscript = {
        normalized: normalizedLine,
        timestamp: now,
      };

      if (!hasHints) {
        console.log('[voice] Ignorando transcripcion sin senal de comando:', JSON.stringify(line));
        continue;
      }

      console.log('[voice] No se detectó un comando válido');
      publishCommand({
        transcription: line,
        recognized: false,
        message: '❓ Comando no reconocido',
        timestamp: now,
      });
      statsCallback?.('❓ Comando no reconocido');
      continue;
    }

    if (pendingCommand && commandToExecute !== pendingCommand.cmd) {
      clearPendingCommand();
    }

    lastRejectedTranscript = null;
    if (isAmbiguousLeftCommand(commandToExecute, recognizedTranscription)) {
      schedulePendingCommand(commandToExecute, recognizedTranscription, now);
      continue;
    }

    if (commandToExecute === 'dictate') {
      const inlineText = extractInlineDictationText(recognizedTranscription);
      await commitRecognizedCommand(commandToExecute, recognizedTranscription, now);
      if (inlineText) {
        await handleDictationLine(inlineText, Date.now());
      }
      continue;
    }

    await commitRecognizedCommand(commandToExecute, recognizedTranscription, now);
  }

  if (!isPaused) {
    updateStatus('listening', getListeningStatusMessage());
  }
}

export function stopVoice() {
  const proc = whisperProcess;

  if (!running) {
    console.log('[voice] No hay proceso de voz corriendo');
    return;
  }

  console.log('[voice] Deteniendo voz...');

  if (proc) {
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
  }

  whisperProcess = null;
  running = false;
  isPaused = false;
  queuedAudioChunk = null;
  isProcessingAudioChunk = false;
  recentTranscriptContext = [];
  clearPendingCommand();
  lastObservedTranscript = null;
  lastRejectedTranscript = null;
  lastExecutedCommand = null;
  dictationMode = false;
  updateStatus('paused', '⏸ Voz detenida');
  statsCallback?.('🛑 Comandos de voz detenidos');
}

export function pauseVoice() {
  if (!running) return;
  if (!isPaused) {
    isPaused = true;
    dictationMode = false;
    sendToRenderer('toggle-pause');
    updateStatus('paused', '⏸ Voz pausada');
  }
}

export function resumeVoice() {
  if (!running) return;
  if (isPaused) {
    isPaused = false;
    sendToRenderer('toggle-pause');
    updateStatus('listening', getListeningStatusMessage());
  }
}

export function getVoiceStats() {
  const effectiveProvider = running ? voiceProvider : getRuntimeVoiceProvider();
  return {
    running,
    paused: isPaused,
    provider: effectiveProvider,
    chunkMs: OPENAI_CHUNK_MS,
    requiresRendererCapture: effectiveProvider === 'openai',
    useAI: USE_AI,
    transcribeModel: OPENAI_TRANSCRIBE_MODEL,
    intentModel: OPENAI_INTENT_MODEL,
  };
}
