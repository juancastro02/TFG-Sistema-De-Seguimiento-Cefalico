import { app, BrowserWindow, ipcMain, screen, globalShortcut } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPythonMouseDriver, PythonMouseDriver } from './native-driver.js';
import { initStore } from './storage/store.js';
import { initVoice, stopVoice, pauseVoice, resumeVoice, getVoiceStats } from './voice/voice.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let ipcRegistered = false;
let native: PythonMouseDriver | null = null;
let controlEnabled = true;

function safeHandle(channel: string, handler: Parameters<typeof ipcMain.handle>[1]) {
    try { ipcMain.handle(channel, handler); }
    catch { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler); }
}

function registerIpcHandlersOnce() {
    if (ipcRegistered) return;
    ipcRegistered = true;

    // Utilidades de pantalla
    safeHandle('native:getScreenSize', () => {
        const d = screen.getPrimaryDisplay();
        return { width: d.workAreaSize.width, height: d.workAreaSize.height };
    });

    // Toggle enable
    safeHandle('native:getEnabled', () => controlEnabled);
    safeHandle('native:setEnabled', (_e, v: boolean) => {
        controlEnabled = !!v;
        mainWindow?.webContents.send('native:enabled-changed', controlEnabled);
        return controlEnabled;
    });

    // Acciones de mouse -> Python
    safeHandle('native:move', async (_e, { x, y }: { x: number; y: number }) => {
        if (!native || !controlEnabled) return false;
        await native.move(x, y);
        return true;
    });

    safeHandle('native:click', async (_e, { button }: { button?: 'left' | 'right' | 'middle' }) => {
        if (!native || !controlEnabled) return false;
        await native.click(button ?? 'left');
        return true;
    });

    safeHandle('native:mouseDown', async (_e, { button }: { button?: 'left' | 'right' | 'middle' }) => {
        if (!native || !controlEnabled) return false;
        await native.down(button ?? 'left');
        return true;
    });

    safeHandle('native:mouseUp', async (_e, { button }: { button?: 'left' | 'right' | 'middle' }) => {
        if (!native || !controlEnabled) return false;
        await native.up(button ?? 'left');
        return true;
    });

    safeHandle('native:scroll', async (_e, { dx = 0, dy = 0 }: { dx?: number; dy?: number }) => {
        if (!native || !controlEnabled) return false;
        await native.scroll(dx, dy);
        return true;
    });

    safeHandle('voice:toggle', async (_ev, enabled: boolean) => {
        console.log('[IPC] voice:toggle', enabled);
        try {
            if (enabled) {
                const onStats = (msg: string) => {
                    mainWindow?.webContents.send('voice:stats', { message: msg });
                };
                initVoice(onStats);
                return { ok: true };
            } else {
                stopVoice();
                return { ok: true };
            }
        } catch (e: any) {
            console.error('[voice:toggle] Error:', e);
            return { ok: false, error: e.message };
        }
    });

    safeHandle('voice:pause', async () => {
        console.log('[IPC] voice:pause');
        pauseVoice();
        return { ok: true };
    });

    safeHandle('voice:resume', async () => {
        console.log('[IPC] voice:resume');
        resumeVoice();
        return { ok: true };
    });

    safeHandle('voice:stats', async () => {
        return getVoiceStats();
    });

    safeHandle('native:mouse', async () => false);
}

function registerShortcuts() {
    const pauseShortcut = process.platform === 'darwin' ? 'Command+Shift+P' : 'Control+Shift+P';
    const voiceShortcut = process.platform === 'darwin' ? 'Command+Shift+V' : 'Control+Shift+V';
    globalShortcut.register(pauseShortcut, () => mainWindow?.webContents.send('toggle-pause'));
    globalShortcut.register(voiceShortcut, () => mainWindow?.webContents.send('toggle-voice'));
    globalShortcut.register('Escape', () => mainWindow?.webContents.send('cancel-dwell'));
}

async function createWindow() {
    if (mainWindow) { mainWindow.focus(); return; }

    const preloadPath = app.isPackaged
        ? path.join(__dirname, 'preload.cjs')
        : path.join(process.cwd(), 'src', 'preload.cjs');

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'Sistema de control de ordenador mediante seguimiento cefálico y comandos de voz',
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            backgroundThrottling: false,
        },
    });

    try {
        if (!app.isPackaged) await mainWindow.loadURL('http://localhost:5173');
        else await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    } catch (err) {
        console.error('Failed to load renderer:', err);
    }

    mainWindow.on('minimize', () => {
        console.log('[main] Ventana minimizada, sistema sigue activo');
    });

    mainWindow.on('restore', () => {
        console.log('[main] Ventana restaurada');
    });

    registerShortcuts();
    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
    registerIpcHandlersOnce();
    initStore();                     // IPC perfiles
    try {
        native = await getPythonMouseDriver();
    } catch (e: any) {
        console.error('No se pudo iniciar el driver Python:', e);
        try {
            const { dialog } = await import('electron');
            dialog.showErrorBox('Driver nativo', String(e?.message ?? e));
        } catch { }
    }

    initVoice();                     // IPC voz
    await createWindow();

    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) await createWindow();
    });
});

app.on('window-all-closed', () => {
    globalShortcut.unregisterAll();
    try { native?.dispose(); } catch { }
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    try { native?.dispose(); } catch { }
});
