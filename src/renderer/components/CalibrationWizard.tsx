import React, { useEffect, useRef, useState } from 'react';
import { applyCalibration, captureNeutralFromCurrent } from '../../tracking/headTracker.js';
import { DEFAULT_PROFILE_VALUES, type Profile } from '../../types/profile.js';
import '../styles.css';

type Step = 'intro' | 'neutral' | 'sensitivity' | 'corners' | 'confirm';
type CalibrationError = 'face_out' | null;
type Pose = { nx: number; ny: number } | null;
type CornerTarget = {
  id: 'top-left' | 'top-right' | 'center' | 'bottom-left' | 'bottom-right';
  label: string;
  x: number;
  y: number;
  toleranceX: number;
  toleranceY: number;
  releaseToleranceX: number;
  releaseToleranceY: number;
  isCenter?: boolean;
};

type CalibrationData = Pick<
  Profile,
  'sensitivity' | 'gain' | 'dwellMs' | 'deadzone' | 'maxSpeed' | 'gazeAmplification' | 'neutralX' | 'neutralY'
>;

const CORNER_HOLD_MS = 650;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function buildCornerTargets(neutralX: number, neutralY: number): CornerTarget[] {
  const horizontalReach = 0.16;
  const verticalReach = 0.14;

  return [
    {
      id: 'top-left',
      label: 'Superior izquierda',
      x: clamp01(neutralX - horizontalReach),
      y: clamp01(neutralY - verticalReach),
      toleranceX: 0.12,
      toleranceY: 0.12,
      releaseToleranceX: 0.16,
      releaseToleranceY: 0.16,
    },
    {
      id: 'top-right',
      label: 'Superior derecha',
      x: clamp01(neutralX + horizontalReach),
      y: clamp01(neutralY - verticalReach),
      toleranceX: 0.12,
      toleranceY: 0.12,
      releaseToleranceX: 0.16,
      releaseToleranceY: 0.16,
    },
    {
      id: 'center',
      label: 'Centro',
      x: clamp01(neutralX),
      y: clamp01(neutralY),
      toleranceX: 0.085,
      toleranceY: 0.085,
      releaseToleranceX: 0.11,
      releaseToleranceY: 0.11,
      isCenter: true,
    },
    {
      id: 'bottom-left',
      label: 'Inferior izquierda',
      x: clamp01(neutralX - horizontalReach),
      y: clamp01(neutralY + verticalReach),
      toleranceX: 0.12,
      toleranceY: 0.12,
      releaseToleranceX: 0.16,
      releaseToleranceY: 0.16,
    },
    {
      id: 'bottom-right',
      label: 'Inferior derecha',
      x: clamp01(neutralX + horizontalReach),
      y: clamp01(neutralY + verticalReach),
      toleranceX: 0.12,
      toleranceY: 0.12,
      releaseToleranceX: 0.16,
      releaseToleranceY: 0.16,
    },
  ];
}

function isPoseInsideTarget(pose: NonNullable<Pose>, target: CornerTarget, isHolding = false) {
  const toleranceX = isHolding ? target.releaseToleranceX : target.toleranceX;
  const toleranceY = isHolding ? target.releaseToleranceY : target.toleranceY;

  return (
    Math.abs(pose.nx - target.x) <= toleranceX
    && Math.abs(pose.ny - target.y) <= toleranceY
  );
}

export default function CalibrationWizard({
  pose,
  initialProfile,
  onComplete,
  onCancel,
}: {
  pose: Pose;
  initialProfile: Profile;
  onComplete: (data: CalibrationData) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>('intro');
  const [error, setError] = useState<CalibrationError>(null);
  const [corner, setCorner] = useState(0);
  const [cornerHoldProgress, setCornerHoldProgress] = useState(0);
  const cornerHoldStartedAtRef = useRef<number | null>(null);
  const [data, setData] = useState<CalibrationData>({
    sensitivity: initialProfile.sensitivity,
    gain: initialProfile.gain,
    dwellMs: initialProfile.dwellMs,
    deadzone: initialProfile.deadzone,
    maxSpeed: initialProfile.maxSpeed,
    gazeAmplification: initialProfile.gazeAmplification,
    neutralX: initialProfile.neutralX,
    neutralY: initialProfile.neutralY,
  });

  useEffect(() => {
    setData({
      sensitivity: initialProfile.sensitivity,
      gain: initialProfile.gain,
      dwellMs: initialProfile.dwellMs,
      deadzone: initialProfile.deadzone,
      maxSpeed: initialProfile.maxSpeed,
      gazeAmplification: initialProfile.gazeAmplification,
      neutralX: initialProfile.neutralX,
      neutralY: initialProfile.neutralY,
    });
  }, [initialProfile]);

  useEffect(() => {
    setError(pose ? null : 'face_out');
  }, [pose]);

  useEffect(() => {
    setCorner(0);
    setCornerHoldProgress(0);
    cornerHoldStartedAtRef.current = null;
  }, [step]);

  const cornerTargets = buildCornerTargets(data.neutralX, data.neutralY);
  const activeCornerTarget = cornerTargets[corner] ?? null;
  const previewPose = pose ?? { nx: data.neutralX, ny: data.neutralY };
  const cornerHoldActive = cornerHoldStartedAtRef.current !== null;
  const activeCornerDetected = pose && activeCornerTarget
    ? isPoseInsideTarget(pose, activeCornerTarget, cornerHoldActive)
    : false;
  const offsetX = previewPose.nx - data.neutralX;
  const offsetY = previewPose.ny - data.neutralY;

  useEffect(() => {
    if (step !== 'corners' || corner >= cornerTargets.length || !activeCornerTarget || !activeCornerDetected) {
      if (cornerHoldStartedAtRef.current !== null || cornerHoldProgress > 0) {
        cornerHoldStartedAtRef.current = null;
        setCornerHoldProgress(0);
      }
      return;
    }

    if (cornerHoldStartedAtRef.current !== null) return;

    const startedAt = performance.now();
    cornerHoldStartedAtRef.current = startedAt;
    setCornerHoldProgress(0);

    const intervalId = window.setInterval(() => {
      if (cornerHoldStartedAtRef.current === null) return;

      const elapsed = performance.now() - cornerHoldStartedAtRef.current;
      setCornerHoldProgress(Math.min(elapsed / CORNER_HOLD_MS, 1));
    }, 40);

    const timeoutId = window.setTimeout(() => {
      cornerHoldStartedAtRef.current = null;
      setCornerHoldProgress(0);
      setCorner((prev) => prev + 1);
    }, CORNER_HOLD_MS);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [activeCornerDetected, activeCornerTarget?.id, corner, cornerTargets.length, step]);

  useEffect(() => {
    if (step === 'corners' && corner >= cornerTargets.length) {
      setStep('confirm');
    }
  }, [corner, cornerTargets.length, step]);

  const captureNeutral = () => {
    if (!pose || error) return;
    const neutral = captureNeutralFromCurrent();
    if (!neutral) return;

    setData((prev) => ({
      ...prev,
      neutralX: neutral.x,
      neutralY: neutral.y,
    }));
    setStep('sensitivity');
  };

  const applyPatch = (patch: Partial<CalibrationData>) => {
    setData((prev) => {
      const next = { ...prev, ...patch };
      applyCalibration(next);
      return next;
    });
  };

  const finish = () => {
    onComplete(data);
  };

  const resetDefaults = () => {
    applyPatch({
      sensitivity: DEFAULT_PROFILE_VALUES.sensitivity,
      gain: DEFAULT_PROFILE_VALUES.gain,
      dwellMs: DEFAULT_PROFILE_VALUES.dwellMs,
      deadzone: DEFAULT_PROFILE_VALUES.deadzone,
      maxSpeed: DEFAULT_PROFILE_VALUES.maxSpeed,
      gazeAmplification: DEFAULT_PROFILE_VALUES.gazeAmplification,
    });
  };

  const stepProgress = {
    intro: 0,
    neutral: 25,
    sensitivity: 50,
    corners: 75,
    confirm: 100,
  }[step];

  return (
    <div className="calibration-wizard calibration-wizard-clean">
      <div className="card wizard-card">
        <div className="wizard-context-bar">
          <div className={`context-chip ${pose ? 'good' : 'warn'}`}>
            {pose ? 'Rostro detectado' : 'Sin rostro en camara'}
          </div>
          <div className="context-chip neutral">
            Neutral X {data.neutralX.toFixed(3)}
          </div>
          <div className="context-chip neutral">
            Neutral Y {data.neutralY.toFixed(3)}
          </div>
        </div>

        <div className="wizard-progress">
          <div className="wizard-progress-bar" style={{ width: `${stepProgress}%` }} />
        </div>

        {step === 'intro' && (
          <div className="wizard-step">
            <div className="wizard-icon">1</div>
            <h2 className="wizard-title">Asistente de Calibracion</h2>
            <p className="wizard-desc">Ajusta la posicion neutra y la respuesta del cursor paso a paso, con una experiencia guiada y simple.</p>
            <div className="wizard-steps-preview">
              <div className="preview-step">
                <span className="preview-icon">1</span>
                <span className="preview-text">Fijar posicion neutra</span>
              </div>
              <div className="preview-step">
                <span className="preview-icon">2</span>
                <span className="preview-text">Ajustar sensibilidad y ganancia</span>
              </div>
              <div className="preview-step">
                <span className="preview-icon">3</span>
                <span className="preview-text">Validar rango de movimiento</span>
              </div>
              <div className="preview-step">
                <span className="preview-icon">OK</span>
                <span className="preview-text">Guardar localmente</span>
              </div>
            </div>
            <div className="wizard-actions">
              <button onClick={onCancel} className="btn-secondary">Cancelar</button>
              <button onClick={() => setStep('neutral')} className="btn-primary">Comenzar calibracion →</button>
            </div>
          </div>
        )}

        {step === 'neutral' && (
          <div className="wizard-step">
            <div className="wizard-icon">1</div>
            <h2 className="wizard-title">Paso 1: Posicion Neutra</h2>
            <p className="wizard-desc">
              Sientate frente a la pantalla, mira al centro y manten tu rostro dentro del encuadre.
            </p>

            <div className="calibration-reticle">
              <div className="reticle-crosshair">
                <div className="reticle-line reticle-h" />
                <div className="reticle-line reticle-v" />
                <div className="reticle-center" />
              </div>
            </div>

            <div className="pose-preview">
              {error === 'face_out' && (
                <div className="calibration-error">
                  <span className="error-icon">⚠️</span>
                  <div>
                    <strong>Rostro fuera de cuadro</strong>
                    <p>Centrate en la pantalla y asegurate de que la camara te vea.</p>
                  </div>
                </div>
              )}
              {!error && pose && (
                <div className="pose-detected">
                  <div className="pose-indicator" />
                  <span>Rostro detectado correctamente</span>
                </div>
              )}
            </div>

            <div className="wizard-actions">
              <button onClick={onCancel} className="btn-secondary">Cancelar</button>
              <button onClick={captureNeutral} disabled={!pose || !!error} className="btn-primary">
                Capturar posicion neutral
              </button>
            </div>
          </div>
        )}

        {step === 'sensitivity' && (
          <div className="wizard-step">
            <div className="wizard-icon">2</div>
            <h2 className="wizard-title">Paso 2: Ajuste Fino</h2>
            <p className="wizard-desc">
              Ajusta la respuesta del cursor hasta que el movimiento se sienta natural y comodo.
            </p>

            <div className="movement-preview">
              <div className="preview-indicator">
                <span className="preview-label">Vista previa en vivo</span>
                <div className="preview-axis preview-axis-h" />
                <div className="preview-axis preview-axis-v" />
                <div
                  className="preview-dot preview-dot-neutral"
                  style={{
                    left: `${data.neutralX * 100}%`,
                    top: `${data.neutralY * 100}%`,
                  }}
                />
                <div
                  className={`preview-dot preview-dot-current ${pose ? '' : 'idle'}`}
                  style={{
                    left: `${previewPose.nx * 100}%`,
                    top: `${previewPose.ny * 100}%`,
                  }}
                />
              </div>
            </div>

            <div className="preview-readout">
              <span>{pose ? 'Seguimiento detectado en tiempo real' : 'Esperando deteccion de rostro para mostrar la vista previa'}</span>
              <span>
                X {previewPose.nx.toFixed(2)} | Y {previewPose.ny.toFixed(2)}
              </span>
            </div>

            <Slider
              label="Sensibilidad"
              value={data.sensitivity}
              min={1.0}
              max={3.5}
              step={0.1}
              onChange={(value) => applyPatch({ sensitivity: value })}
            />

            <Slider
              label="Ganancia"
              value={data.gain}
              min={0.6}
              max={2.0}
              step={0.1}
              onChange={(value) => applyPatch({ gain: value })}
            />

            <Slider
              label="Deadzone"
              value={data.deadzone}
              min={0.001}
              max={0.02}
              step={0.0005}
              onChange={(value) => applyPatch({ deadzone: value })}
            />

            <Slider
              label="Velocidad maxima"
              value={data.maxSpeed}
              min={1.0}
              max={3.0}
              step={0.05}
              onChange={(value) => applyPatch({ maxSpeed: value })}
            />

            <Slider
              label="Amplificacion de mirada"
              value={data.gazeAmplification}
              min={1.2}
              max={2.8}
              step={0.1}
              onChange={(value) => applyPatch({ gazeAmplification: value })}
            />

            <div className="slider-group">
              <label className="slider-label">
                <span>Tiempo de permanencia</span>
                <span className="slider-value">{data.dwellMs}ms</span>
              </label>
              <input
                type="range"
                min={500}
                max={2000}
                step={100}
                value={data.dwellMs}
                className="slider"
                onChange={(event) => applyPatch({ dwellMs: Number(event.target.value) })}
              />
            </div>

            <button onClick={resetDefaults} className="btn-secondary">Restablecer valores</button>

            <div className="wizard-actions">
              <button onClick={() => setStep('neutral')} className="btn-secondary">← Atras</button>
              <button onClick={() => setStep('corners')} className="btn-primary">Continuar →</button>
            </div>
          </div>
        )}

        {step === 'corners' && (
          <div className="wizard-step">
            <div className="wizard-icon">3</div>
            <h2 className="wizard-title">Paso 3: Prueba de Objetivos</h2>
            <p className="wizard-desc">
              Comprueba que puedas llegar a los extremos y volver al centro con seguridad. La validacion es automatica.
            </p>

            <div className="corner-status">
              <strong>{activeCornerTarget ? `Objetivo actual: ${activeCornerTarget.label}` : 'Prueba completada'}</strong>
              <span>
                {!pose
                  ? 'Esperando deteccion de rostro.'
                  : activeCornerDetected
                    ? 'Objetivo detectado. Manten la posicion un instante.'
                    : 'Desplaza la mirada o la cabeza hasta el objetivo resaltado.'}
              </span>
              <span>
                Delta X {offsetX >= 0 ? '+' : ''}{offsetX.toFixed(2)} | Delta Y {offsetY >= 0 ? '+' : ''}{offsetY.toFixed(2)}
              </span>
            </div>

            <div className="movement-preview corner-live-preview">
              <div className="preview-indicator">
                <span className="preview-label">Validacion automatica</span>
                <div className="preview-axis preview-axis-h" />
                <div className="preview-axis preview-axis-v" />
                {cornerTargets.map((target, index) => (
                  <div
                    key={target.id}
                    className={`preview-target-marker ${index < corner ? 'done' : ''} ${index === corner ? 'active' : ''} ${target.isCenter ? 'center' : ''}`}
                    style={{
                      left: `${target.x * 100}%`,
                      top: `${target.y * 100}%`,
                    }}
                  />
                ))}
                <div
                  className="preview-dot preview-dot-neutral"
                  style={{
                    left: `${data.neutralX * 100}%`,
                    top: `${data.neutralY * 100}%`,
                  }}
                />
                <div
                  className={`preview-dot preview-dot-current ${pose ? '' : 'idle'}`}
                  style={{
                    left: `${previewPose.nx * 100}%`,
                    top: `${previewPose.ny * 100}%`,
                  }}
                />
              </div>
            </div>

            <div className="corner-progress">
              <div className="corner-progress-fill" style={{ width: `${cornerHoldProgress * 100}%` }} />
            </div>

            <div className="corner-test">
              {cornerTargets.map((target, index) => (
                <div
                  key={target.id}
                  className={`corner-target ${target.isCenter ? 'center' : ''} ${index < corner ? 'done' : ''} ${index === corner ? 'active' : ''}`}
                >
                  <span className="target-label">{target.label}</span>
                  <span className="target-hint">
                    {index < corner ? 'Validado' : index === corner ? 'En seguimiento' : 'Pendiente'}
                  </span>
                </div>
              ))}
            </div>

            <div className="wizard-actions">
              <button onClick={() => setStep('sensitivity')} className="btn-secondary">← Atras</button>
              <button
                onClick={() => {
                  setCorner(0);
                  setCornerHoldProgress(0);
                  cornerHoldStartedAtRef.current = null;
                }}
                className="btn-secondary"
              >
                Reiniciar prueba
              </button>
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <div className="wizard-step">
            <div className="wizard-icon success">OK</div>
            <h2 className="wizard-title">Calibracion completada</h2>
            <p className="wizard-desc">Estos valores se guardaran localmente en el perfil activo.</p>

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
                <span className="summary-label">Deadzone</span>
                <span className="summary-value">{data.deadzone.toFixed(3)}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Tiempo de permanencia</span>
                <span className="summary-value">{data.dwellMs}ms</span>
              </div>
            </div>

            <div className="wizard-actions">
              <button onClick={() => setStep('sensitivity')} className="btn-secondary">← Ajustar</button>
              <button onClick={finish} className="btn-primary success">Guardar perfil →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="slider-group">
      <label className="slider-label">
        <span>{label}</span>
        <span className="slider-value">{value.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1)}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        className="slider"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
