import React, { useEffect, useState } from 'react';
import { createProfile, type Profile } from '../../types/profile.js';
import '../styles.css';

export default function ProfileManager({
  onClose,
  onActivate,
}: {
  onClose: () => void;
  onActivate: (profile: Profile) => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const load = async () => {
    const data = await window.api.loadProfiles();
    setProfiles(data.profiles || []);
    setActiveId(data.activeId || null);
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const create = () => {
    setEditing(createProfile({ id: Date.now().toString(), name: 'Nuevo perfil' }));
    setIsCreating(true);
  };

  const save = async () => {
    if (!editing) return;

    const updated = isCreating
      ? [...profiles, editing]
      : profiles.map((profile) => (profile.id === editing.id ? editing : profile));

    await window.api.saveProfiles(updated);
    setProfiles(updated);

    if (editing.id === activeId) {
      onActivate(editing);
    }

    setEditing(null);
    setIsCreating(false);
  };

  const del = async (id: string) => {
    if (!confirm('¿Eliminar este perfil?')) return;
    const updated = profiles.filter((profile) => profile.id !== id);
    await window.api.saveProfiles(updated);
    setProfiles(updated);
    if (activeId === id) {
      const nextActive = updated[0] ?? null;
      setActiveId(nextActive?.id ?? null);
      if (nextActive) {
        await window.api.setActiveProfile(nextActive.id);
        await window.api.applyProfile(nextActive);
        onActivate(nextActive);
      }
    }
  };

  const activate = async (profile: Profile) => {
    await window.api.setActiveProfile(profile.id);
    await window.api.applyProfile(profile);
    setActiveId(profile.id);
    onActivate(profile);
  };

  const reset = () => {
    if (!editing) return;
    setEditing(createProfile({ ...editing, id: editing.id, name: editing.name, createdAt: editing.createdAt }));
  };

  return (
    <div className="profile-manager profile-manager-clean surface-card">
      <div className="manager-header">
        <div>
          <span className="section-kicker">Perfiles</span>
          <h2>Configuraciones guardadas</h2>
          <p className="manager-intro">Guarda distintos ajustes para adaptar el sistema a cada persona o situacion de uso.</p>
        </div>
        <button onClick={onClose} className="icon-button">✕</button>
      </div>

      <div className="manager-body">
        <div className="manager-list">
          <div className="manager-list-head">
            <div>
              <h3>Perfiles disponibles</h3>
              <p className="manager-subcopy">Activa uno existente o crea una nueva configuracion.</p>
            </div>
            <button onClick={create} className="btn-primary">+ Crear perfil</button>
          </div>

          {profiles.length === 0 ? (
            <p className="empty">No hay perfiles. Crea uno nuevo.</p>
          ) : profiles.map((profile) => (
            <div key={profile.id} className={`manager-item ${activeId === profile.id ? 'active' : ''}`}>
              <div className="manager-info">
                <h4>{profile.name}</h4>
                <p>
                  Respuesta {profile.sensitivity.toFixed(2)} • Ganancia {profile.gain.toFixed(2)} • Permanencia {profile.dwellMs} ms
                </p>
              </div>
              <div className="manager-actions">
                {activeId !== profile.id && (
                  <button onClick={() => activate(profile)} className="btn-secondary">Activar</button>
                )}
                {activeId === profile.id && <span className="badge-active">✓ Activo</span>}
                <button onClick={() => { setEditing(profile); setIsCreating(false); }} className="btn-secondary">Editar</button>
                <button onClick={() => del(profile.id)} className="btn-danger">Eliminar</button>
              </div>
            </div>
        ))}
      </div>

      {editing && (
          <div className="manager-editor">
            <span className="section-kicker">{isCreating ? 'Nuevo perfil' : 'Edicion'}</span>
            <h3>{isCreating ? 'Crear perfil' : 'Editar perfil'}</h3>

            <label>Nombre del perfil</label>
            <input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />

            <label>Sensibilidad: <strong>{editing.sensitivity.toFixed(2)}</strong></label>
            <input
              type="range"
              min={1.0}
              max={3.5}
              step={0.1}
              value={editing.sensitivity}
              onChange={(event) => setEditing({ ...editing, sensitivity: Number(event.target.value) })}
            />

            <label>Ganancia: <strong>{editing.gain.toFixed(2)}</strong></label>
            <input
              type="range"
              min={0.6}
              max={2.0}
              step={0.1}
              value={editing.gain}
              onChange={(event) => setEditing({ ...editing, gain: Number(event.target.value) })}
            />

            <label>Deadzone: <strong>{editing.deadzone.toFixed(3)}</strong></label>
            <input
              type="range"
              min={0.001}
              max={0.02}
              step={0.0005}
              value={editing.deadzone}
              onChange={(event) => setEditing({ ...editing, deadzone: Number(event.target.value) })}
            />

            <label>Velocidad maxima: <strong>{editing.maxSpeed.toFixed(2)}</strong></label>
            <input
              type="range"
              min={1.0}
              max={3.0}
              step={0.05}
              value={editing.maxSpeed}
              onChange={(event) => setEditing({ ...editing, maxSpeed: Number(event.target.value) })}
            />

            <label>Amplificacion de mirada: <strong>{editing.gazeAmplification.toFixed(2)}</strong></label>
            <input
              type="range"
              min={1.2}
              max={2.8}
              step={0.1}
              value={editing.gazeAmplification}
              onChange={(event) => setEditing({ ...editing, gazeAmplification: Number(event.target.value) })}
            />

            <label>Dwell (ms): <strong>{editing.dwellMs}</strong></label>
            <input
              type="range"
              min={500}
              max={2000}
              step={100}
              value={editing.dwellMs}
              onChange={(event) => setEditing({ ...editing, dwellMs: Number(event.target.value) })}
            />

            <label className="check">
              <input
                type="checkbox"
                checked={editing.voiceEnabled}
                onChange={(event) => setEditing({ ...editing, voiceEnabled: event.target.checked })}
              />
              Voz activa
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={editing.autoClickEnabled}
                onChange={(event) => setEditing({ ...editing, autoClickEnabled: event.target.checked })}
              />
              Autoclick por permanencia
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={editing.headTrackingEnabled}
                onChange={(event) => setEditing({ ...editing, headTrackingEnabled: event.target.checked })}
              />
              Seguimiento activo
            </label>

            <div className="manager-editor-actions">
              <button onClick={() => { setEditing(null); setIsCreating(false); }} className="btn-secondary">Cancelar</button>
              <button onClick={reset} className="btn-secondary">Restablecer</button>
              <button onClick={save} className="btn-primary">Guardar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
