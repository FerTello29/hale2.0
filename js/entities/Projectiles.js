/**
 * Projectiles — orbes de energía del jugador y rayos de los drones.
 *
 * Ambos son cuerpos dinámicos de Rapier con CCD (detección continua) para no
 * atravesar objetos a alta velocidad. El primer contacto del orbe provoca una
 * "ráfaga" (impulso radial) que empuja todo lo cercano.
 */
import * as THREE from 'three';
import { PhysicsEntity } from './Entity.js';
import { COLLISION, COMBAT } from '../config.js';

const orbGeo = new THREE.SphereGeometry(COMBAT.orbRadius, 20, 14);
const boltGeo = new THREE.SphereGeometry(0.13, 12, 8);
const orbMat = new THREE.MeshStandardMaterial({ color: 0xd8fbff, emissive: 0x5fe0ff, emissiveIntensity: 3.2, roughness: 0.2 });
const orbSpentMat = new THREE.MeshStandardMaterial({ color: 0x6e8a94, emissive: 0x16404c, emissiveIntensity: 0.6, roughness: 0.5 });
const boltMat = new THREE.MeshStandardMaterial({ color: 0xffb0a8, emissive: 0xff2a1a, emissiveIntensity: 4, roughness: 0.3 });

export class EnergyOrb extends PhysicsEntity {
  constructor(game, origin, velocity, charge = 0) {
    super(game, 'orb');
    const R = game.physics.R;
    this.object3d = new THREE.Group();
    this.core = new THREE.Mesh(orbGeo, orbMat);
    this.core.castShadow = true;
    this.object3d.add(this.core);
    this.glow = game.fx.createGlowSprite(0x7fe8ff, 1.3 + charge * 0.6);
    this.object3d.add(this.glow);
    game.level.root.add(this.object3d);

    this.attachBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setCcdEnabled(true)
        .setAngularDamping(0.8),
      R.ColliderDesc.ball(COMBAT.orbRadius)
        .setMass(COMBAT.orbMass * (1 + charge * 0.6))
        .setRestitution(0.35)
        .setFriction(0.6)
        .setCollisionGroups(COLLISION.orb)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    );
    this.charge = charge;
    this.armed = true;
    this.life = COMBAT.orbLifetime;
    this.trailTimer = 0;
  }

  onCollide(other, started) {
    if (!started || !this.armed || !this.alive) return;
    this.armed = false;
    const v = this.body.linvel();
    const dir = new THREE.Vector3(v.x, v.y, v.z);
    const speed = dir.length();
    if (speed > 0.01) dir.divideScalar(speed);
    this.game.combat.orbImpact(this, other, this.currPos.clone(), dir, speed);
    this.core.material = orbSpentMat;
    this.glow.visible = false;
    this.life = Math.min(this.life, 2.5);
  }

  update(dt) {
    this.life -= dt;
    if (this.armed) {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.016;
        this.game.fx.trail(this.object3d.position);
      }
    }
    if (this.life < 0.4) this.object3d.scale.setScalar(Math.max(0.01, this.life / 0.4));
    if (this.life <= 0 || this.currPos.y < -40) this.destroy();
  }
}

export class EnemyBolt extends PhysicsEntity {
  constructor(game, origin, velocity, damage) {
    super(game, 'bolt');
    const R = game.physics.R;
    this.damageAmount = damage;
    this.object3d = new THREE.Group();
    this.object3d.add(new THREE.Mesh(boltGeo, boltMat));
    this.object3d.add(game.fx.createGlowSprite(0xff4a3a, 1.2));
    game.level.root.add(this.object3d);
    this.attachBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setGravityScale(0)
        .setCcdEnabled(true),
      R.ColliderDesc.ball(0.13)
        .setMass(0.3)
        .setCollisionGroups(COLLISION.bolt)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    );
    this.life = 4;
  }

  onCollide(other, started) {
    if (!started || !this.alive) return;
    if (other?.type === 'player') other.damage(this.damageAmount, 'bolt');
    this.game.fx.burst('boltHit', this.currPos.clone());
    this.game.audio.play('boltHit', this.currPos);
    this.destroy();
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) this.destroy();
  }
}
