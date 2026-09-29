/**
 * ThirdPersonCamera — cámara orbital en tercera persona.
 *
 * - Yaw/pitch con el mouse (pointer lock) o arrastre táctil.
 * - Modo "apuntar" sobre el hombro (clic derecho) y mira telescópica del
 *   rifle de riel (zoom óptico real reduciendo el FOV).
 * - Retroceso de las armas (kick) que se recupera suavemente.
 * - Evita atravesar paredes con un raycast de Rapier contra la geometría fija.
 * - Sacudidas (explosiones, jefes) y modo "vitrina" para el menú.
 */
import * as THREE from 'three';
import { COLLISION } from '../config.js';
import { heightAt, isVoid } from '../world/TerrainField.js';

const _dir = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _desired = new THREE.Vector3();

export class ThirdPersonCamera {
  constructor(game, camera) {
    this.game = game;
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0.3;
    this.distance = 5.2;
    this.currentDistance = 5.2;
    this.minDistance = 2.4;
    this.maxDistance = 10;
    this.aimDistance = 3.3;
    this.shoulder = 0.75;
    this.pivot = new THREE.Vector3();
    this.pivotInit = false;
    this.shakeAmount = 0;
    this.fovBoost = 0;
    this.aiming = false;
    this.scoped = false;
    this.recoil = 0;
    this.menuAngle = 0;
  }

  reset(target, yaw = 0) {
    this.yaw = yaw;
    this.pitch = 0.28;
    this.distance = 5.2;
    this.currentDistance = 5.2;
    this.pivot.copy(target);
    this.pivotInit = true;
    this.shakeAmount = 0;
    this.recoil = 0;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  right(out = new THREE.Vector3()) {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  shake(amount) {
    this.shakeAmount = Math.min(1.2, this.shakeAmount + amount);
  }

  /** Retroceso del arma: sube la mira y se recupera en ~0,2 s. */
  kick(amount) {
    const k = this.scoped ? 0.5 : 1;
    const up = amount * k * 0.6;
    this.pitch = THREE.MathUtils.clamp(this.pitch - up, -0.55, 1.25);
    this.yaw += (Math.random() - 0.5) * amount * k * 0.5;
    // el 75 % del retroceso vertical se recupera solo
    this.recoil = Math.min(0.2, this.recoil + up * 0.75);
  }

  shakeFrom(pos, strength = 1) {
    const d = this.camera.position.distanceTo(pos);
    this.shake(strength * THREE.MathUtils.clamp(1 - d / 30, 0, 1));
  }

  /** Aplica la entrada de mouse/táctil. */
  handleInput(input, settings) {
    const look = input.consumeLook();
    const zoom = this.scoped ? 0.3 : this.aiming ? 0.7 : 1;
    const sens = 0.0022 * settings.get('sensitivity') * zoom;
    const inv = settings.get('invertY') ? -1 : 1;
    this.yaw -= look.dx * sens;
    this.pitch += look.dy * sens * inv;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.55, 1.25);
  }

  /**
   * @param {THREE.Vector3} target punto de interés (pecho del jugador)
   */
  update(dt, target, { aiming = false, running = false, scoped = false } = {}) {
    this.aiming = aiming;
    this.scoped = scoped;
    if (this.recoil > 0) {
      const back = Math.min(this.recoil, dt * 0.35);
      this.recoil -= back;
      this.pitch = THREE.MathUtils.clamp(this.pitch + back, -0.55, 1.25);
    }
    const k = 1 - Math.exp(-dt * 14);
    if (!this.pivotInit) {
      this.pivot.copy(target);
      this.pivotInit = true;
    }
    this.pivot.lerp(target, k);

    const wantD = scoped ? 0.25 : aiming ? this.aimDistance : this.distance;
    this.currentDistance += (wantD - this.currentDistance) * (1 - Math.exp(-dt * 9));

    const shoulder = scoped ? 0.25 : aiming ? 1.1 : this.shoulder;
    this.right(_dir);
    _pivot.copy(this.pivot).addScaledVector(_dir, shoulder);
    _pivot.y += scoped ? 0.62 : aiming ? 0.5 : 0.38;

    const cp = Math.cos(this.pitch);
    _dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    // colisión de cámara contra el escenario fijo
    let dist = this.currentDistance;
    const hit = this.game.physics.raycast(_pivot, _dir, dist + 0.3, { groups: COLLISION.cameraQuery });
    if (hit) dist = Math.max(0.5, hit.distance - 0.3);
    _desired.copy(_pivot).addScaledVector(_dir, dist);
    const floor = heightAt(_desired.x, _desired.z) + 0.35;
    if (_desired.y < floor && !isVoid(_desired.x, _desired.z)) _desired.y = floor;

    this.camera.position.copy(_desired);
    this.camera.lookAt(_pivot);

    // sacudida
    if (this.shakeAmount > 0.001) {
      const s = this.shakeAmount * 0.18;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.camera.rotation.z += (Math.random() - 0.5) * s * 0.2;
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.2);
    }

    // FOV dinámico
    const base = this.game.settings.get('fov');
    this.fovBoost += ((running ? 5 : 0) - this.fovBoost) * Math.min(1, dt * 4);
    const fov = scoped ? 18 : aiming ? base - 14 : base + this.fovBoost;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * (scoped ? 14 : 8));
      this.camera.updateProjectionMatrix();
    }
  }

  /** Cámara de vitrina: órbita lenta alrededor del personaje en el menú. */
  updateMenu(dt, target) {
    this.menuAngle += dt * 0.12;
    const r = 6.5;
    const a = this.menuAngle;
    this.camera.position.set(target.x + Math.sin(a) * r, target.y + 1.6 + Math.sin(a * 0.7) * 0.4, target.z + Math.cos(a) * r);
    const floor = heightAt(this.camera.position.x, this.camera.position.z) + 0.6;
    if (this.camera.position.y < floor && !isVoid(this.camera.position.x, this.camera.position.z)) this.camera.position.y = floor;
    this.camera.lookAt(target.x, target.y + 0.5, target.z);
    const base = this.game.settings.get('fov');
    if (this.camera.fov !== base) {
      this.camera.fov = base;
      this.camera.updateProjectionMatrix();
    }
  }
}
