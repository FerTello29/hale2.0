/**
 * Settings — parámetros configurables desde la interfaz y progreso guardado.
 *
 * Cada cambio se notifica a los sistemas interesados (física, cámara, audio,
 * render) para que el efecto sea inmediato. Se guardan en localStorage cuando
 * está disponible (con try/catch por si el navegador lo bloquea).
 */
import { PHYSICS } from '../config.js';

const STORAGE_KEY = 'eco-orion:settings:v1';
const PROGRESS_KEY = 'eco-orion:progress:v1';

export const DEFAULT_SETTINGS = {
  difficulty: 'veterano',
  gravity: PHYSICS.defaultGravity,
  sensitivity: 1.0,
  invertY: false,
  fov: 70,
  shadows: true,
  bloom: true,
  showTrajectory: true,
  damageNumbers: true,
  volume: 0.75,
  music: 0.55,
  voice: false,
  gestures: false,
  aiDirector: true,
  aiVoice: true,
  vrView: 'third',
};

export const SETTING_LIMITS = {
  gravity: { min: 2, max: 25, step: 0.1 },
  sensitivity: { min: 0.2, max: 3, step: 0.05 },
  fov: { min: 55, max: 95, step: 1 },
  volume: { min: 0, max: 1, step: 0.05 },
  music: { min: 0, max: 1, step: 0.05 },
};

const safeRead = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const safeWrite = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* almacenamiento no disponible: se mantiene en memoria */
  }
};

export class Settings {
  constructor() {
    this.values = { ...DEFAULT_SETTINGS, ...safeRead(STORAGE_KEY, {}) };
    this.listeners = new Set();
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (!(key in DEFAULT_SETTINGS)) return;
    const lim = SETTING_LIMITS[key];
    if (lim) value = Math.min(lim.max, Math.max(lim.min, Number(value)));
    if (this.values[key] === value) return;
    this.values[key] = value;
    safeWrite(STORAGE_KEY, this.values);
    for (const fn of this.listeners) fn(key, value, this.values);
  }

  reset() {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) this.set(k, v);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** Progreso de campaña: niveles desbloqueados y mejores puntajes. */
export const Progress = {
  data: safeRead(PROGRESS_KEY, { unlocked: 1, best: {}, completed: false }),
  save() {
    safeWrite(PROGRESS_KEY, this.data);
  },
  unlocked() {
    return this.data.unlocked || 1;
  },
  unlock(level) {
    if (level > this.unlocked()) {
      this.data.unlocked = Math.min(3, level);
      this.save();
    }
  },
  best(level, difficulty) {
    return this.data.best?.[`${level}:${difficulty}`] || 0;
  },
  submit(level, difficulty, score) {
    const key = `${level}:${difficulty}`;
    this.data.best = this.data.best || {};
    const prev = this.data.best[key] || 0;
    if (score > prev) {
      this.data.best[key] = score;
      this.save();
      return true;
    }
    return false;
  },
  markCompleted() {
    this.data.completed = true;
    this.save();
  },
};
