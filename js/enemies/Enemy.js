/**
 * Enemy — base de los enemigos terrestres.
 *
 * Cuerpo DINÁMICO de Rapier con rotaciones bloqueadas: la IA fija la velocidad
 * horizontal y la gravedad, los empujones de explosiones, la granada de
 * singularidad o el pulso de choque actúan de verdad sobre ellos. Al morir se
 * desbloquean las rotaciones y el cuerpo cae como un muñeco de trapo.
 */
import * as THREE from 'three';
import { PhysicsEntity } from '../entities/Entity.js';
import { COLLISION, G, groups } from '../config.js';

const _v = new THREE.Vector3();
const _to = new THREE.Vector3();
const _probe = new THREE.Vector3();
const OBSTACLE_QUERY = groups(0xffff, G.WORLD | G.PROP);
const DEAD_GROUPS = groups(G.DEBRIS, G.WORLD | G.PROP);

export class Enemy extends PhysicsEntity {
  /**
   * @param {object} cfg { type, hp, shape:'capsule'|'ball', radius, halfHeight, mass, speed, sight, hear, score, eyeHeight }
   */
  constructor(game, pos, cfg) {
    super(game, cfg.type);
    const R = game.physics.R;
    this.cfg = cfg;
    this.faction = 'enemy';
    const diff = game.difficulty;
    this.maxHp = cfg.hp * diff.enemyHp;
    this.hp = this.maxHp;
    this.radius = cfg.radius ?? 0.35;
    this.halfHeight = cfg.halfHeight ?? 0.55;
    this.centerOffset = cfg.shape === 'ball' ? this.radius : this.halfHeight + this.radius;
    this.hitRadius = cfg.hitRadius ?? this.radius + 0.2;
    this.object3d = new THREE.Group();
    game.level.root.add(this.object3d);
    this.facing = Math.random() * Math.PI * 2;

    const center = { x: pos.x, y: pos.y + this.centerOffset + 0.05, z: pos.z };
    const shape = cfg.shape === 'ball' ? R.ColliderDesc.ball(this.radius) : R.ColliderDesc.capsule(this.halfHeight, this.radius);
    const vol = cfg.shape === 'ball' ? (4 / 3) * Math.PI * this.radius ** 3 : Math.PI * this.radius ** 2 * (2 * this.halfHeight) + (4 / 3) * Math.PI * this.radius ** 3;
    this.attachBody(
      R.RigidBodyDesc.dynamic().setTranslation(center.x, center.y, center.z).lockRotations().setLinearDamping(0.1).setCanSleep(false),
      shape.setDensity((cfg.mass ?? 70) / vol).setFriction(0.15).setFrictionCombineRule(R.CoefficientCombineRule.Min).setRestitution(0).setCollisionGroups(cfg.groups ?? COLLISION.enemy)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    );
    this.home = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.wantVel = new THREE.Vector3();
    this.state = 'idle';
    this.alerted = false;
    this.sees = false;
    this.distance = Infinity;
    this.lastSeen = new THREE.Vector3();
    this.senseTimer = Math.random() * 0.2;
    this.stagger = 0;
    this.dead = false;
    this.deathTime = 0;
    this.flash = 0;
    this.stuckTime = 0;
    this.avoidDir = 0;
    this.avoidTimer = 0;
    this.wander = null;
    this.wanderTimer = 0;
    this.flashMats = [];
    game.enemies.add(this);
    game.damageables.add(this);
  }

  /** Registra materiales que parpadean al recibir daño. */
  collectFlashMaterials(root) {
    root.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive) {
        o.material = o.material.clone();
        this.flashMats.push({ m: o.material, base: o.material.emissive.clone(), k: o.material.emissiveIntensity });
      }
    });
  }

  get player() {
    return this.game.player;
  }

  get feet() {
    return _v.copy(this.currPos).setY(this.currPos.y - this.centerOffset);
  }

  eyePosition(out = new THREE.Vector3()) {
    return out.copy(this.currPos).setY(this.currPos.y + (this.cfg.eyeHeight ?? 0.5));
  }

  damagePoint(out = new THREE.Vector3()) {
    return out.copy(this.currPos);
  }

  isHeadshot(point) {
    return this.cfg.headY !== undefined && point.y > this.currPos.y + this.cfg.headY;
  }

  // ------------------------------------------------------------ percepción
  perceive() {
    const player = this.player;
    if (!player || player.dead) {
      this.sees = false;
      return;
    }
    const chest = player.chestPosition(_to);
    const eye = this.eyePosition(_probe);
    this.distance = eye.distanceTo(chest);
    this.sees = false;
    if (this.distance < (this.cfg.sight ?? 32)) {
      const dir = chest.clone().sub(eye).normalize();
      const hit = this.game.physics.raycast(eye, dir, this.distance, { groups: COLLISION.enemySight });
      this.sees = !hit;
    }
    if (this.sees) {
      this.lastSeen.copy(player.currPos);
      if (!this.alerted) this.alert(true);
    }
  }

  alert(propagate = false) {
    if (this.alerted || this.dead) return;
    this.alerted = true;
    this.lastSeen.copy(this.player?.currPos ?? this.currPos);
    this.onAlert?.();
    if (propagate) {
      for (const e of this.game.enemies) {
        if (e !== this && !e.alerted && e.currPos.distanceTo(this.currPos) < 18) e.alert(false);
      }
    }
  }

  hear(pos, radius) {
    if (!this.alerted && this.currPos.distanceTo(pos) < radius) this.alert(true);
  }

  // ------------------------------------------------------------ movimiento
  /** Dirección hacia `target` evitando obstáculos con raycasts a la altura de la rodilla. */
  steer(target, speed, dt) {
    _to.subVectors(target, this.currPos).setY(0);
    const dist = _to.length();
    if (dist < 0.3) {
      this.wantVel.set(0, 0, 0);
      return dist;
    }
    _to.divideScalar(dist);
    this.avoidTimer -= dt;
    const origin = _probe.copy(this.currPos);
    origin.y = this.currPos.y - this.centerOffset + 0.55;
    const look = Math.min(2.2, dist);
    const blocked = (dx, dz) => !!this.game.physics.raycast(origin, { x: dx, y: 0, z: dz }, look, { groups: OBSTACLE_QUERY, excludeCollider: this.colliders[0] });
    let dx = _to.x;
    let dz = _to.z;
    if (this.avoidTimer > 0 && this.avoidDir) {
      const a = this.avoidDir;
      const c = Math.cos(a);
      const s = Math.sin(a);
      dx = _to.x * c - _to.z * s;
      dz = _to.x * s + _to.z * c;
    } else if (blocked(dx, dz)) {
      for (const a of [0.7, -0.7, 1.4, -1.4, 2.1, -2.1]) {
        const c = Math.cos(a);
        const s = Math.sin(a);
        const nx = _to.x * c - _to.z * s;
        const nz = _to.x * s + _to.z * c;
        if (!blocked(nx, nz)) {
          dx = nx;
          dz = nz;
          this.avoidDir = a;
          this.avoidTimer = 0.6;
          break;
        }
      }
    }
    this.wantVel.set(dx * speed, 0, dz * speed);
    return dist;
  }

  faceToward(target, dt, rate = 8) {
    const yaw = Math.atan2(target.x - this.currPos.x, target.z - this.currPos.z);
    let d = yaw - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, dt * rate);
  }

  stun(t) {
    if (this.dead) return;
    this.stagger = Math.max(this.stagger, t);
  }

  fixedUpdate(h) {
    if (this.dead || !this.body) return;
    if (this.stagger > 0) {
      this.stagger -= h;
      return;
    }
    const v = this.body.linvel();
    const k = Math.min(1, (this.cfg.accel ?? 10) * h);
    const nx = v.x + (this.wantVel.x - v.x) * k;
    const nz = v.z + (this.wantVel.z - v.z) * k;
    this.body.setLinvel({ x: nx, y: v.y, z: nz }, true);
    // detección de atasco: si quiere moverse y no avanza, pequeño salto lateral
    const want = Math.hypot(this.wantVel.x, this.wantVel.z);
    const got = Math.hypot(v.x, v.z);
    if (want > 1 && got < 0.35) this.stuckTime += h;
    else this.stuckTime = Math.max(0, this.stuckTime - h);
    if (this.stuckTime > 0.9) {
      this.stuckTime = 0;
      const m = this.body.mass();
      const side = Math.random() < 0.5 ? 1 : -1;
      this.body.applyImpulse({ x: -this.wantVel.z * side * 0.4 * m, y: 4.5 * m, z: this.wantVel.x * side * 0.4 * m }, true);
      this.avoidDir = side * 1.2;
      this.avoidTimer = 0.8;
    }
  }

  // ------------------------------------------------------------ daño y muerte
  takeDamage(amount, info = {}) {
    if (this.dead) return 0;
    let real = info.weak ? amount * (this.cfg.weakMult ?? 2) : amount;
    if (this.modifyDamage) real = this.modifyDamage(real, info);
    if (real <= 0) return 0;
    this.hp -= real;
    this.flash = 1;
    this.alert(true);
    if (info.source === 'player') this.game.damage.number(info.point ?? this.currPos, real, { headshot: info.headshot, weak: info.weak });
    if (info.force && info.dir && this.body) {
      const m = this.body.mass();
      const f = Math.min(info.force, 18) * (info.kind === 'explosion' || info.kind === 'melee' || info.kind === 'pulse' ? 1 : 0.15) * (this.cfg.knockback ?? 1);
      this.body.applyImpulse({ x: info.dir.x * f * m, y: Math.max(0.2, info.dir.y + 0.25) * f * m * 0.5, z: info.dir.z * f * m }, true);
      if (f > 4) this.stun(Math.min(0.9, f * 0.06));
    }
    this.onDamaged?.(real, info);
    if (this.hp <= 0) this.die(info);
    return real;
  }

  die(info = {}) {
    if (this.dead) return;
    this.dead = true;
    this.state = 'dead';
    this.hp = 0;
    this.game.enemies.delete(this);
    this.game.damageables.delete(this);
    this.wantVel.set(0, 0, 0);
    if (this.body) {
      this.body.setEnabledRotations(true, true, true, true);
      for (const c of this.colliders) c.setCollisionGroups(DEAD_GROUPS);
      const m = this.body.mass();
      const dir = info.dir ?? new THREE.Vector3(0, 0, 1);
      const f = 2.5 + Math.min(10, info.force ?? 3) * 0.5;
      this.body.applyImpulse({ x: dir.x * f * m, y: 2.2 * m, z: dir.z * f * m }, true);
      this.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 0.8, y: (Math.random() - 0.5) * m * 0.3, z: (Math.random() - 0.5) * m * 0.8 }, true);
    }
    this.game.bus.emit('enemy:killed', {
      enemy: this,
      type: this.type,
      name: this.cfg.name ?? this.type,
      score: this.cfg.score ?? 50,
      headshot: !!info.headshot,
      weapon: info.weapon ?? info.kind,
      boss: !!this.isBoss,
      pos: this.currPos.clone(),
      source: info.source,
    });
    if (info.source === 'player') this.game.spawner?.dropLoot(this.currPos.clone(), this.type);
    this.onDeath?.(info);
  }

  // ------------------------------------------------------------ cuadro
  update(dt) {
    if (this.dead) {
      this.deathTime += dt;
      if (this.deathTime > 4.5) this.object3d.position.y -= dt * 0.8;
      if (this.deathTime > 6 || this.currPos.y < -40) this.destroy();
      this.updateDead?.(dt);
      return;
    }
    this.senseTimer -= dt;
    if (this.senseTimer <= 0) {
      this.senseTimer = 0.2;
      this.perceive();
    }
    this.think(dt);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
      for (const f of this.flashMats) {
        f.m.emissive.copy(f.base).lerp(new THREE.Color(0xffffff), this.flash);
        f.m.emissiveIntensity = f.k + this.flash * 2;
      }
    }
    if (this.currPos.y < -30) this.die({ source: 'world' });
  }

  think() {}

  syncVisual(alpha) {
    if (!this.object3d || !this.body) return;
    this.object3d.position.lerpVectors(this.prevPos, this.currPos, alpha);
    if (this.dead) this.object3d.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    else this.object3d.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.facing || 0);
  }

  dispose() {
    this.game.enemies.delete(this);
    this.game.damageables.delete(this);
    super.dispose();
  }
}
