import React from 'react'
import { useState } from 'react'
import '../styles.css';

interface VoiceCommand {
  action?: string
  transcription: string
  magnitude?: number
  recognized: boolean
  message: string
  timestamp: number
}
interface VoiceStatus { state: 'listening'|'processing'|'paused'|'error'; message: string }

export default function VoicePanel({
  enabled, status, commandHistory, onToggle
}:{
  enabled: boolean
  status: VoiceStatus
  commandHistory: VoiceCommand[]
  onToggle: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  
  const statusColor: Record<string, string> = {
    listening: '#10b981', processing: '#3b82f6', paused: '#f59e0b', error: '#ef4444'
  }
  const statusEmoji: Record<string, string> = {
    listening: '🎙️', processing: '🔄', paused: '⏸', error: '❌'
  }

  return (
    <div className={`voice-panel ${expanded ? 'expanded' : ''}`}>
      <div className="voice-header">
        <h2>🎤 Acciones por Voz (CU-10)</h2>
        
        <div className="voice-indicator" style={{ 
          backgroundColor: enabled ? statusColor[status.state] : '#6b7280' 
        }}>
          <span className="voice-icon">{statusEmoji[status.state]}</span>
          <span className="voice-label">{enabled ? 'Voz activa' : 'Voz inactiva'}</span>
        </div>

        <button className="btn-toggle" onClick={onToggle} style={{ 
          backgroundColor: enabled ? '#10b981' : '#6b7280' 
        }}>
          {enabled ? 'Desactivar voz' : 'Activar voz'}
        </button>
      </div>

      {enabled && commandHistory.length > 0 && (
        <div className="voice-transcription">
          <strong>Última transcripción:</strong>
          <p>"{commandHistory[commandHistory.length - 1].transcription}"</p>
        </div>
      )}

      <div className="voice-commands">
        <h3>Comandos disponibles</h3>
        <div className="commands-grid">
          <div className="command-item">
            <span className="command-icon">👆</span>
            <div>
              <strong>Clic izquierdo</strong>
              <p>"clic", "seleccionar"</p>
            </div>
          </div>
          <div className="command-item">
            <span className="command-icon">👆👆</span>
            <div>
              <strong>Doble clic</strong>
              <p>"doble clic", "abrir"</p>
            </div>
          </div>
          <div className="command-item">
            <span className="command-icon">👉</span>
            <div>
              <strong>Clic secundario</strong>
              <p>"clic derecho", "menú"</p>
            </div>
          </div>
          <div className="command-item">
            <span className="command-icon">✊</span>
            <div>
              <strong>Mantener</strong>
              <p>"mantener", "arrastrar"</p>
            </div>
          </div>
          <div className="command-item">
            <span className="command-icon">🖐️</span>
            <div>
              <strong>Soltar</strong>
              <p>"soltar", "dejar"</p>
            </div>
          </div>
          <div className="command-item">
            <span className="command-icon">⬆️</span>
            <div>
              <strong>Desplazamiento</strong>
              <p>"scroll arriba", "scroll abajo"</p>
            </div>
          </div>
        </div>
      </div>

      <button className="btn-expand" onClick={() => setExpanded(!expanded)}>
        {expanded ? '▼ Ver menos' : '▲ Ver historial'}
      </button>

      {expanded && (
        <div className="voice-history">
          <h3>Historial de comandos</h3>
          {commandHistory.length === 0 ? (
            <p className="empty">No hay comandos registrados</p>
          ) : commandHistory.map((c, i) => (
            <div key={i} className={`history-item ${c.recognized ? 'ok' : 'fail'}`}>
              <span className="dot">{c.recognized ? '✓' : '✗'}</span>
              <div className="txt">
                <div className="trans">{c.transcription}</div>
                {c.recognized && <div className="act">→ {c.action}{c.magnitude && c.magnitude>1 ? ` (x${c.magnitude})` : ''}</div>}
              </div>
              <span className="time">{new Date(c.timestamp).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
