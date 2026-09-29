/**
 * JEFE FINAL — El Eco.
 *
 * Inteligencia cristalina que flota sobre el santuario (cuerpo cinemático de
 * Rapier). Tres fases:
 *
 *  1. ANCLAS: un escudo lo hace invulnerable mientras cuatro anclas de cristal
 *     le transmiten energía. Lanza orbes teledirigidos (se pueden derribar),
 *     lluvia de cristales con aviso y abre portales de criaturas.
 *  2. NÚCLEO: sin escudo baja a media altura. Añade el rayo fijador (se
 *     bloquea poniéndose a cubierto tras un pilar) y el anillo de choque que
 *     recorre la plataforma (hay que SALTARLO).
 *  3. FURIA (<35 %): todo más rápido, anillos dobles, cielo teñido.
 *
 * Punto débil: el ojo (daño ×2).
 */
import * as THREE from 'three';
import { PhysicsEntity } from '../entities/Entity.js';
import { CrystalNode } from '../entities/Interactables.js';
import { HomingOrb, Lob } from '../entities/Projectiles.js';
import { Debris } from '../entities/Props.js';
import { G, groups, SCORE, COLLISION } from '../config.js';
import { heightAt, isVoid } from '../world/TerrainField.js';

const _v = new THREE.Vector3();
const _eye = new THREE.Vector3();

export class Eco extends PhysicsEntity {
  /**
   * @param {THREE.Vector3} center centro de la plataforma (a nivel del suelo)
   * @param {object} opts { anchors: Vector3[], portals: Vector3[], arenaRadius, onDefeated }
   */
  constructor(game, center, opts = {}) {
    super(game, 'eco');
    const R = game.physics.R;
    this.opts = opts;
    this.faction = 'enemy';
    this.isBoss = true;
    this.cfg = { name: 'El Eco', score: SCORE.boss };
    this.title = 'La mente del cristal';
    this.maxHp = 3400 * game.difficulty.bossHp;
    this.hp = this.maxHp;
    this.hitRadius = 2.6;
    this.arena = center.clone();
    this.arenaRadius = opts.arenaRadius ?? 32;
    this.hover = 10;
    this.pos = center.clone().setY(center.y + this.hover);

    this.object3d = new THREE.Group();
    this.model = game.assets.cloneProp('EcoCore', { cloneMaterials: true });
    this.object3d.add(this.model);
    this.eye = this.model.getObjectByName('EcoEye');
    this.inner = this.model.getObjectByName('EcoInner');
    this.shell = this.model.getObjectByName('EcoShell');
    this.shards = this.model.getObjectByName('EcoShards');
    this.halo = game.fx.createGlowSprite(0xff2bd6, 14);
    this.object3d.add(this.halo);
    this.eyeGlow = game.fx.createGlowSprite(0xff5ae0, 3);
    this.eye?.add(this.eyeGlow);
    this.flashMats = [];
    this.model.traverse((o) => {
      if (o.isMesh && o.material?.emissive) this.flashMats.push({ m: o.material, base: o.material.emissive.clone(), k: o.material.emissiveIntensity });
    });
    // escudo
    this.shieldMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(4.2, 3),
      new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    this.object3d.add(this.shieldMesh);
    game.level.root.add(this.object3d);

    this.attachBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y, this.pos.z),
      R.ColliderDesc.ball(2.5).setCollisionGroups(groups(G.BOSS, G.PLAYER | G.ORB | G.PROP))
    );
    this.interpolate = true;

    // anclas
    this.anchors = [];
    this.beams = [];
    (opts.anchors || []).forEach((p, i) => {
      const a = new CrystalNode(game, p, {
        hp: 320 * game.difficulty.enemyHp,
        scale: 2.1,
        name: `Ancla ${i + 1}`,
        onDestroyed: () => this.#anchorDestroyed(),
      });
      game.addEntity(a);
      this.anchors.push(a);
      this.beams.push(game.fx.createBeam(0xff4fd8, 0.3));
    });

    // efectos de ataque
    this.rings = [];
    this.laserAim = game.fx.createBeam(0xff3a2a, 0.035);
    this.laserAim.visible = false;
    this.laserFire = game.fx.createBeam(0xff5ae0, 0.45);
    this.laserFire.visible = false;
    this.laser = null;

    this.phase = 1;
    this.t = 0;
    this.flash = 0;
    this.shieldFlash = 0;
    this.dead = false;
    this.deathT = 0;
    this.timers = { homing: 4, rain: 7, summon: 10, ring: 6, laser: 3 };
    this.active = opts.active ?? true;
    this.alerted = true;
    game.damageables.add(this);
    game.enemies.add(this);
    game.boss = this;
    game.bus.emit('boss:show', { name: this.cfg.name, title: this.title, color: '#ff5ae0' });
    game.bus.emit('boss:nodes', { total: this.anchors.length, left: this.anchors.length });
    if (!this.anchors.length) this.breakShield(true);
  }

  get shielded() {
    return this.phase === 1;
  }

  get anchorsLeft() {
    return this.anchors.filter((a) => !a.dead).length;
  }

  get player() {
    return this.game.player;
  }

  alert() {}
  hear() {}
  stun() {}

  damagePoint(out = new THREE.Vector3()) {
    return out.copy(this.currPos);
  }

  isWeakPoint(point) {
    if (!this.eye) return false;
    this.eye.getWorldPosition(_eye);
    return point.distanceTo(_eye) < 1.2;
  }

  #anchorDestroyed() {
    const { game } = this;
    const left = this.anchorsLeft;
    game.bus.emit('boss:nodes', { total: this.anchors.length, left });
    game.bus.emit('anchor:destroyed', { left });
    if (left > 0) return;
    this.breakShield();
  }

  /** Fase 2: escudo roto (también al reanudar desde el punto de control). */
  breakShield(silent = false) {
    const { game } = this;
    this.phase = 2;
    this.shieldMesh.visible = false;
    this.hover = 6.5;
    this.timers.laser = 2;
    this.timers.ring = 5;
    if (silent) return;
    game.fx.burst('crystalBlast', this.currPos.clone());
    game.fx.flash(this.currPos, 0xff4fd8, 40, 1);
    game.audio.play('shieldBreak', this.currPos, { pitch: 0.6 });
    game.audio.play('ecoScream', this.currPos);
    game.cameraRig.shake(1.2);
    game.bus.emit('eco:phase', { phase: 2 });
  }

  takeDamage(amount, info = {}) {
    if (this.dead) return 0;
    if (this.phase === 1) {
      this.shieldFlash = 1;
      if (info.point) this.game.fx.impact(info.point, _v.subVectors(info.point, this.currPos).normalize(), 'shield');
      this.game.audio.play('shieldDeflect', info.point ?? this.currPos);
      return 0;
    }
    let real = info.weak ? amount * 2 : amount;
    if (info.kind === 'gravity') real *= 0.5;
    this.hp -= real;
    this.flash = 1;
    if (info.source === 'player') this.game.damage.number(info.point ?? this.currPos, real, { weak: info.weak });
    if (this.phase === 2 && this.hp < this.maxHp * 0.35) {
      this.phase = 3;
      this.game.audio.play('ecoScream', this.currPos, { pitch: 0.8 });
      this.game.bus.emit('eco:phase', { phase: 3 });
      this.game.bus.emit('hud:banner', { title: 'EL ECO ENLOQUECE', subtitle: 'Resiste: está a punto de romperse', type: 'danger' });
    }
    if (this.hp <= 0) this.die(info);
    return real;
  }

  die(info = {}) {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    const { game } = this;
    game.damageables.delete(this);
    game.enemies.delete(this);
    game.boss = null;
    game.bus.emit('boss:hide');
    game.bus.emit('enemy:killed', { enemy: this, type: 'eco', name: 'El Eco', score: this.cfg.score, boss: true, headshot: !!info.weak, pos: this.currPos.clone(), source: info.source });
    game.audio.play('ecoScream', this.currPos, { pitch: 0.5 });
    this.laserAim.visible = false;
    this.laserFire.visible = false;
    this.laser = null;
  }

  // ------------------------------------------------------------ movimiento
  fixedUpdate(h) {
    if (!this.body) return;
    this.t += h;
    const target = this.arena.clone();
    target.y += this.hover + Math.sin(this.t * 0.9) * 0.6;
    if (this.dead) target.y = this.pos.y + Math.sin(this.t * 40) * 0.05;
    // deriva lenta alrededor del centro
    const drift = this.phase === 1 ? 2 : 5;
    target.x += Math.sin(this.t * 0.23) * drift;
    target.z += Math.cos(this.t * 0.19) * drift;
    this.pos.lerp(target, Math.min(1, h * 0.8));
    this.body.setNextKinematicTranslation(this.pos);
  }

  update(dt) {
    const { game } = this;
    const player = this.player;
    // animación del cristal
    const speed = this.phase === 3 ? 2.2 : 1;
    if (this.shards) this.shards.rotation.y += dt * 0.5 * speed;
    if (this.shell) {
      this.shell.rotation.x += dt * 0.2 * speed;
      this.shell.rotation.y += dt * 0.3 * speed;
    }
    if (this.inner) this.inner.rotation.y -= dt * 0.9 * speed;
    this.halo.material.opacity = 0.35 + Math.sin(game.time * 2) * 0.1 + (this.phase === 3 ? 0.2 : 0);
    if (player && !this.dead) {
      // el ojo mira al jugador
      const look = player.chestPosition(_v);
      const m = new THREE.Matrix4().lookAt(look, this.object3d.position, THREE.Object3D.DEFAULT_UP);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      this.model.quaternion.slerp(q, Math.min(1, dt * 3));
    }
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
    if (this.shieldMesh.visible) {
      this.shieldMesh.rotation.y += dt * 0.3;
      this.shieldMesh.material.opacity = 0.12 + this.shieldFlash * 0.3 + Math.sin(game.time * 2.5) * 0.03;
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
      for (const f of this.flashMats) f.m.emissiveIntensity = f.k + this.flash * 2.5;
    }
    // rayos de las anclas
    this.anchors.forEach((a, i) => {
      const b = this.beams[i];
      b.visible = !a.dead && !this.dead;
      if (b.visible) b.set(a.center, this.object3d.position);
    });
    this.#updateRings(dt);
    this.#updateLaser(dt);

    if (this.dead) {
      this.#dying(dt);
      return;
    }
    if (!this.active || game.state !== 'playing' || !player || player.dead) return;

    // ataques
    const rate = this.phase === 3 ? 1.45 : 1;
    for (const k of Object.keys(this.timers)) this.timers[k] -= dt * rate;
    if (this.timers.homing <= 0) {
      this.timers.homing = this.phase === 1 ? 7.5 : 6;
      this.#homing(this.phase === 1 ? 2 : this.phase === 2 ? 3 : 4);
    }
    if (this.timers.rain <= 0) {
      this.timers.rain = this.phase === 1 ? 9 : 8;
      this.#rain(this.phase === 1 ? 6 : 9);
    }
    if (this.timers.summon <= 0) {
      this.timers.summon = this.phase === 1 ? 20 : 26;
      if (game.director.alive < 6) this.#summon();
    }
    if (this.phase >= 2) {
      if (this.timers.ring <= 0) {
        this.timers.ring = this.phase === 3 ? 8 : 11;
        this.#ring();
        if (this.phase === 3) setTimeout(() => !this.dead && this.#ring(), 1400);
      }
      if (this.timers.laser <= 0 && !this.laser) {
        this.timers.laser = this.phase === 3 ? 4.5 : 6;
        this.#startLaser();
      }
    }
  }

  // ------------------------------------------------------------ ataques
  #eyePos(out = _eye) {
    if (this.eye) return this.eye.getWorldPosition(out);
    return out.copy(this.object3d.position);
  }

  #homing(n) {
    const { game } = this;
    const origin = this.#eyePos(new THREE.Vector3());
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        if (this.dead || game.state !== 'playing') return;
        const o = origin.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3));
        const orb = new HomingOrb(game, o, 18);
        orb.vel.set((Math.random() - 0.5) * 8, 3 + Math.random() * 3, (Math.random() - 0.5) * 8);
        game.addEntity(orb);
        game.audio.play('homingLaunch', o);
      }, i * 260);
    }
  }

  #rain(n) {
    const { game } = this;
    const player = this.player;
    for (let i = 0; i < n; i++) {
      let x;
      let z;
      let ok = false;
      for (let k = 0; k < 8 && !ok; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = i === 0 ? 0 : 1.5 + Math.random() * 9;
        x = player.currPos.x + Math.cos(a) * r;
        z = player.currPos.z + Math.sin(a) * r;
        ok = !isVoid(x, z);
      }
      if (!ok) continue;
      const y = heightAt(x, z);
      const target = new THREE.Vector3(x, y, z);
      setTimeout(() => {
        if (this.dead || game.state !== 'playing') return;
        const origin = target.clone().setY(y + 16);
        game.addEntity(new Lob(game, origin, new THREE.Vector3(0, -8, 0), 'shard', { warnAt: target, damageMult: 1 }));
      }, 150 + i * 120);
    }
    game.audio.play('crystalRain', player.currPos);
  }

  #summon() {
    const { game } = this;
    const portals = this.opts.portals || [];
    if (!portals.length) return;
    const p = portals[Math.floor(Math.random() * portals.length)];
    const list = this.phase === 1 ? [['espectro', 2], ['acechador', 2]] : this.phase === 2 ? [['espectro', 1], ['elite', 1], ['acechador', 2]] : [['acechador', 4], ['elite', 1]];
    game.director.wave(list, p, 5, { interval: 0.5, minPlayerDist: 6 });
    game.bus.emit('hud:toast', { text: 'El Eco abre un portal', type: 'danger', icon: 'hurricane' });
  }

  #ring() {
    const { game } = this;
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.06, 6, 96),
      new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    mesh.rotation.x = Math.PI / 2;
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 0.9, 96, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    const g = new THREE.Group();
    g.add(mesh, wall);
    wall.position.y = 0.45;
    mesh.position.y = 0.9;
    g.position.copy(this.arena).setY(this.arena.y + 0.05);
    game.level.root.add(g);
    this.rings.push({ g, mesh, wall, r: 3, hit: false });
    game.audio.play('ringWave', this.arena);
    game.bus.emit('boss:telegraph', { text: '¡SALTA EL ANILLO!' });
  }

  #updateRings(dt) {
    const player = this.player;
    for (const ring of this.rings) {
      ring.r += dt * 10.5;
      ring.g.scale.set(ring.r, 1, ring.r);
      ring.mesh.material.opacity = Math.max(0, 0.95 - ring.r / 40);
      ring.wall.material.opacity = Math.max(0, 0.35 - ring.r / 110);
      if (!ring.hit && player && !player.dead && this.game.state === 'playing') {
        const d = Math.hypot(player.currPos.x - this.arena.x, player.currPos.z - this.arena.z);
        const feet = player.feetPosition.y - heightAt(player.currPos.x, player.currPos.z);
        if (Math.abs(d - ring.r) < 0.8 && feet < 0.75) {
          ring.hit = true;
          player.damage(26, { source: 'enemy', kind: 'ring', from: this.arena });
          player.knockback(_v.set(player.currPos.x - this.arena.x, 0, player.currPos.z - this.arena.z).normalize().multiplyScalar(9), 4);
          this.game.audio.play('damage', player.currPos);
        }
      }
    }
    this.rings = this.rings.filter((ring) => {
      if (ring.r > this.arenaRadius + 6) {
        ring.g.parent?.remove(ring.g);
        ring.mesh.geometry.dispose();
        ring.mesh.material.dispose();
        ring.wall.geometry.dispose();
        ring.wall.material.dispose();
        return false;
      }
      return true;
    });
  }

  #startLaser() {
    this.laser = { t: 0, dir: new THREE.Vector3(), fired: false };
    this.game.audio.play('laserCharge', this.currPos);
  }

  #updateLaser(dt) {
    const L = this.laser;
    if (!L) return;
    const { game } = this;
    const player = this.player;
    L.t += dt;
    const origin = this.#eyePos(new THREE.Vector3());
    const lockTime = this.phase === 3 ? 0.9 : 1.2;
    if (L.t < lockTime) {
      // fase de fijación: sigue al jugador
      if (player) L.dir.copy(player.chestPosition(_v)).sub(origin).normalize();
      const hit = game.physics.raycast(origin, L.dir, 120, { groups: COLLISION.cameraQuery });
      const end = hit ? hit.point : origin.clone().addScaledVector(L.dir, 120);
      this.laserAim.visible = true;
      this.laserAim.set(origin, end);
      this.laserAim.setOpacity(0.4 + 0.6 * Math.abs(Math.sin(L.t * 20)));
    } else if (!L.fired) {
      L.fired = true;
      this.laserAim.visible = false;
      const hit = game.physics.raycast(origin, L.dir, 120, { groups: COLLISION.cameraQuery });
      const maxD = hit ? hit.distance : 120;
      L.end = hit ? hit.point : origin.clone().addScaledVector(L.dir, 120);
      this.laserFire.visible = true;
      this.laserFire.set(origin, L.end);
      game.audio.play('laserFire', origin);
      game.fx.flash(L.end, 0xff4fd8, 18, 0.4);
      game.fx.burst('sparks', L.end);
      // ¿el jugador está en la línea de fuego (y no detrás de una cobertura)?
      if (player && !player.dead) {
        const chest = player.chestPosition(new THREE.Vector3());
        const rel = chest.clone().sub(origin);
        const along = rel.dot(L.dir);
        const perp = rel.addScaledVector(L.dir, -along).length();
        if (along > 0 && along < maxD + 0.5 && perp < 1.1) {
          player.damage(30, { source: 'enemy', kind: 'laser', from: origin });
          game.cameraRig.shake(0.5);
        }
      }
    } else if (L.t < lockTime + 0.4) {
      this.laserFire.setOpacity(1 - (L.t - lockTime) / 0.4);
    } else {
      this.laserFire.visible = false;
      this.laser = null;
    }
  }

  #dying(dt) {
    const { game } = this;
    this.deathT += dt;
    const k = Math.min(1, this.deathT / 3.2);
    this.model.scale.setScalar(1 - k * 0.55 + Math.sin(this.deathT * 30) * 0.05 * k);
    this.halo.scale.setScalar(14 + k * 20);
    if (Math.random() < dt * 14) {
      const p = this.object3d.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6));
      game.fx.burst('shards', p);
      game.fx.flash(p, 0xff4fd8, 10, 0.2);
    }
    game.cameraRig.shake(dt * 1.5);
    if (this.deathT > 3.2 && this.alive) {
      const p = this.object3d.position.clone();
      for (let i = 0; i < 18; i++) {
        const d = new Debris(game, p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4)), 'crystal', 4);
        d.push(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize(), 10);
        game.addEntity(d);
      }
      game.fx.burst('explosion', p);
      game.fx.burst('crystalBlast', p);
      game.fx.shockwave(this.arena.clone(), 30, 0xff4fd8);
      game.fx.flash(p, 0xffffff, 60, 1.4);
      game.audio.play('explosion', p);
      game.cameraRig.shake(1.5);
      this.destroy();
      this.opts.onDefeated?.(this);
      game.bus.emit('boss:defeated', { type: 'eco' });
    }
  }

  dispose() {
    this.game.damageables.delete(this);
    this.game.enemies.delete(this);
    for (const b of this.beams) b.dispose();
    this.laserAim.dispose();
    this.laserFire.dispose();
    for (const ring of this.rings) {
      ring.g.parent?.remove(ring.g);
      ring.mesh.geometry.dispose();
      ring.wall.geometry.dispose();
    }
    this.shieldMesh.geometry.dispose();
    super.dispose();
  }
}
