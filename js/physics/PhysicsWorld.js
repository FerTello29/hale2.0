/**
 * PhysicsWorld — envoltura de Rapier 3D.
 *
 * - Paso fijo (60 Hz) con acumulador e interpolación para el render.
 * - Registro collider → entidad para despachar eventos de colisión.
 * - Consultas: raycast, superposición con esferas, impulsos radiales.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PHYSICS } from '../config.js';

/** Entidad "mundo" para colliders estáticos (terreno, muros, puentes...). */
export const WORLD_ENTITY = Object.freeze({ type: 'world', isStatic: true });

let rapierReady = null;
export function initRapier() {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

const _v = new THREE.Vector3();

export class PhysicsWorld {
  constructor() {
    this.R = RAPIER;
    this.world = null;
    this.eventQueue = null;
    this.owners = new Map();
    this.accumulator = 0;
    this.step_ = PHYSICS.fixedStep;
    this.gravity = PHYSICS.defaultGravity;
    this.stepCount = 0;
    this.bodiesToSync = new Set();
  }

  create(gravity = PHYSICS.defaultGravity) {
    this.dispose();
    this.gravity = gravity;
    this.world = new RAPIER.World({ x: 0, y: -gravity, z: 0 });
    this.world.timestep = this.step_;
    this.eventQueue = new RAPIER.EventQueue(true);
    this.owners.clear();
    this.bodiesToSync.clear();
    this.accumulator = 0;
    this.stepCount = 0;
  }

  dispose() {
    if (this.world) {
      this.world.free();
      this.world = null;
    }
    if (this.eventQueue) {
      this.eventQueue.free();
      this.eventQueue = null;
    }
    this.owners.clear();
    this.bodiesToSync.clear();
  }

  setGravity(g) {
    this.gravity = g;
    if (!this.world) return;
    this.world.gravity = { x: 0, y: -g, z: 0 };
    // despertar cuerpos para que el cambio se note inmediatamente
    this.world.forEachRigidBody((b) => {
      if (b.isDynamic()) b.wakeUp();
    });
  }

  /** Sincroniza las consultas espaciales con los cuerpos recién creados/movidos. */
  refreshQueries() {
    if (!this.world) return;
    this.world.propagateModifiedBodyPositionsToColliders();
    this.world.updateSceneQueries();
  }

  // --------------------------------------------------------------- registro
  register(collider, entity) {
    this.owners.set(collider.handle, entity);
  }

  unregister(collider) {
    this.owners.delete(collider.handle);
  }

  ownerOf(collider) {
    return collider ? this.owners.get(collider.handle) ?? null : null;
  }

  /** Crea un cuerpo con uno o varios colliders y los asocia a la entidad. */
  createBody(bodyDesc, colliderDescs, entity) {
    const body = this.world.createRigidBody(bodyDesc);
    const colliders = [];
    for (const cd of [].concat(colliderDescs)) {
      const c = this.world.createCollider(cd, body);
      colliders.push(c);
      if (entity) this.register(c, entity);
    }
    return { body, colliders };
  }

  /** Crea un collider fijo sin cuerpo (estático) — terreno, muros, rocas. */
  createStatic(colliderDesc, entity = WORLD_ENTITY) {
    const c = this.world.createCollider(colliderDesc);
    this.register(c, entity);
    return c;
  }

  removeBody(body) {
    if (!body || !this.world) return;
    const n = body.numColliders();
    for (let i = 0; i < n; i++) this.unregister(body.collider(i));
    this.world.removeRigidBody(body);
  }

  removeCollider(collider) {
    if (!collider || !this.world) return;
    this.unregister(collider);
    this.world.removeCollider(collider, true);
  }

  // --------------------------------------------------------------- simulación
  /**
   * Avanza la simulación con paso fijo.
   * @param {number} dt tiempo real transcurrido
   * @param {(h:number)=>void} beforeStep lógica de paso fijo (jugador, drones)
   * @param {(a,b,started)=>void} onCollision despacho de eventos
   * @returns {number} alpha para interpolar el render (0..1)
   */
  step(dt, beforeStep, onCollision) {
    if (!this.world) return 1;
    this.accumulator += Math.min(dt, 0.1);
    let steps = 0;
    while (this.accumulator >= this.step_ && steps < PHYSICS.maxSubSteps) {
      for (const ent of this.bodiesToSync) ent.capturePrevious?.();
      beforeStep?.(this.step_);
      this.world.step(this.eventQueue);
      this.stepCount++;
      this.eventQueue.drainCollisionEvents((h1, h2, started) => {
        const a = this.owners.get(h1) ?? null;
        const b = this.owners.get(h2) ?? null;
        if (!a && !b) return;
        const c1 = this.world.getCollider(h1);
        const c2 = this.world.getCollider(h2);
        onCollision?.(a, b, started, c1, c2);
      });
      this.eventQueue.drainContactForceEvents(() => {});
      for (const ent of this.bodiesToSync) ent.captureCurrent?.();
      this.accumulator -= this.step_;
      steps++;
    }
    if (steps === PHYSICS.maxSubSteps) this.accumulator = 0; // evitar "espiral de la muerte"
    return this.accumulator / this.step_;
  }

  // --------------------------------------------------------------- consultas
  /**
   * Raycast con normal. Devuelve { point, normal, distance, collider, entity } o null.
   */
  raycast(origin, dir, maxDist, { groups, excludeCollider, excludeBody, predicate, solid = true } = {}) {
    if (!this.world) return null;
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray, maxDist, solid,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups, excludeCollider, excludeBody, predicate
    );
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return {
      distance: d,
      point: new THREE.Vector3(origin.x + dir.x * d, origin.y + dir.y * d, origin.z + dir.z * d),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
      entity: this.ownerOf(hit.collider),
    };
  }

  /** Lista de colliders que intersectan una esfera. */
  overlapSphere(center, radius, { groups, includeSensors = false } = {}) {
    const out = [];
    if (!this.world) return out;
    const shape = new RAPIER.Ball(radius);
    this.world.intersectionsWithShape(
      center, { x: 0, y: 0, z: 0, w: 1 }, shape,
      (c) => {
        out.push(c);
        return true;
      },
      includeSensors ? undefined : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups
    );
    return out;
  }

  /**
   * Impulso radial: cambia la velocidad de los cuerpos dinámicos cercanos
   * (Δv decrece linealmente con la distancia). Devuelve las entidades afectadas.
   */
  radialImpulse(center, radius, deltaV, { upBias = 0.35, groups, maxMass = 60, exclude } = {}) {
    const touched = new Map();
    for (const c of this.overlapSphere(center, radius, { groups })) {
      const body = c.parent();
      const entity = this.ownerOf(c);
      if (entity && !touched.has(entity)) touched.set(entity, 0);
      if (!body || !body.isDynamic() || body === exclude) continue;
      if (touched.get(entity) === 1) continue;
      if (entity) touched.set(entity, 1);
      const p = body.translation();
      _v.set(p.x - center.x, p.y - center.y, p.z - center.z);
      const dist = Math.max(0.001, _v.length());
      const falloff = THREE.MathUtils.clamp(1 - dist / radius, 0, 1);
      if (falloff <= 0) continue;
      _v.divideScalar(dist);
      _v.y += upBias;
      _v.normalize();
      const m = Math.min(body.mass(), maxMass);
      const j = deltaV * falloff * m;
      body.applyImpulse({ x: _v.x * j, y: _v.y * j, z: _v.z * j }, true);
      body.applyTorqueImpulse(
        { x: (Math.random() - 0.5) * j * 0.15, y: (Math.random() - 0.5) * j * 0.15, z: (Math.random() - 0.5) * j * 0.15 },
        true
      );
    }
    return [...touched.keys()];
  }

  /** Utilidad: cuaternión de Rapier a partir de un ángulo en Y. */
  static yawQuat(angle) {
    return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
  }
}
