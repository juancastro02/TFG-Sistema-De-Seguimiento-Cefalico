import React from 'react'
import { useEffect, useRef, useState } from 'react'

import '../styles.css';

export default function StatusHUD() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [voiceState, setVoiceState] = useState<'listening'|'processing'|'paused'|'error'>('paused')
  const [voiceMsg, setVoiceMsg] = useState<string>('Mic apagado')

  useEffect(() => {
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: 240, height: 160 }, audio: false })
        if (videoRef.current) {
          videoRef.current.srcObject = s
          await videoRef.current.play()
        }
      } catch {}
    })()

    const unsub1 = window.api.on('voice:status', (p: {state:string; message:string}) => {
      const st = (p?.state || 'paused') as any
      setVoiceState(st)
      setVoiceMsg(p?.message || '')
    }) as unknown as (() => void) | undefined;
    return () => { if (unsub1) unsub1() }
  }, [])

  const color = {
    listening: '#10b981',
    processing: '#3b82f6',
    paused: '#9ca3af',
    error: '#ef4444'
  }[voiceState]

  return (
    <div style={{
      position:'fixed', right: 16, bottom: 16, zIndex: 9999,
      display:'flex', gap:12, alignItems:'center'
    }}>
      <div style={{
        position:'relative', width: 160, height: 100, overflow:'hidden',
        borderRadius: 12, boxShadow:'0 6px 24px rgba(0,0,0,.25)', border:'1px solid rgba(255,255,255,.08)'
      }}>
        <video ref={videoRef} muted playsInline style={{ width:'100%', height:'100%', objectFit:'cover' }} />
        <div style={{
          position:'absolute', top:6, left:6, background:'rgba(0,0,0,.45)', color:'#fff',
          padding:'4px 8px', borderRadius: 8, fontSize:12
        }}>Cámara</div>
      </div>

      <div style={{
        background:'#0f172a', color:'#e5e7eb', padding:'10px 12px',
        borderRadius:12, boxShadow:'0 6px 24px rgba(0,0,0,.25)', border:'1px solid rgba(255,255,255,.06)'
      }}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <span style={{
            width:10, height:10, borderRadius:999, background: color
          }} />
          <strong style={{fontSize:13}}>Micrófono</strong>
        </div>
        <div style={{fontSize:12, opacity:.85, marginTop:4}}>{voiceMsg}</div>
        <div style={{marginTop:8, display:'flex', gap:8}}>
          <button onClick={()=> window.api.voiceToggle(true)}
            style={btnStyle}>Activar</button>
          <button onClick={()=> window.api.voicePause()}
            style={btnStyle}>Pausar</button>
          <button onClick={()=> window.api.voiceResume()}
            style={btnStyle}>Reanudar</button>
        </div>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background:'#111827', color:'#e5e7eb', border:'1px solid #1f2937',
  borderRadius:8, padding:'6px 10px', fontSize:12, cursor:'pointer'
}
