import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
let running = false;
let isPaused = false;
const COMMANDS = {
    left: { synonyms: ['clic', 'click', 'seleccionar', 'elegir', 'hacer clic'] },
    double: { synonyms: ['doble clic', 'doble click', 'abrir', 'ejecutar'] },
    right: { synonyms: ['clic derecho', 'click derecho', 'menú', 'opciones', 'contextual'] },
    down: { synonyms: ['arrastrar', 'mantener', 'tomar', 'agarrar'] },
    up: { synonyms: ['soltar', 'dejar', 'liberar'] },
    scroll_up: { synonyms: ['scroll arriba', 'subir', 'página arriba'] },
    scroll_down: { synonyms: ['scroll abajo', 'bajar', 'página abajo'] },
    pause: { synonyms: ['pausa', 'pausar', 'detener'] },
    resume: { synonyms: ['reanudar', 'continuar', 'seguir'] },
    cancel: { synonyms: ['cancelar', 'anular'] }
};
const stats = { total: 0, successful: 0, failed: 0, lastCommand: null, lastTimestamp: null };
export function initVoice() {
    ipcMain.handle('voice:toggle', async (_e, on) => {
        running = on;
        if (running && !isPaused)
            startLoop().catch(console.error);
        return running;
    });
    ipcMain.handle('voice:pause', async () => { isPaused = true; notify('voice:status', { state: 'paused', message: '⏸ Sistema en pausa' }); return true; });
    ipcMain.handle('voice:resume', async () => { isPaused = false; notify('voice:status', { state: 'listening', message: '🎤 Escuchando...' }); if (running)
        startLoop().catch(console.error); return true; });
    ipcMain.handle('voice:stats', async () => stats);
}
function getWin() { return BrowserWindow.getAllWindows()[0] || null; }
function notify(ch, data) { const w = getWin(); w?.webContents.send(ch, data); }
async function startLoop() {
    notify('voice:status', { state: 'listening', message: '🎤 Escuchando...' });
    while (running && !isPaused) {
        try {
            const tmp = path.join(os.tmpdir(), `voice_${Date.now()}.wav`);
            await recordWav(tmp, 2);
            if (fs.existsSync(tmp)) {
                const text = await transcribe(tmp);
                fs.unlinkSync(tmp);
                if (text)
                    await dispatch(text);
            }
        }
        catch (e) {
            notify('voice:error', String(e));
        }
        await new Promise(r => setTimeout(r, 80));
    }
    if (isPaused)
        notify('voice:status', { state: 'paused', message: '⏸ Sistema en pausa' });
}
function recordWav(outPath, seconds) {
    return new Promise((resolve) => {
        const sox = spawn('sox', ['-d', '-r', '16000', '-c', '1', '-b', '16', outPath, 'trim', '0', String(seconds)]);
        sox.on('close', () => resolve());
        sox.on('error', () => resolve());
    });
}
async function transcribe(file) {
    const whisperBin = app.isPackaged
        ? path.join(process.resourcesPath, '..', 'whisper.cpp', 'build', 'bin', 'main')
        : path.join(app.getAppPath(), 'whisper.cpp', 'build', 'bin', 'main');
    const model = app.isPackaged
        ? path.join(process.resourcesPath, 'models', 'ggml-base.bin')
        : path.join(app.getAppPath(), 'assets', 'models', 'ggml-base.bin');
    if (!fs.existsSync(whisperBin) || !fs.existsSync(model))
        return '';
    return new Promise((resolve) => {
        const p = spawn(whisperBin, ['-m', model, '-f', file, '--language', 'es', '--no-timestamps']);
        let out = '';
        p.stdout?.on('data', d => out += d.toString());
        p.stderr?.on('data', d => console.error('whisper:', d.toString()));
        p.on('close', (code) => {
            if (code === 0) {
                const txt = out.split('\n').filter(l => l.trim() && !l.includes('[')).join(' ').trim().toLowerCase();
                resolve(txt);
            }
            else
                resolve('');
        });
        p.on('error', () => resolve(''));
    });
}
function findCommand(text) {
    const norm = text.toLowerCase();
    let mag = 1;
    const m = norm.match(/\d+/);
    if (m)
        mag = parseInt(m[0], 10) || 1;
    for (const key of Object.keys(COMMANDS)) {
        for (const syn of COMMANDS[key].synonyms) {
            if (norm.includes(syn))
                return { key, magnitude: (key === 'scroll_up' || key === 'scroll_down') ? mag : undefined };
        }
    }
    return null;
}
async function dispatch(text) {
    stats.total++;
    const cmd = findCommand(text);
    if (!cmd) {
        stats.failed++;
        notify('voice:command', { recognized: false, transcription: text, message: '❌ Comando no reconocido' });
        return;
    }
    stats.lastCommand = cmd.key;
    stats.lastTimestamp = Date.now();
    const w = getWin();
    if (!w)
        return;
    notify('voice:status', { state: 'processing', message: '🔄 Procesando...' });
    switch (cmd.key) {
        case 'left':
            w.webContents.send('execute-command', { type: 'click', button: 'left' });
            break;
        case 'double':
            w.webContents.send('execute-command', { type: 'click', button: 'double' });
            break;
        case 'right':
            w.webContents.send('execute-command', { type: 'click', button: 'right' });
            break;
        case 'down':
            w.webContents.send('execute-command', { type: 'mouse', action: 'down' });
            break;
        case 'up':
            w.webContents.send('execute-command', { type: 'mouse', action: 'up' });
            break;
        case 'scroll_up':
            w.webContents.send('execute-command', { type: 'scroll', delta: 120 * (cmd.magnitude ?? 1) });
            break;
        case 'scroll_down':
            w.webContents.send('execute-command', { type: 'scroll', delta: -120 * (cmd.magnitude ?? 1) });
            break;
        case 'pause':
            isPaused = true;
            notify('voice:status', { state: 'paused', message: '⏸ Sistema en pausa' });
            break;
        case 'resume':
            isPaused = false;
            notify('voice:status', { state: 'listening', message: '🎤 Escuchando...' });
            break;
        case 'cancel':
            w.webContents.send('execute-command', { type: 'system', action: 'cancel' });
            break;
    }
    notify('voice:command', {
        recognized: true,
        action: cmd.key,
        magnitude: cmd.magnitude,
        transcription: text,
        message: `✓ ${cmd.key} ejecutado`
    });
    notify('voice:status', { state: 'listening', message: '🎤 Escuchando...' });
}
