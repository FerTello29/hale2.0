/**
 * Bastión — constructo pesado de obsidiana con escudo de energía frontal.
 *
 * - El escudo reduce 85 % el daño de balas y golpes que llegan de frente:
 *   hay que flanquearlo (la espalda es su punto débil) o usar explosivos.
 * - Morteros de plasma con aviso en el suelo (trayectoria balística real).
 * - Pisotón: si el jugador se acerca, carga y lanza una onda de choque.
 * - Masa de 350 kg: las granadas lo desplazan poco, la singularidad sí.
 */
import * as THREE from 'three';
import { Enemy } from './Enemy.js';
import { Lob, EnemyBolt } from '../entities/Projectiles.js';
import { SCORE } from '../config.js';
import { heightAt } from '../world/TerrainField.js';

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export class Bastion extends Enemy {
  constructor(game, pos) {
    super(game, pos, {
      type: 'bastion',
      name: 'Bastión',
      hp: 420,
      shape: 'capsule',
      radius: 0.85,
      halfHeight: 0.55,
      mass: 350,
      sight: 40,
      score: SCORE.bastion,
      eyeHeight: 0.4,
      accel: 4,
      hitRadius: 1.1,
      weakMult: 1.6,
    });
    this.model = game.assets.cloneProp('Bastion');
    this.model.scale.setScalar(1.15);
    this.object3d.add(this.model);
    this.collectFlashMaterials(this.model);
    this.shield = this.model.getObjectByName('BastionShield');
    if (this.shield) {
      this.shield.material = this.shield.material.clone();
      this.shieldBase = this.shield.material.opacity;
    }
    this.coreNode = this.model.getObjectByName('BastionCore');
    this.cannons = [this.model.getObjectByName('CannonL'), this.model.getObjectByName('CannonR')].filter(Boolean);
    this.mortarCd = 2.5 + Math.random() * 2;
    this.boltCd = 1.5;
    this.stompT = 0;
    this.stompCd = 0;
    this.shieldFlash = 0;
    this.t = Math.random() * 5;
  }

  onAlert() {
    this.game.audio.play('bastionAlert', this.currPos);
  }

  /** Espalda = punto débil (el arma lo marca como impacto crítico). */
  isWeakPoint(point) {
    _v.subVectors(point, this.currPos).setY(0).normalize();
    return _v.dot(this.#forward(_f)) < -0.35;
  }

  #forward(out) {
    return out.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  modifyDamage(amount, info) {
    if (info.kind === 'bullet' || info.kind === 'melee') {
      const p = info.point ?? this.currPos;
      _v.subVectors(p, this.currPos).setY(0).normalize();
      if (_v.dot(this.#forward(_f)) > 0.3) {
        this.shieldFlash = 1;
        this.game.audio.play('shieldDeflect', p);
        this.game.fx.impact(p, _v, 'shield');
        return amount * 0.15;
      }
    }
    return amount;
  }

  stun(t) {
    super.stun(t * 0.4);
  }

  think(dt) {
    const player = this.player;
    this.t += dt;
    this.mortarCd -= dt;
    this.boltCd -= dt;
    this.stompCd -= dt;
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
    if (this.shield) this.shield.material.opacity = this.shieldBase + this.shieldFlash * 0.5 + Math.sin(this.t * 4) * 0.05;
    // flotación
    this.model.position.y = 0.05 + Math.sin(this.t * 1.6) * 0.08;
    this.model.rotation.z = Math.sin(this.t * 0.9) * 0.03;

    if (this.stompT > 0) {
      this.stompT -= dt;
      this.wantVel.set(0, 0, 0);
      this.model.position.y += (0.9 - this.stompT) * 0.5;
      if (this.stompT <= 0) this.#stomp();
      return;
    }

    if (!this.alerted || !player || player.dead) {
      this.wanderTimer -= dt;
      if (!this.wander || this.wanderTimer <= 0) {
        const a = Math.random() * Math.PI * 2;
        this.wander = this.home.clone().add(new THREE.Vector3(Math.cos(a) * 4, 0, Math.sin(a) * 4));
        this.wanderTimer = 5 + Math.random() * 4;
      }
      if (this.steer(this.wander, 1.2, dt) > 0.5) this.faceToward(this.wander, dt, 1.5);
      else this.wantVel.set(0, 0, 0);
      return;
    }

    const dist = this.distance;
    this.faceToward(player.currPos, dt, 1.6); // gira despacio: se puede flanquear
    if (dist < 4.6 && this.stompCd <= 0) {
      this.stompT = 0.9;
      this.stompCd = 4;
      this.game.fx.warning(this.feet.clone(), 5.5, 0.9, 0xff4fd8);
      this.game.audio.play('bastionCharge', this.currPos);
      return;
    }
    if (!this.sees || dist > 18) this.steer(this.sees ? player.currPos : this.lastSeen, 1.9, dt);
    else if (dist < 9) {
      _v.subVectors(this.currPos, player.currPos).setY(0).normalize().multiplyScalar(4).add(this.currPos);
      this.steer(_v, 1.3, dt);
    } else this.wantVel.set(0, 0, 0);

    if (this.game.state !== 'playing') return;
    if (this.stagger > 0) return;
    if (this.mortarCd <= 0 && dist < 42) {
      this.mortarCd = (3.6 + Math.random() * 1.6) / this.game.difficulty.accuracy;
      this.#mortar();
    } else if (this.sees && this.boltCd <= 0 && dist < 26) {
      this.boltCd = 2.6 + Math.random();
      this.#bolts();
    }
  }

  #mortar() {
    const { game } = this;
    const player = this.player;
    const origin = this.currPos.clone();
    origin.y += 1.4;
    const T = 1.55;
    const target = player.feetPosition.clone().addScaledVector(player.velocity, T * 0.55);
    target.x += (Math.random() - 0.5) * 2;
    target.z += (Math.random() - 0.5) * 2;
    target.y = heightAt(target.x, target.z);
    const g = game.physics.gravity;
    const vel = new THREE.Vector3((target.x - origin.x) / T, (target.y - origin.y) / T + 0.5 * g * T, (target.z - origin.z) / T);
    game.addEntity(new Lob(game, origin, vel, 'plasma', { warnAt: target }));
    game.fx.flash(origin, 0xa040ff, 8, 0.3);
    game.audio.play('mortar', origin);
  }

  #bolts() {
    const { game } = this;
    const player = this.player;
    this.object3d.updateMatrixWorld(true);
    let i = 0;
    for (const c of this.cannons) {
      const origin = c.getWorldPosition(new THREE.Vector3());
      this.game.after(i * 0.18, () => {
        if (this.dead || !player || player.dead) return;
        const dir = player.chestPosition(new THREE.Vector3()).sub(origin).normalize();
        const err = 0.05 / game.difficulty.accuracy;
        dir.x += (Math.random() - 0.5) * err;
        dir.z += (Math.random() - 0.5) * err;
        game.addEntity(new EnemyBolt(game, origin, dir.normalize().multiplyScalar(20), 10, 0xff2bd6));
        game.audio.play('enemyShot', origin);
      });
      i++;
    }
  }

  #stomp() {
    const { game } = this;
    const c = this.feet.clone();
    game.physics.radialImpulse(c, 6, 9, { upBias: 0.8 });
    game.fx.shockwave(c, 5.5, 0xff4fd8);
    game.fx.burst('dust', c);
    game.fx.flash(c, 0xff4fd8, 12, 0.3);
    game.audio.play('stomp', c);
    game.cameraRig.shakeFrom(c, 0.9);
    const player = this.player;
    if (player && !player.dead) {
      const d = player.feetPosition.distanceTo(c);
      if (d < 5.5 && player.grounded) {
        player.damage(26 * (1 - d / 7), { source: 'enemy', kind: 'stomp', from: c });
        const away = player.currPos.clone().sub(c).setY(0).normalize();
        player.knockback(away.multiplyScalar(11), 5);
      }
    }
  }

  onDeath() {
    const { game } = this;
    const p = this.currPos.clone();
    game.fx.burst('shards', p);
    game.fx.burst('smallExplosion', p);
    game.audio.play('bastionDie', p);
    if (this.shield) this.shield.visible = false;
    this.game.after(0.9, () => {
      if (!this.alive) return;
      game.damage.explode(this.currPos.clone(), { radius: 4, damage: 40, deltaV: 10, source: 'player', small: true, color: 0xff4fd8, selfFactor: 0.4 });
    });
  }
}
