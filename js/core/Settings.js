/**
 * Settings — parámetros configurables desde la interfaz.
 *
 * Cada cambio se notifica a los sistemas interesados (física, cámara, audio,
 * render) para que el efecto sea inmediato. Se guardan en localStorage cuando
 * está disponible (con try/catch por si el navegador lo bloquea).
 */
import { PHYSICS } from '../config.js';

const STORAGE_KEY = 'veta-airosa:settings:v1';

export const DEFAULT_SETTINGS = {
  difficulty: 'minero',
  gravity: PHYSICS.defaultGravity,
  throwPower: 24,
  sensitivity: 1.0,
  invertY: false,
  fov: 68,
  rockfall: 'normal',
  shadows: true,
  bloom: true,
  showTrajectory: true,
  volume: 0.7,
};

export const SETTING_LIMITS = {
  gravity: { min: 2, max: 25, step: 0.1 },
  throwPower: { min: 10, max: 40, step: 1 },
  sensitivity: { min: 0.2, max: 3, step: 0.05 },
  fov: { min: 50, max: 90, step: 1 },
  volume: { min: 0, max: 1, step: 0.05 },
};

export class Settings {
  constructor() {
    this.values = { ...DEFAULT_SETTINGS, ...this.#load() };
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
    this.#save();
    for (const fn of this.listeners) fn(key, value, this.values);
  }

  reset() {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) this.set(k, v);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  #save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      /* almacenamiento no disponible: se mantienen en memoria */
    }
  }
}

/** Récord local (mejor puntaje por dificultad). */
export const BestScores = {
  key: 'veta-airosa:best:v1',
  get(difficulty) {
    try {
      const all = JSON.parse(localStorage.getItem(this.key) || '{}');
      return all[difficulty] || 0;
    } catch {
      return 0;
    }
  },
  submit(difficulty, score) {
    try {
      const all = JSON.parse(localStorage.getItem(this.key) || '{}');
      const prev = all[difficulty] || 0;
      if (score > prev) {
        all[difficulty] = score;
        localStorage.setItem(this.key, JSON.stringify(all));
        return true;
      }
    } catch {
      /* sin almacenamiento */
    }
    return false;
  },
};
