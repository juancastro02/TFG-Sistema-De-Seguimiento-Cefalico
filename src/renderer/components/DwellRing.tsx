import { useEffect, useRef, useState } from 'react'
import React from 'react'
import { clickFromGesture } from '../../tracking/headTracker.js'
import '../styles.css';


export default function DwellRing({
  cursorX, cursorY, dwellMs, isPaused, isStable, enabled = false
}:{
  cursorX: number
  cursorY: number
  dwellMs: number
  isPaused: boolean
  isStable: boolean
  enabled?: boolean
}) {
  const [progress, setProgress] = useState(0)
  const [state, setState] = useState<'idle'|'arming'|'filling'|'completed'>('idle')
  const [isExecuting, setIsExecuting] = useState(false);

  const startTimeRef = useRef<number | null>(null)
  const armRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const completionRef = useRef<number | null>(null)
  const awaitingMovementResetRef = useRef(false)

  const RING = 40
  const ARM_MS = 240

  useEffect(() => {
    return () => {
      clearTimers();
      awaitingMovementResetRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || isPaused) {
      awaitingMovementResetRef.current = false
      setIsExecuting(false)
      reset()
      return;
    }

    if (!isStable) {
      if (awaitingMovementResetRef.current) {
        awaitingMovementResetRef.current = false
      }
      setIsExecuting(false)
      reset()
      return
    }

    if (awaitingMovementResetRef.current || isExecuting) {
      return
    }

    if (state === 'idle') {
      setState('arming')
      armRef.current = window.setTimeout(() => {
        startTimeRef.current = Date.now()
        setState('filling')
      }, ARM_MS)
      return
    }

    if (state !== 'filling') return

    const animate = () => {
      if (!startTimeRef.current) return
      const elapsed = Date.now() - startTimeRef.current
      const p = Math.min((elapsed / dwellMs) * 100, 100)
      setProgress(p)
      
      if (p >= 100 && !isExecuting) {
        setState('completed')
        setIsExecuting(true);
        clearTimers();
        
        if (enabled) {
          clickFromGesture('left')
            .then(() => {
              completionRef.current = window.setTimeout(() => {
                awaitingMovementResetRef.current = true
                setIsExecuting(false)
                reset()
              }, 450);
            })
            .catch((e) => {
              console.error('[DwellRing] Error:', e);
              setIsExecuting(false);
              reset();
            });
        }
      } else if (p < 100) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => { 
      if (rafRef.current) cancelAnimationFrame(rafRef.current) 
    }
  }, [isStable, isPaused, dwellMs, enabled, state, isExecuting])

  const reset = () => {
    setProgress(0)
    setState('idle')
    clearTimers()
  }

  const clearTimers = () => {
    if (armRef.current) { 
      clearTimeout(armRef.current); 
      armRef.current = null 
    }
    startTimeRef.current = null
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (completionRef.current) {
      clearTimeout(completionRef.current)
      completionRef.current = null
    }
  }

  if (!enabled || state === 'idle' || !isStable) return null

  const circ = 2 * Math.PI * 18
  const sdo = circ - (progress / 100) * circ

  return (
    <div
      style={{
        position: 'fixed',
        left: cursorX - RING / 2,
        top: cursorY - RING / 2,
        width: RING,
        height: RING,
        pointerEvents: 'none',
        zIndex: 10000,
        transform: state === 'completed' ? 'scale(1.15)' : 'scale(1)',
        transition: state === 'completed' ? 'transform 0.2s ease-out' : 'none'
      }}
    >
      <svg width={RING} height={RING}>
        <circle cx={RING/2} cy={RING/2} r={18} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3"/>
        <circle cx={RING/2} cy={RING/2} r={18} fill="none" stroke="#3b82f6" strokeWidth="3"
                strokeDasharray={circ} strokeDashoffset={sdo} strokeLinecap="round"
                transform={`rotate(-90 ${RING/2} ${RING/2})`} />
        {state === 'completed' && <circle cx={RING/2} cy={RING/2} r={4} fill="#10b981" />}
      </svg>
    </div>
  )
}
