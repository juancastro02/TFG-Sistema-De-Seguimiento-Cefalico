import React from 'react';
import '../styles.css';

interface VoiceCommand {
  action?: string;
  transcription: string;
  magnitude?: number;
  recognized: boolean;
  message: string;
  timestamp: number;
}

interface VoiceStatus {
  state: 'listening' | 'processing' | 'paused' | 'error';
  message: string;
}

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

const COMMAND_CATALOG = [
  { title: 'Seleccion', commands: ['clic', 'clic derecho', 'doble clic'] },
  { title: 'Dictado', commands: ['escribir', 'borrar', 'enter', 'listo'] },
  { title: 'Arrastre', commands: ['mantener', 'soltar'] },
  { title: 'Desplazamiento', commands: ['scroll arriba', 'scroll abajo'] },
  { title: 'Sistema', commands: ['pausar mouse', 'reanudar mouse', 'ocultar ventana', 'mostrar ventana', 'activar autoclick', 'desactivar autoclick', 'cancelar'] },
];

function formatTime(timestamp?: number) {
  if (!timestamp) return 'Sin capturas';
  return new Date(timestamp).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function VoicePanel({
  enabled,
  status,
  runtime,
  commandHistory,
  onToggle,
}: {
  enabled: boolean;
  status: VoiceStatus;
  runtime: VoiceRuntimeInfo;
  commandHistory: VoiceCommand[];
  onToggle: () => void;
}) {
  const latestSample = commandHistory[0] ?? null;
  const recentSamples = commandHistory.slice(0, 6);
  const statusLabel: Record<VoiceStatus['state'], string> = {
    listening: 'Escuchando',
    processing: 'Interpretando',
    paused: 'Pausado',
    error: 'Error',
  };
  const latestResult = latestSample
    ? latestSample.recognized
      ? ACTION_LABELS[latestSample.action || ''] || latestSample.action || 'Comando reconocido'
      : 'Se escucho audio, pero no se asigno un comando'
    : enabled
      ? 'Habla con una frase corta para validar el pipeline'
      : 'Activa la voz para empezar la prueba';
  const providerLabel = runtime.provider === 'openai' ? 'OpenAI' : 'Local';

  return (
    <section className="voice-panel-clean">
      <div className="voice-panel-header">
        <div>
          <span className="section-kicker">Comandos de voz</span>
          <h3>Habla de forma natural, con frases breves y claras</h3>
          <p>
            Esta vista esta pensada para comprobar rapidamente si la app te escucho bien y
            que comando ejecuto.
          </p>
        </div>

        <div className="voice-panel-actions">
          <span className={`signal-pill ${enabled ? 'good' : 'neutral'}`}>
            {enabled ? statusLabel[status.state] : 'Voz inactiva'}
          </span>
          <button className={`action-button ${enabled ? 'primary' : 'secondary'}`} onClick={onToggle}>
            {enabled ? 'Desactivar voz' : 'Activar voz'}
          </button>
        </div>
      </div>

      <div className="voice-panel-grid">
        <div className="surface-card voice-panel-card">
          <span className="section-kicker">Ultima interpretacion</span>
          <h3>{latestSample ? `"${latestSample.transcription}"` : 'Sin transcripciones todavia'}</h3>
          <p>{latestSample?.message || status.message}</p>

          <div className="signal-list">
            <div className="signal-row">
              <span>Resultado</span>
              <strong className={`tone-${latestSample?.recognized ? 'good' : 'neutral'}`}>{latestResult}</strong>
            </div>
            <div className="signal-row">
              <span>Estado</span>
              <strong className={`tone-${status.state === 'error' ? 'warn' : status.state === 'listening' ? 'good' : 'neutral'}`}>{enabled ? statusLabel[status.state] : 'Inactiva'}</strong>
            </div>
            <div className="signal-row">
              <span>Hora</span>
              <strong className="tone-neutral">{formatTime(latestSample?.timestamp)}</strong>
            </div>
          </div>

          <p className="voice-runtime-note">Motor de voz: {providerLabel}</p>
        </div>

        <div className="surface-card voice-panel-card">
          <span className="section-kicker">Que decir</span>
          <h3>Frases recomendadas</h3>
          <p>Estas expresiones suelen dar la experiencia mas estable.</p>

          <div className="voice-command-groups compact">
            {COMMAND_CATALOG.map((group) => (
              <article key={group.title} className="voice-command-group">
                <strong>{group.title}</strong>
                <div className="command-chip-row">
                  {group.commands.map((command) => (
                    <span key={command} className="command-chip strong">{command}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>

      <div className="surface-card voice-panel-card">
        <span className="section-kicker">Historial reciente</span>
        <h3>Ultimas capturas</h3>
        {recentSamples.length === 0 ? (
          <p className="empty-state">
            Todavia no hay transcripciones. Activa la voz y prueba con una frase como "clic", "mantener" o "escribir".
          </p>
        ) : (
          <div className="voice-log">
            {recentSamples.map((sample, index) => (
              <div key={`${sample.timestamp}-${index}`} className={`voice-log-item ${sample.recognized ? 'ok' : 'fail'}`}>
                <div className="voice-log-copy">
                  <strong>{sample.transcription}</strong>
                  <p>{sample.recognized ? ACTION_LABELS[sample.action || ''] || sample.message : sample.message}</p>
                </div>
                <span className="voice-log-time">{formatTime(sample.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
