/**
 * GestureControl — controla a NOVA-7 con gestos de la mano frente a la cámara.
 *
 * Usa MediaPipe Gesture Recognizer (Google) en el propio navegador: el video
 * de la cámara se analiza en el dispositivo y NUNCA se envía a ningún
 * servidor. Se muestra la cámara (en espejo) con el esqueleto de la mano
 * detectada y una guía ilustrada de los gestos, resaltando el que se reconoce.
 *
 * Además de los 7 gestos de MediaPipe, se calculan gestos propios con los
 * puntos de la mano: 👈 👉 (moverse de lado), 🤙 (correr) y 👌 (granada).
 * Para girar, la palma o el puño se inclinan como un volante (handTilt).
 * Al disparar con ☝️ se activa el apuntado automático (AutoAim).
 *
 * Se pueden usar las dos manos a la vez (p. ej. ✋ para avanzar con una y ☝️
 * para disparar con la otra).
 */

const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const SOURCE = 'gesture';
const DETECT_INTERVAL = 1000 / 20; // ms (≈20 detecciones por segundo)
const MIN_SCORE = 0.55;
const STABLE_ON = 2; // detecciones seguidas para aceptar un gesto
const STABLE_OFF = 4; // …y para soltarlo (tolera cortes breves de la detección: NOVA-7 no titubea)
const TILT_DEAD = THREE_DEG(18); // inclinación natural de la mano que no gira
const TILT_FULL = THREE_DEG(55); // inclinación con la que se gira a la velocidad máxima
const TURN_SPEED = 2.2; // rad/s

/** Gestos reconocidos, su ilustración y su acción en el juego. */
export const GESTURES = [
  { id: 'Open_Palm', emoji: '✋', name: 'Palma abierta', action: 'Avanzar', detail: 'recto; inclínala como volante para girar' },
  { id: 'Closed_Fist', emoji: '✊', name: 'Puño', action: 'Detenerse', detail: 'inclínalo para girar sin avanzar' },
  { id: 'Pointing_Up', emoji: '☝️', name: 'Índice arriba', action: 'Disparar', detail: 'mientras lo mantengas' },
  { id: 'Victory', emoji: '✌️', name: 'Amor y paz', action: 'Saltar', detail: '' },
  { id: 'Thumb_Up', emoji: '👍', name: 'Pulgar arriba', action: 'Recargar', detail: '' },
  { id: 'Thumb_Down', emoji: '👎', name: 'Pulgar abajo', action: 'Retroceder', detail: 'mientras lo mantengas' },
  { id: 'ILoveYou', emoji: '🤟', name: 'Te quiero', action: 'Interactuar', detail: 'baliza, nave (como E)' },
  // gestos propios, calculados con los puntos de la mano (classifyHand)
  { id: 'Point_Left', emoji: '👈', name: 'Señalar a la izquierda', action: 'Izquierda', detail: 'índice de lado, mientras lo mantengas' },
  { id: 'Point_Right', emoji: '👉', name: 'Señalar a la derecha', action: 'Derecha', detail: 'índice de lado, mientras lo mantengas' },
  { id: 'Call_Me', emoji: '🤙', name: 'Llámame', action: 'Correr', detail: 'pulgar y meñique: corre hacia adelante' },
  { id: 'OK_Sign', emoji: '👌', name: 'OK', action: 'Granada', detail: 'mantén para apuntar y suelta para lanzar' },
];
const BY_ID = Object.fromEntries(GESTURES.map((g) => [g.id, g]));
const HOLDS = { Open_Palm: ['forward'], Thumb_Down: ['back'], Pointing_Up: ['fire'], Point_Left: ['left'], Point_Right: ['right'], Call_Me: ['forward', 'run'] };
/**
 * Qué gestos propios pueden reemplazar a lo que dijo MediaPipe (poses parecidas
 * o sin clasificar). Así un ☝️ claro nunca se convierte en otra cosa.
 */
const OVERRIDES = {
  None: null, // cualquiera
  Pointing_Up: new Set(['Point_Left', 'Point_Right']),
  Open_Palm: new Set(['OK_Sign']),
  Closed_Fist: new Set(['Call_Me', 'Point_Left', 'Point_Right']),
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function THREE_DEG(d) {
  return (d * Math.PI) / 180;
}

/**
 * Inclinación de la mano como un volante (radianes): 0 = dedos hacia arriba,
 * positivo = inclinada hacia TU derecha (la imagen se muestra en espejo).
 */
export function handTilt(lm, aspect = 4 / 3) {
  if (!lm?.[0] || !lm?.[9]) return 0;
  const vx = (lm[9].x - lm[0].x) * aspect;
  const vy = lm[9].y - lm[0].y;
  // en la cámara sin espejo, inclinarla a tu derecha mueve los dedos hacia x menor
  return Math.atan2(-vx, -vy);
}

/**
 * Clasifica gestos que MediaPipe no trae de fábrica a partir de los 21
 * puntos de la mano (0 muñeca · 1-4 pulgar · 5-8 índice · 9-12 medio ·
 * 13-16 anular · 17-20 meñique). Las coordenadas son de la cámara SIN espejo;
 * `aspect` = ancho/alto del video, para medir ángulos en píxeles reales.
 * @returns {string|null} 'Point_Left' | 'Point_Right' | 'Call_Me' | 'OK_Sign' | null
 */
export function classifyHand(lm, aspect = 4 / 3) {
  if (!lm || lm.length < 21) return null;
  const scale = dist(lm[0], lm[9]) || 1e-6;
  // un dedo está extendido si su punta queda más lejos de la muñeca que su articulación media
  const ext = (tip, pip) => dist(lm[0], lm[tip]) > dist(lm[0], lm[pip]) * 1.08;
  const index = ext(8, 6);
  const middle = ext(12, 10);
  const ring = ext(16, 14);
  const pinky = ext(20, 18);
  const thumb = dist(lm[4], lm[17]) > dist(lm[3], lm[17]) * 1.05 && dist(lm[4], lm[5]) > scale * 0.45;

  // 👌 pulgar e índice tocándose y los otros tres dedos estirados
  if (dist(lm[4], lm[8]) < scale * 0.35 && middle && ring && pinky) return 'OK_Sign';
  // 🤙 pulgar y meñique fuera, los demás doblados
  if (thumb && pinky && !index && !middle && !ring) return 'Call_Me';
  // 👈 👉 solo el índice, apuntando de lado
  if (index && !middle && !ring && !pinky) {
    const vx = (lm[8].x - lm[5].x) * aspect;
    const vy = lm[8].y - lm[5].y;
    // en la cámara sin espejo, señalar a TU derecha mueve la punta hacia x menor
    if (Math.abs(vx) > Math.abs(vy) * 1.4) return vx < 0 ? 'Point_Right' : 'Point_Left';
  }
  return null;
}

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
    this.tilt = 0; // inclinación suavizada de la mano que conduce (✋ o ✊)
    this.steering = false;
    this.handNames = [];
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
    if (this.active.has('OK_Sign')) input.untap('grenade');
    this.active.clear();
    this.counts = {};
    this.tilt = 0;
    this.steering = false;
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
    let tilt = null;
    this.handNames = [];
    const aspect = (this.video?.videoWidth || 4) / (this.video?.videoHeight || 3);
    (result?.gestures ?? []).forEach((list, i) => {
      const top = list?.[0];
      let name = top && top.score >= MIN_SCORE ? top.categoryName : 'None';
      // gestos propios (👈 👉 🤙 👌) a partir de los puntos de la mano
      if (name in OVERRIDES) {
        const own = classifyHand(result.landmarks?.[i], aspect);
        if (own && (OVERRIDES[name] === null || OVERRIDES[name].has(own))) name = own;
      }
      this.handNames[i] = name;
      if (!BY_ID[name]) return;
      seen.add(name);
      // la palma o el puño conducen: su inclinación es el volante
      if ((name === 'Open_Palm' || name === 'Closed_Fist') && tilt === null) tilt = handTilt(result.landmarks?.[i], aspect);
    });
    for (const g of GESTURES) {
      const c = this.counts[g.id] ?? 0;
      this.counts[g.id] = seen.has(g.id) ? Math.max(1, c + 1) : Math.min(-1, c - 1);
    }
    const before = new Set(this.active);
    for (const g of GESTURES) {
      if (this.counts[g.id] >= STABLE_ON) this.active.add(g.id);
      else if (this.counts[g.id] <= -STABLE_OFF) this.active.delete(g.id);
    }
    // con una sola mano no puede haber dos gestos: si ya se ve uno nuevo estable,
    // el anterior termina en ese momento (sin esperar la tolerancia de STABLE_OFF)
    const hands = result?.gestures?.length ?? 0;
    if (hands === 1 && seen.size === 1) {
      const [now] = seen;
      if (this.active.has(now)) {
        for (const id of [...this.active]) {
          if (id === now) continue;
          this.active.delete(id);
          this.counts[id] = -STABLE_OFF;
        }
      }
    }
    // filtro suave para que el volante no tiemble
    this.steering = this.active.has('Open_Palm') || this.active.has('Closed_Fist');
    if (!this.steering) this.tilt = 0;
    else this.tilt += ((tilt ?? 0) - this.tilt) * 0.5;
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
      case 'OK_Sign':
        // mantener G: muestra la trayectoria; al soltar el gesto se lanza
        input.setHold(SOURCE, 'grenade', true);
        input.tap('grenade');
        break;
      default:
        break;
    }
    for (const action of HOLDS[id] ?? []) input.setHold(SOURCE, action, true);
    game.bus.emit('gesture:start', { id, ...BY_ID[id] });
  }

  #onEnd(id) {
    const input = this.game.input;
    if (id === 'Pointing_Up') {
      input.setHold(SOURCE, 'fire', false);
      input.untap('fire'); // suelta el orbe cargado
    }
    if (id === 'OK_Sign') {
      input.setHold(SOURCE, 'grenade', false);
      input.untap('grenade');
    }
    for (const action of HOLDS[id] ?? []) input.setHold(SOURCE, action, false);
  }

  /** Giro (rad/s, positivo = a la derecha) según la inclinación de la mano. */
  steerRate() {
    if (!this.steering) return 0;
    const a = Math.abs(this.tilt);
    if (a < TILT_DEAD) return 0;
    const k = Math.min(1, (a - TILT_DEAD) / (TILT_FULL - TILT_DEAD));
    return Math.sign(this.tilt) * k * k * TURN_SPEED;
  }

  /** Acciones continuas: volante, disparo de armas semiautomáticas y apuntado automático. */
  #apply(dt) {
    const { game } = this;
    if (!this.#canAct()) {
      if (game.input.holds.get(SOURCE)?.size) game.input.releaseAll(SOURCE);
      return;
    }
    // si el juego se reanudó con un gesto ya puesto, restaurar lo que mantiene
    // (y lo que comparten dos gestos, p. ej. «avanzar» de ✋ y 🤙)
    for (const id of this.active) for (const action of HOLDS[id] ?? []) game.input.setHold(SOURCE, action, true);
    const rate = this.steerRate();
    // girar a la derecha = yaw menor (sin apuntado automático, que ya gira hacia el blanco)
    if (rate && !game.autoAim?.target) game.turnView(-rate * dt);
    if (this.active.has('Pointing_Up')) {
      game.autoAim?.request();
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
      const on = this.active.has(this.handNames[i]);
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
    // volante: arco con la inclinación actual (verde si está girando)
    if (this.steering) {
      const cx = w / 2;
      const cy = h * 0.9;
      const r = h * 0.22;
      ctx.lineWidth = Math.max(3, w / 110);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      // el lienzo se ve en espejo: se dibuja con el ángulo invertido
      const ang = -Math.PI / 2 - this.tilt;
      ctx.strokeStyle = this.steerRate() ? '#3dffb0' : '#5ff0ff';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
      ctx.stroke();
    }
  }
}
