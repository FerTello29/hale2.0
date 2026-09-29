/**
 * TouchControls — joystick virtual + botones para pantallas táctiles.
 * Escribe en input.virtual; arrastrar sobre el canvas gira la cámara.
 */
export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.enabled = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches;
    this.root = document.getElementById('touch-ui');
    if (!this.enabled) return;
    document.body.classList.add('is-touch');
    this.input.requireLockForMouse = false;
    this.#joystick();
    this.#buttons();
    this.#look();
  }

  show(visible) {
    if (!this.enabled) return;
    this.root.classList.toggle('is-hidden', !visible);
    if (!visible) {
      this.input.virtual.x = 0;
      this.input.virtual.y = 0;
      this.input.virtual.keys.clear();
    }
  }

  #joystick() {
    const base = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    let id = null;
    const R = 52;
    const move = (t) => {
      const r = base.getBoundingClientRect();
      let dx = t.clientX - (r.left + r.width / 2);
      let dy = t.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.input.virtual.x = dx / R;
      this.input.virtual.y = -dy / R;
    };
    base.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      id = t.identifier;
      move(t);
    }, { passive: false });
    base.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === id) move(t);
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === id) {
          id = null;
          knob.style.transform = '';
          this.input.virtual.x = 0;
          this.input.virtual.y = 0;
        }
      }
    };
    base.addEventListener('touchend', end);
    base.addEventListener('touchcancel', end);
  }

  #buttons() {
    const keys = this.input.virtual.keys;
    this.root.querySelectorAll('.tbtn').forEach((btn) => {
      const action = btn.dataset.action;
      const toggle = btn.dataset.toggle === '1';
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.game.audio.unlock();
        if (toggle) {
          const on = !keys.has(action);
          if (on) keys.add(action);
          else keys.delete(action);
          btn.classList.toggle('is-active', on);
          return;
        }
        keys.add(action);
        keys.add(`+${action}`);
        btn.classList.add('is-active');
      }, { passive: false });
      const up = (e) => {
        e.preventDefault();
        if (toggle) return;
        keys.delete(action);
        keys.add(`-${action}`);
        btn.classList.remove('is-active');
      };
      btn.addEventListener('touchend', up, { passive: false });
      btn.addEventListener('touchcancel', up, { passive: false });
    });
  }

  #look() {
    const canvas = this.game.renderer.domElement;
    let id = null;
    let lx = 0;
    let ly = 0;
    canvas.addEventListener('touchstart', (e) => {
      if (id !== null) return;
      const t = e.changedTouches[0];
      id = t.identifier;
      lx = t.clientX;
      ly = t.clientY;
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        this.input.lookDX += (t.clientX - lx) * 1.6;
        this.input.lookDY += (t.clientY - ly) * 1.6;
        lx = t.clientX;
        ly = t.clientY;
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) if (t.identifier === id) id = null;
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
  }
}
