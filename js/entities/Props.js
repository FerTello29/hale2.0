/**
 * Props — objetos con física del escenario:
 *   Crate          caja militar (apilable, empujable)
 *   SupplyCrate    caja de suministros rompible (suelta munición, salud o granadas)
 *   Canister       cápsula de plasma inestable: explota con disparos o impactos
 *   StoneOrb       esfera de piedra rodante (también la lanza el Coloso)
 *   StoneBlock     bloque de piedra de los pilones derribables
 *   Debris         fragmentos (metal o cristal) que se desvanecen
 */
import * as THREE from 'three';
import { PhysicsEntity } from './Entity.js';
import { COLLISION } from '../config.js';

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

// ------------------------------------------------------------------ caja militar
export class Crate extends PhysicsEntity {
  constructor(game, pos, { size = 1, rotY = 0, sleeping = true } = {}) {
    super(game, 'crate');
    const R = game.physics.R;
    this.size = size;
    const geo = cachedGeo(`box${size}`, () => new THREE.BoxGeometry(size, size, size));
    this.object3d = new THREE.Mesh(geo, this.material());
    this.object3d.castShadow = true;
    this.object3d.receiveShadow = true;
    game.level.root.add(this.object3d);
    const h = size / 2;
    this.attachBody(
      dynamicDesc(R, pos, { rotY, sleeping }),
      R.ColliderDesc.cuboid(h, h, h).setDensity(14).setFriction(0.75).setRestitution(0.05).setCollisionGroups(COLLISION.prop)
    );
    this.spawnPos = this.currPos.clone();
  }

  material() {
    return this.game.assets.materials.crate;
  }
}

// ------------------------------------------------------------------ caja de suministros
export class SupplyCrate extends Crate {
  constructor(game, pos, opts = {}) {
    super(game, pos, { size: 0.85, ...opts });
    this.type = 'supply';
    this.hp = 25;
    this.hitRadius = 0.5;
    game.damageables.add(this);
    // franja luminosa para distinguirla
    const band = new THREE.Mesh(
      cachedGeo('supplyBand', () => new THREE.BoxGeometry(0.87, 0.08, 0.87)),
      cachedGeo('supplyBandMat', () => new THREE.MeshStandardMaterial({ color: 0x9dffe0, emissive: 0x19ffb0, emissiveIntensity: 2 }))
    );
    this.object3d.add(band);
  }

  takeDamage(amount, info = {}) {
    if (!this.alive) return 0;
    this.hp -= amount;
    if (info.dir) this.push(info.dir, Math.min(4, amount / 12));
    if (this.hp <= 0) this.break(info);
    return amount;
  }

  break(info = {}) {
    if (!this.alive) return;
    const p = this.currPos.clone();
    const { game } = this;
    for (let i = 0; i < 6; i++) {
      const off = new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.2) * 0.6, (Math.random() - 0.5) * 0.6);
      const d = new Debris(game, p.clone().add(off), 'metal');
      _dir.copy(off).normalize();
      if (info.dir) _dir.addScaledVector(info.dir, 0.8);
      _dir.y += 0.6;
      d.push(_dir.normalize(), 3 + Math.random() * 4);
      game.addEntity(d);
    }
    game.fx.burst('sparks', p);
    game.audio.play('crateBreak', p);
    game.spawner?.dropLoot(p, 'crate');
    game.bus.emit('crate:broken', { pos: p });
    this.destroy();
  }

  dispose() {
    this.game.damageables.delete(this);
    super.dispose();
  }
}

// ------------------------------------------------------------------ cápsula de plasma
export class Canister extends PhysicsEntity {
  constructor(game, pos, { rotY = 0, sleeping = true } = {}) {
    super(game, 'canister');
    const R = game.physics.R;
    const { materials } = game.assets;
    const geo = cachedGeo('canister', () => new THREE.CylinderGeometry(0.4, 0.4, 1.1, 20, 1));
    this.material = materials.canister.clone();
    this.object3d = new THREE.Mesh(geo, [this.material, materials.canisterCap, materials.canisterCap]);
    this.object3d.castShadow = true;
    this.object3d.receiveShadow = true;
    const glow = new THREE.Mesh(
      cachedGeo('canGlow', () => new THREE.CylinderGeometry(0.12, 0.12, 0.2, 12)),
      cachedGeo('canGlowMat', () => new THREE.MeshStandardMaterial({ color: 0xffd0a0, emissive: 0xff8a1a, emissiveIntensity: 3 }))
    );
    glow.position.y = 0.62;
    this.object3d.add(glow);
    game.level.root.add(this.object3d);
    this.attachBody(
      dynamicDesc(R, pos, { rotY, sleeping }),
      R.ColliderDesc.cylinder(0.55, 0.4).setDensity(16).setFriction(0.6).setRestitution(0.1).setCollisionGroups(COLLISION.prop)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    );
    this.hp = 20;
    this.hitRadius = 0.55;
    this.state = 'idle';
    this.fuse = 0;
    game.damageables.add(this);
  }

  takeDamage(amount, info = {}) {
    if (this.state === 'exploded') return 0;
    this.hp -= amount;
    if (info.dir && this.body) this.push(info.dir, Math.min(3, amount / 15));
    if (this.hp <= 0) this.ignite(info.kind === 'explosion' ? 0.12 + Math.random() * 0.2 : 0.05);
    else if (this.state === 'idle' && this.hp < 12) this.ignite(1.6); // fuga: explota en breve
    return amount;
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

  onCollide(other, started) {
    if (!started || this.state !== 'idle' || !this.body) return;
    if (this.speed() > 11) this.ignite(0.05);
  }

  update(dt) {
    if (this.state !== 'fuse') return;
    this.fuse -= dt;
    const blink = Math.sin(performance.now() * 0.03) > 0;
    this.material.emissive.setHex(blink ? 0xff6a22 : 0x000000);
    this.material.emissiveIntensity = 1.6;
    if (Math.random() < dt * 20) this.game.fx.burst('sparks', this.currPos.clone().setY(this.currPos.y + 0.5));
    if (this.fuse <= 0) this.explode();
  }

  explode() {
    if (this.state === 'exploded' || !this.alive) return;
    this.state = 'exploded';
    const p = this.currPos.clone();
    this.destroy();
    this.game.damage.explode(p, { radius: 7, damage: 120, deltaV: 16, source: 'player', selfFactor: 0.6, friendly: true });
    this.game.bus.emit('canister:exploded', { pos: p });
  }

  dispose() {
    this.game.damageables.delete(this);
    this.material.dispose();
    super.dispose();
  }
}

// ------------------------------------------------------------------ esfera de piedra
export class StoneOrb extends PhysicsEntity {
  constructor(game, pos, { radius = 0.8, sleeping = false, thrown = false, damage = 28, seed = Math.random() } = {}) {
    super(game, 'boulder');
    const R = game.physics.R;
    this.radius = radius;
    this.thrown = thrown;
    this.damageAmount = damage;
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
    this.object3d = new THREE.Mesh(geo, game.assets.materials.rock);
    this.object3d.castShadow = true;
    this.object3d.receiveShadow = true;
    game.level.root.add(this.object3d);
    this.attachBody(
      dynamicDesc(R, pos, { rotY: seed * 6, sleeping, angDamp: 0.35, ccd: thrown }),
      R.ColliderDesc.ball(radius).setDensity(26).setFriction(0.85).setRestitution(0.12).setCollisionGroups(COLLISION.prop)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    );
    this.age = 0;
    this.hitCooldown = 0;
  }

  onCollide(other, started) {
    if (!started) return;
    const speed = this.speed();
    if (other?.type === 'player' && this.hitCooldown <= 0 && speed > 4.5) {
      this.hitCooldown = 0.8;
      other.damage(this.thrown ? this.damageAmount : Math.min(25, (speed - 3.5) * 4), { source: 'enemy', kind: 'boulder', from: this.currPos });
    }
    if (other?.takeDamage && other.faction === 'enemy' && speed > 6 && !this.thrown) {
      other.takeDamage(speed * 6, { kind: 'crush', source: 'player', point: this.currPos.clone(), dir: other.currPos.clone().sub(this.currPos).normalize() });
    }
    if (this.thrown && other?.type === 'world' && speed > 5) {
      this.game.fx.burst('dust', this.currPos.clone());
      this.game.audio.play('rockLand', this.currPos);
      this.game.cameraRig?.shakeFrom(this.currPos, 0.4);
      this.thrown = false;
    }
  }

  update(dt) {
    this.age += dt;
    this.hitCooldown -= dt;
    if (this.currPos.y < -45) this.destroy();
    if (this.age > 60 && this.body?.isSleeping() && this.transient) this.destroy();
  }

  dispose() {
    this.geometry.dispose();
    super.dispose();
  }
}

// ------------------------------------------------------------------ bloque de piedra
export class StoneBlock extends PhysicsEntity {
  constructor(game, pos, size, { rotY = 0, owner = null, sleeping = true, glyphs = true } = {}) {
    super(game, 'block');
    const R = game.physics.R;
    this.owner = owner;
    const key = `stone${size.x}_${size.y}_${size.z}`;
    const geo = cachedGeo(key, () => new THREE.BoxGeometry(size.x, size.y, size.z));
    this.object3d = new THREE.Mesh(geo, glyphs ? game.assets.materials.ruin : game.assets.materials.stone);
    this.object3d.castShadow = true;
    this.object3d.receiveShadow = true;
    game.level.root.add(this.object3d);
    this.attachBody(
      dynamicDesc(R, pos, { rotY, sleeping, angDamp: 0.2 }),
      R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setDensity(22).setFriction(0.8).setRestitution(0.02)
        .setCollisionGroups(COLLISION.prop)
    );
    this.spawnPos = this.currPos.clone();
  }
}

// ------------------------------------------------------------------ fragmentos
export class Debris extends PhysicsEntity {
  constructor(game, pos, kind = 'metal', scale = 1) {
    super(game, 'debris');
    const R = game.physics.R;
    const w = (0.12 + Math.random() * 0.14) * scale;
    const l = (0.3 + Math.random() * 0.35) * scale;
    const crystal = kind === 'crystal';
    const geo = crystal ? cachedGeo('debrisC', () => new THREE.OctahedronGeometry(1, 0)) : cachedGeo('debrisM', () => new THREE.BoxGeometry(1, 1, 1));
    const mat = crystal
      ? cachedGeo('debrisCMat', () => new THREE.MeshStandardMaterial({ color: 0xd6c2ff, emissive: 0x7a2cff, emissiveIntensity: 1.5, flatShading: true }))
      : game.assets.materials.debris;
    this.object3d = new THREE.Mesh(geo, mat);
    if (crystal) this.object3d.scale.set(w, l, w);
    else this.object3d.scale.set(l, 0.05 * scale, w);
    this.object3d.castShadow = true;
    game.level.root.add(this.object3d);
    this.attachBody(
      dynamicDesc(R, pos, { rotY: Math.random() * Math.PI * 2, angDamp: 0.4 }),
      (crystal ? R.ColliderDesc.ball(Math.max(0.06, w * 0.8)) : R.ColliderDesc.cuboid(l / 2, 0.025 * scale, w / 2))
        .setDensity(8).setFriction(0.8).setCollisionGroups(COLLISION.debris)
    );
    this.baseScale = this.object3d.scale.clone();
    this.life = 3.5 + Math.random() * 1.5;
  }

  update(dt) {
    this.life -= dt;
    if (this.life < 0.6) this.object3d.scale.copy(this.baseScale).multiplyScalar(Math.max(0.01, this.life / 0.6));
    if (this.life <= 0) this.destroy();
  }
}
