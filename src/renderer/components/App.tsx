import React, { useEffect, useRef, useState, useCallback } from 'react';
import CalibrationWizard from './CalibrationWizard.js';
import ProfileManager from './ProfileManager.js';
import VoicePanel from './VoicePanel.js';
import DwellRing from './DwellRing.js';
import {
  startHeadTracking,
  stopHeadTracking,
  applyCalibration,
  captureNeutralFromCurrent,
} from '../../tracking/headTracker.js';
import '../styles.css';

type Tab = 'uso' | 'calibracion' | 'perfiles' | 'voz';
type Notification = { id: number; message: string; type: 'info' | 'success' | 'error' };

type VoiceStatus = {
  state: 'listening' | 'processing' | 'paused' | 'error';
  message: string;
};

export default function App() {
  const [tab, setTab] = useState<Tab>('uso');
  const [enabled, setEnabled] = useState(true);
  const [pose, setPose] = useState<{ nx: number; ny: number } | null>(null);
  const [dwellMs, setDwellMs] = useState(1000);
  const [isStable, setIsStable] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>({
    state: 'paused',
    message: '⏸',
  });
  const [isMinimized, setIsMinimized] = useState(false);
  const [isExecutingCommand, setIsExecutingCommand] = useState(false);

  const videoRefForTracking = useRef<HTMLVideoElement>(null);
  const notifId = useRef(0);
  const enabledRef = useRef(enabled);

  const showNotification = (message: string, type: Notification['type'] = 'info') => {
    const id = ++notifId.current;
    setNotifications((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 3000);
  };

  useEffect(() => {
    let mounted = true;
    window.native.getEnabled().then((v: any) => {
      if (mounted) setEnabled(!!v);
    });
    window.native.onEnabledChanged((v: boolean) => {
      setEnabled(v);
      showNotification(v ? 'Seguimiento activo' : 'Seguimiento pausado', v ? 'success' : 'info');
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const stableTick = (() => {
    let last: { x: number; y: number } | null = null;
    let timer: any;
    return (nx: number, ny: number) => {
      if (!last) last = { x: nx, y: ny };
      const dist = Math.hypot(nx - last.x, ny - last.y);
      if (dist < 0.015) {
        clearTimeout(timer);
        timer = setTimeout(() => setIsStable(true), 400);
      } else {
        setIsStable(false);
        last = { x: nx, y: ny };
      }
    };
  })();

  useEffect(() => {
    if (!videoRefForTracking.current) return;

    const video = videoRefForTracking.current;
    let cancelled = false;

    const boot = async () => {
      try {
        await startHeadTracking(video, (nx: number, ny: number) => {
          if (cancelled) return;

          if (!enabledRef.current) {
            setIsStable(false);
            return;
          }

          setPose({ nx, ny });
          stableTick(nx, ny);
        });
      } catch (e) {
        console.error('Error iniciando head tracking:', e);
      }
    };

    boot();

    return () => {
      cancelled = true;
      try {
        stopHeadTracking();
      } catch (e) {
        console.warn('Error al detener head tracking:', e);
      }
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsMinimized(document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const toggleVoice = useCallback(async () => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    await window.api.voiceToggle(next);
    showNotification(next ? 'Voz activada' : 'Voz desactivada', 'info');
  }, [voiceEnabled]);

  useEffect(() => {
    const execHandler = (payload: any) => {
      if (!payload) return;
      
      if (isExecutingCommand) {
        console.log('[App] Ignorando comando, ya hay uno ejecutándose');
        return;
      }

      setIsExecutingCommand(true);
      setIsStable(false); 
      if (payload.type === 'click') {
        if (payload.button === 'double') {
          window.native
            .click('left')
            .then(() => window.native.click('left'))
            .then(() => {
              setTimeout(() => setIsExecutingCommand(false), 500); 
            })
            .catch((e: unknown) => {
              console.error('[App] Error en doble clic:', e);
              setIsExecutingCommand(false);
            });
        } else {
          window.native
            .click(payload.button)
            .then(() => {
              setTimeout(() => setIsExecutingCommand(false), 500); 
            })
            .catch((e: unknown) => {
              console.error('[App] Error en clic:', e);
              setIsExecutingCommand(false);
            });
        }
        showNotification(`Clic ${payload.button} ejecutado`, 'success');
      } else if (payload.type === 'scroll') {
        window.native
          .scroll(0, payload.delta || 0)
          .then(() => {
            setTimeout(() => setIsExecutingCommand(false), 300);
          })
          .catch((e: unknown) => {
            console.error('[App] Error en scroll:', e);
            setIsExecutingCommand(false);
          });
        showNotification('Desplazamiento ejecutado', 'success');
      } else if (payload.type === 'system' && payload.action === 'cancel') {
        setIsStable(false);
        setIsExecutingCommand(false);
        showNotification('Acción cancelada', 'info');
      }
      else if (payload.type === 'hold') {
        window.native
          .mouseDown('left')
          .then(() => {
            setTimeout(() => setIsExecutingCommand(false), 300);
          })
          .catch((e: unknown) => {
            console.error('[App] Error en hold:', e);
            setIsExecutingCommand(false);
          });
        showNotification('🖱️ Manteniendo clic...', 'info');
      }
      else if (payload.type === 'release') {
        window.native
          .mouseUp('left')
          .then(() => {
            setTimeout(() => setIsExecutingCommand(false), 300);
          })
          .catch((e: unknown) => {
            console.error('[App] Error en release:', e);
            setIsExecutingCommand(false);
          });
        showNotification('✋ Clic soltado', 'success');
      } else {
        setIsExecutingCommand(false);
      }
    };

    const statusHandler = (payload: VoiceStatus) => {
      setVoiceStatus(payload);
    };

    const errorHandler = (payload: unknown) => {
      let text: string;

      if (typeof payload === 'string') {
        text = payload;
      } else if (payload instanceof Error) {
        text = payload.message;
      } else {
        try {
          text = JSON.stringify(payload);
        } catch {
          text = String(payload);
        }
      }

      setVoiceStatus({ state: 'error', message: text });
      showNotification('Error de voz: ' + text, 'error');
    };

    const togglePauseHandler = () => {
      window.native.getEnabled().then((v: boolean) => {
        window.native.setEnabled(!v);
      });
    };

    const toggleVoiceHandler = () => {
      toggleVoice();
    };

    const cancelDwellHandler = () => {
      setIsStable(false);
      showNotification('Permanencia cancelada', 'info');
    };

    const ipcRenderer = (window as any).api?.ipcRenderer;
    if (ipcRenderer?.setMaxListeners) {
      ipcRenderer.setMaxListeners(20);
    }

    const unsubscribers: (() => void)[] = [];

    unsubscribers.push(window.api.on('execute-command', execHandler) as any);
    unsubscribers.push(window.api.on('voice:status', statusHandler) as any);
    unsubscribers.push(window.api.on('voice:error', errorHandler) as any);
    unsubscribers.push(window.api.on('toggle-pause', togglePauseHandler) as any);
    unsubscribers.push(window.api.on('toggle-voice', toggleVoiceHandler) as any);
    unsubscribers.push(window.api.on('cancel-dwell', cancelDwellHandler) as any);

    return () => {
      window.api.off('execute-command', execHandler);
      window.api.off('voice:status', statusHandler);
      window.api.off('voice:error', errorHandler);
      window.api.off('toggle-pause', togglePauseHandler);
      window.api.off('toggle-voice', toggleVoiceHandler);
      window.api.off('cancel-dwell', cancelDwellHandler);
    };
  }, [toggleVoice, isExecutingCommand]);

  const onCalibrationDone = async (data: any) => {
    setDwellMs(data.dwellMs);
    applyCalibration({
      sensitivity: data.sensitivity,
      gain: data.gain,
      deadzone: data.deadzone,
      maxSpeed: data.maxSpeed,
    });
    captureNeutralFromCurrent();
    await window.api.applyProfile(data);
    setTab('uso');
    showNotification('Perfil de parámetros activo', 'success');
  };

  useEffect(() => {
    if (tab !== 'uso') {
      setIsStable(false);
    }
  }, [tab]);

  return (
    <div className="app-root">
      {isMinimized && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            background: 'rgba(59, 130, 246, 0.9)',
            color: 'white',
            padding: '8px',
            textAlign: 'center',
            fontSize: '13px',
            fontWeight: 600,
            zIndex: 10000,
          }}
        >
          🎯 Sistema activo en segundo plano
        </div>
      )}

      <video
        ref={videoRefForTracking}
        muted
        playsInline
        autoPlay
        style={{
          position: 'fixed',
          right: tab === 'uso' ? 16 : -9999, 
          top: 16,
          width: 200,
          height: 150,
          borderRadius: 12,
          border: '2px solid rgba(255,255,255,0.08)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          transform: 'scaleX(-1)',
          zIndex: 40,
        }}
      />
      {tab === 'uso' && (
        <div
          className="pip-label"
          style={{
            position: 'fixed',
            right: 24,
            top: 24,
            background: 'rgba(0,0,0,0.6)',
            color: 'white',
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            backdropFilter: 'blur(8px)',
            zIndex: 41,
          }}
        >
          Cámara
        </div>
      )}

      <div className={`status-indicator ${enabled ? 'active' : 'paused'}`}>
        <span className="status-icon">{enabled ? '●' : '⏸'}</span>
        <span className="status-text">{enabled ? 'Activo' : 'En pausa'}</span>
      </div>

      <div className={'mic-badge ' + voiceStatus.state} title={voiceStatus.message}>
        {voiceStatus.state === 'listening'
          ? '🎙️'
          : voiceStatus.state === 'processing'
          ? '🔄'
          : voiceStatus.state === 'paused'
          ? '⏸'
          : '❌'}
        <span className="mic-text">{voiceStatus.message}</span>
      </div>

      <div className="notifications-zone">
        {notifications.map((n) => (
          <div key={n.id} className={`notification notification-${n.type}`}>
            <span className="notif-icon">
              {n.type === 'success' ? '✓' : n.type === 'error' ? '✗' : 'ℹ'}
            </span>
            <span className="notif-message">{n.message}</span>
          </div>
        ))}
      </div>

      <div className="quick-actions">
        <button
          className="quick-btn"
          onClick={async () => {
            const next = !enabled;
            await window.native.setEnabled(next);
          }}
          title="Pausar/Reanudar (Cmd+Shift+P)"
        >
          {enabled ? '⏸' : '▶️'}
        </button>
        <button
          className="quick-btn"
          onClick={() => setTab('calibracion')}
          title="Configuración"
        >
          ⚙️
        </button>
      </div>

      <div className="content">
        {tab === 'uso' && (
          <UseOverlay pose={pose} dwellMs={dwellMs} isEnabled={enabled} isStable={isStable} />
        )}

        {tab === 'calibracion' && (
          <CalibrationWizard
            onComplete={(d) => onCalibrationDone(d)}
            onCancel={() => setTab('uso')}
          />
        )}

        {tab === 'perfiles' && <ProfileManager onClose={() => setTab('uso')} />}

        {tab === 'voz' && (
          <div className="center">
            <VoicePanel
              enabled={voiceEnabled}
              status={voiceStatus}
              commandHistory={[]}
              onToggle={toggleVoice}
            />
          </div>
        )}
      </div>

      <nav className="tabs">
        <button className={tab === 'uso' ? 'active' : ''} onClick={() => setTab('uso')}>
          <span className="tab-icon">👁️</span>
          <span className="tab-label">Uso</span>
        </button>
        <button
          className={tab === 'calibracion' ? 'active' : ''}
          onClick={() => setTab('calibracion')}
        >
          <span className="tab-icon">⚙️</span>
          <span className="tab-label">Calibración</span>
        </button>
        <button
          className={tab === 'perfiles' ? 'active' : ''}
          onClick={() => setTab('perfiles')}
        >
          <span className="tab-icon">👤</span>
          <span className="tab-label">Perfiles</span>
        </button>
        <button className={tab === 'voz' ? 'active' : ''} onClick={() => setTab('voz')}>
          <span className="tab-icon">🎤</span>
          <span className="tab-label">Voz</span>
        </button>
      </nav>
    </div>
  );
}

function UseOverlay({
  pose,
  dwellMs,
  isEnabled,
  isStable,
}: {
  pose: { nx: number; ny: number } | null;
  dwellMs: number;
  isEnabled: boolean;
  isStable: boolean;
}) {
  const [cursor, setCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  
  const [shouldShowDwell, setShouldShowDwell] = useState(false);

  useEffect(() => {
    let mounted = true;
    const upd = async () => {
      if (!pose) return;
      const { width, height } = await window.native.getScreenSize();
      const x = Math.round(pose.nx * (width - 1));
      const y = Math.round(pose.ny * (height - 1));
      if (mounted) setCursor({ x, y });
    };
    upd();
    return () => {
      mounted = false;
    };
  }, [pose?.nx, pose?.ny]);

  useEffect(() => {
    if (isEnabled && isStable && pose) {
      setShouldShowDwell(true);
    } else {
      setShouldShowDwell(false);
    }
  }, [isEnabled, isStable, pose]);

  return (
    <>
      {shouldShowDwell && (
        <DwellRing
          cursorX={cursor.x}
          cursorY={cursor.y}
          dwellMs={dwellMs}
          isPaused={!isEnabled}
          isStable={isStable}
          enabled={true}
        />
      )}

      <div className="hint">
        <div className="hint-title">💡 Interfaz de uso</div>
        <ul className="hint-list">
          <li>
            Al estabilizarse sobre un objetivo, el <strong>anillo de permanencia</strong> completa la cuenta
          </li>
          <li>Si la permanencia no se cumple, el anillo se reinicia sin accionar</li>
          <li>
            Presioná <kbd>Esc</kbd> para cancelar la permanencia
          </li>
          <li>
            Presioná <kbd>Cmd+Shift+P</kbd> para pausar/reanudar
          </li>
          <li>Usá comandos de voz: "clic", "doble clic", "menú", "scroll arriba/abajo"</li>
        </ul>
      </div>
    </>
  );
}
