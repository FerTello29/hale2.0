/**
 * XRMode — realidad virtual inmersiva con WebXR (Meta Quest 3, Quest 2/Pro,
 * Pico y otros visores compatibles con el navegador).
 *
 * - La cámara del visor se coloca detrás de NOVA-7 (tercera persona) o en su
 *   cabeza (primera persona) desplazando el espacio de referencia de WebXR,
 *   de modo que el resto del juego sigue trabajando en coordenadas del mundo.
 * - Se camina hacia donde miras; el giro es por pasos (30°) para evitar mareo.
 * - Se apunta con el control derecho (láser + retícula).
 *
 * Controles Touch:
 *   Stick izq.: mover · clic stick izq.: correr · gatillo izq.: granada
 *   Grip izq.: interactuar / pulso · X (mantener): voz · Y: pausa
 *   Gatillo der.: disparar · grip der.: golpe · A: saltar · B: recargar
 *   Stick der. ←/→: girar · ↑/↓: cambiar arma · clic stick der.: 1.ª/3.ª persona
 */
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

const SOURCE = 'xr';
const SNAP = THREE.MathUtils.degToRad(30);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _target = new THREE.Vector3();

const deadzone = (v, dz = 0.18) => (Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz));

export class XRMode {
  constructor(game) {
    this.game = game;
    this.renderer = game.renderer;
    this.supported = false;
    this.presenting = false;
    this.session = null;
    this.rigYaw = 0;
    this.rigPos = new THREE.Vector3();
    this.headHeight = 1.6;
    this.prev = { left: {}, right: {} };
    this.snapArmed = true;
    this.cycleArmed = true;
    this.lastFire = -10;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    if (this.renderer.xr.setFoveation) this.renderer.xr.setFoveation(1);
    this.#buildControllers();
    this.ready = navigator.xr?.isSessionSupported
      ? navigator.xr.isSessionSupported('immersive-vr').then((ok) => (this.supported = ok)).catch(() => false)
      : Promise.resolve(false);

    game.bus.on('hitmarker', () => this.#pulse('right', 0.3, 30));
    game.bus.on('player:damaged', () => {
      this.#pulse('left', 0.6, 70);
      this.#pulse('right', 0.6, 70);
    });
  }

  get firstPerson() {
    return this.game.settings.get('vrView') === 'first';
  }

  #buildControllers() {
    const { renderer } = this;
    const factory = new XRControllerModelFactory();
    this.controllers = [];
    for (let i = 0; i < 2; i++) {
      const ray = renderer.xr.getController(i);
      ray.addEventListener('connected', (e) => {
        ray.userData.handedness = e.data.handedness;
        ray.userData.connected = true;
        if (e.data.handedness === 'right') ray.add(this.laser);
      });
      ray.addEventListener('disconnected', () => {
        ray.userData.connected = false;
        ray.remove(this.laser);
      });
      const grip = renderer.xr.getControllerGrip(i);
      grip.add(factory.createControllerModel(grip));
      this.controllers.push({ ray, grip });
    }
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    this.laser = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.laser.frustumCulled = false;
  }

  attach(scene) {
    for (const c of this.controllers) {
      scene.add(c.ray);
      scene.add(c.grip);
    }
  }

  get rightRay() {
    return this.controllers.find((c) => c.ray.userData.connected && c.ray.userData.handedness === 'right')?.ray ?? null;
  }

  /** Debe llamarse dentro de un clic (gesto del usuario). */
  async enter() {
    if (this.presenting) return true;
    if (!navigator.xr) return false;
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    } catch (err) {
      console.warn('[VR] no se pudo iniciar la sesión', err);
      this.game.bus.emit('hud:toast', { text: 'No se pudo entrar en realidad virtual', type: 'danger', icon: 'headset-vr' });
      return false;
    }
    this.session = session;
    session.addEventListener('end', () => this.#onEnd());
    session.addEventListener('visibilitychange', () => {
      if (session.visibilityState !== 'visible' && this.game.state === 'playing') this.game.pause();
    });
    await this.renderer.xr.setSession(session);
    this.baseSpace = this.renderer.xr.getReferenceSpace();
    this.presenting = true;
    this.rigYaw = this.game.cameraRig.yaw;
    this.rigPos.copy(this.game.player?.object3d.position ?? _v.set(0, 0, 0));
    this.prev = { left: {}, right: {} };
    this.game.onImmersiveStart('xr');
    return true;
  }

  exit() {
    if (this.session) this.session.end().catch(() => {});
  }

  #onEnd() {
    this.presenting = false;
    this.session = null;
    this.baseSpace = null;
    this.game.input.releaseAll(SOURCE);
    this.game.onImmersiveEnd('xr');
  }

  /** Rayo de puntería: control derecho si existe, si no la mirada. */
  aimRay(origin, dir) {
    const ray = this.rightRay;
    if (ray) {
      ray.getWorldPosition(origin);
      ray.getWorldQuaternion(_q);
      dir.set(0, 0, -1).applyQuaternion(_q).normalize();
    } else {
      this.game.camera.getWorldPosition(origin);
      this.game.camera.getWorldDirection(dir);
    }
  }

  turn(rad) {
    this.rigYaw += rad;
  }

  // ---------------------------------------------------------------- entrada
  pollInput() {
    if (!this.presenting || !this.session) return;
    const { game } = this;
    const input = game.input;
    const paused = game.state === 'paused';
    for (const src of this.session.inputSources) {
      const gp = src.gamepad;
      if (!gp || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
      const prev = this.prev[src.handedness];
      const btn = (i) => !!gp.buttons[i]?.pressed;
      const edge = (name, now) => {
        const was = !!prev[name];
        prev[name] = now;
        return now && !was ? 1 : !now && was ? -1 : 0;
      };
      const ax = gp.axes[2] ?? gp.axes[0] ?? 0;
      const ay = gp.axes[3] ?? gp.axes[1] ?? 0;
      if (src.handedness === 'left') {
        if (edge('y', btn(5)) === 1) paused ? game.resume() : game.pause();
        const talk = edge('x', btn(4));
        if (talk === 1) game.voice.pushStart();
        else if (talk === -1) game.voice.pushEnd();
        if (paused) continue;
        input.setAxis(SOURCE, deadzone(ax), -deadzone(ay));
        if (edge('stick', btn(3)) === 1) input.setHold(SOURCE, 'run', !input.holds.get(SOURCE)?.has('run'));
        const g = edge('trigger', (gp.buttons[0]?.value ?? 0) > 0.5);
        if (g === 1) {
          input.setHold(SOURCE, 'grenade', true);
          input.tap('grenade');
        } else if (g === -1) {
          input.setHold(SOURCE, 'grenade', false);
          input.untap('grenade');
        }
        if (edge('grip', btn(1)) === 1) {
          if (game.level?.currentPrompt()) game.tryInteract();
          else input.tap('pulse');
        }
      } else {
        const trig = edge('trigger', (gp.buttons[0]?.value ?? 0) > 0.5);
        if (paused) {
          if (trig === 1) game.resume();
          if (edge('b', btn(5)) === 1) this.exit();
          continue;
        }
        if (trig === 1) {
          input.setHold(SOURCE, 'fire', true);
          input.tap('fire');
        } else if (trig === -1) {
          input.setHold(SOURCE, 'fire', false);
          input.untap('fire');
        }
        if (edge('grip', btn(1)) === 1) input.tap('melee');
        if (edge('a', btn(4)) === 1) input.tap('jump');
        if (edge('b', btn(5)) === 1) input.tap('reload');
        if (edge('stick', btn(3)) === 1) {
          game.settings.set('vrView', this.firstPerson ? 'third' : 'first');
          game.bus.emit('hud:toast', { text: this.firstPerson ? 'Vista en primera persona' : 'Vista en tercera persona', type: 'info', icon: 'eye' });
        }
        // giro por pasos y cambio de arma con el stick derecho
        if (Math.abs(ax) > 0.7 && this.snapArmed) {
          this.rigYaw -= Math.sign(ax) * SNAP;
          this.snapArmed = false;
        } else if (Math.abs(ax) < 0.3) this.snapArmed = true;
        if (Math.abs(ay) > 0.7 && this.cycleArmed) {
          input.wheel += ay < 0 ? 1 : -1;
          this.cycleArmed = false;
        } else if (Math.abs(ay) < 0.3) this.cycleArmed = true;
      }
    }
    if (game.weapons && game.weapons.lastFire !== this.lastFire) {
      this.lastFire = game.weapons.lastFire;
      this.#pulse('right', 0.35, 25);
    }
  }

  #pulse(hand, intensity, ms) {
    if (!this.session) return;
    for (const src of this.session.inputSources) {
      if (src.handedness !== hand) continue;
      const act = src.gamepad?.hapticActuators?.[0];
      try {
        act?.pulse?.(intensity, ms);
      } catch {
        /* sin vibración */
      }
    }
  }

  // ---------------------------------------------------------------- vista
  /** Sustituye a ThirdPersonCamera.update() mientras el visor está activo. */
  update(dt) {
    if (!this.presenting || !this.baseSpace) return;
    const { game } = this;
    const player = game.player;
    const cam = game.camera;
    // se camina hacia donde mira la cabeza
    cam.getWorldDirection(_v);
    if (Math.hypot(_v.x, _v.z) > 0.1) game.cameraRig.yaw = Math.atan2(-_v.x, -_v.z);

    if (player) {
      const feet = player.object3d.position;
      const first = this.firstPerson;
      // altura real de la cabeza sobre el suelo del visor (de pie o sentado)
      const measured = cam.getWorldPosition(_v).y - this.rigPos.y;
      if (measured > 0.5 && measured < 2.4) this.headHeight += (measured - this.headHeight) * Math.min(1, dt * 2);
      if (first) {
        _target.set(0, 0, 0.12);
        _target.y = 1.62 - this.headHeight;
      } else {
        _target.set(0.45, 2.15 - this.headHeight, 3.1);
      }
      _target.applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.rigYaw).add(feet);
      if (first || this.rigPos.distanceToSquared(_target) > 100) this.rigPos.copy(_target);
      else this.rigPos.lerp(_target, 1 - Math.exp(-dt * 7));
      player.object3d.visible = !first;
    }
    const q = { x: 0, y: Math.sin(this.rigYaw / 2), z: 0, w: Math.cos(this.rigYaw / 2) };
    const t = new XRRigidTransform({ x: this.rigPos.x, y: this.rigPos.y, z: this.rigPos.z }, q);
    this.renderer.xr.setReferenceSpace(this.baseSpace.getOffsetReferenceSpace(t.inverse));

    // láser hasta el punto de mira
    const ray = this.rightRay;
    if (ray && game.weapons?.aimPoint) {
      const d = ray.getWorldPosition(_v).distanceTo(game.weapons.aimPoint);
      this.laser.scale.z = Math.min(d, 60);
      this.laser.visible = game.state === 'playing';
    }
  }
}
