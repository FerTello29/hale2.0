/**
 * AIClient — puente con las funciones serverless de Vercel (/api/*).
 *
 * La API key de OpenAI vive solo en el servidor (variables de entorno de
 * Vercel). El navegador habla con /api/command, /api/tactics y
 * /api/transcribe; si no hay servidor (GitHub Pages, servidor local sin
 * `vercel dev`, sin Internet) el cliente queda "sin conexión" y el juego usa
 * su lógica local sin mostrar errores.
 */
import { AI } from '../config.js';

export class AIClient {
  constructor(game) {
    this.game = game;
    this.base = AI.baseUrl.replace(/\/$/, '');
    /** 'unknown' → 'online' | 'offline' | 'nokey' */
    this.status = 'unknown';
    this.probe = null;
  }

  get online() {
    return this.status === 'online';
  }

  #url(path) {
    return `${this.base}/api/${path}`;
  }

  /** Comprueba una sola vez si existe el servidor de IA y si tiene API key. */
  check() {
    if (this.probe) return this.probe;
    this.probe = (async () => {
      try {
        const res = await this.#fetch('health', { method: 'GET' }, 4000);
        const data = await res.json();
        this.status = data?.ok ? (data.ai ? 'online' : 'nokey') : 'offline';
      } catch {
        this.status = 'offline';
      }
      this.game.bus.emit('ai:status', { status: this.status });
      return this.status;
    })();
    return this.probe;
  }

  async #fetch(path, init, timeout = AI.timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(this.#url(path), { ...init, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async #post(path, body) {
    if ((await this.check()) !== 'online') return null;
    try {
      const res = await this.#fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await res.json();
    } catch (err) {
      console.warn(`[IA] /api/${path} no respondió`, err?.message || err);
      return null;
    }
  }

  /** Frase libre → { actions: [...], reply } */
  command(text, context) {
    return this.#post('command', { text, context });
  }

  /** Estado de la partida → decisión táctica. */
  tactics(snapshot) {
    return this.#post('tactics', { snapshot });
  }

  /** Audio grabado (Blob) → { text } */
  async transcribe(blob) {
    if ((await this.check()) !== 'online') return null;
    try {
      const res = await this.#fetch('transcribe', {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm' },
        body: blob,
      }, 12000);
      return await res.json();
    } catch (err) {
      console.warn('[IA] /api/transcribe no respondió', err?.message || err);
      return null;
    }
  }
}
