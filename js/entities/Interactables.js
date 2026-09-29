/**
 * Interactables — elementos de misión:
 *
 *  RescueBeacon    baliza de rescate (nivel 1): se activa con E y transmite
 *  Dropship        nave de extracción: aterriza, baja la rampa y se aborda con E
 *  CrystalNode     nodo/ancla de cristal con vida (escudos de los jefes)
 *  ResonancePylon  torre de bloques de piedra con cristal: se derriba con física
 *  TempleGate      puerta sellada del templo (nivel 2)
 */
import * as THREE from 'three';
import { Entity, PhysicsEntity } from './Entity.js';
import { StoneBlock, Debris } from './Props.js';
import { COLLISION } from '../config.js';

const _v = new THREE.Vector3();
const yawQuat = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

// ====================================================================== baliza
export class RescueBeacon extends Entity {
  constructor(game, pos, { radius = 16, duration = 60 } = {}) {
    super(game, 'beacon');
    const R = game.physics.R;
    this.pos = pos.clone();
    this.radius = radius;
    this.duration = duration;
    this.object3d = new THREE.Group();
    this.object3d.position.copy(pos);
    this.model = game.assets.cloneProp('RescueBeacon', { cloneMaterials: true });
    this.model.scale.setScalar(1.5);
    this.object3d.add(this.model);
    this.light = this.model.getObjectByName('BeaconLight');
    this.panel = this.model.getObjectByName('BeaconPanel');
    this.glow = game.fx.createGlowSprite(0xff3a2a, 2.2);
    this.glow.position.y = 3.45 * 1.5;
    this.object3d.add(this.glow);
    // columna de transmisión
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.8, 120, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    this.beam.position.y = 60;
    this.object3d.add(this.beam);
    // anillo de la zona a defender
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.25, radius, 96),
      new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.15;
    this.object3d.add(this.ring);
    game.level.root.add(this.object3d);
    game.physics.createStatic(R.ColliderDesc.cylinder(1.2, 0.7).setTranslation(pos.x, pos.y + 1.2, pos.z).setCollisionGroups(COLLISION.world));
    this.state = 'off'; // off → ready → transmitting → done
    this.progress = 0;
    this.t = 0;
    this.inside = true;
  }

  get interactPoint() {
    return this.pos;
  }

  canInteract(p) {
    return this.state === 'ready' && p.distanceTo(this.pos) < 3.6;
  }

  setReady() {
    if (this.state !== 'off') return;
    this.state = 'ready';
    this.glow.material.color.setHex(0xffb347);
  }

  activate() {
    if (this.state !== 'ready') return false;
    this.state = 'transmitting';
    this.glow.material.color.setHex(0x7fe8ff);
    this.game.audio.play('beacon', this.pos);
    return true;
  }

  update(dt) {
    this.t += dt;
    const blink = Math.sin(this.t * (this.state === 'transmitting' ? 9 : 3)) > 0;
    this.glow.visible = this.state !== 'off' || blink;
    this.glow.scale.setScalar(2 + (blink ? 0.6 : 0));
    if (this.state === 'transmitting') {
      const player = this.game.player;
      this.inside = !!player && player.currPos.distanceTo(this.pos) < this.radius;
      if (this.inside && this.game.state === 'playing') this.progress = Math.min(1, this.progress + dt / this.duration);
      this.beam.material.opacity = 0.12 + Math.sin(this.t * 6) * 0.04;
      this.beam.rotation.y += dt;
      this.ring.material.opacity = this.inside ? 0.35 : 0.2 + (blink ? 0.4 : 0);
      this.ring.material.color.setHex(this.inside ? 0x7fe8ff : 0xff5a4a);
      if (this.progress >= 1) {
        this.state = 'done';
        this.game.audio.play('objective', this.pos);
        this.game.bus.emit('beacon:done');
      }
    } else if (this.state === 'done') {
      this.beam.material.opacity = 0.2;
      this.ring.material.opacity = Math.max(0, this.ring.material.opacity - dt);
    }
  }

  dispose() {
    this.beam.geometry.dispose();
    this.beam.material.dispose();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    super.dispose();
  }
}

// ====================================================================== nave
export class Dropship extends Entity {
  /**
   * @param {THREE.Vector3} pos punto de aterrizaje
   * @param {number} yaw orientación (la rampa queda en -Z local)
   * @param {{landed?:boolean, wreck?:boolean}} opts
   */
  constructor(game, pos, yaw = 0, { landed = false, wreck = false } = {}) {
    super(game, 'dropship');
    const R = game.physics.R;
    this.pos = pos.clone();
    this.yaw = yaw;
    this.wreck = wreck;
    this.object3d = new THREE.Group();
    this.model = game.assets.cloneProp('Dropship', { cloneMaterials: wreck });
    this.object3d.add(this.model);
    this.object3d.rotation.y = yaw;
    this.rampPivot = this.model.getObjectByName('RampPivot');
    this.engines = [];
    this.model.traverse((o) => {
      if (o.name === 'EngineGlow') this.engines.push(o);
    });
    game.level.root.add(this.object3d);
    this.lights = [];
    if (!wreck) {
      for (const e of this.engines) {
        const s = game.fx.createGlowSprite(0x7fe8ff, 2.2);
        s.position.y = -0.9;
        e.add(s);
        this.lights.push(s);
      }
    }
    this.t = 0;
    this.colliders = [];
    if (wreck) {
      this.state = 'wreck';
      this.object3d.position.copy(pos);
      this.model.rotation.set(0.08, 0, 0.22);
      this.model.position.y = -0.6;
      for (const m of this.engines) m.visible = false;
      if (this.rampPivot) this.rampPivot.rotation.x = 0.5;
      this.#addColliders(R);
    } else if (landed) {
      this.state = 'landed';
      this.object3d.position.copy(pos);
      this.rampT = 1;
      this.#addColliders(R);
    } else {
      this.state = 'hidden';
      this.object3d.visible = false;
      this.object3d.position.copy(pos);
    }
    this.rampT = this.rampT ?? 0;
    this.#poseRamp();
  }

  #addColliders(R) {
    const q = yawQuat(this.yaw);
    const add = (hx, hy, hz, lx, ly, lz) => {
      const off = _v.set(lx, ly, lz).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
      this.colliders.push(
        this.game.physics.createStatic(
          R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(this.pos.x + off.x, this.pos.y + off.y, this.pos.z + off.z).setRotation(q).setCollisionGroups(COLLISION.world)
        )
      );
    };
    add(1.7, 1.25, 4.3, 0, this.wreck ? 1.6 : 2.2, 0);
    add(1.4, 0.9, 1.6, 0, this.wreck ? 1.8 : 2.4, 5.2);
    if (!this.wreck) {
      add(2.2, 0.15, 1.3, 3.6, 2.6, -1);
      add(2.2, 0.15, 1.3, -3.6, 2.6, -1);
    }
  }

  /** Punto (mundo) al pie de la rampa, donde se aborda. */
  get interactPoint() {
    return _v.set(0, 0, -7.4).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw).add(this.pos).clone();
  }

  canInteract(p) {
    return this.state === 'ready' && p.distanceTo(this.interactPoint) < 4.2;
  }

  /** Aterrizaje animado. */
  arrive(duration = 7) {
    if (this.state !== 'hidden') return;
    this.state = 'arriving';
    this.object3d.visible = true;
    this.arriveT = 0;
    this.arriveDur = duration;
    this.game.audio.play('dropship', this.pos);
  }

  #poseRamp() {
    if (this.rampPivot && !this.wreck) this.rampPivot.rotation.x = -this.rampT * 0.32;
  }

  update(dt) {
    this.t += dt;
    if (this.wreck) {
      if (Math.random() < dt * 14) {
        const p = this.object3d.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 3.2, (Math.random() - 0.5) * 5).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw));
        this.game.fx.smoke(p);
      }
      return;
    }
    for (const s of this.lights) s.scale.setScalar(2 + Math.sin(this.t * 30) * 0.3);
    if (this.state === 'arriving') {
      this.arriveT += dt;
      const k = Math.min(1, this.arriveT / this.arriveDur);
      const e = 1 - Math.pow(1 - k, 3);
      const from = _v.set(0, 45, 60).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
      this.object3d.position.set(this.pos.x + from.x * (1 - e), this.pos.y + from.y * (1 - e), this.pos.z + from.z * (1 - e));
      this.object3d.rotation.x = (1 - e) * 0.25;
      if (k > 0.8 && Math.random() < dt * 30) this.game.fx.burst('dust', this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 0.2, (Math.random() - 0.5) * 8)));
      if (k >= 1) {
        this.state = 'landing';
        this.object3d.position.copy(this.pos);
        this.object3d.rotation.x = 0;
        this.#addColliders(this.game.physics.R);
        this.game.physics.refreshQueries();
        this.game.audio.play('rampOpen', this.pos);
      }
    } else if (this.state === 'landing') {
      this.rampT = Math.min(1, this.rampT + dt / 1.6);
      this.#poseRamp();
      if (this.rampT >= 1) {
        this.state = 'ready';
        this.game.bus.emit('dropship:ready');
      }
    } else if (this.state === 'landed') {
      this.state = 'ready';
    }
    if (this.state === 'ready' || this.state === 'landing') {
      this.object3d.position.y = this.pos.y + Math.sin(this.t * 1.3) * 0.03;
    }
  }

  dispose() {
    for (const c of this.colliders) this.game.physics.removeCollider(c);
    super.dispose();
  }
}

// ====================================================================== nodo de cristal
/**
 * Cristal con vida montado en un pedestal. Alimenta el escudo de un jefe con
 * un rayo de energía visible. Si se destruye, emite onDestroyed.
 */
export class CrystalNode extends Entity {
  constructor(game, pos, { hp = 220, scale = 1.6, name = 'Nodo', color = 0xff38c8, pedestal = true, onDestroyed } = {}) {
    super(game, 'node');
    const R = game.physics.R;
    this.faction = 'enemy';
    this.isObjective = true;
    this.label = name;
    this.maxHp = hp;
    this.hp = hp;
    this.hitRadius = 0.9 * scale;
    this.onDestroyed = onDestroyed;
    this.object3d = new THREE.Group();
    this.object3d.position.copy(pos);
    if (pedestal) {
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 1.4, 8), game.assets.materials.ruin);
      ped.position.y = 0.7;
      ped.castShadow = ped.receiveShadow = true;
      this.pedestal = ped;
      this.object3d.add(ped);
    }
    this.crystal = game.assets.cloneProp('PylonCrystal', { cloneMaterials: true });
    this.crystal.scale.setScalar(scale);
    this.crystal.position.y = (pedestal ? 1.4 : 0) + 0.75 * scale;
    this.object3d.add(this.crystal);
    this.core = this.crystal.getObjectByName('PylonCore');
    this.glow = game.fx.createGlowSprite(color, 2.2 * scale);
    this.glow.position.y = this.crystal.position.y;
    this.object3d.add(this.glow);
    this.coreMat = this.core?.material;
    game.level.root.add(this.object3d);
    this.center = pos.clone().setY(pos.y + this.crystal.position.y);
    const height = (pedestal ? 1.4 : 0) + 1.8 * scale;
    this.collider = game.physics.createStatic(
      R.ColliderDesc.cylinder(height / 2, 0.8 * Math.max(1, scale * 0.8)).setTranslation(pos.x, pos.y + height / 2, pos.z).setCollisionGroups(COLLISION.world),
      this
    );
    this.flash = 0;
    this.t = Math.random() * 5;
    this.dead = false;
    this.currPos = this.center;
    game.damageables.add(this);
  }

  damagePoint(out = new THREE.Vector3()) {
    return out.copy(this.center);
  }

  takeDamage(amount, info = {}) {
    if (this.dead) return 0;
    this.hp -= amount;
    this.flash = 1;
    if (info.source === 'player') this.game.damage.number(info.point ?? this.center, amount, {});
    this.game.audio.play('crystalHit', this.center);
    if (this.hp <= 0) this.shatter();
    return amount;
  }

  shatter() {
    if (this.dead) return;
    this.dead = true;
    const { game } = this;
    game.damageables.delete(this);
    for (let i = 0; i < 10; i++) {
      const d = new Debris(game, this.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.5)), 'crystal', 2);
      d.push(new THREE.Vector3(Math.random() - 0.5, 0.8, Math.random() - 0.5).normalize(), 5 + Math.random() * 4);
      game.addEntity(d);
    }
    game.fx.burst('shards', this.center);
    game.fx.burst('crystalBlast', this.center);
    game.fx.flash(this.center, 0xff38c8, 20, 0.6);
    game.fx.shockwave(this.center.clone().setY(this.center.y - 2), 6, 0xff38c8);
    game.audio.play('crystalShatter', this.center);
    game.cameraRig.shakeFrom(this.center, 0.6);
    this.crystal.visible = false;
    this.glow.visible = false;
    game.physics.removeCollider(this.collider);
    this.collider = null;
    if (this.pedestal) {
      const R = game.physics.R;
      const p = this.object3d.position;
      this.collider = game.physics.createStatic(R.ColliderDesc.cylinder(0.7, 1.3).setTranslation(p.x, p.y + 0.7, p.z).setCollisionGroups(COLLISION.world));
    }
    this.onDestroyed?.(this);
  }

  update(dt) {
    this.t += dt;
    if (this.dead) return;
    this.crystal.rotation.y += dt * 0.8;
    this.crystal.position.y += Math.sin(this.t * 2) * 0.002;
    this.glow.material.opacity = 0.55 + Math.sin(this.t * 3) * 0.15 + this.flash * 0.5;
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 5);
      if (this.coreMat) this.coreMat.emissiveIntensity = 2.2 + this.flash * 4;
    }
  }

  dispose() {
    this.game.damageables.delete(this);
    if (this.collider) this.game.physics.removeCollider(this.collider);
    this.pedestal?.geometry.dispose();
    super.dispose();
  }
}

// ====================================================================== pilón de resonancia
/** Cristal dinámico que corona la torre de piedra del pilón. */
class PylonTop extends PhysicsEntity {
  constructor(game, pos, pylon) {
    super(game, 'pylonTop');
    const R = game.physics.R;
    this.pylon = pylon;
    this.faction = 'enemy';
    this.isObjective = true;
    this.hitRadius = 0.9;
    this.object3d = game.assets.cloneProp('PylonCrystal', { cloneMaterials: true });
    this.object3d.scale.setScalar(1.3);
    this.core = this.object3d.getObjectByName('PylonCore');
    this.glow = game.fx.createGlowSprite(0xb070ff, 4);
    this.object3d.add(this.glow);
    game.level.root.add(this.object3d);
    this.attachBody(
      R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setSleeping(true).setAngularDamping(0.3),
      R.ColliderDesc.cylinder(0.9, 0.55).setDensity(6).setFriction(0.8).setCollisionGroups(COLLISION.prop)
    );
    this.startY = pos.y;
    this.flash = 0;
    game.damageables.add(this);
  }

  takeDamage(amount, info = {}) {
    if (!this.alive || this.pylon.destroyed) return 0;
    const real = info.kind === 'explosion' ? amount * 1.2 : amount;
    this.pylon.hp -= real;
    this.flash = 1;
    if (info.source === 'player') this.game.damage.number(info.point ?? this.currPos, real, {});
    this.game.audio.play('crystalHit', this.currPos);
    if (info.dir) this.push(info.dir, Math.min(2.5, real / 40));
    if (this.pylon.hp <= 0) this.pylon.destroy('shot');
    return real;
  }

  update(dt) {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 5);
      if (this.core) this.core.material.emissiveIntensity = 2.2 + this.flash * 4;
    }
    this.glow.material.opacity = 0.6 + Math.sin(performance.now() * 0.004) * 0.2;
  }

  dispose() {
    this.game.damageables.delete(this);
    super.dispose();
  }
}

/**
 * Pilón de resonancia: torre de bloques de piedra (cuerpos dinámicos dormidos)
 * coronada por un cristal. Se destruye si el cristal pierde su vida o si cae
 * al derribar la torre (explosiones, singularidad, orbes, golpes).
 */
export class ResonancePylon extends Entity {
  constructor(game, pos, { name = 'Pilón', hp = 260, rotY = 0, levels = 4, onDestroyed } = {}) {
    super(game, 'pylon');
    this.label = name;
    this.pos = pos.clone();
    this.hp = hp;
    this.maxHp = hp;
    this.onDestroyed = onDestroyed;
    this.destroyed = false;
    this.blocks = [];
    let y = pos.y;
    // base ancha y tambor que se estrecha: bloques apilados
    const sizes = [
      new THREE.Vector3(2.6, 1.0, 2.6),
      new THREE.Vector3(1.9, 1.3, 1.9),
      new THREE.Vector3(1.5, 1.3, 1.5),
      new THREE.Vector3(1.3, 1.1, 1.3),
      new THREE.Vector3(1.1, 0.9, 1.1),
    ].slice(0, levels);
    sizes.forEach((s, i) => {
      y += s.y / 2;
      const b = new StoneBlock(game, new THREE.Vector3(pos.x, y + 0.005, pos.z), s, { rotY: rotY + i * 0.18, owner: this, sleeping: true, glyphs: i % 2 === 0 });
      game.addEntity(b);
      this.blocks.push(b);
      y += s.y / 2;
    });
    this.top = new PylonTop(game, new THREE.Vector3(pos.x, y + 0.95, pos.z), this);
    game.addEntity(this.top);
    this.height = y + 0.95 - pos.y;
    this.t = 0;
  }

  get center() {
    return this.top.currPos;
  }

  get currPos() {
    return this.top.currPos;
  }

  update(dt) {
    this.t += dt;
    if (this.destroyed) return;
    const top = this.top;
    // derribado: el cristal cayó o se desplazó mucho
    const p = top.currPos;
    if (p.y < top.startY - 2.2 || Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > 3.5) this.destroy('toppled');
  }

  destroy(how = 'shot') {
    if (this.destroyed) return;
    this.destroyed = true;
    const { game } = this;
    const c = this.top.currPos.clone();
    for (let i = 0; i < 9; i++) {
      const d = new Debris(game, c.clone().add(new THREE.Vector3((Math.random() - 0.5), Math.random(), (Math.random() - 0.5))), 'crystal', 1.8);
      d.push(new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(), 6);
      game.addEntity(d);
    }
    game.fx.burst('shards', c);
    game.fx.burst('crystalBlast', c);
    game.fx.flash(c, 0xb070ff, 20, 0.6);
    game.audio.play('crystalShatter', c);
    game.cameraRig.shakeFrom(c, 0.6);
    this.top.destroy();
    // despertar la torre para que reaccione
    for (const b of this.blocks) b.body?.wakeUp();
    this.onDestroyed?.(this, how);
  }
}

// ====================================================================== puerta del templo
export class TempleGate extends Entity {
  constructor(game, pos, yaw = 0) {
    super(game, 'gate');
    const R = game.physics.R;
    this.pos = pos.clone();
    this.yaw = yaw;
    this.object3d = game.assets.cloneProp('TempleGate', { cloneMaterials: true });
    this.object3d.position.copy(pos);
    this.object3d.rotation.y = yaw;
    game.level.root.add(this.object3d);
    this.doors = [this.object3d.getObjectByName('DoorL'), this.object3d.getObjectByName('DoorR')];
    this.doorBase = this.doors.map((d) => d.position.x);
    // barrera de energía
    this.barrier = new THREE.Mesh(
      new THREE.PlaneGeometry(10.6, 10.6),
      new THREE.MeshBasicMaterial({ color: 0xb070ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    this.barrier.position.set(0, 5.3, 1.2);
    this.object3d.add(this.barrier);
    const q = yawQuat(yaw);
    const place = (hx, hy, hz, lx, ly, lz) => {
      const off = _v.set(lx, ly, lz).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      return game.physics.createStatic(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(pos.x + off.x, pos.y + off.y, pos.z + off.z).setRotation(q).setCollisionGroups(COLLISION.world));
    };
    place(1.1, 5.5, 1.6, -6.4, 5.5, 0);
    place(1.1, 5.5, 1.6, 6.4, 5.5, 0);
    place(7.5, 1.2, 1.8, 0, 11.8, 0);
    this.doorCollider = place(5.3, 5.25, 0.5, 0, 5.25, 0);
    this.open = 0;
    this.opening = false;
    this.sealed = true;
    this.t = 0;
  }

  unseal() {
    if (!this.sealed) return;
    this.sealed = false;
    this.game.audio.play('barrierDown', this.pos);
    this.game.fx.flash(this.pos.clone().setY(this.pos.y + 5), 0xb070ff, 25, 1);
  }

  openDoors() {
    if (this.opening) return;
    this.opening = true;
    this.game.audio.play('gateOpen', this.pos);
    this.game.cameraRig.shakeFrom(this.pos, 0.8);
  }

  /** Punto justo detrás de la puerta (dentro del templo). */
  get inside() {
    return _v.set(0, 0, -4).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw).add(this.pos).clone();
  }

  update(dt) {
    this.t += dt;
    if (this.sealed) {
      this.barrier.material.opacity = 0.3 + Math.sin(this.t * 3) * 0.08;
    } else if (this.barrier.visible) {
      this.barrier.material.opacity -= dt * 0.5;
      if (this.barrier.material.opacity <= 0) this.barrier.visible = false;
    }
    if (this.opening && this.open < 1) {
      this.open = Math.min(1, this.open + dt / 4);
      const e = this.open * this.open * (3 - 2 * this.open);
      this.doors[0].position.x = this.doorBase[0] - e * 4.6;
      this.doors[1].position.x = this.doorBase[1] + e * 4.6;
      if (Math.random() < dt * 20) this.game.fx.burst('dust', this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 10, 0.3, 1)));
      if (this.open >= 1 && this.doorCollider) {
        this.game.physics.removeCollider(this.doorCollider);
        this.doorCollider = null;
        this.game.bus.emit('gate:open');
      }
    }
  }

  dispose() {
    this.barrier.geometry.dispose();
    this.barrier.material.dispose();
    super.dispose();
  }
}

