/**
 * Projectiles — proyectiles con física de Rapier:
 *
 *  PlasmaOrb   orbe cargado del lanzaorbes (explota al primer contacto)
 *  Grenade     granadas de fragmentación y de singularidad (rebotan, mecha)
 *  Singularity vórtice gravitatorio que atrae cuerpos dinámicos y enemigos
 *  EnemyBolt   rayo de plasma enemigo (sin gravedad)
 *  Lob         proyectil balístico enemigo: mortero, ácido o fragmento de cristal
 *  HomingOrb   orbe teledirigido del Eco (se puede derribar a disparos)
 */
import * as THREE from 'three';
import { PhysicsEntity, Entity } from './Entity.js';
import { COLLISION, G, groups, GRENADES } from '../config.js';
import { heightAt } from '../world/TerrainField.js';

const sphereGeo = (r) => new THREE.SphereGeometry(r, 16, 12);
const GEO = { orb: sphereGeo(0.22), bolt: sphereGeo(0.12), lob: sphereGeo(0.24), homing: sphereGeo(0.35), core: sphereGeo(1) };
const MAT = {
  orb: new THREE.MeshStandardMaterial({ color: 0xd8fbff, emissive: 0x5fe0ff, emissiveIntensity: 3.4, roughness: 0.2 }),
  bolt: new THREE.MeshStandardMaterial({ color: 0xffc8f6, emissive: 0xff2bd6, emissiveIntensity: 4, roughness: 0.3 }),
  plasma: new THREE.MeshStandardMaterial({ color: 0xe5c8ff, emissive: 0xa040ff, emissiveIntensity: 3.5, roughness: 0.3 }),
  acid: new THREE.MeshStandardMaterial({ color: 0xc8ffd8, emissive: 0x2cff9a, emissiveIntensity: 3.2, roughness: 0.3 }),
  shard: new THREE.MeshStandardMaterial({ color: 0xffd0f4, emissive: 0xff38c8, emissiveIntensity: 2.4, flatShading: true }),
  homing: new THREE.MeshStandardMaterial({ color: 0xffd2f2, emissive: 0xff3ad0, emissiveIntensity: 4, roughness: 0.2 }),
  singularity: new THREE.MeshBasicMaterial({ color: 0x050008 }),
};
const DYNAMIC_QUERY = groups(0xffff, G.PROP | G.ENEMY | G.DEBRIS);

// ------------------------------------------------------------------ orbe del jugador
export class PlasmaOrb extends PhysicsEntity {
  constructor(game, origin, velocity, { charge = 0, damage = 95, radius = 4 } = {}) {
    super(game, 'orb');
    const R = game.physics.R;
    this.object3d = new THREE.Group();
    this.object3d.add(new THREE.Mesh(GEO.orb, MAT.orb));
    this.object3d.add(game.fx.createGlowSprite(0x7fe8ff, 1.6 + charge * 0.8));
    game.level.root.add(this.object3d);
    this.attachBody(
      R.RigidBodyDesc.dynamic().setTranslation(origin.x, origin.y, origin.z).setLinvel(velocity.x, velocity.y, velocity.z)
        .setCcdEnabled(true).setGravityScale(0.55),
      R.ColliderDesc.ball(0.22).setMass(2).setRestitution(0.2).setCollisionGroups(COLLISION.orb)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    );
    this.charge = charge;
    this.damage = damage * (0.75 + charge * 0.5);
    this.radius = radius * (0.8 + charge * 0.4);
    this.life = 5;
    this.trail = 0;
  }

  onCollide(other, started) {
    if (!started || !this.alive) return;
    this.detonate();
  }

  detonate() {
    if (!this.alive) return;
    const p = this.currPos.clone();
    this.destroy();
    this.game.damage.explode(p, { radius: this.radius, damage: this.damage, deltaV: 13 + this.charge * 5, source: 'player', color: 0x7fe8ff });
  }

  update(dt) {
    this.life -= dt;
    this.trail -= dt;
    if (this.trail <= 0) {
      this.trail = 0.016;
      this.game.fx.trail(this.object3d.position, 0x8ff0ff);
    }
    if (this.life <= 0 || this.currPos.y < -40) this.detonate();
  }
}

// ------------------------------------------------------------------ granadas
export class Grenade extends PhysicsEntity {
  constructor(game, origin, velocity, type = 'frag') {
    super(game, 'grenade');
    const R = game.physics.R;
    this.kind = type;
    this.def = GRENADES[type];
    this.object3d = game.assets.cloneProp(this.def.prop);
    this.object3d.scale.setScalar(1.1);
    this.light = game.fx.createGlowSprite(type === 'frag' ? 0xffb040 : 0xa060ff, 0.6);
    this.object3d.add(this.light);
    game.level.root.add(this.object3d);
    this.attachBody(
      R.RigidBodyDesc.dynamic().setTranslation(origin.x, origin.y, origin.z).setLinvel(velocity.x, velocity.y, velocity.z)
        .setAngvel({ x: 6, y: 2, z: 3 }).setCcdEnabled(true).setAngularDamping(0.6).setLinearDamping(0.1),
      R.ColliderDesc.ball(0.12).setMass(0.6).setRestitution(0.45).setFriction(0.7).setCollisionGroups(COLLISION.orb)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    );
    this.fuse = this.def.fuse;
    this.bounceCd = 0;
    this.blink = 0;
  }

  onCollide(other, started) {
    if (!started || this.bounceCd > 0) return;
    this.bounceCd = 0.12;
    this.game.audio.play('grenadeBounce', this.currPos, { gain: Math.min(1, this.speed() / 10) });
    // la singularidad se activa al primer impacto con un enemigo
    if (this.kind === 'gravity' && (other?.type === 'espectro' || other?.type === 'acechador')) this.fuse = Math.min(this.fuse, 0.05);
  }

  update(dt) {
    this.fuse -= dt;
    this.bounceCd -= dt;
    this.blink += dt * (this.fuse < 0.8 ? 18 : 7);
    this.light.material.opacity = 0.4 + 0.6 * (Math.sin(this.blink) > 0 ? 1 : 0);
    if (this.fuse <= 0) this.detonate();
  }

  detonate() {
    if (!this.alive) return;
    const p = this.currPos.clone();
    this.destroy();
    if (this.kind === 'frag') {
      this.game.damage.explode(p, { radius: this.def.radius, damage: this.def.damage, deltaV: this.def.deltaV, source: 'player' });
    } else {
      this.game.addEntity(new Singularity(this.game, p));
    }
  }
}

/** Vórtice gravitatorio: atrae cuerpos dinámicos y enemigos y luego estalla. */
export class Singularity extends Entity {
  constructor(game, pos) {
    super(game, 'singularity');
    this.def = GRENADES.gravity;
    this.center = pos.clone();
    this.center.y = Math.max(this.center.y, heightAt(pos.x, pos.z) + 1.4);
    this.t = 0;
    this.object3d = new THREE.Group();
    this.object3d.position.copy(this.center);
    this.core = new THREE.Mesh(GEO.core, MAT.singularity);
    this.core.scale.setScalar(0.1);
    this.object3d.add(this.core);
    this.halo = game.fx.createGlowSprite(0x9a4dff, 4);
    this.object3d.add(this.halo);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xb070ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.05, 8, 48), ringMat);
    this.ring.rotation.x = Math.PI / 2;
    this.object3d.add(this.ring);
    game.level.root.add(this.object3d);
    game.fx.flash(this.center, 0x9a4dff, 16, 0.5);
    game.audio.play('singularity', this.center);
    game.bus.emit('noise', { pos: this.center, radius: 30 });
    this.tickDamage = 0;
  }

  fixedUpdate(h) {
    const { game } = this;
    const r = this.def.radius;
    for (const c of game.physics.overlapSphere(this.center, r, { groups: DYNAMIC_QUERY })) {
      const body = c.parent();
      if (!body || !body.isDynamic()) continue;
      const p = body.translation();
      const dx = this.center.x - p.x;
      const dy = this.center.y - p.y;
      const dz = this.center.z - p.z;
      const dist = Math.max(0.4, Math.hypot(dx, dy, dz));
      const k = (1 - Math.min(1, dist / r)) * 0.8 + 0.2;
      const m = Math.min(body.mass(), 120);
      const j = this.def.pull * k * m * h;
      body.applyImpulse({ x: (dx / dist) * j, y: (dy / dist) * j + 9.81 * m * h * 0.9, z: (dz / dist) * j }, true);
      // amortiguar para que orbiten cerca del núcleo
      const v = body.linvel();
      body.setLinvel({ x: v.x * 0.985, y: v.y * 0.985, z: v.z * 0.985 }, true);
      const owner = game.physics.ownerOf(c);
      if (owner?.stun) owner.stun(0.3);
    }
    for (const d of game.drones) {
      if (d.isActive && d.currPos.distanceTo(this.center) < r * 0.8) d.takeDamage(40 * h, { kind: 'gravity', source: 'player', point: this.center });
    }
  }

  update(dt) {
    this.t += dt;
    const grow = Math.min(1, this.t * 3);
    this.core.scale.setScalar(0.3 + grow * 0.5 + Math.sin(this.t * 30) * 0.05);
    this.ring.scale.setScalar(1 + Math.sin(this.t * 6) * 0.15 + grow * 1.5);
    this.ring.rotation.z += dt * 4;
    this.halo.scale.setScalar(4 + Math.sin(this.t * 12) * 0.6);
    this.game.fx.vortex(this.center, this.def.radius * 0.8);
    if (this.t >= this.def.duration) {
      this.destroy();
      this.game.damage.explode(this.center, {
        radius: this.def.radius * 0.6, damage: this.def.damage, deltaV: 20, source: 'player', color: 0xb070ff,
      });
    }
  }

  dispose() {
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    super.dispose();
  }
}

// ------------------------------------------------------------------ proyectiles enemigos
export class EnemyBolt extends PhysicsEntity {
  constructor(game, origin, velocity, damage, color = 0xff2bd6) {
    super(game, 'bolt');
    const R = game.physics.R;
    this.damageAmount = damage;
    this.object3d = new THREE.Group();
    const m = new THREE.Mesh(GEO.bolt, MAT.bolt);
    m.scale.set(1, 1, 2.6);
    this.object3d.add(m);
    this.object3d.add(game.fx.createGlowSprite(color, 1.3));
    game.level.root.add(this.object3d);
    this.attachBody(
      R.RigidBodyDesc.dynamic().setTranslation(origin.x, origin.y, origin.z).setLinvel(velocity.x, velocity.y, velocity.z)
        .setGravityScale(0).setCcdEnabled(true),
      R.ColliderDesc.ball(0.13).setMass(0.2).setCollisionGroups(COLLISION.bolt).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    );
    this.dir = velocity.clone().normalize();
    this.life = 4;
    this.origin = origin.clone();
  }

  onCollide(other, started) {
    if (!started || !this.alive) return;
    if (other?.type === 'player') other.damage(this.damageAmount, { source: 'enemy', kind: 'bolt', from: this.origin });
    this.game.fx.burst('boltHit', this.currPos.clone());
    this.game.audio.play('boltHit', this.currPos);
    this.destroy();
  }

  syncVisual(alpha) {
    super.syncVisual(alpha);
    if (this.dir) this.object3d.lookAt(this.object3d.position.clone().add(this.dir));
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) this.destroy();
  }
}

const LOB_STYLE = {
  plasma: { mat: 'plasma', glow: 0xa040ff, radius: 4, damage: 28, fx: 'smallExplosion', color: 0xa060ff },
  acid: { mat: 'acid', glow: 0x2cff9a, radius: 3.2, damage: 18, fx: 'acid', color: 0x2cff9a },
  shard: { mat: 'shard', glow: 0xff38c8, radius: 3.4, damage: 22, fx: 'shards', color: 0xff38c8 },
};

/** Proyectil balístico enemigo con aviso en el suelo. */
export class Lob extends PhysicsEntity {
  constructor(game, origin, velocity, style = 'plasma', { damageMult = 1, warnAt = null } = {}) {
    super(game, 'lob');
    const R = game.physics.R;
    this.style = LOB_STYLE[style];
    this.styleName = style;
    this.object3d = new THREE.Group();
    const mesh = new THREE.Mesh(style === 'shard' ? new THREE.OctahedronGeometry(0.35, 0) : GEO.lob, MAT[this.style.mat]);
    if (style === 'shard') mesh.scale.set(0.7, 1.8, 0.7);
    this.mesh = mesh;
    this.object3d.add(mesh);
    this.object3d.add(game.fx.createGlowSprite(this.style.glow, 1.6));
    game.level.root.add(this.object3d);
    this.attachBody(
      R.RigidBodyDesc.dynamic().setTranslation(origin.x, origin.y, origin.z).setLinvel(velocity.x, velocity.y, velocity.z).setCcdEnabled(true),
      R.ColliderDesc.ball(0.24).setMass(1).setCollisionGroups(COLLISION.bolt).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    );
    this.damageMult = damageMult;
    this.life = 7;
    if (warnAt) game.fx.warning(warnAt, this.style.radius * 0.8, 1.4, this.style.color);
  }

  onCollide(other, started) {
    if (!started || !this.alive) return;
    this.detonate();
  }

  detonate() {
    if (!this.alive) return;
    const p = this.currPos.clone();
    this.destroy();
    this.game.damage.explode(p, {
      radius: this.style.radius, damage: this.style.damage * this.damageMult * 2.2, deltaV: 8, source: 'enemy', small: true, color: this.style.color, noFx: true,
    });
    this.game.fx.burst(this.style.fx, p);
    this.game.fx.shockwave(p, this.style.radius, this.style.color);
    this.game.fx.flash(p, this.style.color, 10, 0.3);
    this.game.audio.play(this.styleName === 'acid' ? 'acid' : 'smallExplosion', p);
  }

  update(dt) {
    this.life -= dt;
    this.mesh.rotation.x += dt * 5;
    if (this.life <= 0 || this.currPos.y < -40) this.detonate();
  }
}

/** Orbe teledirigido: persigue al jugador, se puede derribar a disparos. */
export class HomingOrb extends PhysicsEntity {
  constructor(game, origin, damage = 20) {
    super(game, 'homing');
    const R = game.physics.R;
    this.faction = 'enemy';
    this.object3d = new THREE.Group();
    this.object3d.add(new THREE.Mesh(GEO.homing, MAT.homing));
    this.object3d.add(game.fx.createGlowSprite(0xff3ad0, 2.4));
    game.level.root.add(this.object3d);
    this.pos = origin.clone();
    this.vel = new THREE.Vector3(0, 4, 0);
    this.attachBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(origin.x, origin.y, origin.z),
      R.ColliderDesc.ball(0.4).setCollisionGroups(groups(G.DRONE, G.ORB)).setSensor(false)
    );
    this.damageAmount = damage;
    this.life = 9;
    this.hp = 1;
    this.hitRadius = 0.4;
    game.damageables.add(this);
  }

  fixedUpdate(h) {
    const player = this.game.player;
    if (!player) return;
    const target = player.chestPosition(new THREE.Vector3());
    const desired = target.sub(this.pos).normalize().multiplyScalar(7.5);
    this.vel.lerp(desired, Math.min(1, h * 1.6));
    this.pos.addScaledVector(this.vel, h);
    this.body.setNextKinematicTranslation(this.pos);
  }

  takeDamage(amount, info) {
    if (!this.alive) return 0;
    this.pop(false);
    return amount;
  }

  pop(hitPlayer) {
    if (!this.alive) return;
    const p = this.pos.clone();
    this.destroy();
    this.game.damageables.delete(this);
    if (hitPlayer) this.game.player.damage(this.damageAmount, { source: 'enemy', kind: 'homing', from: p });
    this.game.fx.burst('shards', p);
    this.game.fx.flash(p, 0xff3ad0, 8, 0.25);
    this.game.audio.play('boltHit', p);
  }

  update(dt) {
    this.life -= dt;
    const player = this.game.player;
    if (player && !player.dead && this.pos.distanceTo(player.chestPosition(new THREE.Vector3())) < 1.0) this.pop(true);
    else if (this.life <= 0 || this.pos.y < heightAt(this.pos.x, this.pos.z) + 0.2) this.pop(false);
  }

  dispose() {
    this.game.damageables.delete(this);
    super.dispose();
  }
}
