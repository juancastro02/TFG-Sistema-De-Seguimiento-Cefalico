import { DEFAULT_PROFILE_VALUES } from '../types/profile.js';

export class EMA {
  private alpha: number;
  private x: number | null = null;
  private y: number | null = null;

  constructor(alpha: number = 0.24) {
    this.alpha = alpha;
  }
  
  update(nx: number, ny: number): [number, number] {
    if (this.x === null || this.y === null) {
      this.x = nx; this.y = ny;
    } else {
      this.x = this.alpha * nx + (1 - this.alpha) * this.x;
      this.y = this.alpha * ny + (1 - this.alpha) * this.y;
    }
    return [this.x, this.y];
  }
  
  reset() { this.x = null; this.y = null; }
}

const LANDMARKS = {
  LEFT_EYE: [33, 160, 158, 133, 153, 144, 163, 7],
  LEFT_IRIS_CENTER: 468,
  LEFT_PUPIL: 468,
  RIGHT_EYE: [263, 387, 385, 362, 380, 373, 390, 249],
  RIGHT_IRIS_CENTER: 473,
  RIGHT_PUPIL: 473,
  NOSE_TIP: 1,
  NOSE_BRIDGE: 6,
  FACE_CENTER: 168,
  FOREHEAD: 10,
  CHIN: 152
};

type Calib = {
  neutralX: number;
  neutralY: number;
  gain: number;
  sensitivity: number;
  deadzone: number;
  maxSpeed: number;
  gazeAmplification: number;
};

const calib: Calib = {
  neutralX: DEFAULT_PROFILE_VALUES.neutralX,
  neutralY: DEFAULT_PROFILE_VALUES.neutralY,
  gain: DEFAULT_PROFILE_VALUES.gain,
  sensitivity: DEFAULT_PROFILE_VALUES.sensitivity,
  deadzone: DEFAULT_PROFILE_VALUES.deadzone,
  maxSpeed: DEFAULT_PROFILE_VALUES.maxSpeed,
  gazeAmplification: DEFAULT_PROFILE_VALUES.gazeAmplification,
};

let paused = false;
let dwellClickEnabled = false;
let lastObsNorm: { x: number; y: number } | null = null;
let ema = new EMA(0.24);
let currentScreenPos: { x: number; y: number } | null = null;
let screenSize: { width: number; height: number } | null = null;
let lastObservationAt = 0;

type OnPose = (pose: { nx: number; ny: number } | null) => void;

let mediaStream: MediaStream | null = null;
let rafId: number | null = null;
let movementRafId: number | null = null;
let faceLandmarker: any = null;
let videoRef: HTMLVideoElement | null = null;
let runningMode: "VIDEO" = "VIDEO";
let movementLoopRunning = false;

const TASKS_VISION_VER = "0.10.22-rc.20250304";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VER}/wasm`;
const MODEL_ASSET =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const LOST_TRACKING_TIMEOUT_MS = 180;

function extractGazePosition(landmarks: any[]): { x: number; y: number } {
  try {
    const leftIris = landmarks[LANDMARKS.LEFT_IRIS_CENTER];
    const rightIris = landmarks[LANDMARKS.RIGHT_IRIS_CENTER];
    
    const leftEyePoints = LANDMARKS.LEFT_EYE.map(i => landmarks[i]);
    const rightEyePoints = LANDMARKS.RIGHT_EYE.map(i => landmarks[i]);
    
    const leftEyeCenter = {
      x: leftEyePoints.reduce((sum, p) => sum + p.x, 0) / leftEyePoints.length,
      y: leftEyePoints.reduce((sum, p) => sum + p.y, 0) / leftEyePoints.length
    };
    
    const rightEyeCenter = {
      x: rightEyePoints.reduce((sum, p) => sum + p.x, 0) / rightEyePoints.length,
      y: rightEyePoints.reduce((sum, p) => sum + p.y, 0) / rightEyePoints.length
    };
    
    const leftGazeOffset = {
      x: (leftIris.x - leftEyeCenter.x) * calib.gazeAmplification,
      y: (leftIris.y - leftEyeCenter.y) * calib.gazeAmplification
    };
    
    const rightGazeOffset = {
      x: (rightIris.x - rightEyeCenter.x) * calib.gazeAmplification,
      y: (rightIris.y - rightEyeCenter.y) * calib.gazeAmplification
    };
    
    const gazeX = (leftGazeOffset.x + rightGazeOffset.x) / 2;
    const gazeY = (leftGazeOffset.y + rightGazeOffset.y) / 2;
    
    const noseTip = landmarks[LANDMARKS.NOSE_TIP];
    
    const x = (noseTip.x * 0.45) + ((0.5 + gazeX) * 0.55);
    const y = (noseTip.y * 0.45) + ((0.5 + gazeY) * 0.55);
    
    return { x: clamp01(x), y: clamp01(y) };
    
  } catch (e) {
    console.error('[gaze] Error extrayendo posición:', e);
    const nose = landmarks[LANDMARKS.NOSE_TIP];
    return { x: nose.x, y: nose.y };
  }
}

function calculateVelocity(nx: number, ny: number): [number, number] {
  const RESPONSE_WINDOW = 0.18;

  let dx = nx - calib.neutralX;
  let dy = ny - calib.neutralY;

  const applyDeadzone = (value: number): number => {
    const sign = Math.sign(value);
    const abs = Math.abs(value);
    if (abs < calib.deadzone) return 0;
    const normalized = clamp((abs - calib.deadzone) / Math.max(RESPONSE_WINDOW - calib.deadzone, 0.001), 0, 1);
    return sign * Math.pow(normalized, 0.82);
  };

  dx = applyDeadzone(dx);
  dy = applyDeadzone(dy);

  if (dx === 0 && dy === 0) {
    return [0, 0];
  }

  const magnitude = Math.hypot(dx, dy);

  const dirX = dx / magnitude;
  const dirY = dy / magnitude;

  let baseSpeed = (0.16 + magnitude * 0.94) * calib.sensitivity * calib.gain;

  const baseSpeedMag = Math.hypot(dirX * baseSpeed, dirY * baseSpeed);
  if (baseSpeedMag > calib.maxSpeed) {
    const scale = calib.maxSpeed / baseSpeedMag;
    baseSpeed *= scale;
  }

  const pixelMultiplier = 10 + magnitude * 46;

  let vx = dirX * baseSpeed * pixelMultiplier;
  let vy = dirY * baseSpeed * pixelMultiplier;

  const maxPixelsPerStep = 10 + calib.maxSpeed * 32;
  const maxPixelsMagnitude = Math.hypot(vx, vy);
  if (maxPixelsMagnitude > maxPixelsPerStep) {
    const scale = maxPixelsPerStep / maxPixelsMagnitude;
    vx *= scale;
    vy *= scale;
  }

  return [vx, vy];
}

let lastMoveTime = 0;
const MOVE_INTERVAL = 16;

async function refreshScreenSize() {
  screenSize = await window.native.getScreenSize();
  return screenSize;
}

async function movementLoop() {
  if (!movementLoopRunning) return;

  const now = performance.now();
  const elapsed = now - lastMoveTime;
  const trackingIsFresh = Date.now() - lastObservationAt <= LOST_TRACKING_TIMEOUT_MS;

  if (elapsed >= MOVE_INTERVAL && !paused && lastObsNorm && currentScreenPos && trackingIsFresh) {
    lastMoveTime = now;
    
    const [vx, vy] = calculateVelocity(lastObsNorm.x, lastObsNorm.y);
    
    if (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05) {
      try {
        const { width, height } = screenSize ?? await refreshScreenSize();
        
        const timeFactor = Math.min(elapsed / MOVE_INTERVAL, 2.0);
        let newX = currentScreenPos.x + (vx * timeFactor);
        let newY = currentScreenPos.y + (vy * timeFactor);

        newX = clamp(newX, 0, width - 1);
        newY = clamp(newY, 0, height - 1);

        currentScreenPos = { x: newX, y: newY };
        await window.native.move(Math.round(newX), Math.round(newY));
      } catch (e) {
        console.error('[movementLoop] error:', e);
      }
    }
  }

  movementRafId = requestAnimationFrame(movementLoop);
}

export async function clickFromGesture(button: 'left'|'right'|'middle' = 'left') {
  if (paused) return;
  console.log(`[headTracker] clickFromGesture(${button})`);
  await window.native.click(button);
}

export async function scrollFromGesture(dx = 0, dy = 0) {
  if (paused) return;
  console.log(`[headTracker] scrollFromGesture(dx=${dx}, dy=${dy})`);
  await window.native.scroll(dx, dy);
}

export async function holdFromGesture(button: 'left' | 'right' = 'left') {
  if (paused) return;
  console.log(`[headTracker] holdFromGesture(${button})`);
  await window.native.mouseDown?.(button);
}

export async function releaseFromGesture(button: 'left' | 'right' = 'left') {
  if (paused) return;
  console.log(`[headTracker] releaseFromGesture(${button})`);
  await window.native.mouseUp?.(button);
}

export function setPaused(v: boolean) { 
  console.log(`[headTracker] setPaused(${v})`);
  paused = v; 
}

export function setDwellClickEnabled(v: boolean) { 
  console.log(`[headTracker] setDwellClickEnabled(${v})`);
  dwellClickEnabled = v; 
}

export function getDwellClickEnabled() { 
  return dwellClickEnabled; 
}

export function applyCalibration(patch: Partial<Calib>) {
  console.log('[headTracker] applyCalibration:', patch);
  if (typeof patch.neutralX === 'number') calib.neutralX = clamp01(patch.neutralX);
  if (typeof patch.neutralY === 'number') calib.neutralY = clamp01(patch.neutralY);
  if (typeof patch.gain === 'number') calib.gain = patch.gain;
  if (typeof patch.sensitivity === 'number') calib.sensitivity = patch.sensitivity;
  if (typeof patch.deadzone === 'number') calib.deadzone = patch.deadzone;
  if (typeof patch.maxSpeed === 'number') calib.maxSpeed = patch.maxSpeed;
  if (typeof patch.gazeAmplification === 'number') calib.gazeAmplification = patch.gazeAmplification;
}

export function captureNeutralFromCurrent() {
  if (lastObsNorm) {
    console.log('[headTracker] captureNeutral:', lastObsNorm);
    calib.neutralX = lastObsNorm.x;
    calib.neutralY = lastObsNorm.y;
    ema.reset();
    return { x: calib.neutralX, y: calib.neutralY };
  }
  return null;
}

export async function getScreen() {
  return window.native.getScreenSize();
}

async function ensureFaceLandmarker() {
  if (faceLandmarker) return faceLandmarker;

  console.log('[headTracker] Inicializando MediaPipe con iris tracking...');
  const mp = await import("@mediapipe/tasks-vision");
  const filesetResolver = await mp.FilesetResolver.forVisionTasks(WASM_BASE);
  
  faceLandmarker = await mp.FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: { modelAssetPath: MODEL_ASSET },
    runningMode: runningMode,
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  
  console.log('[headTracker] MediaPipe listo con iris tracking');
  return faceLandmarker;
}

export async function startHeadTracking(
  videoEl: HTMLVideoElement,
  onPose: OnPose,
  onDebug?: (raw: any) => void
): Promise<void> {
  console.log('[headTracker] startHeadTracking() con eye gaze');
  await stopHeadTracking();
  ema.reset();

  videoRef = videoEl;

  console.log('[headTracker] Solicitando cámara HD...');
  mediaStream = await navigator.mediaDevices.getUserMedia({
    video: { 
      facingMode: "user", 
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 60 }
    },
    audio: false,
  });
  videoEl.srcObject = mediaStream;
  
  videoEl.setAttribute('playsinline', '');
  videoEl.muted = true;
  
  await videoEl.play();
  console.log('[headTracker] Cámara HD iniciada');

  const { width, height } = await refreshScreenSize();
  currentScreenPos = { x: width / 2, y: height / 2 };

  await ensureFaceLandmarker();

  const loop = () => {
    if (!videoRef || !faceLandmarker) return;

    const now = performance.now();
    const res = faceLandmarker.detectForVideo(videoRef, now);
    
    if (res && res.faceLandmarks && res.faceLandmarks[0]) {
      const lm = res.faceLandmarks[0];
      const gazePos = extractGazePosition(lm);
      
      const nx = clamp01(1 - gazePos.x);
      const ny = clamp01(gazePos.y);

      const [smoothX, smoothY] = ema.update(nx, ny);
      lastObsNorm = { x: smoothX, y: smoothY };
      lastObservationAt = Date.now();

      onPose({ nx: smoothX, ny: smoothY });
      onDebug?.(res);
    } else {
      lastObsNorm = null;
      lastObservationAt = 0;
      onPose(null);
    }

    rafId = requestAnimationFrame(loop);
  };

  rafId = requestAnimationFrame(loop);

  if (!movementLoopRunning) {
    console.log('[headTracker] Iniciando movement loop');
    movementLoopRunning = true;
    lastMoveTime = performance.now();
    movementRafId = requestAnimationFrame(movementLoop);
  }
}

export async function stopHeadTracking(): Promise<void> {
  console.log('[headTracker] stopHeadTracking()');
  
  movementLoopRunning = false;

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (movementRafId !== null) {
    cancelAnimationFrame(movementRafId);
    movementRafId = null;
  }
  
  if (mediaStream) {
    try {
      mediaStream.getTracks().forEach(t => t.stop());
    } catch {}
    mediaStream = null;
  }
  
  if (videoRef) {
    try {
      (videoRef as any).srcObject = null;
      videoRef = null;
    } catch {}
  }
  
  if (faceLandmarker) {
    try {
      await faceLandmarker.close?.();
    } catch {}
    faceLandmarker = null;
  }

  currentScreenPos = null;
  screenSize = null;
  lastObsNorm = null;
  lastObservationAt = 0;
  ema.reset();
}
