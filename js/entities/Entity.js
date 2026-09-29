/**
 * Entity / PhysicsEntity — clases base de todo objeto del juego.
 *
 * PhysicsEntity mantiene sincronizados un Object3D de Three.js y un cuerpo
 * rígido de Rapier, interpolando entre los dos últimos pasos de física para
 * que el movimiento se vea fluido a cualquier tasa de refresco.
 */
import * as THREE from 'three';

let NEXT_ID = 1;

export class Entity {
  constructor(game, type) {
    this.game = game;
    this.type = type;
    this.id = NEXT_ID++;
    this.alive = true;
    this.object3d = null;
  }

  /** Lógica por cuadro (tiempo variable). */
  update(/* dt */) {}

  /** Lógica de paso fijo, antes de cada paso de física. */
  fixedUpdate(/* h */) {}

  /** Notificación de colisión desde PhysicsWorld. */
  onCollide(/* other, started, myCollider, otherCollider */) {}

  /**
   * Impacto de una mecánica de combate.
   * @param {{kind:'orb'|'punch'|'pulse'|'explosion', point:THREE.Vector3, dir?:THREE.Vector3, strength?:number}} info
   */
  hit(/* info */) {}

  get position() {
    return this.object3d ? this.object3d.position : null;
  }

  /** Solicita la destrucción diferida (se ejecuta después del paso de física). */
  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.game.queueRemoval(this);
  }

  /** Liberación real de recursos (la llama Game). */
  dispose() {
    if (this.object3d?.parent) this.object3d.parent.remove(this.object3d);
  }
}

export class PhysicsEntity extends Entity {
  constructor(game, type) {
    super(game, type);
    this.body = null;
    this.colliders = [];
    this.prevPos = new THREE.Vector3();
    this.currPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.currQuat = new THREE.Quaternion();
    this.visualOffset = new THREE.Vector3();
    this.interpolate = true;
  }

  /** Crea el cuerpo rígido y lo registra para interpolación y eventos. */
  attachBody(bodyDesc, colliderDescs) {
    const { body, colliders } = this.game.physics.createBody(bodyDesc, colliderDescs, this);
    this.body = body;
    this.colliders = colliders;
    this.captureCurrent();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.game.physics.bodiesToSync.add(this);
    this.syncVisual(1);
    return body;
  }

  capturePrevious() {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  captureCurrent() {
    if (!this.body) return;
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
  }

  /** Copia la pose interpolada al Object3D. */
  syncVisual(alpha) {
    if (!this.object3d || !this.body) return;
    if (this.interpolate) {
      this.object3d.position.lerpVectors(this.prevPos, this.currPos, alpha);
      this.object3d.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    } else {
      this.object3d.position.copy(this.currPos);
      this.object3d.quaternion.copy(this.currQuat);
    }
    if (this.visualOffset.lengthSq() > 0) {
      this.object3d.position.add(_off.copy(this.visualOffset).applyQuaternion(this.object3d.quaternion));
    }
  }

  get bodyPosition() {
    return this.currPos;
  }

  speed() {
    if (!this.body) return 0;
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  /** Aplica un cambio de velocidad (Δv) independiente de la masa, con tope. */
  push(dir, deltaV, maxMass = 60) {
    if (!this.body || !this.body.isDynamic()) return;
    const m = Math.min(this.body.mass(), maxMass);
    this.body.applyImpulse({ x: dir.x * deltaV * m, y: dir.y * deltaV * m, z: dir.z * deltaV * m }, true);
  }

  dispose() {
    this.game.physics.bodiesToSync.delete(this);
    if (this.body) this.game.physics.removeBody(this.body);
    this.body = null;
    super.dispose();
  }
}

const _off = new THREE.Vector3();
