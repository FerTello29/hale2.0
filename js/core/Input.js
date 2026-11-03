/**
 * Input — teclado, mouse (pointer lock), controles táctiles virtuales y
 * fuentes externas (voz, gamepad, controles de VR).
 *
 * Expone "acciones" en lugar de teclas para que el resto del juego no dependa
 * de un dispositivo concreto: down('run'), pressed('jump'), released('fire').
 */
const KEYMAP = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  fire: ['Mouse0'],
  aim: ['Mouse2'],
  reload: ['KeyR'],
  melee: ['KeyF'],
  pulse: ['KeyQ'],
  grenade: ['KeyG'],
  grenadeSwitch: ['KeyT'],
  interact: ['KeyE'],
  weapon1: ['Digit1', 'Numpad1'],
  weapon2: ['Digit2', 'Numpad2'],
  weapon3: ['Digit3', 'Numpad3'],
  weapon4: ['Digit4', 'Numpad4'],
  nextWeapon: [],
  prevWeapon: [],
  pause: ['Escape', 'KeyP'],
  help: ['KeyH'],
  voice: ['KeyV'],
  gestures: ['KeyC'],
};

export class Input {
  constructor(element) {
    this.element = element;
    this.keys = new Set();
    this.pressedSet = new Set();
    this.releasedSet = new Set();
    this.lookDX = 0;
    this.lookDY = 0;
    this.wheel = 0;
    this.locked = false;
    this.enabled = true;
    /** Entrada de los controles táctiles (la escribe TouchControls). */
    this.virtual = { x: 0, y: 0, keys: new Set() };
    /** Acciones mantenidas por fuentes externas: fuente → Set de acciones. */
    this.holds = new Map();
    /** Ejes de movimiento de fuentes externas: fuente → { x, y }. */
    this.axes = new Map();
    this.onLockChange = null;
    this.onLockError = null;
    /** Con mouse, los clics solo cuentan como acciones si el puntero está capturado. */
    this.requireLockForMouse = true;

    this.#bind();
  }

  #bind() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      // evitar que la página se desplace con espacio/flechas solo mientras se juega
      if (document.body.dataset.screen === 'game' && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      if (!e.repeat) this.pressedSet.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.releasedSet.add(e.code);
    });
    window.addEventListener('blur', () => this.clear());

    const onDown = (e) => {
      if (this.requireLockForMouse && !this.locked) return; // el primer clic solo captura el puntero
      const code = `Mouse${e.button}`;
      this.keys.add(code);
      this.pressedSet.add(code);
    };
    this.element.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', (e) => {
      const code = `Mouse${e.button}`;
      if (this.keys.has(code)) this.releasedSet.add(code);
      this.keys.delete(code);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookDX += e.movementX || 0;
      this.lookDY += e.movementY || 0;
    });
    this.element.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    this.element.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockerror', () => this.onLockError?.());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) {
        // soltar botones del mouse para evitar "disparos fantasma"
        ['Mouse0', 'Mouse1', 'Mouse2'].forEach((c) => this.keys.delete(c));
      }
      this.onLockChange?.(this.locked);
    });
  }

  requestLock() {
    if (this.locked || !this.element.requestPointerLock) return;
    try {
      const p = this.element.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* algunos navegadores rechazan el bloqueo si no hay gesto del usuario */
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  #codes(action) {
    return KEYMAP[action] || [action];
  }

  /** Una fuente externa mantiene (o suelta) una acción. */
  setHold(source, action, on) {
    let set = this.holds.get(source);
    if (!set) this.holds.set(source, (set = new Set()));
    if (on) set.add(action);
    else set.delete(action);
  }

  releaseAll(source) {
    this.holds.get(source)?.clear();
    this.axes.delete(source);
  }

  /** Pulsación de un solo cuadro (equivale a pressed()). */
  tap(action) {
    this.virtual.keys.add(`+${action}`);
  }

  /** Liberación de un solo cuadro (equivale a released()). */
  untap(action) {
    this.virtual.keys.add(`-${action}`);
  }

  setAxis(source, x, y) {
    if (!x && !y) this.axes.delete(source);
    else this.axes.set(source, { x, y });
  }

  down(action) {
    if (!this.enabled) return false;
    if (this.virtual.keys.has(action)) return true;
    for (const set of this.holds.values()) if (set.has(action)) return true;
    return this.#codes(action).some((c) => this.keys.has(c));
  }

  pressed(action) {
    if (!this.enabled) return false;
    if (this.virtual.keys.has(`+${action}`)) return true;
    return this.#codes(action).some((c) => this.pressedSet.has(c));
  }

  released(action) {
    if (!this.enabled) return false;
    if (this.virtual.keys.has(`-${action}`)) return true;
    return this.#codes(action).some((c) => this.releasedSet.has(c));
  }

  /** Vector de movimiento (x: derecha, y: adelante) normalizado. */
  axis() {
    let x = 0;
    let y = 0;
    if (this.enabled) {
      if (this.down('forward')) y += 1;
      if (this.down('back')) y -= 1;
      if (this.down('right')) x += 1;
      if (this.down('left')) x -= 1;
      x += this.virtual.x;
      y += this.virtual.y;
      for (const a of this.axes.values()) {
        x += a.x;
        y += a.y;
      }
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y, magnitude: Math.min(1, len) };
  }

  consumeLook() {
    const out = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return out;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Llamar al final de cada cuadro: limpia los eventos de flanco. */
  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
    for (const k of [...this.virtual.keys]) {
      if (k.startsWith('+') || k.startsWith('-')) this.virtual.keys.delete(k);
    }
  }

  clear() {
    this.keys.clear();
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.virtual.keys.clear();
    this.virtual.x = 0;
    this.virtual.y = 0;
    for (const set of this.holds.values()) set.clear();
    this.axes.clear();
    this.lookDX = 0;
    this.lookDY = 0;
  }
}
