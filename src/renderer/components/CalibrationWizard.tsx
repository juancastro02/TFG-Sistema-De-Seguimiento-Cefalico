import { useEffect, useRef, useState } from 'react'
import { startHeadTracking, applyCalibration, stopHeadTracking, captureNeutralFromCurrent } from '../../tracking/headTracker.js'
import React from 'react';
import '../styles.css';

type Step = 'intro'|'neutral'|'sensitivity'|'corners'|'confirm'
type CalibrationError = 'low_light'|'face_out'|null

interface CalibrationData {
  neutral: { x:number; y:number } | null
  sensitivity: number
  gain: number
  dwellMs: number
  deadzone: number
  maxSpeed: number
}

export default function CalibrationWizard({ onComplete, onCancel }:{
  onComplete: (data:CalibrationData)=>void
  onCancel: ()=>void
}) {
  const [step, setStep] = useState<Step>('intro')
  const [pose, setPose] = useState<{x:number;y:number}|null>(null)
  const [error, setError] = useState<CalibrationError>(null)
  const [progress, setProgress] = useState(0)
  const [data, setData] = useState<CalibrationData>({ 
    neutral: null, 
    sensitivity: 3.5,
    gain: 2.5,
    dwellMs: 1000,
    deadzone: 0.08,
    maxSpeed: 25
  })
  const [corner, setCorner] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const boot = async () => {
      if (!videoRef.current) return
      await startHeadTracking(videoRef.current, () => {}, (p) => {
        setPose(p)
        // Detectar errores
        if (!p?.faceLandmarks?.[0]) {
          setError('face_out')
        } else {
          setError(null)
        }
      })
    }
    boot().catch(console.error)
    return () => {
      try {
        stopHeadTracking()
        const stream = videoRef.current?.srcObject as MediaStream | undefined
        stream?.getTracks()?.forEach(t => t.stop())
      } catch {}
    }
  }, [])

  const captureNeutral = () => {
    if (!pose || error) return;
    captureNeutralFromCurrent();
    setData(prev => ({ ...prev, neutral: { x: 0, y: 0 } }));
    setStep('sensitivity');
    setProgress(33);
  };

  const retryStep = () => {
    setError(null);
  };

  const finish = async () => {
    await window.api.applyProfile({
      sensitivity: data.sensitivity,
      gain: data.gain,
      dwellMs: data.dwellMs,
      deadzone: data.deadzone,
      maxSpeed: data.maxSpeed
    })
    onComplete({ ...data })
  }

  const stepProgress = {
    intro: 0,
    neutral: 25,
    sensitivity: 50,
    corners: 75,
    confirm: 100
  }[step];

  return (
    <div className="calibration-wizard modal">
      <div className="card wizard-card">
        <div className="wizard-progress">
          <div className="wizard-progress-bar" style={{ width: `${stepProgress}%` }}></div>
        </div>

        <video ref={videoRef} style={{ position:'absolute', opacity:0, width:1, height:1 }} playsInline muted />
        
        {step === 'intro' && (
          <div className="wizard-step">
            <div className="wizard-icon">🎯</div>
            <h2 className="wizard-title">Asistente de Calibración</h2>
            <p className="wizard-desc">
              Este asistente te guiará paso a paso para configurar el sistema:
            </p>
            <div className="wizard-steps-preview">
              <div className="preview-step">
                <span className="preview-icon">1️⃣</span>
                <span className="preview-text">Fijar posición neutra</span>
              </div>
              <div className="preview-step">
                <span className="preview-icon">2️⃣</span>
                <span className="preview-text">Ajustar sensibilidad y ganancia</span>
              </div>
              <div className="preview-step">
                <span className="preview-icon">3️⃣</span>
                <span className="preview-text">Probar objetivos</span>
              </div>
              <div className="preview-step">
                <span className="preview-icon">✓</span>
                <span className="preview-text">Confirmar perfil</span>
              </div>
            </div>
            <div className="wizard-actions">
              <button onClick={onCancel} className="btn-secondary">Cancelar</button>
              <button onClick={() => setStep('neutral')} className="btn-primary">
                Comenzar calibración →
              </button>
            </div>
          </div>
        )}

        {step === 'neutral' && (
          <div className="wizard-step">
            <div className="wizard-icon">📍</div>
            <h2 className="wizard-title">Paso 1: Posición Neutra</h2>
            <p className="wizard-desc">
              Sentate cómodamente frente a la <strong>retícula central</strong>.<br/>
              Mirá directamente a la pantalla y mantené tu rostro dentro del cuadro.
            </p>

            <div className="calibration-reticle">
              <div className="reticle-crosshair">
                <div className="reticle-line reticle-h"></div>
                <div className="reticle-line reticle-v"></div>
                <div className="reticle-center"></div>
              </div>
            </div>

            <div className="pose-preview">
              {error === 'low_light' && (
                <div className="calibration-error">
                  <span className="error-icon">⚠️</span>
                  <div>
                    <strong>Iluminación insuficiente</strong>
                    <p>Aumentá la luz del ambiente para mejorar la detección</p>
                  </div>
                </div>
              )}
              {error === 'face_out' && (
                <div className="calibration-error">
                  <span className="error-icon">⚠️</span>
                  <div>
                    <strong>Rostro fuera de cuadro</strong>
                    <p>Centrate en la pantalla y asegurate de que tu cara sea visible</p>
                  </div>
                </div>
              )}
              {!error && pose && (
                <div className="pose-detected">
                  <div className="pose-indicator"></div>
                  <span>✓ Rostro detectado correctamente</span>
                </div>
              )}
              {!error && !pose && (
                <div className="pose-waiting">
                  <div className="spinner"></div>
                  <span>Detectando rostro...</span>
                </div>
              )}
            </div>

            <div className="wizard-actions">
              <button onClick={onCancel} className="btn-secondary">Cancelar</button>
              {error && (
                <button onClick={retryStep} className="btn-secondary">
                  🔄 Reintentar
                </button>
              )}
              <button 
                onClick={captureNeutral} 
                disabled={!pose || !!error} 
                className="btn-primary"
              >
                Capturar posición neutral
              </button>
            </div>
          </div>
        )}

        {step === 'sensitivity' && (
          <div className="wizard-step">
            <div className="wizard-icon">⚙️</div>
            <h2 className="wizard-title">Paso 2: Sensibilidad y Ganancia</h2>
            <p className="wizard-desc">
              Ajustá los parámetros mientras observás la <strong>vista previa de movimiento</strong>.
            </p>
            
            <div className="movement-preview">
              <div className="preview-indicator">
                <span className="preview-label">Vista previa</span>
                <div className="preview-dot" style={{
                  transform: `translate(${(pose?.x || 0.5) * 100}%, ${(pose?.y || 0.5) * 100}%)`
                }}></div>
              </div>
            </div>

            <div className="slider-group">
              <label className="slider-label">
                <span>Sensibilidad</span>
                <span className="slider-value">{data.sensitivity.toFixed(2)}</span>
              </label>
              <input 
                type="range" 
                min={1.0} max={6.0} step={0.5}
                value={data.sensitivity}
                className="slider"
                onChange={(e)=>{ 
                  const v=parseFloat(e.target.value); 
                  setData(d=>({...d,sensitivity:v})); 
                  applyCalibration({sensitivity:v})
                }}
              />
              <div className="slider-hint">
                <span>Baja</span>
                <span>Alta</span>
              </div>
            </div>

            <div className="slider-group">
              <label className="slider-label">
                <span>Ganancia</span>
                <span className="slider-value">{data.gain.toFixed(2)}</span>
              </label>
              <input 
                type="range" 
                min={1.0} max={5.0} step={0.5}
                value={data.gain}
                className="slider"
                onChange={(e)=>{ 
                  const v=parseFloat(e.target.value); 
                  setData(d=>({...d,gain:v})); 
                  applyCalibration({gain:v})
                }}
              />
              <div className="slider-hint">
                <span>Lenta</span>
                <span>Rápida</span>
              </div>
            </div>

            <div className="slider-group">
              <label className="slider-label">
                <span>Tiempo de permanencia (dwell)</span>
                <span className="slider-value">{data.dwellMs}ms</span>
              </label>
              <input 
                type="range" 
                min={500} max={2000} step={100}
                value={data.dwellMs}
                className="slider"
                onChange={(e)=> setData(d=>({...d,dwellMs: parseInt(e.target.value)}))}
              />
              <div className="slider-hint">
                <span>Rápido</span>
                <span>Lento</span>
              </div>
            </div>

            <button onClick={() => setData(prev => ({...prev, sensitivity:3.5, gain:2.5, dwellMs:1000}))} className="btn-secondary">
              🔄 Restablecer valores
            </button>

            <div className="wizard-actions">
              <button onClick={()=> setStep('neutral')} className="btn-secondary">← Atrás</button>
              <button onClick={()=> { setStep('corners'); setProgress(66); }} className="btn-primary">
                Continuar →
              </button>
            </div>
          </div>
        )}

        {step === 'corners' && (
          <div className="wizard-step">
            <div className="wizard-icon">🎯</div>
            <h2 className="wizard-title">Paso 3: Prueba de Objetivos</h2>
            <p className="wizard-desc">
              Movete hacia cada <strong>objetivo en las esquinas y el centro</strong> para validar el rango de movimiento.
            </p>
            
            <div className="corner-test">
              <div className={`corner-target ${corner >= 0 ? 'done' : ''}`}>
                <span className="target-label">Superior izquierda</span>
              </div>
              <div className={`corner-target ${corner >= 1 ? 'done' : ''}`}>
                <span className="target-label">Superior derecha</span>
              </div>
              <div className={`corner-target center ${corner >= 2 ? 'done' : ''}`}>
                <span className="target-label">Centro</span>
              </div>
              <div className={`corner-target ${corner >= 3 ? 'done' : ''}`}>
                <span className="target-label">Inferior izquierda</span>
              </div>
              <div className={`corner-target ${corner >= 4 ? 'done' : ''}`}>
                <span className="target-label">Inferior derecha</span>
              </div>
            </div>

            <div className="wizard-actions">
              <button onClick={()=> setStep('sensitivity')} className="btn-secondary">← Atrás</button>
              <button onClick={retryStep} className="btn-secondary">
                🔄 Reintentar
              </button>
              <button 
                onClick={() => {
                  if (corner < 4) {
                    setCorner(corner + 1);
                  } else {
                    setStep('confirm');
                    setProgress(100);
                  }
                }}
                className="btn-primary"
              >
                {corner < 4 ? 'Marcar objetivo →' : 'Finalizar prueba →'}
              </button>
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <div className="wizard-step">
            <div className="wizard-icon success">✓</div>
            <h2 className="wizard-title">¡Calibración Completada!</h2>
            <p className="wizard-desc">
              Perfil de parámetros configurado correctamente. Revisá los valores finales:
            </p>
            
            <div className="config-summary">
              <div className="summary-item">
                <span className="summary-label">Sensibilidad</span>
                <span className="summary-value">{data.sensitivity.toFixed(2)}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Ganancia</span>
                <span className="summary-value">{data.gain.toFixed(2)}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Tiempo de permanencia</span>
                <span className="summary-value">{data.dwellMs}ms</span>
              </div>
            </div>

            <div className="wizard-actions">
              <button onClick={()=> setStep('sensitivity')} className="btn-secondary">
                ← Ajustar parámetros
              </button>
              <button onClick={finish} className="btn-primary success">
                Activar perfil →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
