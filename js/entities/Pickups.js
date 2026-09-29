/**
 * Pickups — objetos coleccionables detectados con sensores de Rapier.
 *
 * Cada pickup es un cuerpo fijo con un collider sensor. Rapier genera un evento
 * de colisión cuando la cápsula (cinemática) del jugador entra al sensor, por
 * eso se activa ActiveCollisionTypes.KINEMATIC_FIXED.
 */
import * as THREE from 'three';
import { Entity } from './Entity.js';
import { COLLISION } from '../config.js';

class Pickup extends Entity {
  constructor(game, pos, { type, prop, radius = 0.9, lifetime = Infinity, glowColor = 0x9fe8ff, glowSize = 2.2, cloneMaterials = false }) {
    super(game, type);
    const R = game.physics.R;
    this.basePos = new THREE.Vector3(pos.x, pos.y + 1.0, pos.z);
    this.object3d = new THREE.Group();
    this.object3d.position.copy(this.basePos);
    this.model = game.assets.cloneProp(prop, { cloneMaterials });
    this.object3d.add(this.model);
    this.glow = game.fx.createGlowSprite(glowColor, glowSize);
    this.object3d.add(this.glow);
    game.level.root.add(this.object3d);

    const { body, colliders } = game.physics.createBody(
      R.RigidBodyDesc.fixed().setTranslation(this.basePos.x, this.basePos.y, this.basePos.z),
      R.ColliderDesc.ball(radius)
        .setSensor(true)
        .setCollisionGroups(COLLISION.pickup)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
        .setActiveCollisionTypes(R.ActiveCollisionTypes.DEFAULT | R.ActiveCollisionTypes.KINEMATIC_FIXED),
      this
    );
    this.body = body;
    this.colliders = colliders;
    this.phase = Math.random() * Math.PI * 2;
    this.lifetime = lifetime;
    this.age = 0;
  }

  update(dt) {
    this.age += dt;
    this.phase += dt;
    this.object3d.position.y = this.basePos.y + Math.sin(this.phase * 2.2) * 0.12;
    this.model.rotation.y += dt * 1.6;
    const remaining = this.lifetime - this.age;
    if (remaining < 5) this.object3d.visible = Math.sin(remaining * 18) > -0.3;
    if (remaining <= 0) this.destroy();
  }

  onCollide(other, started) {
    if (started && this.alive && other?.type === 'player' && !other.dead) {
      this.collect(other);
    }
  }

  collect() {}

  dispose() {
    if (this.body) this.game.physics.removeBody(this.body);
    this.body = null;
    super.dispose();
  }
}

export class SilverCore extends Pickup {
  constructor(game, pos) {
    super(game, pos, { type: 'core', prop: 'SilverCore', radius: 1.0, glowColor: 0x9fe8ff, glowSize: 2.6 });
  }

  collect(player) {
    this.destroy();
    const p = this.object3d.position.clone();
    this.game.fx.burst('collect', p);
    this.game.audio.play('core', p);
    player.energy = Math.min(player.maxEnergy, player.energy + 15);
    this.game.mission.collectCore(p);
  }
}

export class GoldCore extends Pickup {
  constructor(game, pos, lifetime = 25) {
    super(game, pos, { type: 'goldcore', prop: 'SilverCore', radius: 1.0, lifetime, glowColor: 0xffd36b, glowSize: 3, cloneMaterials: true });
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.material.color.set(0xffd36b);
        o.material.emissive?.set(0xff9a2a);
      }
    });
    this.model.scale.setScalar(1.15);
  }

  collect() {
    this.destroy();
    const p = this.object3d.position.clone();
    this.game.fx.burst('gold', p);
    this.game.audio.play('gold', p);
    this.game.mission.collectGoldCore(p);
  }
}

export class BatteryPickup extends Pickup {
  constructor(game, pos, lifetime = Infinity) {
    super(game, pos, { type: 'battery', prop: 'Battery', radius: 0.9, lifetime, glowColor: 0x6dffa8, glowSize: 1.8 });
    this.model.scale.setScalar(1.3);
  }

  collect(player) {
    this.destroy();
    const p = this.object3d.position.clone();
    this.game.fx.burst('battery', p);
    this.game.audio.play('battery', p);
    const overflow = player.heal(25);
    this.game.mission.batteryCollected(p, overflow);
  }
}
