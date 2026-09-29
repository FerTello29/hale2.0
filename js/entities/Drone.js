/**
 * Drone — centinela de CAPATAZ.
 *
 * Vuela como cuerpo cinemático (Rapier kinematicPositionBased): patrulla,
 * detecta al jugador con un raycast de línea de visión y dispara rayos.
 * Al recibir un impacto se convierte en cuerpo DINÁMICO, cae por gravedad
 * y explota al tocar el suelo.
 */
import * as THREE from 'three';
import { PhysicsEntity } from './Entity.js';
import { EnemyBolt } from './Projectiles.js';
import { COLLISION, G, groups } from '../config.js';
import { heightAt } from '../world/Terrain.js';

const _to = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const DOWN = { x: 0, y: -1, z: 0 };
const GROUND_QUERY = groups(0xffff, G.WORLD | G.PROP);
const SIGHT_QUERY = groups(0xffff, G.WORLD);

export class Drone extends PhysicsEntity {
  constructor(game, home, squad) {
    super(game, 'drone');
    const R = game.physics.R;
    this.home = home; // { pos: Vector3, tower }
    this.squad = squad;
    this.object3d = game.assets.cloneProp('Drone', { cloneMaterials: true });
    this.object3d.scale.setScalar(1.15);
    this.rotors = [0, 1, 2, 3].map((i) => this.object3d.getObjectByName(`Rotor${i}`)).filter(Boolean);
    this.eyeMats = [];
    this.object3d.traverse((o) => {
      if (o.isMesh && o.material.name === 'GlowRed') this.eyeMats.push(o.material);
    });
    game.level.root.add(this.object3d);

    this.hover = 3.4 + Math.random() * 0.8;
    this.patrolAngle = Math.random() * Math.PI * 2;
    this.patrolRadius = 5 + Math.random() * 2.5;
    // nace sobre su círculo de patrulla (nunca dentro de la torre que vigila)
    const start = home.pos.clone();
    start.x += Math.cos(this.patrolAngle) * this.patrolRadius;
    start.z += Math.sin(this.patrolAngle) * this.patrolRadius;
    start.y = this.#groundAt(start.x, start.z) + this.hover + 2;
    this.attachBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y, start.z),
      R.ColliderDesc.ball(0.6)
        .setDensity(18)
        .setFriction(0.5)
        .setRestitution(0.2)
        .setCollisionGroups(COLLISION.drone)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    );
    this.pos = start.clone();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.state = 'patrol';
    this.fireTimer = 1.5 + Math.random() * 1.5;
    this.senseTimer = 0;
    this.groundTimer = 0;
    this.groundY = start.y - this.hover;
    this.seesPlayer = false;
    this.downTime = 0;
    this.time = Math.random() * 10;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
  }

  #groundAt(x, z) {
    const hit = this.game.physics.raycast({ x, y: 60, z }, DOWN, 90, { groups: GROUND_QUERY });
    return Math.max(hit ? hit.point.y : heightAt(x, z), heightAt(x, z));
  }

  get isActive() {
    return this.state === 'patrol' || this.state === 'chase' || this.state === 'return';
  }

  // ------------------------------------------------------------ IA (tiempo variable)
  update(dt) {
    this.time += dt;
    for (const r of this.rotors) r.rotation.y += dt * (this.isActive ? 38 : 6);
    if (this.state === 'down') {
      this.downTime += dt;
      if (this.downTime > 2.6 || this.currPos.y < -20) this.explode();
      return;
    }
    const player = this.game.player;
    this.senseTimer -= dt;
    if (this.senseTimer <= 0 && player && !player.dead) {
      this.senseTimer = 0.2;
      const chest = player.chestPosition(_tmp);
      const dist = this.currPos.distanceTo(chest);
      this.seesPlayer = false;
      if (dist < 26) {
        _to.subVectors(chest, this.currPos).normalize();
        const hit = this.game.physics.raycast(this.currPos, _to, dist, { groups: SIGHT_QUERY });
        this.seesPlayer = !hit;
      }
      const fromHome = _to.subVectors(this.currPos, this.home.pos).setY(0).length();
      if (this.state === 'return') {
        if (fromHome < 6) this.state = 'patrol';
      } else if (fromHome > 34) {
        this.state = 'return';
      } else if (this.seesPlayer) {
        if (this.state !== 'chase') {
          this.game.audio.play('droneAlert', this.currPos);
          this.fireTimer = Math.max(this.fireTimer, 0.9);
        }
        this.state = 'chase';
      } else if (this.state === 'chase' && dist > 32) {
        this.state = 'patrol';
      }
    }

    // disparo con aviso visual (el ojo se intensifica antes de disparar)
    let glow = 2.6;
    if (this.state === 'chase' && this.seesPlayer && player && !player.dead && this.game.state === 'playing') {
      this.fireTimer -= dt;
      if (this.fireTimer < 0.55) glow = 2.6 + (0.55 - this.fireTimer) * 14;
      if (this.fireTimer <= 0) {
        this.fire(player);
        this.fireTimer = this.squad.fireInterval * (0.8 + Math.random() * 0.4);
      }
    }
    for (const m of this.eyeMats) m.emissiveIntensity = glow;
  }

  fire(player) {
    const target = player.chestPosition(new THREE.Vector3());
    const origin = this.currPos.clone();
    _to.subVectors(target, origin);
    const dist = _to.length();
    const speed = 17;
    // puntería con anticipación parcial al movimiento del jugador
    target.addScaledVector(player.velocity, (dist / speed) * 0.55);
    _to.subVectors(target, origin).normalize();
    origin.addScaledVector(_to, 0.85);
    const bolt = new EnemyBolt(this.game, origin, _to.clone().multiplyScalar(speed), 9 * this.squad.damageMult);
    this.game.addEntity(bolt);
    this.game.audio.play('droneShot', origin);
  }

  // ------------------------------------------------------------ vuelo (paso fijo)
  fixedUpdate(h) {
    if (!this.isActive || !this.body) return;
    this.groundTimer -= h;
    const target = _tmp;
    let maxSpeed = 3;
    const player = this.game.player;
    if (this.state === 'chase' && player) {
      maxSpeed = 5.5;
      const pp = player.currPos;
      _to.subVectors(this.pos, pp).setY(0);
      if (_to.lengthSq() < 0.01) _to.set(1, 0, 0);
      _to.normalize();
      // orbitar lentamente alrededor del jugador manteniendo distancia
      const a = Math.atan2(_to.z, _to.x) + this.strafe * 0.35 * h;
      target.set(pp.x + Math.cos(a) * 9, 0, pp.z + Math.sin(a) * 9);
    } else if (this.state === 'return') {
      maxSpeed = 5;
      target.set(this.home.pos.x, 0, this.home.pos.z);
    } else {
      this.patrolAngle += (maxSpeed / this.patrolRadius) * h * 0.8;
      target.set(
        this.home.pos.x + Math.cos(this.patrolAngle) * this.patrolRadius,
        0,
        this.home.pos.z + Math.sin(this.patrolAngle) * this.patrolRadius
      );
    }
    if (this.groundTimer <= 0) {
      this.groundTimer = 0.25;
      // suelo actual y 2.5 m adelante: así el dron se eleva ANTES de llegar a una torre o pila de cajas
      const ahead = this.vel.lengthSq() > 0.01 ? _tmp2.copy(this.vel).setY(0).normalize().multiplyScalar(2.5) : _tmp2.set(0, 0, 0);
      this.groundY = Math.max(this.#groundAt(this.pos.x, this.pos.z), this.#groundAt(this.pos.x + ahead.x, this.pos.z + ahead.z));
    }
    const minY = this.groundY + this.hover;
    target.y = Math.max(minY, player && this.state === 'chase' ? player.currPos.y + 2.8 : minY) + Math.sin(this.time * 1.7) * 0.25;

    _to.subVectors(target, this.pos);
    const desired = _to.clone();
    if (desired.length() > maxSpeed) desired.setLength(maxSpeed);
    this.vel.lerp(desired, Math.min(1, h * 3));
    this.pos.addScaledVector(this.vel, h);
    // nunca atravesar el terreno
    this.pos.y = Math.max(this.pos.y, heightAt(this.pos.x, this.pos.z) + 1.2);

    // orientación: mira al jugador en persecución, si no hacia donde avanza
    let yawTarget = this.yaw;
    if (this.state === 'chase' && player) {
      yawTarget = Math.atan2(player.currPos.x - this.pos.x, player.currPos.z - this.pos.z);
    } else if (this.vel.lengthSq() > 0.05) {
      yawTarget = Math.atan2(this.vel.x, this.vel.z);
    }
    let d = yawTarget - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, h * 5);
    const tilt = THREE.MathUtils.clamp(this.vel.length() * 0.05, 0, 0.25);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, this.yaw, 0, 'YXZ'));
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }

  // ------------------------------------------------------------ daño
  hit(info) {
    if (!this.isActive) return;
    this.knockDown(info);
  }

  knockDown(info) {
    const R = this.game.physics.R;
    this.state = 'down';
    this.downTime = 0;
    this.body.setBodyType(R.RigidBodyType.Dynamic, true);
    this.body.setGravityScale(1, true);
    const dir = info?.dir ? info.dir.clone() : new THREE.Vector3().subVectors(this.currPos, info?.point ?? this.currPos);
    if (dir.lengthSq() < 0.001) dir.set(0, 0, 1);
    dir.normalize();
    this.body.setLinvel({ x: dir.x * 6 + this.vel.x, y: 3 + dir.y * 2, z: dir.z * 6 + this.vel.z }, true);
    this.body.setAngvel({ x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 12, z: (Math.random() - 0.5) * 12 }, true);
    for (const m of this.eyeMats) {
      m.emissive.setHex(0x331100);
      m.emissiveIntensity = 0.5;
    }
    this.game.fx.burst('sparks', this.currPos.clone());
    this.game.audio.play('droneDown', this.currPos);
    this.game.mission?.droneDowned(this.currPos.clone());
  }

  onCollide(other, started) {
    if (this.state === 'down' && started && this.downTime > 0.25 && (other?.type === 'world' || other?.type === 'block')) {
      this.explode();
    }
  }

  explode() {
    if (this.state === 'dead') return;
    this.state = 'dead';
    const p = this.currPos.clone();
    this.destroy();
    this.game.combat.explode(p, { radius: 4, deltaV: 8, playerDamage: 10, source: this, small: true });
    this.squad.onDroneDead(this);
  }
}

/** Escuadrón: crea los drones y los reaparece mientras su torre siga en pie. */
export class DroneSquad {
  constructor(game, homes, difficulty) {
    this.game = game;
    this.homes = homes;
    this.count = Math.min(difficulty.drones, homes.length);
    this.fireInterval = difficulty.droneFireInterval;
    this.respawnTime = difficulty.droneRespawn;
    this.damageMult = difficulty.damageMult;
    this.drones = [];
    this.pending = [];
  }

  spawnAll() {
    for (let i = 0; i < this.count; i++) this.spawn(this.homes[i]);
  }

  spawn(home) {
    const d = new Drone(this.game, home, this);
    this.drones.push(d);
    this.game.addEntity(d);
    return d;
  }

  onDroneDead(drone) {
    this.drones = this.drones.filter((d) => d !== drone);
    const tower = drone.home.tower;
    if (!tower || !tower.destroyed) this.pending.push({ home: drone.home, t: this.respawnTime });
  }

  update(dt) {
    for (const p of this.pending) p.t -= dt;
    const ready = this.pending.filter((p) => p.t <= 0);
    this.pending = this.pending.filter((p) => p.t > 0);
    for (const p of ready) {
      const tower = p.home.tower;
      const anyTower = this.game.level.towers.some((t) => !t.destroyed);
      if ((tower && tower.destroyed) || !anyTower) continue;
      const d = this.spawn(p.home);
      this.game.fx.burst('sparks', d.currPos.clone());
    }
  }

  get active() {
    return this.drones.filter((d) => d.isActive);
  }
}
