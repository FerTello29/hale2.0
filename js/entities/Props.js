/**
 * Props — objetos con física: cajas, cajas de suministros (rompibles),
 * barriles explosivos, rocas rodantes, vagonetas mineras, bloques de piedra
 * y los fragmentos (debris) que dejan las cajas al romperse.
 */
import * as THREE from 'three';
import { PhysicsEntity } from './Entity.js';
import { COLLISION, COMBAT, SCORE } from '../config.js';

const _dir = new THREE.Vector3();
const yawQuat = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

function dynamicDesc(R, pos, { rotY = 0, sleeping = false, linDamp = 0.05, angDamp = 0.15, ccd = false } = {}) {
  return R.RigidBodyDesc.dynamic()
    .setTranslation(pos.x, pos.y, pos.z)
    .setRotation(yawQuat(rotY))
    .setLinearDamping(linDamp)
    .setAngularDamping(angDamp)
    .setCcdEnabled(ccd)
    .setSleeping(sleeping);
}

const geoCache = new Map();
function cachedGeo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

// ------------------------------------------------------------------ Caja
export class Crate extends PhysicsEntity {
  constructor(game, pos, { size = 1, rotY = 0, sleeping = false, tower = null } = {}) {
    super(game, 'crate');
    const R = game.physics.R;
    this.size = size;
    this.tower = tower;
    const geo = cachedGeo(`box${size}`, () => new THREE.BoxGeometry(size, size, size));
    this.object3d = new THREE.Mesh(geo, this.material());
    this.object3d.castShadow = true;
    this.object3d.receiveShadow = true;
    game.level.root.add(this.object3d);
    const h = size / 2;
    this.attachBody(
      dynamicDesc(R, pos, { rotY, sleeping }),
      R.ColliderDesc.cuboid(h, h, h).setDensity(12).setFriction(0.75).setRestitution(0.05)
        .setCollisionGroups(COLLISION.prop)
    );
    this.spawnPos = this.currPos.clone();
  }

  material() {
    return this.game.assets.materials.crate;
  }
}

// ------------------------------------------------------------------ Caja de suministros (rompible)
export class SupplyCrate extends Crate {
  constructor(game, pos, opts = {}) {
    super(game, pos, { size: 0.9, ...opts });
    this.type = 'supply';
  }

  material() {
    return this.game.assets.materials.supply;
  }

  hit(info) {
    if (!this.alive) return;
    if (info.kind === 'orb' || info.kind === 'punch' || info.kind === 'explosion') this.break(info);
  }

  break(info) {
    if (!this.alive) return;
    const p = this.currPos.clone();
    const { game } = this;
    for (let i = 0; i < 7; i++) {
      const off = new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.2) * 0.6, (Math.random() - 0.5) * 0.6);
      const d = new Debris(game, p.clone().add(off));
      _dir.copy(off).normalize();
      if (info?.dir) _dir.addScaledVector(info.dir, 0.8);
      _dir.y += 0.6;
      d.push(_dir.normalize(), 3 + Math.random() * 4);
      game.addEntity(d);
    }
    game.fx.burst('wood', p);
    game.audio.play('crateBreak', p);
    game.mission?.crateBroken(p);
    // siempre suelta una batería o, con menos probabilidad, un núcleo dorado
    if (Math.random() < 0.8) game.spawner?.spawnBatteryAt(p);
    this.destroy();
  }
}

// ------------------------------------------------------------------ Fragmentos
export class Debris extends PhysicsEntity {
  constructor(game, pos) {
    super(game, 'debris');
    const R = game.physics.R;
    const w = 0.12 + Math.random() * 0.12;
    const l = 0.4 + Math.random() * 0.35;
    const geo = cachedGeo('debris', () => new THREE.BoxGeometry(1, 1, 1));
    this.object3d = new THREE.Mesh(geo, game.assets.materials.debris);
    this.object3d.scale.set(l, 0.06, w);
    this.object3d.castShadow = true;
    game.level.root.add(this.object3d);
    this.attachBody(
      dynamicDesc(R, pos, { rotY: Math.random() * Math.PI * 2, angDamp: 0.4 }),
      R.ColliderDesc.cuboid(l / 2, 0.03, w / 2).setDensity(6).setFriction(0.8).setCollisionGroups(COLLISION.debris)
    );
    this.life = 4 + Math.random() * 1.5;
  }

  update(dt) {
    this.life -= dt;
    if (this.life < 0.6) this.object3d.scale.multiplyScalar(Math.max(0.0, 1 - dt * 4));
    if (this.life <= 0) this.destroy();
  }
}

// ------------------------------------------------------------------ Bloque de piedra (torres)
export class StoneBlock extends PhysicsEntity {
  constructor(game, pos, size, { rotY = 0, tower = null, sleeping = true } = {}) {
    super(game, 'block');
    const R = game.physics.R;
    this.tower = tower;
    const key = `stone${size.x}_${size.y}_${size.z}`;
    const geo = cachedGeo(key, () => new THREE.BoxGeometry(size.x, size.y, size.z));
    this.object3d = new THREE.Mesh(geo, game.assets.materials.stone);
    this.object3d.castShadow = true;
    this.object3d.receiveShadow = true;
    game.level.root.add(this.object3d);
    this.attachBody(
      dynamicDesc(R, pos, { rotY, sleeping, angDamp: 0.2 }),
      R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setDensity(34).setFriction(0.8).setRestitution(0.02)
        .setCollisionGroups(COLLISION.prop)
    );
    this.spawnPos = this.currPos.clone();
  }
}

// ------------------------------------------------------------------ Barril explosivo
export class Barrel extends PhysicsEntity {
  constructor(game, pos, { rotY = 0, sleeping = false } = {}) {
    super(game, 'barrel');
    const R = game.physics.R;
    const { materials } = game.assets;
    const geo = cachedGeo('barrel', () => new THREE.CylinderGeometry(0.42, 0.42, 1.1, 24, 1));
    this.material = materials.barrel.clone(); // clonado para parpadear individualmente
    this.object3d = new THREE.Mesh(geo, [this.material, materials.barrelCap, materials.barrelCap]);
    this.object3d.castShadow = true;
    this.object3d.receiveShadow = true;
    game.level.root.add(this.object3d);
    this.attachBody(
      dynamicDesc(R, pos, { rotY, sleeping }),
      R.ColliderDesc.cylinder(0.55, 0.42).setDensity(18).setFriction(0.6).setRestitution(0.1)
        .setCollisionGroups(COLLISION.prop)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    );
    this.state = 'idle';
    this.fuse = 0;
  }

  ignite(delay) {
    if (this.state === 'exploded') return;
    if (this.state === 'fuse') {
      this.fuse = Math.min(this.fuse, delay);
      return;
    }
    this.state = 'fuse';
    this.fuse = delay;
    if (delay > 0.3) this.game.audio.play('fuse', this.currPos);
  }

  hit(info) {
    if (info.kind === 'orb') this.ignite(0.05);
    else if (info.kind === 'punch') this.ignite(1.3);
    else if (info.kind === 'explosion') this.ignite(0.12 + Math.random() * 0.22);
  }

  onCollide(other, started) {
    if (!started || this.state !== 'idle' || !this.body) return;
    // impacto fuerte (caída, roca, vagoneta lanzada)
    if (this.speed() > 11) this.ignite(0.05);
    else if (other?.type === 'boulder' && other.speed() > 6) this.ignite(0.1);
  }

  update(dt) {
    if (this.state !== 'fuse') return;
    this.fuse -= dt;
    const blink = Math.sin(performance.now() * 0.03) > 0;
    this.material.emissive.setHex(blink ? 0xff5522 : 0x000000);
    this.material.emissiveIntensity = 1.5;
    if (this.fuse <= 0) this.explode();
  }

  explode() {
    if (this.state === 'exploded' || !this.alive) return;
    this.state = 'exploded';
    const p = this.currPos.clone();
    this.destroy();
    this.game.combat.explode(p, {
      radius: COMBAT.barrelRadius,
      deltaV: COMBAT.barrelDeltaV,
      playerDamage: COMBAT.barrelPlayerDamage,
      source: this,
    });
    this.game.mission?.barrelExploded(p);
  }

  dispose() {
    this.material.dispose();
    super.dispose();
  }
}

// ------------------------------------------------------------------ Roca rodante
export class Boulder extends PhysicsEntity {
  constructor(game, pos, { radius = 0.8, sleeping = false, rockfall = false, seed = Math.random() } = {}) {
    super(game, 'boulder');
    const R = game.physics.R;
    this.radius = radius;
    this.rockfall = rockfall;
    const geo = new THREE.IcosahedronGeometry(radius, 2);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = Math.sin(v.x * 3.1 + seed * 10) * Math.cos(v.y * 2.7 + seed * 7) * Math.sin(v.z * 3.3 + seed * 3);
      v.multiplyScalar(1 + n * 0.12);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    this.geometry = geo;
    this.object3d = new THREE.Mesh(geo, game.assets.materials.boulder);
    this.object3d.castShadow = true;
    this.object3d.receiveShadow = true;
    game.level.root.add(this.object3d);
    this.attachBody(
      dynamicDesc(R, pos, { rotY: seed * 6, sleeping, angDamp: 0.35, ccd: rockfall }),
      R.ColliderDesc.ball(radius).setDensity(26).setFriction(0.85).setRestitution(0.12)
        .setCollisionGroups(COLLISION.prop)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    );
    this.age = 0;
    this.hitCooldown = 0;
    this.landed = false;
  }

  onCollide(other, started) {
    if (!started) return;
    const speed = this.speed();
    if (other?.type === 'player' && this.hitCooldown <= 0 && speed > 4.5) {
      this.hitCooldown = 0.8;
      other.damage(Math.min(30, (speed - 3.5) * 4.5 * (this.radius / 0.8)), 'boulder');
    }
    if (other?.type === 'drone' && speed > 3) other.hit({ kind: 'explosion', point: this.currPos.clone() });
    if (this.rockfall && !this.landed && other?.type === 'world') {
      this.landed = true;
      this.game.fx.burst('dust', this.currPos.clone().setY(this.currPos.y - this.radius * 0.8));
      this.game.audio.play('rockLand', this.currPos);
      this.game.cameraRig?.shakeFrom(this.currPos, 0.35);
    }
  }

  update(dt) {
    this.age += dt;
    this.hitCooldown -= dt;
    if (this.currPos.y < -40) this.destroy();
    // las rocas del derrumbe desaparecen cuando ya no estorban
    if (this.rockfall && this.age > 45 && this.body?.isSleeping()) this.destroy();
  }

  dispose() {
    this.geometry.dispose();
    super.dispose();
  }
}

// ------------------------------------------------------------------ Vagoneta minera
export class MineCart extends PhysicsEntity {
  constructor(game, pos, { rotY = 0 } = {}) {
    super(game, 'cart');
    const R = game.physics.R;
    this.object3d = game.assets.cloneProp('MineCart');
    game.level.root.add(this.object3d);
    this.visualOffset.set(0, -0.56, 0);
    const center = { x: pos.x, y: pos.y + 0.56, z: pos.z };
    this.attachBody(
      dynamicDesc(R, center, { rotY, linDamp: 0.15, angDamp: 0.4 }),
      [
        R.ColliderDesc.cuboid(0.56, 0.56, 0.8).setDensity(16).setFriction(0.06).setRestitution(0.05)
          .setCollisionGroups(COLLISION.prop),
      ]
    );
  }
}

export { SCORE };
