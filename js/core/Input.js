/**
 * Input — teclado, mouse (pointer lock) y controles táctiles virtuales.
 *
 * Expone "acciones" en lugar de teclas para que el resto del juego no dependa
 * de un dispositivo concreto: down('run'), pressed('jump'), released('throw').
 */
const KEYMAP = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  punch: ['KeyF'],
  pulse: ['KeyQ'],
  interact: ['KeyE'],
  pause: ['Escape', 'KeyP'],
  help: ['KeyH'],
  throw: ['Mouse0'],
  aim: ['Mouse2'],
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

  down(action) {
    if (!this.enabled) return false;
    if (this.virtual.keys.has(action)) return true;
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
    this.lookDX = 0;
    this.lookDY = 0;
  }
}
