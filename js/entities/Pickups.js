/**
 * Pickups — objetos que se recogen al tocarlos (sensores de Rapier con
 * ActiveCollisionTypes.KINEMATIC_FIXED para detectar la cápsula cinemática).
 *
 *  HealthPack   +45 de salud
 *  AmmoPack     munición para todas las armas
 *  GrenadePack  +1 granada de cada tipo
 *  EnergyCell   celda de energía (objetivo del nivel 1)
 *  WeaponPickup desbloquea un arma
 */
import * as THREE from 'three';
import { Entity } from './Entity.js';
import { COLLISION, WEAPONS } from '../config.js';

class Pickup extends Entity {
  constructor(game, pos, { type, prop, radius = 0.9, lifetime = Infinity, glowColor = 0x9fe8ff, glowSize = 2, scale = 1, lift = 0.8 }) {
    super(game, type);
    const R = game.physics.R;
    this.basePos = new THREE.Vector3(pos.x, pos.y + lift, pos.z);
    this.object3d = new THREE.Group();
    this.object3d.position.copy(this.basePos);
    this.model = game.assets.cloneProp(prop);
    this.model.scale.setScalar(scale);
    this.object3d.add(this.model);
    this.glow = game.fx.createGlowSprite(glowColor, glowSize);
    this.object3d.add(this.glow);
    game.level.root.add(this.object3d);
    const { body } = game.physics.createBody(
      R.RigidBodyDesc.fixed().setTranslation(this.basePos.x, this.basePos.y, this.basePos.z),
      R.ColliderDesc.ball(radius).setSensor(true).setCollisionGroups(COLLISION.pickup)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
        .setActiveCollisionTypes(R.ActiveCollisionTypes.DEFAULT | R.ActiveCollisionTypes.KINEMATIC_FIXED),
      this
    );
    this.body = body;
    this.radius = radius;
    this.phase = Math.random() * Math.PI * 2;
    this.lifetime = lifetime;
    this.age = 0;
  }

  update(dt) {
    this.age += dt;
    this.phase += dt;
    const player = this.game.player;
    // respaldo por distancia (por si el evento del sensor no llega en un teletransporte)
    if (player && !player.dead && this.game.state === 'playing' && player.currPos.distanceToSquared(this.basePos) < this.radius * this.radius * 0.8) {
      this.tryCollect(player);
      if (!this.alive) return;
    }
    this.object3d.position.y = this.basePos.y + Math.sin(this.phase * 2.2) * 0.1;
    this.model.rotation.y += dt * 1.5;
    const remaining = this.lifetime - this.age;
    if (remaining < 5) this.object3d.visible = Math.sin(remaining * 18) > -0.3;
    if (remaining <= 0) this.destroy();
  }

  onCollide(other, started) {
    if (started && this.alive && other?.type === 'player' && !other.dead) this.tryCollect(other);
  }

  tryCollect(player) {
    if (!this.alive) return;
    if (this.collect(player) !== false) this.destroy();
  }

  /** Devuelve false si no se pudo recoger (p. ej. salud llena). */
  collect() {}

  dispose() {
    if (this.body) this.game.physics.removeBody(this.body);
    this.body = null;
    super.dispose();
  }
}

export class HealthPack extends Pickup {
  constructor(game, pos, lifetime = Infinity) {
    super(game, pos, { type: 'health', prop: 'MedKit', glowColor: 0x6dffc8, glowSize: 1.6, lifetime, scale: 1.2 });
  }

  collect(player) {
    if (player.health >= player.maxHealth) return false;
    player.heal(45);
    this.game.fx.burst('heal', this.object3d.position);
    this.game.audio.play('heal', this.object3d.position);
    this.game.bus.emit('hud:toast', { text: '+45 salud', type: 'battery', icon: 'heart-pulse-fill' });
    return true;
  }
}

export class AmmoPack extends Pickup {
  constructor(game, pos, lifetime = Infinity) {
    super(game, pos, { type: 'ammo', prop: 'AmmoBox', glowColor: 0xffc86b, glowSize: 1.5, lifetime, scale: 1.15 });
  }

  collect() {
    const got = this.game.weapons.addAmmoPack(0.4);
    if (!got) return false;
    this.game.fx.burst('ammo', this.object3d.position);
    this.game.audio.play('ammo', this.object3d.position);
    this.game.bus.emit('hud:toast', { text: 'Munición recogida', type: 'warn', icon: 'box-seam' });
    return true;
  }
}

export class GrenadePack extends Pickup {
  constructor(game, pos, lifetime = Infinity) {
    super(game, pos, { type: 'grenades', prop: 'GrenadePack', glowColor: 0xc08bff, glowSize: 1.4, lifetime, scale: 1.2 });
  }

  collect() {
    const got = this.game.weapons.addGrenades(1, 1);
    if (!got) return false;
    this.game.audio.play('ammo', this.object3d.position);
    this.game.bus.emit('hud:toast', { text: '+1 granada de cada tipo', type: 'gold', icon: 'circle-fill' });
    return true;
  }
}

export class EnergyCell extends Pickup {
  constructor(game, pos) {
    super(game, pos, { type: 'cell', prop: 'EnergyCell', radius: 1.1, glowColor: 0x5ff0ff, glowSize: 2.8, scale: 1.3, lift: 0.4 });
    // columna de luz para localizarla a distancia
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.5, 30, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x5ff0ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.position.y = 15;
    this.beam = beam;
    this.object3d.add(beam);
  }

  collect() {
    const p = this.object3d.position.clone();
    this.game.fx.burst('collect', p);
    this.game.audio.play('core', p);
    this.game.bus.emit('cell:collected', { pos: p });
    return true;
  }

  dispose() {
    this.beam.geometry.dispose();
    this.beam.material.dispose();
    super.dispose();
  }
}

export class WeaponPickup extends Pickup {
  constructor(game, pos, weaponId) {
    const def = WEAPONS[weaponId];
    super(game, pos, { type: 'weaponPickup', prop: def.prop, radius: 1.2, glowColor: 0xffe08a, glowSize: 3, scale: 1.8, lift: 1.1 });
    this.weaponId = weaponId;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.04, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.9;
    this.ring = ring;
    this.object3d.add(ring);
  }

  collect() {
    const def = WEAPONS[this.weaponId];
    this.game.weapons.unlock(this.weaponId, true);
    this.game.fx.burst('gold', this.object3d.position);
    this.game.audio.play('weaponPickup', this.object3d.position);
    this.game.bus.emit('hud:banner', { title: 'Nueva arma', subtitle: `${def.name} · tecla ${def.slot}`, type: 'info' });
    this.game.bus.emit('weapon:unlocked', { id: this.weaponId });
    return true;
  }

  dispose() {
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    super.dispose();
  }
}
