import React, { useCallback, useEffect, useRef, useState } from 'react';
import CalibrationWizard from './CalibrationWizard.js';
import ProfileManager from './ProfileManager.js';
import VoicePanel from './VoicePanel.js';
import DwellRing from './DwellRing.js';
import { applyCalibration, setDwellClickEnabled, startHeadTracking, stopHeadTracking } from '../../tracking/headTracker.js';
import { createProfile, DEFAULT_PROFILE_VALUES, type Profile } from '../../types/profile.js';
import '../styles.css';

type Tab = 'uso' | 'calibracion' | 'perfiles' | 'voz';
type Notification = { id: number; message: string; type: 'info' | 'success' | 'error' };
type VoiceStatus = { state: 'listening' | 'processing' | 'paused' | 'error'; message: string };
type VoiceCommand = {
  action?: string;
  transcription: string;
  recognized: boolean;
  message: string;
  timestamp: number;
};
type Pose = { nx: number; ny: number } | null;
type MicCaptureState = 'idle' | 'requesting' | 'streaming' | 'error';

const MAX_COMMAND_HISTORY = 20;
const MIN_VOICE_RMS = 0.012;
const MAX_SPEECH_WINDOW_MS = 1800;
const SPEECH_END_SILENCE_MS = 320;
const INITIAL_VOICE_RUNTIME: VoiceRuntimeInfo = {
  running: false,
  paused: true,
  provider: 'local',
  chunkMs: 950,
  requiresRendererCapture: false,
  useAI: false,
  transcribeModel: 'gpt-4o-mini-transcribe',
  intentModel: 'gpt-4o-mini',
};
const WAV_SAMPLE_RATE = 16000;
const QUICK_COMMANDS = [
  'clic',
  'clic derecho',
  'doble clic',
  'escribir',
  'borrar',
  'listo',
  'mantener',
  'soltar',
  'scroll arriba',
  'scroll abajo',
  'ocultar ventana',
  'mostrar ventana',
  'activar autoclick',
  'pausar mouse',
];
const ACTION_LABELS: Record<string, string> = {
  left: 'Clic izquierdo',
  double: 'Doble clic',
  right: 'Clic derecho',
  scroll_up: 'Scroll arriba',
  scroll_down: 'Scroll abajo',
  pause: 'Pausar mouse',
  resume: 'Reanudar mouse',
  dictate: 'Modo escritura',
  typed_text: 'Texto escrito',
  delete_word: 'Borrar ultima palabra',
  submit_text: 'Confirmar dictado',
  cancel_text: 'Cancelar dictado',
  hide_window: 'Ocultar ventana',
  show_window: 'Mostrar ventana',
  dwell_on: 'Activar autoclick',
  dwell_off: 'Desactivar autoclick',
  cancel: 'Cancelar',
  hold: 'Mantener clic',
  release: 'Soltar clic',
};
const TAB_SUMMARY: Record<Tab, { eyebrow: string; title: string; description: string }> = {
  uso: {
    eyebrow: 'Uso diario',
    title: 'Una pantalla clara para empezar a usar el sistema con confianza.',
    description: 'Aqui priorizamos orientacion, comandos principales y acciones rapidas sin ruido tecnico.',
  },
  calibracion: {
    eyebrow: 'Calibracion',
    title: 'Ajusta la postura y la sensibilidad paso a paso, sin perder de vista la camara.',
    description: 'La calibracion queda guiada y visible para que puedas comprobar el encuadre y la respuesta del cursor.',
  },
  perfiles: {
    eyebrow: 'Perfiles',
    title: 'Guarda configuraciones para distintas personas, posturas o contextos de uso.',
    description: 'Mantener perfiles separados hace mas facil adaptar la herramienta sin volver a calibrar desde cero.',
  },
  voz: {
    eyebrow: 'Comandos de voz',
    title: 'Habla con frases cortas y revisa solo la informacion necesaria para confiar en el sistema.',
    description: 'La vista de voz muestra lo que se escucho, que accion se disparo y las frases recomendadas para un uso fluido.',
  },
};
const TAB_META: Record<Tab, { label: string; caption: string; marker: string; panelTitle: string }> = {
  uso: {
    label: 'Panel principal',
    caption: 'Operacion diaria',
    marker: '01',
    panelTitle: 'Centro de uso diario',
  },
  calibracion: {
    label: 'Calibracion',
    caption: 'Ajuste guiado',
    marker: '02',
    panelTitle: 'Centro de calibracion',
  },
  perfiles: {
    label: 'Perfiles',
    caption: 'Configuraciones',
    marker: '03',
    panelTitle: 'Gestor de perfiles',
  },
  voz: {
    label: 'Comandos de voz',
    caption: 'Control verbal',
    marker: '04',
    panelTitle: 'Centro de voz',
  },
};

function formatClock(timestamp?: number) {
  if (!timestamp) return 'Sin actividad todavia';
  return new Date(timestamp).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function mergeFloat32Chunks(chunks: Float32Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function downsampleTo16k(input: Float32Array, inputSampleRate: number) {
  if (inputSampleRate === WAV_SAMPLE_RATE) {
    return input;
  }

  const ratio = inputSampleRate / WAV_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  let outputIndex = 0;
  let inputIndex = 0;

  while (outputIndex < outputLength) {
    const nextInputIndex = Math.min(input.length, Math.round((outputIndex + 1) * ratio));
    let sum = 0;
    let count = 0;

    for (let i = inputIndex; i < nextInputIndex; i += 1) {
      sum += input[i];
      count += 1;
    }

    output[outputIndex] = count > 0 ? sum / count : input[inputIndex] ?? 0;
    outputIndex += 1;
    inputIndex = nextInputIndex;
  }

  return output;
}

function encodeWavFromFloat32(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += bytesPerSample;
  }

  return new Uint8Array(buffer);
}

function calculateRms(samples: Float32Array) {
  if (!samples.length) return 0;

  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }

  return Math.sqrt(sum / samples.length);
}

export default function App() {
  const [tab, setTab] = useState<Tab>('uso');
  const [enabled, setEnabled] = useState(true);
  const [pose, setPose] = useState<Pose>(null);
  const [cursorPreview, setCursorPreview] = useState({ x: 0, y: 0 });
  const [dwellMs, setDwellMs] = useState(DEFAULT_PROFILE_VALUES.dwellMs);
  const [isStable, setIsStable] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [autoClickEnabled, setAutoClickEnabled] = useState(DEFAULT_PROFILE_VALUES.autoClickEnabled);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>({ state: 'paused', message: 'Voz inactiva' });
  const [voiceRuntime, setVoiceRuntimeInfo] = useState<VoiceRuntimeInfo>(INITIAL_VOICE_RUNTIME);
  const [commandHistory, setCommandHistory] = useState<VoiceCommand[]>([]);
  const [isMinimized, setIsMinimized] = useState(false);
  const [screenSize, setScreenSize] = useState({ width: 1920, height: 1080 });
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [micCaptureState, setMicCaptureState] = useState<MicCaptureState>('idle');

  const videoRefForTracking = useRef<HTMLVideoElement>(null);
  const notifId = useRef(0);
  const fallbackProfileRef = useRef(createProfile());
  const enabledRef = useRef(enabled);
  const voiceEnabledRef = useRef(voiceEnabled);
  const isExecutingCommandRef = useRef(false);
  const didHydrateRef = useRef(false);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const processorSinkRef = useRef<GainNode | null>(null);
  const speechChunksRef = useRef<Float32Array[]>([]);
  const speechActiveRef = useRef(false);
  const speechStartedAtRef = useRef(0);
  const lastSpeechDetectedAtRef = useRef(0);
  const stabilityRef = useRef<{ last: Pose; timer: number | null }>({ last: null, timer: null });

  const showNotification = useCallback((message: string, type: Notification['type'] = 'info') => {
    const id = ++notifId.current;
    setNotifications((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setNotifications((prev) => prev.filter((notification) => notification.id !== id));
    }, 3200);
  }, []);

  const mergeActiveProfile = useCallback((patch: Partial<Profile>) => {
    setActiveProfile((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const refreshVoiceRuntime = useCallback(async (next?: VoiceRuntimeInfo | null) => {
    if (next) {
      setVoiceRuntimeInfo(next);
      return next;
    }

    const runtime = await window.api.voiceStats();
    setVoiceRuntimeInfo(runtime);
    return runtime;
  }, []);

  const stopAudioCapture = useCallback(() => {
    try {
      scriptProcessorRef.current?.disconnect();
      audioSourceRef.current?.disconnect();
      processorSinkRef.current?.disconnect();
    } catch (error) {
      console.warn('No se pudo desconectar la captura de audio:', error);
    }

    scriptProcessorRef.current = null;
    audioSourceRef.current = null;
    processorSinkRef.current = null;
    speechChunksRef.current = [];
    speechActiveRef.current = false;
    speechStartedAtRef.current = 0;
    lastSpeechDetectedAtRef.current = 0;

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch((error) => {
        console.warn('No se pudo cerrar AudioContext:', error);
      });
      audioContextRef.current = null;
    }

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }
  }, []);

  const resetStability = useCallback(() => {
    if (stabilityRef.current.timer !== null) {
      window.clearTimeout(stabilityRef.current.timer);
      stabilityRef.current.timer = null;
    }
    stabilityRef.current.last = null;
    setIsStable(false);
  }, []);

  const updateStability = useCallback((nextPose: Exclude<Pose, null>) => {
    const last = stabilityRef.current.last;
    if (!last) {
      stabilityRef.current.last = nextPose;
      return;
    }

    const distance = Math.hypot(nextPose.nx - last.nx, nextPose.ny - last.ny);
    if (distance < 0.015) {
      if (stabilityRef.current.timer === null) {
        stabilityRef.current.timer = window.setTimeout(() => {
          setIsStable(true);
          stabilityRef.current.timer = null;
        }, 400);
      }
      return;
    }

    if (stabilityRef.current.timer !== null) {
      window.clearTimeout(stabilityRef.current.timer);
      stabilityRef.current.timer = null;
    }
    stabilityRef.current.last = nextPose;
    setIsStable(false);
  }, []);

  const setVoiceRuntime = useCallback(async (
    next: boolean,
    options: { persist?: boolean; notify?: boolean } = {},
  ) => {
    const { persist = true, notify = true } = options;
    const result = await window.api.voiceToggle(next);

    if (!result.ok) {
      if (result.stats) {
        setVoiceRuntimeInfo(result.stats);
      }
      showNotification(result.error || 'No se pudo actualizar la voz', 'error');
      return false;
    }

    voiceEnabledRef.current = next;
    setVoiceEnabled(next);
    await refreshVoiceRuntime(result.stats);

    if (persist) {
      await window.api.saveActive({ voiceEnabled: next });
      mergeActiveProfile({ voiceEnabled: next });
    }

    if (notify) {
      showNotification(next ? 'Voz activada' : 'Voz desactivada', 'info');
    }

    return true;
  }, [mergeActiveProfile, refreshVoiceRuntime, showNotification]);

  const setAutoClickRuntime = useCallback(async (
    next: boolean,
    options: { persist?: boolean; notify?: boolean } = {},
  ) => {
    const { persist = true, notify = true } = options;

    setDwellClickEnabled(next);
    setAutoClickEnabled(next);

    if (persist) {
      await window.api.saveActive({ autoClickEnabled: next });
      mergeActiveProfile({ autoClickEnabled: next });
    }

    if (notify) {
      showNotification(next ? 'Autoclick activado' : 'Autoclick desactivado', 'info');
    }

    return true;
  }, [mergeActiveProfile, showNotification]);

  const setTrackingEnabled = useCallback(async (next: boolean, persist = true) => {
    const applied = await window.native.setEnabled(next);
    enabledRef.current = applied;
    setEnabled(applied);

    if (persist) {
      await window.api.saveActive({ headTrackingEnabled: applied });
      mergeActiveProfile({ headTrackingEnabled: applied });
    }

    if (!applied) {
      resetStability();
    }

    return applied;
  }, [mergeActiveProfile, resetStability]);

  const applyRuntimeProfile = useCallback(async (profile: Profile, options: { syncVoice?: boolean } = {}) => {
    const { syncVoice = true } = options;

    applyCalibration({
      sensitivity: profile.sensitivity,
      gain: profile.gain,
      deadzone: profile.deadzone,
      maxSpeed: profile.maxSpeed,
      gazeAmplification: profile.gazeAmplification,
      neutralX: profile.neutralX,
      neutralY: profile.neutralY,
    });

    setDwellMs(profile.dwellMs);
    setActiveProfile(profile);

    await setAutoClickRuntime(profile.autoClickEnabled, { persist: false, notify: false });
    await setTrackingEnabled(profile.headTrackingEnabled, false);

    if (syncVoice) {
      await setVoiceRuntime(profile.voiceEnabled, { persist: false, notify: false });
    } else {
      voiceEnabledRef.current = profile.voiceEnabled;
      setVoiceEnabled(profile.voiceEnabled);
    }
  }, [setAutoClickRuntime, setTrackingEnabled, setVoiceRuntime]);

  const sendVoiceChunk = useCallback(async (buffer: Uint8Array, mimeType: string) => {
    if (!voiceEnabledRef.current || buffer.byteLength < 1024) {
      return;
    }

    try {
      const result = await window.api.voiceChunk(buffer, mimeType);
      if (!result.ok && result.error) {
        console.warn('Chunk de voz rechazado:', result.error);
      }
    } catch (error) {
      console.error('No se pudo enviar audio al backend de voz:', error);
    }
  }, []);

  const flushSpeechBuffer = useCallback((sampleRate: number) => {
    const chunks = speechChunksRef.current;
    speechChunksRef.current = [];
    speechActiveRef.current = false;
    speechStartedAtRef.current = 0;
    lastSpeechDetectedAtRef.current = 0;

    if (chunks.length === 0) {
      return;
    }

    const merged = mergeFloat32Chunks(chunks);
    if (merged.length < 2048) {
      return;
    }

    const resampled = downsampleTo16k(merged, sampleRate);
    const wav = encodeWavFromFloat32(resampled, WAV_SAMPLE_RATE);
    void sendVoiceChunk(wav, 'audio/wav');
  }, [sendVoiceChunk]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);

  useEffect(() => {
    let mounted = true;

    const unsubscribeEnabled = window.native.onEnabledChanged((nextEnabled) => {
      enabledRef.current = nextEnabled;
      setEnabled(nextEnabled);
      if (didHydrateRef.current) {
        showNotification(nextEnabled ? 'Seguimiento activo' : 'Seguimiento pausado', nextEnabled ? 'success' : 'info');
      }
      if (!nextEnabled) {
        resetStability();
      }
    });

    const boot = async () => {
      try {
        const [size, profile, runtime] = await Promise.all([
          window.native.getScreenSize(),
          window.api.loadActive().catch(() => fallbackProfileRef.current),
          window.api.voiceStats().catch(() => INITIAL_VOICE_RUNTIME),
        ]);

        if (!mounted) return;
        setScreenSize(size);
        setVoiceRuntimeInfo(runtime);
        await applyRuntimeProfile(profile);
      } catch (error) {
        console.error('Error cargando configuracion inicial:', error);
        showNotification('No se pudo cargar la configuracion local', 'error');
      } finally {
        didHydrateRef.current = true;
      }
    };

    boot();

    return () => {
      mounted = false;
      unsubscribeEnabled?.();
      stopAudioCapture();
      resetStability();
    };
  }, [applyRuntimeProfile, resetStability, showNotification, stopAudioCapture]);

  useEffect(() => {
    const refreshScreenSize = async () => {
      try {
        setScreenSize(await window.native.getScreenSize());
      } catch (error) {
        console.warn('No se pudo refrescar el tamano de pantalla:', error);
      }
    };

    const handleResize = () => {
      refreshScreenSize().catch(console.error);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!videoRefForTracking.current) return;

    const video = videoRefForTracking.current;
    let cancelled = false;

    const boot = async () => {
      try {
        await startHeadTracking(video, (nextPose) => {
          if (cancelled) return;

          setPose(nextPose);

          if (!enabledRef.current || !nextPose) {
            resetStability();
            return;
          }

          updateStability(nextPose);
        });
      } catch (error) {
        console.error('Error iniciando head tracking:', error);
        showNotification('No se pudo iniciar el seguimiento', 'error');
      }
    };

    boot();

    return () => {
      cancelled = true;
      try {
        stopHeadTracking();
      } catch (error) {
        console.warn('Error al detener head tracking:', error);
      }
      resetStability();
    };
  }, [resetStability, showNotification, updateStability]);

  useEffect(() => {
    if (!pose) return;

    setCursorPreview({
      x: Math.round(pose.nx * (screenSize.width - 1)),
      y: Math.round(pose.ny * (screenSize.height - 1)),
    });
  }, [pose, screenSize.height, screenSize.width]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsMinimized(document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!voiceEnabled || !voiceRuntime.requiresRendererCapture) {
      stopAudioCapture();
      setMicCaptureState('idle');
      return () => {
        cancelled = true;
      };
    }

    const startCapture = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMicCaptureState('error');
        showNotification('Tu entorno no permite capturar audio desde el renderer', 'error');
        return;
      }

      setMicCaptureState('requesting');

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        audioStreamRef.current = stream;
        const audioContext = new AudioContext({ sampleRate: WAV_SAMPLE_RATE });
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const sink = audioContext.createGain();
        sink.gain.value = 0;

        audioContextRef.current = audioContext;
        audioSourceRef.current = source;
        scriptProcessorRef.current = processor;
        processorSinkRef.current = sink;
        speechChunksRef.current = [];
        speechActiveRef.current = false;
        speechStartedAtRef.current = 0;
        lastSpeechDetectedAtRef.current = 0;

        processor.onaudioprocess = (event) => {
          const inputData = event.inputBuffer.getChannelData(0);
          if (!inputData?.length) return;

          const chunk = new Float32Array(inputData);
          const now = performance.now();
          const rms = calculateRms(chunk);
          const detectedSpeech = rms >= MIN_VOICE_RMS;

          if (detectedSpeech) {
            if (!speechActiveRef.current) {
              speechActiveRef.current = true;
              speechStartedAtRef.current = now;
              speechChunksRef.current = [];
            }

            speechChunksRef.current.push(chunk);
            lastSpeechDetectedAtRef.current = now;

            if (now - speechStartedAtRef.current >= MAX_SPEECH_WINDOW_MS) {
              flushSpeechBuffer(audioContext.sampleRate);
            }
            return;
          }

          if (!speechActiveRef.current) {
            return;
          }

          speechChunksRef.current.push(chunk);
          if (now - lastSpeechDetectedAtRef.current >= SPEECH_END_SILENCE_MS) {
            flushSpeechBuffer(audioContext.sampleRate);
          }
        };

        source.connect(processor);
        processor.connect(sink);
        sink.connect(audioContext.destination);
        setMicCaptureState('streaming');
      } catch (error) {
        console.error('No se pudo acceder al microfono:', error);
        setMicCaptureState('error');
        showNotification('No se pudo acceder al microfono. Revisa permisos del sistema.', 'error');
      }
    };

    startCapture().catch(console.error);

    return () => {
      cancelled = true;
      if (audioContextRef.current && speechActiveRef.current) {
        flushSpeechBuffer(audioContextRef.current.sampleRate);
      }
      stopAudioCapture();
    };
  }, [flushSpeechBuffer, showNotification, stopAudioCapture, voiceEnabled, voiceRuntime.chunkMs, voiceRuntime.requiresRendererCapture]);

  useEffect(() => {
    const execHandler = (payload: any) => {
      if (!payload || isExecutingCommandRef.current) {
        return;
      }

      isExecutingCommandRef.current = true;
      resetStability();

      const finish = (delayMs = 250) => {
        window.setTimeout(() => {
          isExecutingCommandRef.current = false;
        }, delayMs);
      };

      if (payload.type === 'click') {
        const button = payload.button === 'double' ? 'double' : payload.button;
        const action = window.native.click(button);
        const notificationText = payload.button === 'double'
          ? 'Doble clic ejecutado'
          : `Clic ${payload.button} ejecutado`;

        action
          .then((ok) => {
            ensureNativeResult(ok, notificationText.toLowerCase());
            finish(payload.button === 'double' ? 260 : 250);
          })
          .catch((error: unknown) => {
            console.error('[App] Error en clic:', error);
            isExecutingCommandRef.current = false;
          });

        showNotification(notificationText, 'success');
        return;
      }

      if (payload.type === 'scroll') {
        window.native.scroll(0, payload.delta || 0)
          .then((ok) => {
            ensureNativeResult(ok, 'el desplazamiento');
            finish(200);
          })
          .catch((error: unknown) => {
            console.error('[App] Error en scroll:', error);
            isExecutingCommandRef.current = false;
          });
        showNotification('Desplazamiento ejecutado', 'success');
        return;
      }

      if (payload.type === 'hold') {
        window.native.mouseDown(payload.button || 'left')
          .then((ok) => {
            ensureNativeResult(ok, 'mantener clic');
            finish(200);
          })
          .catch((error: unknown) => {
            console.error('[App] Error en hold:', error);
            isExecutingCommandRef.current = false;
          });
        showNotification('Manteniendo clic...', 'info');
        return;
      }

      if (payload.type === 'release') {
        window.native.mouseUp(payload.button || 'left')
          .then((ok) => {
            ensureNativeResult(ok, 'soltar clic');
            finish(200);
          })
          .catch((error: unknown) => {
            console.error('[App] Error en release:', error);
            isExecutingCommandRef.current = false;
          });
        showNotification('Clic soltado', 'success');
        return;
      }

      if (payload.type === 'dwell') {
        setAutoClickRuntime(Boolean(payload.enabled))
          .then(() => finish(150))
          .catch((error: unknown) => {
            console.error('[App] Error cambiando autoclick:', error);
            isExecutingCommandRef.current = false;
          });
        return;
      }

      if (payload.type === 'text') {
        window.native.typeText(String(payload.text || ''))
          .then((ok) => {
            ensureNativeResult(ok, 'la escritura por voz');
            finish(120);
          })
          .catch((error: unknown) => {
            console.error('[App] Error escribiendo texto:', error);
            isExecutingCommandRef.current = false;
          });
        return;
      }

      if (payload.type === 'key') {
        window.native.pressKey(String(payload.key || 'enter'))
          .then((ok) => {
            ensureNativeResult(ok, 'la tecla solicitada');
            finish(120);
          })
          .catch((error: unknown) => {
            console.error('[App] Error pulsando tecla:', error);
            isExecutingCommandRef.current = false;
          });
        if (payload.key === 'enter') {
          showNotification('Enter enviado', 'success');
        }
        return;
      }

      if (payload.type === 'edit' && payload.action === 'delete_last_word') {
        window.native.deleteLastWord()
          .then((ok) => {
            ensureNativeResult(ok, 'borrar la ultima palabra');
            finish(120);
          })
          .catch((error: unknown) => {
            console.error('[App] Error borrando ultima palabra:', error);
            isExecutingCommandRef.current = false;
          });
        showNotification('Ultima palabra borrada', 'info');
        return;
      }

      if (payload.type === 'system') {
        if (payload.action === 'pause_tracking') {
          setTrackingEnabled(false)
            .then(() => finish(150))
            .catch((error: unknown) => {
              console.error('[App] Error pausando seguimiento:', error);
              isExecutingCommandRef.current = false;
            });
          showNotification('Seguimiento pausado', 'info');
          return;
        }

        if (payload.action === 'resume_tracking') {
          setTrackingEnabled(true)
            .then(() => finish(150))
            .catch((error: unknown) => {
              console.error('[App] Error reanudando seguimiento:', error);
              isExecutingCommandRef.current = false;
            });
          showNotification('Seguimiento reanudado', 'success');
          return;
        }

        if (payload.action === 'cancel') {
          isExecutingCommandRef.current = false;
          showNotification('Accion cancelada', 'info');
          return;
        }
      }

      isExecutingCommandRef.current = false;
    };

    const statusHandler = (payload: VoiceStatus) => {
      setVoiceStatus(payload);
    };

    const commandHandler = (payload: VoiceCommand) => {
      if (!payload?.transcription) return;
      setCommandHistory((prev) => [payload, ...prev].slice(0, MAX_COMMAND_HISTORY));
    };

    const errorHandler = (payload: unknown) => {
      const text = payload instanceof Error ? payload.message : typeof payload === 'string' ? payload : String(payload);
      setVoiceStatus({ state: 'error', message: text });
      showNotification(`Error de voz: ${text}`, 'error');
    };

    const togglePauseHandler = () => {
      setTrackingEnabled(!enabledRef.current).catch((error) => {
        console.error('No se pudo alternar el seguimiento:', error);
      });
    };

    const toggleVoiceHandler = () => {
      setVoiceRuntime(!voiceEnabledRef.current).catch((error) => {
        console.error('No se pudo alternar la voz:', error);
      });
    };

    const cancelDwellHandler = () => {
      resetStability();
      showNotification('Permanencia cancelada', 'info');
    };

    const cleanups = [
      window.api.on('execute-command', execHandler),
      window.api.on('voice:status', statusHandler),
      window.api.on('voice:command', commandHandler),
      window.api.on('voice:error', errorHandler),
      window.api.on('toggle-pause', togglePauseHandler),
      window.api.on('toggle-voice', toggleVoiceHandler),
      window.api.on('cancel-dwell', cancelDwellHandler),
    ];

    return () => {
      cleanups.forEach((cleanup) => cleanup?.());
    };
  }, [resetStability, setAutoClickRuntime, setTrackingEnabled, setVoiceRuntime, showNotification]);

  useEffect(() => {
    if (tab === 'perfiles') {
      resetStability();
    }
  }, [resetStability, tab]);

  const onCalibrationDone = async (data: Partial<Profile>) => {
    const nextProfile = { ...(activeProfile ?? fallbackProfileRef.current), ...data };

    applyCalibration({
      sensitivity: nextProfile.sensitivity,
      gain: nextProfile.gain,
      deadzone: nextProfile.deadzone,
      maxSpeed: nextProfile.maxSpeed,
      gazeAmplification: nextProfile.gazeAmplification,
      neutralX: nextProfile.neutralX,
      neutralY: nextProfile.neutralY,
    });

    setDwellMs(nextProfile.dwellMs);
    setActiveProfile(nextProfile);
    await window.api.applyProfile(data);
    setTab('uso');
    showNotification('Perfil de parametros guardado localmente', 'success');
  };

  const shortcutPause = window.api.platform === 'darwin' ? 'Cmd+Shift+P' : 'Ctrl+Shift+P';
  const shortcutVoice = window.api.platform === 'darwin' ? 'Cmd+Shift+V' : 'Ctrl+Shift+V';
  const shouldShowDwell = Boolean(enabled && autoClickEnabled && isStable && pose);
  const latestCommand = commandHistory[0] ?? null;
  const latestRecognizedCommand = commandHistory.find((entry) => entry.recognized) ?? null;
  const micCaptureLabel = micCaptureState === 'streaming'
    ? 'Mic listo'
    : micCaptureState === 'requesting'
      ? 'Pidiendo permiso'
      : micCaptureState === 'error'
        ? 'Micro con error'
        : 'Micro inactivo';
  const tabSummary = TAB_SUMMARY[tab];
  const latestRecognizedLabel = latestRecognizedCommand?.action
    ? ACTION_LABELS[latestRecognizedCommand.action] || latestRecognizedCommand.action
    : 'Sin comando valido aun';
  const ensureNativeResult = useCallback((ok: boolean, actionLabel: string) => {
    if (!ok) {
      throw new Error(`No se pudo ejecutar ${actionLabel}. Revisa si el control esta pausado o si el driver nativo no esta disponible.`);
    }
  }, []);
  const voiceStateLabel = !voiceEnabled
    ? 'Apagada'
    : voiceStatus.state === 'listening'
      ? 'Escuchando'
      : voiceStatus.state === 'processing'
        ? 'Interpretando'
        : voiceStatus.state === 'error'
          ? 'Error'
          : 'Pausada';
  const voiceStateTone: 'good' | 'warn' | 'neutral' = !voiceEnabled
    ? 'neutral'
    : voiceStatus.state === 'error'
      ? 'warn'
      : voiceStatus.state === 'listening'
        ? 'good'
        : 'neutral';
  const activeTabMeta = TAB_META[tab];

  return (
    <div className="app-root app-playground assistive-app ui-rebuild">
      {shouldShowDwell && (
        <DwellRing
          cursorX={cursorPreview.x}
          cursorY={cursorPreview.y}
          dwellMs={dwellMs}
          isPaused={!enabled}
          isStable={isStable}
          enabled={autoClickEnabled}
        />
      )}

      {isMinimized && (
        <div className="top-banner">
          Sistema activo en segundo plano
        </div>
      )}

      <div className="notifications-zone">
        {notifications.map((notification) => (
          <div key={notification.id} className={`notification notification-${notification.type}`}>
            <span className="notif-icon">
              {notification.type === 'success' ? '✓' : notification.type === 'error' ? '✗' : 'i'}
            </span>
            <span className="notif-message">{notification.message}</span>
          </div>
        ))}
      </div>

      <div className="assistive-shell modern-shell">
        <header className="surface-card modern-topbar">
          <div className="modern-brand">
            <span className="brand-kicker">Sistema de Seguimiento Cefalico</span>
            <h1>Interfaz principal</h1>
            <p>
              Un entorno claro para mover el cursor, hablar con la aplicacion y ajustar el sistema
              sin perderse entre datos tecnicos.
            </p>
          </div>

          <div className="modern-topbar-actions">
            <button
              className={`action-button ${enabled ? 'primary' : 'secondary'}`}
              onClick={() => {
                setTrackingEnabled(!enabledRef.current).catch(console.error);
              }}
            >
              {enabled ? 'Pausar seguimiento' : 'Reanudar seguimiento'}
            </button>
            <button
              className={`action-button ${voiceEnabled ? 'primary' : 'secondary'}`}
              onClick={() => {
                setVoiceRuntime(!voiceEnabledRef.current).catch(console.error);
              }}
            >
              {voiceEnabled ? 'Desactivar voz' : 'Activar voz'}
            </button>
            <button
              className={`action-button ${autoClickEnabled ? 'primary' : 'secondary'}`}
              onClick={() => {
                setAutoClickRuntime(!autoClickEnabled).catch(console.error);
              }}
            >
              {autoClickEnabled ? 'Desactivar autoclick' : 'Activar autoclick'}
            </button>
          </div>
        </header>

        <section className="surface-card modern-status-strip">
          <StatusBadge
            label="Seguimiento"
            value={enabled ? 'Activo' : 'Pausado'}
            detail={enabled ? 'El cursor esta listo para responder' : 'El cursor no se movera hasta reanudar'}
            tone={enabled ? 'good' : 'warn'}
          />
          <StatusBadge
            label="Voz"
            value={voiceStateLabel}
            detail={voiceEnabled ? 'Comandos por voz disponibles' : 'Control por voz desactivado'}
            tone={voiceStateTone}
          />
          <StatusBadge
            label="Camara"
            value={pose ? 'Rostro detectado' : 'Ajustar posicion'}
            detail={pose ? 'La postura actual es valida' : 'Centra el rostro para mejorar el seguimiento'}
            tone={pose ? 'good' : 'warn'}
          />
          <StatusBadge
            label="Autoclick"
            value={autoClickEnabled ? 'Activado' : 'Desactivado'}
            detail={autoClickEnabled ? `Tiempo de permanencia ${dwellMs} ms` : 'La seleccion se hace manualmente'}
            tone={autoClickEnabled ? 'good' : 'neutral'}
          />
          <StatusBadge
            label="Microfono"
            value={micCaptureLabel}
            detail={micCaptureState === 'streaming' ? 'Listo para escuchar' : 'Se activara cuando la voz lo necesite'}
            tone={micCaptureState === 'error' ? 'warn' : micCaptureState === 'streaming' ? 'good' : 'neutral'}
          />
        </section>

        <div className="modern-body">
          <aside className="surface-card modern-sidebar">
            <div className="modern-sidebar-header">
              <span className="section-kicker">Secciones</span>
              <h3>Navegacion</h3>
              <p>Accede a cada area del sistema desde un unico panel lateral.</p>
            </div>

            <nav className="modern-nav">
              {(Object.keys(TAB_META) as Tab[]).map((tabKey) => {
                const meta = TAB_META[tabKey];
                const active = tab === tabKey;

                return (
                  <button
                    key={tabKey}
                    className={`modern-nav-item ${active ? 'active' : ''}`}
                    onClick={() => setTab(tabKey)}
                  >
                    <span className="modern-nav-marker">{meta.marker}</span>
                    <span className="modern-nav-copy">
                      <strong>{meta.label}</strong>
                      <small>{meta.caption}</small>
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="modern-sidebar-card">
              <span className="section-kicker">Comandos utiles</span>
              <div className="command-chip-row">
                {QUICK_COMMANDS.slice(0, 8).map((command) => (
                  <span key={command} className="command-chip">
                    {command}
                  </span>
                ))}
              </div>
            </div>

            <div className="modern-sidebar-card">
              <span className="section-kicker">Atajos</span>
              <div className="shortcut-row">
                <span>Pausar seguimiento</span>
                <kbd>{shortcutPause}</kbd>
              </div>
              <div className="shortcut-row">
                <span>Activar o desactivar voz</span>
                <kbd>{shortcutVoice}</kbd>
              </div>
              <div className="shortcut-row">
                <span>Cancelar permanencia</span>
                <kbd>Esc</kbd>
              </div>
            </div>
          </aside>

          <main className="modern-main">
            <section className="surface-card modern-hero">
              <div className="modern-hero-copy">
                <span className="section-kicker">{tabSummary.eyebrow}</span>
                <h2>{activeTabMeta.panelTitle}</h2>
                <p>{tabSummary.description}</p>
              </div>

              <div className="modern-hero-highlight">
                <span className="section-kicker">Ultima actividad</span>
                <strong>{latestCommand ? latestCommand.transcription : 'Sin actividad aun'}</strong>
                <p>{latestCommand?.message || 'Cuando hables o ejecutes una accion, aqui veras el ultimo resultado.'}</p>
              </div>
            </section>

            <div className={`modern-content-grid modern-content-grid-${tab}`}>
              <section className="surface-card modern-live-card">
                <div className="modern-card-head">
                  <div>
                    <span className="section-kicker">Vista en vivo</span>
                    <h3>Seguimiento del rostro</h3>
                  </div>
                  <span className={`signal-pill ${pose ? 'good' : 'warn'}`}>
                    {pose ? 'Listo' : 'Ajustar postura'}
                  </span>
                </div>

                <div className="camera-stage camera-stage-large modern-camera-stage">
                  <video
                    ref={videoRefForTracking}
                    muted
                    playsInline
                    autoPlay
                    className="tracking-camera"
                  />
                  <div className="camera-grid-overlay" />
                  <div className="camera-crosshair" />
                </div>

                <div className="modern-live-footer">
                  <SignalRow label="Rostro" value={pose ? 'Detectado' : 'Fuera de cuadro'} tone={pose ? 'good' : 'warn'} />
                  <SignalRow label="Postura" value={isStable ? 'Estable' : 'En ajuste'} tone={isStable ? 'good' : 'neutral'} />
                  <SignalRow label="Ultimo comando" value={latestRecognizedLabel} tone={latestRecognizedCommand ? 'good' : 'neutral'} />
                </div>
              </section>

              <section className="surface-card modern-panel-card">
                {tab === 'uso' && (
                  <DailyUseSection
                    pose={pose}
                    enabled={enabled}
                    isStable={isStable}
                    autoClickEnabled={autoClickEnabled}
                    voiceEnabled={voiceEnabled}
                    latestCommand={latestCommand}
                    latestRecognizedCommand={latestRecognizedCommand}
                    shortcutPause={shortcutPause}
                    shortcutVoice={shortcutVoice}
                    onOpenCalibration={() => setTab('calibracion')}
                    onOpenVoice={() => setTab('voz')}
                    onOpenProfiles={() => setTab('perfiles')}
                  />
                )}

                {tab === 'calibracion' && (
                  <CalibrationWizard
                    pose={pose}
                    initialProfile={activeProfile ?? fallbackProfileRef.current}
                    onComplete={onCalibrationDone}
                    onCancel={() => setTab('uso')}
                  />
                )}

                {tab === 'perfiles' && (
                  <ProfileManager
                    onClose={() => setTab('uso')}
                    onActivate={(profile) => {
                      applyRuntimeProfile(profile).catch(console.error);
                      setTab('uso');
                      showNotification(`Perfil "${profile.name}" activado`, 'success');
                    }}
                  />
                )}

                {tab === 'voz' && (
                  <VoicePanel
                    enabled={voiceEnabled}
                    status={voiceStatus}
                    runtime={voiceRuntime}
                    commandHistory={commandHistory}
                    onToggle={() => {
                      setVoiceRuntime(!voiceEnabledRef.current).catch(console.error);
                    }}
                  />
                )}
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function DailyUseSection({
  pose,
  enabled,
  isStable,
  autoClickEnabled,
  voiceEnabled,
  latestCommand,
  latestRecognizedCommand,
  shortcutPause,
  shortcutVoice,
  onOpenCalibration,
  onOpenVoice,
  onOpenProfiles,
}: {
  pose: Pose;
  enabled: boolean;
  isStable: boolean;
  autoClickEnabled: boolean;
  voiceEnabled: boolean;
  latestCommand: VoiceCommand | null;
  latestRecognizedCommand: VoiceCommand | null;
  shortcutPause: string;
  shortcutVoice: string;
  onOpenCalibration: () => void;
  onOpenVoice: () => void;
  onOpenProfiles: () => void;
}) {
  return (
    <div className="daily-layout">
      <div className="daily-card daily-card-wide">
        <span className="section-kicker">Comenzar</span>
        <h3>Una rutina simple para usar el sistema con tranquilidad</h3>
        <div className="daily-steps">
          <article className="daily-step">
            <strong>1. Encuentra una postura comoda</strong>
            <p>
              {pose
                ? 'La camara ya te reconoce. Si sientes que el cursor no responde como quieres, vuelve al centro y continua.'
                : 'Colocate frente a la pantalla hasta que la camara pueda detectar el rostro con claridad.'}
            </p>
          </article>
          <article className="daily-step">
            <strong>2. Activa solo lo necesario</strong>
            <p>
              {enabled ? 'El seguimiento esta listo para mover el cursor.' : 'Reanuda el seguimiento cuando quieras volver a usar el cursor.'}{' '}
              {voiceEnabled ? 'La voz esta disponible para los comandos principales.' : 'Puedes activar la voz si quieres controlar tambien por habla.'}
            </p>
          </article>
          <article className="daily-step">
            <strong>3. Ajusta si algo no se siente natural</strong>
            <p>
              Si notas cansancio o una respuesta incomoda, entra en calibracion o cambia de perfil en lugar de seguir forzando la postura.
            </p>
          </article>
        </div>

        <div className="daily-actions">
          <button className="action-button primary" onClick={onOpenCalibration}>Abrir calibracion</button>
          <button className="action-button secondary" onClick={onOpenVoice}>Practicar comandos de voz</button>
          <button className="action-button secondary" onClick={onOpenProfiles}>Gestionar perfiles</button>
        </div>
      </div>

      <div className="daily-card">
        <span className="section-kicker">Lista rapida</span>
        <h3>Antes de empezar</h3>
        <ul className="check-list">
          <li className={pose ? 'done' : ''}>{pose ? 'Rostro detectado correctamente.' : 'Alinea tu rostro dentro de la camara.'}</li>
          <li className={enabled ? 'done' : ''}>{enabled ? 'Seguimiento activo.' : 'Reanuda el seguimiento para mover el cursor.'}</li>
          <li className={isStable ? 'done' : ''}>{isStable ? 'Postura estable.' : 'Busca una postura comoda antes de hacer selecciones.'}</li>
          <li className={autoClickEnabled ? 'done' : ''}>{autoClickEnabled ? 'Autoclick activado.' : 'Activalo solo si lo necesitas.'}</li>
        </ul>
      </div>

      <div className="daily-card">
        <span className="section-kicker">Hablar con la app</span>
        <h3>Comandos recomendados</h3>
        <div className="command-chip-row">
          {QUICK_COMMANDS.map((command) => (
            <span key={command} className="command-chip">{command}</span>
          ))}
        </div>
      </div>

      <div className="daily-card">
        <span className="section-kicker">Ultimo resultado</span>
        <h3>Actividad reciente</h3>
        <div className="live-transcript compact">
          <strong>{latestCommand ? latestCommand.transcription : 'Sin actividad aun'}</strong>
          <p>{latestCommand?.message || 'Cuando hables, aqui veras lo ultimo que haya entendido el sistema.'}</p>
        </div>
        <div className="signal-list">
          <SignalRow
            label="Comando reconocido"
            value={latestRecognizedCommand?.action ? ACTION_LABELS[latestRecognizedCommand.action] || latestRecognizedCommand.action : 'Sin comando'}
            tone={latestRecognizedCommand ? 'good' : 'neutral'}
          />
          <SignalRow label="Hora" value={formatClock(latestRecognizedCommand?.timestamp)} tone="neutral" />
        </div>
      </div>

      <div className="daily-card">
        <span className="section-kicker">Apoyo rapido</span>
        <h3>Atajos del teclado</h3>
        <div className="shortcut-row">
          <span>Pausar o reanudar seguimiento</span>
          <kbd>{shortcutPause}</kbd>
        </div>
        <div className="shortcut-row">
          <span>Activar o desactivar voz</span>
          <kbd>{shortcutVoice}</kbd>
        </div>
        <div className="shortcut-row">
          <span>Cancelar permanencia</span>
          <kbd>Esc</kbd>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'neutral';
  detail?: string;
}) {
  return (
    <div className={`status-badge ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function SignalRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'neutral';
}) {
  return (
    <div className="signal-row">
      <span>{label}</span>
      <strong className={`tone-${tone}`}>{value}</strong>
    </div>
  );
}
