/**
 * GestureControl — controla a NOVA-7 con gestos de la mano frente a la cámara.
 *
 * Usa MediaPipe Gesture Recognizer (Google) en el propio navegador: el video
 * de la cámara se analiza en el dispositivo y NUNCA se envía a ningún
 * servidor. Se muestra la cámara (en espejo) con el esqueleto de la mano
 * detectada y una guía ilustrada de los gestos, resaltando el que se reconoce.
 *
 * Se pueden usar las dos manos a la vez (p. ej. ✋ para avanzar con una y ☝️
 * para disparar con la otra). Con la palma abierta, mover la mano hacia un
 * lado de la imagen gira la cámara.
 */

const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const SOURCE = 'gesture';
const DETECT_INTERVAL = 1000 / 20; // ms (≈20 detecciones por segundo)
const MIN_SCORE = 0.55;
const STABLE = 2; // detecciones seguidas para aceptar o soltar un gesto

/** Gestos reconocidos, su ilustración y su acción en el juego. */
export const GESTURES = [
  { id: 'Open_Palm', emoji: '✋', name: 'Palma abierta', action: 'Avanzar', detail: 'mueve la mano a un lado para girar' },
  { id: 'Closed_Fist', emoji: '✊', name: 'Puño', action: 'Detenerse', detail: 'suelta todo lo que esté activo' },
  { id: 'Pointing_Up', emoji: '☝️', name: 'Índice arriba', action: 'Disparar', detail: 'mientras lo mantengas' },
  { id: 'Victory', emoji: '✌️', name: 'Amor y paz', action: 'Saltar', detail: '' },
  { id: 'Thumb_Up', emoji: '👍', name: 'Pulgar arriba', action: 'Recargar', detail: '' },
  { id: 'Thumb_Down', emoji: '👎', name: 'Pulgar abajo', action: 'Retroceder', detail: 'mientras lo mantengas' },
  { id: 'ILoveYou', emoji: '🤟', name: 'Te quiero', action: 'Interactuar', detail: 'baliza, nave (como E)' },
];
const BY_ID = Object.fromEntries(GESTURES.map((g) => [g.id, g]));
const HOLDS = { Open_Palm: 'forward', Thumb_Down: 'back' };

const $ = (id) => document.getElementById(id);

/** Tarjetas ilustradas de la guía (menú, pausa y panel de la cámara). */
export function renderGestureGuide(el, { compact = false } = {}) {
  el.innerHTML = GESTURES.map((g) => `<div class="gesture-tile" data-gesture="${g.id}" title="${g.name}: ${g.action}">
      <span class="gesture-tile__emoji" aria-hidden="true">${g.emoji}</span>
      <span class="gesture-tile__text"><strong>${g.action}</strong>${compact ? '' : `<small>${g.name}${g.detail ? ` · ${g.detail}` : ''}</small>`}</span>
    </div>`).join('');
}

export class GestureControl {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this.running = false;
    this.loading = false;
    this.recognizer = null;
    this.stream = null;
    this.lastDetect = 0;
    this.lastVideoTime = -1;
    this.counts = {}; // gesto → detecciones seguidas (positivas o negativas)
    this.active = new Set();
    this.palmX = null;
    this.semiTimer = 0;
    this.result = null;
    this.panel = $('gesture-panel');
    this.video = $('gesture-video');
    this.canvas = $('gesture-canvas');
    this.ctx = this.canvas?.getContext('2d');
    this.label = $('gesture-now');
    this.status = $('gesture-status');
    this.button = $('btn-gesture');
    document.querySelectorAll('[data-gesture-guide]').forEach((el) => renderGestureGuide(el, { compact: el.dataset.gestureGuide === 'compact' }));
    $('btn-gesture-close')?.addEventListener('click', () => this.stop());
    $('gesture-guide-toggle')?.addEventListener('click', () => this.panel.classList.toggle('is-collapsed'));
    this.button?.addEventListener('click', () => this.toggle());
    document.querySelectorAll('[data-action="gestures"]').forEach((b) => b.addEventListener('click', () => this.toggle()));
    this.button?.classList.toggle('d-none', !this.supported);
  }

  get supported() {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  toggle() {
    if (this.enabled) this.stop();
    else this.start();
  }

  /** Enciende la cámara y carga el modelo (la primera vez descarga ~18 MB). */
  async start() {
    const { game } = this;
    if (this.enabled || this.loading) return;
    if (!this.supported) {
      game.bus.emit('hud:toast', { text: 'Este navegador no permite usar la cámara', type: 'danger', icon: 'camera-video-off' });
      return;
    }
    if (game.immersive) {
      game.bus.emit('hud:toast', { text: 'Los gestos no están disponibles dentro del visor', type: 'warn', icon: 'hand-index' });
      return;
    }
    this.loading = true;
    this.enabled = true;
    game.settings.set('gestures', true);
    this.#showPanel(true);
    this.#setStatus('Encendiendo la cámara…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      if (!this.enabled) return this.#releaseCamera();
      this.video.srcObject = this.stream;
      await this.video.play();
      this.#setStatus('Cargando el reconocedor de gestos…');
      await this.#loadModel();
      if (!this.enabled) return;
      this.running = true;
      this.#setStatus('Muestra tu mano a la cámara (a unos 30–60 cm, con buena luz)');
      game.bus.emit('hud:toast', { text: 'Control con gestos activado', type: 'info', icon: 'hand-index-thumb' });
    } catch (err) {
      console.warn('[Gestos]', err);
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      const noCam = err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError';
      game.bus.emit('hud:toast', {
        text: denied ? 'Permiso de cámara denegado' : noCam ? 'No se encontró una cámara' : 'No se pudo iniciar el reconocimiento de gestos',
        type: 'danger',
        icon: 'camera-video-off',
      });
      this.stop();
    } finally {
      this.loading = false;
    }
  }

  async #loadModel() {
    if (this.recognizer) return;
    const vision = await import(`${VISION_URL}/vision_bundle.mjs`);
    this.HAND_CONNECTIONS = vision.GestureRecognizer.HAND_CONNECTIONS;
    const files = await vision.FilesetResolver.forVisionTasks(`${VISION_URL}/wasm`);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    try {
      this.recognizer = await vision.GestureRecognizer.createFromOptions(files, options('GPU'));
    } catch {
      // algunos equipos no permiten el delegado de GPU
      this.recognizer = await vision.GestureRecognizer.createFromOptions(files, options('CPU'));
    }
  }

  stop() {
    this.enabled = false;
    this.running = false;
    this.game.settings.set('gestures', false);
    this.#releaseCamera();
    this.#release();
    this.#showPanel(false);
  }

  #releaseCamera() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  #showPanel(v) {
    this.panel?.classList.toggle('is-hidden', !v);
    document.body.classList.toggle('has-gestures', v);
    this.button?.classList.toggle('is-active', v);
  }

  #setStatus(text) {
    if (this.status) this.status.textContent = text;
  }

  /** Suelta las acciones que mantienen los gestos. */
  #release() {
    const input = this.game.input;
    input.releaseAll(SOURCE);
    if (this.active.has('Pointing_Up')) input.untap('fire');
    this.active.clear();
    this.counts = {};
    this.palmX = null;
    this.#highlight();
  }

  // ---------------------------------------------------------------- ciclo
  update(dt) {
    if (!this.running || !this.recognizer) return;
    const now = performance.now();
    const v = this.video;
    if (now - this.lastDetect >= DETECT_INTERVAL && v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastDetect = now;
      this.lastVideoTime = v.currentTime;
      try {
        this.process(this.recognizer.recognizeForVideo(v, now));
      } catch (err) {
        console.warn('[Gestos] fallo al analizar el cuadro', err);
      }
    }
    this.#apply(dt);
  }

  /**
   * Convierte un resultado de MediaPipe en gestos estables (también se usa en
   * las pruebas con resultados simulados).
   */
  process(result) {
    this.result = result;
    const seen = new Set();
    let palmX = null;
    (result?.gestures ?? []).forEach((list, i) => {
      const top = list?.[0];
      if (!top || top.score < MIN_SCORE || !BY_ID[top.categoryName]) return;
      seen.add(top.categoryName);
      if (top.categoryName === 'Open_Palm') {
        const lm = result.landmarks?.[i];
        // muñeca (0) y base del dedo medio (9); la imagen se muestra en espejo
        if (lm?.[0] && lm?.[9]) palmX = 1 - (lm[0].x + lm[9].x) / 2;
      }
    });
    for (const g of GESTURES) {
      const c = this.counts[g.id] ?? 0;
      this.counts[g.id] = seen.has(g.id) ? Math.max(1, c + 1) : Math.min(-1, c - 1);
    }
    const before = new Set(this.active);
    for (const g of GESTURES) {
      if (this.counts[g.id] >= STABLE) this.active.add(g.id);
      else if (this.counts[g.id] <= -STABLE) this.active.delete(g.id);
    }
    this.palmX = this.active.has('Open_Palm') ? palmX ?? this.palmX : null;
    for (const id of this.active) if (!before.has(id)) this.#onStart(id);
    for (const id of before) if (!this.active.has(id)) this.#onEnd(id);
    this.#draw(result);
    this.#highlight();
  }

  #canAct() {
    const g = this.game;
    return g.state === 'playing' && g.player?.canAct();
  }

  #onStart(id) {
    const { game } = this;
    if (!this.#canAct()) return;
    const input = game.input;
    switch (id) {
      case 'Closed_Fist':
        // detener también lo que se ordenó por voz
        game.voice?.exec.stopAll();
        input.releaseAll(SOURCE);
        break;
      case 'Pointing_Up':
        this.semiTimer = 0;
        input.setHold(SOURCE, 'fire', true);
        input.tap('fire');
        break;
      case 'Victory':
        input.tap('jump');
        break;
      case 'Thumb_Up':
        input.tap('reload');
        break;
      case 'ILoveYou':
        game.tryInteract();
        break;
      default:
        break;
    }
    if (HOLDS[id]) input.setHold(SOURCE, HOLDS[id], true);
    game.bus.emit('gesture:start', { id, ...BY_ID[id] });
  }

  #onEnd(id) {
    const input = this.game.input;
    if (id === 'Pointing_Up') {
      input.setHold(SOURCE, 'fire', false);
      input.untap('fire'); // suelta el orbe cargado
    }
    if (HOLDS[id]) input.setHold(SOURCE, HOLDS[id], false);
  }

  /** Acciones continuas: girar con la palma y disparar armas semiautomáticas. */
  #apply(dt) {
    const { game } = this;
    if (!this.#canAct()) {
      if (game.input.holds.get(SOURCE)?.size) game.input.releaseAll(SOURCE);
      return;
    }
    // si el juego se reanudó con un gesto ya puesto, restaurar lo que mantiene
    for (const id of this.active) if (HOLDS[id]) game.input.setHold(SOURCE, HOLDS[id], true);
    if (this.palmX !== null) {
      const off = this.palmX - 0.5;
      const dead = 0.12;
      if (Math.abs(off) > dead) game.turnView(-(off - Math.sign(off) * dead) * dt * 4);
    }
    if (this.active.has('Pointing_Up')) {
      const w = game.weapons;
      if (w.def.mode === 'semi') {
        this.semiTimer -= dt;
        if (this.semiTimer <= 0) {
          game.input.tap('fire');
          this.semiTimer = 1 / w.def.fireRate + 0.05;
        }
      }
    }
  }

  // ---------------------------------------------------------------- dibujo
  #highlight() {
    const main = [...this.active][0];
    document.querySelectorAll('.gesture-tile').forEach((t) => t.classList.toggle('is-active', this.active.has(t.dataset.gesture)));
    if (this.label) {
      const g = BY_ID[main];
      this.label.textContent = g ? `${[...this.active].map((id) => BY_ID[id].emoji).join(' ')} ${[...this.active].map((id) => BY_ID[id].action).join(' + ')}` : this.result?.landmarks?.length ? 'Mano detectada' : 'Sin mano';
      this.label.classList.toggle('is-on', !!g);
    }
    if (this.status && this.running) this.status.textContent = this.result?.landmarks?.length ? '' : 'Muestra tu mano a la cámara (a unos 30–60 cm, con buena luz)';
  }

  #draw(result) {
    const c = this.canvas;
    const ctx = this.ctx;
    if (!c || !ctx) return;
    const w = this.video.videoWidth || 640;
    const h = this.video.videoHeight || 480;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    const conns = this.HAND_CONNECTIONS ?? [];
    (result?.landmarks ?? []).forEach((lm, i) => {
      const name = result.gestures?.[i]?.[0]?.categoryName;
      const on = this.active.has(name);
      ctx.lineWidth = Math.max(2, w / 160);
      ctx.strokeStyle = on ? '#3dffb0' : '#5ff0ff';
      ctx.beginPath();
      for (const { start, end } of conns) {
        ctx.moveTo(lm[start].x * w, lm[start].y * h);
        ctx.lineTo(lm[end].x * w, lm[end].y * h);
      }
      ctx.stroke();
      ctx.fillStyle = on ? '#ffffff' : '#ff4fd8';
      for (const p of lm) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, Math.max(2.5, w / 120), 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // zona muerta del giro con la palma
    if (this.palmX !== null) {
      ctx.fillStyle = 'rgba(95,240,255,0.12)';
      ctx.fillRect(w * 0.38, 0, w * 0.24, h);
    }
  }
}
