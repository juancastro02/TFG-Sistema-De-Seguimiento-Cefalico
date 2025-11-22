import React from 'react'
import { useEffect, useState } from 'react'
import '../styles.css';

interface Profile {
  id: string
  name: string
  createdAt: number
  sensitivity: number
  gain: number
  dwellMs: number
  voiceEnabled: boolean
  headTrackingEnabled: boolean
}

export default function ProfileManager({ onClose }:{ onClose: ()=>void }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [previewMovement, setPreviewMovement] = useState<{x:number;y:number}>({x:50,y:50})

  useEffect(() => { load() }, [])
  const load = async () => {
    const data = await window.api.loadProfiles()
    setProfiles(data.profiles || [])
    setActiveId(data.activeId || null)
  }

  const create = () => {
    const p: Profile = {
      id: Date.now().toString(),
      name: 'Nuevo Perfil',
      createdAt: Date.now(),
      sensitivity: 3.5, 
      gain: 2.5, 
      dwellMs: 1000,
      voiceEnabled: true, 
      headTrackingEnabled: true
    }
    setEditing(p); 
    setIsCreating(true)
  }

  const save = async () => {
    if (!editing) return
    const updated = isCreating ? [...profiles, editing] : profiles.map(p => p.id===editing.id ? editing : p)
    await window.api.saveProfiles(updated)
    setProfiles(updated); 
    setEditing(null); 
    setIsCreating(false)
  }

  const del = async (id: string) => {
    if (!confirm('¿Eliminar este perfil?')) return
    const updated = profiles.filter(p => p.id !== id)
    await window.api.saveProfiles(updated)
    setProfiles(updated)
    if (activeId === id) setActiveId(null)
  }

  const activate = async (p: Profile) => {
    await window.api.setActiveProfile(p.id)
    setActiveId(p.id)
    await window.api.applyProfile(p)
  }

  const reset = () => {
    if (!editing) return;
    setEditing({...editing, sensitivity:3.5, gain:2.5, dwellMs:1000})
  }

  return (
    <div className="manager modal card">
      <div className="header">
        <h2>⚙️ Configuración y Perfiles</h2>
        <button onClick={onClose} className="close">✕</button>
      </div>

      <div className="content">
        <div className="list">
          <div className="list-head">
            <h3>Perfiles guardados</h3>
            <button onClick={create} className="btn-primary">+ Crear perfil</button>
          </div>

          {profiles.length === 0 ? <p className="empty">No hay perfiles. Crea uno nuevo.</p> :
            profiles.map(p => (
              <div key={p.id} className={`item ${activeId===p.id?'active':''}`}>
                <div className="info">
                  <h4>{p.name}</h4>
                  <p>Sens {p.sensitivity.toFixed(2)} • Gan {p.gain.toFixed(2)} • Dwell {p.dwellMs}ms</p>
                </div>
                <div className="actions">
                  {activeId!==p.id && <button onClick={()=>activate(p)} className="btn-secondary">Activar</button>}
                  {activeId===p.id && <span className="badge-active">✓ Activo</span>}
                  <button onClick={()=>{setEditing(p); setIsCreating(false)}} className="btn-secondary">✏️</button>
                  <button onClick={()=>del(p.id)} className="btn-danger">🗑️</button>
                </div>
              </div>
            ))
          }
        </div>

        {editing && (
          <div className="editor">
            <h3>{isCreating?'Crear Perfil':'Editar Perfil'}</h3>
            
            <label>Nombre del perfil</label>
            <input value={editing.name} onChange={e=> setEditing({...editing!, name:e.target.value})} />
            
            <div className="movement-preview-mini">
              <div className="preview-dot" style={{
                left: `${editing.sensitivity * 10}%`,
                top: `${editing.gain * 10}%`
              }}></div>
              <span className="preview-label">Vista previa (simulada)</span>
            </div>

            <label>Sensibilidad: <strong>{editing.sensitivity.toFixed(2)}</strong></label>
            <input type="range" min={1} max={6} step={0.5}
                   value={editing.sensitivity}
                   onChange={e=> setEditing({...editing!, sensitivity: parseFloat(e.target.value)})} />
            
            <label>Ganancia: <strong>{editing.gain.toFixed(2)}</strong></label>
            <input type="range" min={1} max={5} step={0.5}
                   value={editing.gain}
                   onChange={e=> setEditing({...editing!, gain: parseFloat(e.target.value)})} />
            
            <label>Dwell (ms): <strong>{editing.dwellMs}</strong></label>
            <input type="range" min={500} max={2000} step={100}
                   value={editing.dwellMs}
                   onChange={e=> setEditing({...editing!, dwellMs: parseInt(e.target.value)})} />
            
            <label className="check">
              <input type="checkbox" checked={editing.voiceEnabled}
                   onChange={e=> setEditing({...editing!, voiceEnabled: e.target.checked})}/>
              Voz activa
            </label>
            
            <label className="check">
              <input type="checkbox" checked={editing.headTrackingEnabled}
                   onChange={e=> setEditing({...editing!, headTrackingEnabled: e.target.checked})}/>
              Seguimiento activo
            </label>

            <div className="editor-actions">
              <button onClick={()=>{setEditing(null); setIsCreating(false)}} className="btn-secondary">Cancelar</button>
              <button onClick={reset} className="btn-secondary">🔄 Restablecer</button>
              <button onClick={save} className="btn-primary">Guardar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
