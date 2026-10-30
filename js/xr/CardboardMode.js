/**
 * CardboardMode — lentes de realidad virtual para celular (VR Box, Cardboard
 * y similares).
 *
 * - Pantalla dividida en estéreo (StereoEffect de Three.js), en horizontal y
 *   pantalla completa.
 * - La cabeza mueve la cámara con el giroscopio del teléfono
 *   (DeviceOrientationEvent; en iPhone se pide permiso).
 * - Como no se puede tocar la pantalla con el teléfono dentro del visor, el
 *   control es por VOZ («avanza», «dispara», «ve al objetivo»…), con un
 *   control Bluetooth (gamepad) o tocando la pantalla / el botón del visor
 *   para disparar.
 */
import * as THREE from 'three';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';

const SOURCE = 'cardboard';
const _euler = new THREE.Euler();
const _q = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // la cámara mira por detrás del teléfono
const _q0 = new THREE.Quaternion();
const _zee = new THREE.Vector3(0, 0, 1);

export class CardboardMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.orientation = null;
    this.yawOffset = null;
    this.effect = null;
    this.exitButton = document.getElementById('btn-cardboard-exit');
    this.exitButton?.addEventListener('click', () => this.exit());
    this.onOrient = (e) => {
      if (e.alpha === null) return;
      this.orientation = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
    };
    this.onTouchStart = (e) => {
      if (!this.active || e.target === this.exitButton) return;
      e.preventDefault();
      this.game.audio.unlock();
      if (this.game.state === 'playing') {
        this.game.input.setHold(SOURCE, 'fire', true);
        this.game.input.tap('fire');
      }
    };
    this.onTouchEnd = () => {
      if (!this.active) return;
      this.game.input.setHold(SOURCE, 'fire', false);
      this.game.input.untap('fire');
    };
  }

  get supported() {
    return 'DeviceOrientationEvent' in window;
  }

  /** Debe llamarse dentro de un clic (permisos de giroscopio y pantalla completa). */
  async enter() {
    if (this.active) return true;
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') throw new Error('denegado');
      } catch {
        this.game.bus.emit('hud:toast', { text: 'Se necesita permiso del giroscopio', type: 'danger', icon: 'phone' });
        return false;
      }
    }
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      await screen.orientation?.lock?.('landscape');
    } catch {
      /* algunos navegadores (iPhone) no permiten bloquear la orientación */
    }
    this.effect ??= new StereoEffect(this.game.renderer);
    this.effect.setEyeSeparation(0.064);
    this.effect.setSize(window.innerWidth, window.innerHeight);
    window.addEventListener('deviceorientation', this.onOrient);
    const canvas = this.game.renderer.domElement;
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd);
    canvas.addEventListener('touchcancel', this.onTouchEnd);
    this.yawOffset = null;
    this.active = true;
    document.body.classList.add('is-cardboard');
    this.exitButton?.classList.remove('is-hidden');
    this.game.onImmersiveStart('cardboard');
    return true;
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('deviceorientation', this.onOrient);
    const canvas = this.game.renderer.domElement;
    canvas.removeEventListener('touchstart', this.onTouchStart);
    canvas.removeEventListener('touchend', this.onTouchEnd);
    canvas.removeEventListener('touchcancel', this.onTouchEnd);
    this.game.input.releaseAll(SOURCE);
    document.body.classList.remove('is-cardboard');
    this.exitButton?.classList.add('is-hidden');
    try {
      screen.orientation?.unlock?.();
      if (document.fullscreenElement) document.exitFullscreen?.();
    } catch {
      /* nada que restaurar */
    }
    this.game.renderer.setScissorTest(false);
    this.game.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    this.game.onImmersiveEnd('cardboard');
  }

  turn(rad) {
    if (this.yawOffset !== null) this.yawOffset += rad;
  }

  /** Orientación del teléfono → yaw/pitch de la cámara en tercera persona. */
  applyOrientation() {
    if (!this.active || !this.orientation) return;
    const o = this.orientation;
    const d = THREE.MathUtils.DEG2RAD;
    const screenAngle = (screen.orientation?.angle ?? window.orientation ?? 0) * d;
    _euler.set(o.beta * d, o.alpha * d, -o.gamma * d, 'YXZ');
    _q.setFromEuler(_euler).multiply(_q1).multiply(_q0.setFromAxisAngle(_zee, -screenAngle));
    _euler.setFromQuaternion(_q, 'YXZ');
    const rig = this.game.cameraRig;
    if (this.yawOffset === null) this.yawOffset = rig.yaw - _euler.y;
    rig.yaw = this.yawOffset + _euler.y;
    rig.pitch = THREE.MathUtils.clamp(-_euler.x + 0.12, -0.55, 1.25);
  }

  render(scene, camera) {
    this.effect.render(scene, camera);
  }

  resize(w, h) {
    this.effect?.setSize(w, h);
  }
}
