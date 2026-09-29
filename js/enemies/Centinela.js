/**
 * Centinela — dron de cristal flotante del Eco.
 *
 * Cuerpo CINEMÁTICO de Rapier (vuela, ignora la gravedad) que orbita al
 * jugador y dispara pares de rayos. El pulso de choque (Q) lo aturde y le hace
 * daño doble. Al morir su cuerpo pasa a ser DINÁMICO: cae con la gravedad del
 * mundo y estalla al tocar el suelo.
 */
import * as THREE from 'three';
import { PhysicsEntity } from '../entities/Entity.js';
import { EnemyBolt } from '../entities/Projectiles.js';
import { Debris } from '../entities/Props.js';
import { COLLISION, G, groups, SCORE } from '../config.js';
import { heightAt, isVoid } from '../world/TerrainField.js';

const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const OBSTACLE = groups(0xffff, G.WORLD | G.PROP);

export class Centinela extends PhysicsEntity {
  constructor(game, pos, { altitude = 3.6 } = {}) {
    super(game, 'centinela');
    const R = game.physics.R;
    this.faction = 'enemy';
    this.cfg = { name: 'Centinela', score: SCORE.centinela };
    this.maxHp = 60 * game.difficulty.enemyHp;
    this.hp = this.maxHp;
    this.hitRadius = 0.6;
    this.altitude = altitude + Math.random() * 1.2;
    this.pos = new THREE.Vector3(pos.x, heightAt(pos.x, pos.z) + this.altitude, pos.z);
    this.vel = new THREE.Vector3();
    this.home = this.pos.clone();

    this.object3d = new THREE.Group();
    this.model = game.assets.cloneProp('Sentinel');
    this.model.scale.setScalar(1.25);
    this.object3d.add(this.model);
    this.glow = game.fx.createGlowSprite(0xff2bd6, 1.6);
    this.glow.position.z = 0.3;
    this.object3d.add(this.glow);
    this.ring = this.model.getObjectByName('SentinelRing');
    this.eye = this.model.getObjectByName('SentinelEye');
    game.level.root.add(this.object3d);
    this.flashMats = [];
    this.model.traverse((o) => {
      if (o.isMesh && o.material?.emissive) {
        o.material = o.material.clone();
        this.flashMats.push({ m: o.material, base: o.material.emissive.clone(), k: o.material.emissiveIntensity });
      }
    });

    this.attachBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y, this.pos.z),
      R.ColliderDesc.ball(0.55).setCollisionGroups(COLLISION.drone).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    );
    this.alerted = false;
    this.sees = false;
    this.dead = false;
    this.senseTimer = Math.random() * 0.3;
    this.fireCd = 1.5 + Math.random() * 2;
    this.orbitAngle = Math.random() * Math.PI * 2;
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
    this.orbitRadius = 9 + Math.random() * 4;
    this.stunT = 0;
    this.flash = 0;
    this.t = Math.random() * 10;
    this.lastSeen = new THREE.Vector3();
    this.distance = Infinity;
    game.drones.add(this);
    game.enemies.add(this);
    game.damageables.add(this);
  }

  get isActive() {
    return this.alive && !this.dead;
  }

  get player() {
    return this.game.player;
  }

  damagePoint(out = new THREE.Vector3()) {
    return out.copy(this.currPos);
  }

  isWeakPoint(point) {
    if (!this.eye) return false;
    this.eye.getWorldPosition(_t);
    return point.distanceTo(_t) < 0.28;
  }

  alert(propagate = false) {
    if (this.alerted || this.dead) return;
    this.alerted = true;
    this.game.audio.play('sentinelAlert', this.currPos);
    if (propagate) {
      for (const e of this.game.enemies) if (e !== this && !e.alerted && e.currPos.distanceTo(this.currPos) < 18) e.alert?.(false);
    }
  }

  hear(pos, radius) {
    if (!this.alerted && this.currPos.distanceTo(pos) < radius) this.alert(true);
  }

  stun(t) {
    this.stunT = Math.max(this.stunT, t);
  }

  #perceive() {
    const player = this.player;
    this.sees = false;
    if (!player || player.dead) return;
    const chest = player.chestPosition(_t);
    this.distance = this.pos.distanceTo(chest);
    if (this.distance > 42) return;
    const dir = _v.copy(chest).sub(this.pos).normalize();
    const hit = this.game.physics.raycast(this.pos, dir, this.distance, { groups: COLLISION.enemySight });
    this.sees = !hit;
    if (this.sees) {
      this.lastSeen.copy(player.currPos);
      this.alert(true);
    }
  }

  fixedUpdate(h) {
    if (this.dead || !this.body) return;
    const player = this.player;
    this.t += h;
    let target;
    if (this.stunT > 0) {
      this.stunT -= h;
      this.vel.multiplyScalar(0.9);
      this.vel.y -= 6 * h;
    } else {
      if (this.alerted && player && !player.dead) {
        this.orbitAngle += h * this.orbitDir * 0.45;
        const c = this.sees ? player.currPos : this.lastSeen;
        target = _t.set(c.x + Math.cos(this.orbitAngle) * this.orbitRadius, 0, c.z + Math.sin(this.orbitAngle) * this.orbitRadius);
      } else {
        this.orbitAngle += h * 0.25;
        target = _t.set(this.home.x + Math.cos(this.orbitAngle) * 5, 0, this.home.z + Math.sin(this.orbitAngle) * 5);
      }
      // no sobrevolar el abismo si no hace falta
      if (isVoid(target.x, target.z)) target.lerp(this.home, 0.5);
      target.y = Math.max(heightAt(target.x, target.z), heightAt(this.pos.x, this.pos.z)) + this.altitude + Math.sin(this.t * 1.7) * 0.4;
      const desired = _v.copy(target).sub(this.pos);
      const d = desired.length();
      const speed = this.alerted ? 5.5 : 2;
      if (d > 0.01) desired.multiplyScalar(Math.min(speed, d * 1.5) / d);
      // evitar obstáculos: si hay algo delante, subir y rodear
      if (this.vel.lengthSq() > 0.5) {
        const dir = this.vel.clone().normalize();
        const hit = this.game.physics.raycast(this.pos, dir, 2.2, { groups: OBSTACLE, excludeCollider: this.colliders[0] });
        if (hit) {
          desired.y += 4;
          this.orbitDir *= -1;
        }
      }
      this.vel.lerp(desired, Math.min(1, h * 2.5));
    }
    this.pos.addScaledVector(this.vel, h);
    const floor = heightAt(this.pos.x, this.pos.z) + 1.2;
    if (this.pos.y < floor && !isVoid(this.pos.x, this.pos.z)) this.pos.y = floor;
    this.body.setNextKinematicTranslation(this.pos);
  }

  update(dt) {
    if (this.dead) {
      this.deadT += dt;
      this.object3d.rotation.x += dt * 6;
      if (Math.random() < dt * 30) this.game.fx.burst('sparks', this.currPos.clone());
      if (this.deadT > 3 || this.currPos.y < -40) this.#explode();
      return;
    }
    this.senseTimer -= dt;
    if (this.senseTimer <= 0) {
      this.senseTimer = 0.2;
      this.#perceive();
    }
    const player = this.player;
    // mirar al jugador
    if (player && this.alerted) {
      const p = player.chestPosition(_t);
      this.object3d.lookAt(p);
    } else {
      this.object3d.rotation.y += dt * 0.6;
    }
    if (this.ring) this.ring.rotation.z += dt * 3;
    this.model.rotation.z = Math.sin(this.t * 2) * 0.15;
    // disparo
    this.fireCd -= dt;
    if (this.alerted && this.sees && this.stunT <= 0 && this.fireCd <= 0 && this.game.state === 'playing' && this.distance < 38) {
      this.fireCd = (2.2 + Math.random() * 1.2) / this.game.difficulty.accuracy;
      this.#fire();
    }
    this.glow.material.opacity = 0.6 + (this.fireCd < 0.5 ? (0.5 - this.fireCd) * 1.5 : 0);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
      for (const f of this.flashMats) {
        f.m.emissive.copy(f.base).lerp(new THREE.Color(0xffffff), this.flash);
        f.m.emissiveIntensity = f.k + this.flash * 2;
      }
    }
  }

  #fire() {
    const player = this.player;
    const { game } = this;
    const target = player.chestPosition(new THREE.Vector3());
    const dist = this.pos.distanceTo(target);
    target.addScaledVector(player.velocity, dist / 22 * 0.6);
    const right = new THREE.Vector3().subVectors(target, this.pos).cross(THREE.Object3D.DEFAULT_UP).normalize();
    for (const s of [-1, 1]) {
      const origin = this.pos.clone().addScaledVector(right, s * 0.35);
      const dir = target.clone().sub(origin).normalize();
      const err = 0.04 / game.difficulty.accuracy;
      dir.x += (Math.random() - 0.5) * err;
      dir.y += (Math.random() - 0.5) * err;
      dir.z += (Math.random() - 0.5) * err;
      dir.normalize();
      game.addEntity(new EnemyBolt(game, origin, dir.multiplyScalar(22), 6, 0xff5ae0));
    }
    game.fx.flash(this.pos, 0xff2bd6, 5, 0.2);
    game.audio.play('sentinelShot', this.pos);
  }

  takeDamage(amount, info = {}) {
    if (this.dead) return 0;
    let real = info.weak ? amount * 1.8 : amount;
    if (info.kind === 'pulse') this.stun(1.6);
    this.hp -= real;
    this.flash = 1;
    this.alert(true);
    if (info.source === 'player') this.game.damage.number(info.point ?? this.currPos, real, { headshot: info.headshot, weak: info.weak });
    if (info.dir) this.vel.addScaledVector(info.dir, Math.min(8, (info.force ?? 2) * 0.6));
    if (this.hp <= 0) this.die(info);
    return real;
  }

  die(info = {}) {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
    this.hp = 0;
    const { game } = this;
    game.drones.delete(this);
    game.enemies.delete(this);
    game.damageables.delete(this);
    // de cinemático a dinámico: ahora lo gobierna la gravedad
    const R = game.physics.R;
    this.body.setBodyType(R.RigidBodyType.Dynamic, true);
    this.body.setLinvel({ x: this.vel.x + (info.dir?.x ?? 0) * 4, y: 2, z: this.vel.z + (info.dir?.z ?? 0) * 4 }, true);
    this.body.setAngvel({ x: 4, y: 6, z: 2 }, true);
    this.colliders[0].setCollisionGroups(groups(G.DEBRIS, G.WORLD | G.PROP));
    this.colliders[0].setDensity(20);
    this.object3d.lookAt(this.object3d.position.clone().add(new THREE.Vector3(0, -1, 0)));
    game.audio.play('sentinelDie', this.currPos);
    game.fx.burst('sparks', this.currPos.clone());
    game.bus.emit('enemy:killed', {
      enemy: this, type: this.type, name: 'Centinela', score: this.cfg.score, headshot: !!info.headshot,
      weapon: info.weapon ?? info.kind, pos: this.currPos.clone(), source: info.source,
    });
    if (info.source === 'player') game.spawner?.dropLoot(this.currPos.clone(), this.type);
  }

  onCollide(other, started) {
    if (!started || !this.dead || this.deadT < 0.15) return;
    if (other?.type === 'world' || other?.type === 'crate' || other?.type === 'block') this.#explode();
  }

  #explode() {
    if (!this.alive) return;
    const p = this.currPos.clone();
    this.destroy();
    for (let i = 0; i < 4; i++) {
      const d = new Debris(this.game, p.clone().add(new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.5, (Math.random() - 0.5))), 'crystal', 1);
      d.push(new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(), 4);
      this.game.addEntity(d);
    }
    this.game.damage.explode(p, { radius: 3.5, damage: 30, deltaV: 8, source: 'player', small: true, color: 0xff5ae0, friendly: true, selfFactor: 0.4 });
  }

  syncVisual(alpha) {
    if (!this.body) return;
    this.object3d.position.lerpVectors(this.prevPos, this.currPos, alpha);
  }

  dispose() {
    this.game.drones.delete(this);
    this.game.enemies.delete(this);
    this.game.damageables.delete(this);
    super.dispose();
  }
}
