/**
 * Acechador — criatura de cristal de seis patas. Rápida y frágil: corre en
 * zigzag hacia el jugador, salta sobre él con un impulso físico real y lo
 * muerde. Al morir se hace añicos en fragmentos de cristal con física.
 *
 * Las patas se animan por procedimiento (marcha trípode) a partir de la
 * velocidad real del cuerpo de Rapier.
 */
import * as THREE from 'three';
import { Enemy } from './Enemy.js';
import { Debris } from '../entities/Props.js';
import { SCORE } from '../config.js';

const _v = new THREE.Vector3();
const _head = new THREE.Vector3();

/** Prepara las referencias de patas de un modelo Crawler/Matriarch. */
export function rigLegs(model) {
  const legs = [];
  for (let i = 0; i < 6; i++) {
    const leg = model.getObjectByName(`Leg${i}`);
    const hip = model.getObjectByName(`Hip${i}`);
    const knee = model.getObjectByName(`Knee${i}`);
    if (!leg || !hip || !knee) continue;
    legs.push({ leg, hip, knee, baseY: leg.rotation.y, baseHip: hip.rotation.z, baseKnee: knee.rotation.z, side: i < 3 ? -1 : 1, group: i % 2 });
  }
  return { legs, body: model.getObjectByName('Body'), bodyY: model.getObjectByName('Body')?.position.y ?? 0 };
}

/** Marcha trípode: dos grupos de tres patas alternados. */
export function animateLegs(rig, phase, amount, crouch = 0) {
  for (const l of rig.legs) {
    const p = phase + (l.group ? Math.PI : 0);
    const s = Math.sin(p);
    const lift = Math.max(0, Math.cos(p));
    l.leg.rotation.y = l.baseY + s * 0.38 * amount * -l.side;
    l.hip.rotation.z = l.baseHip + lift * 0.45 * amount - crouch * 0.25;
    l.knee.rotation.z = l.baseKnee - lift * 0.25 * amount + crouch * 0.35;
  }
  if (rig.body) rig.body.position.y = rig.bodyY + Math.abs(Math.sin(phase)) * 0.05 * amount - crouch * 0.12;
}

export class Acechador extends Enemy {
  constructor(game, pos, { scale = 1.15 } = {}) {
    super(game, pos, {
      type: 'acechador',
      name: 'Acechador',
      hp: 45,
      shape: 'ball',
      radius: 0.42,
      mass: 45,
      sight: 30,
      score: SCORE.acechador,
      eyeHeight: 0.15,
      accel: 12,
      hitRadius: 0.65,
      weakMult: 1.5,
    });
    this.model = game.assets.cloneProp('Crawler');
    this.model.scale.setScalar(scale);
    this.model.position.y = -this.centerOffset;
    this.object3d.add(this.model);
    this.collectFlashMaterials(this.model);
    this.rig = rigLegs(this.model);
    this.headNode = this.model.getObjectByName('Head');
    this.phase = Math.random() * 6;
    this.leapCd = 1.5 + Math.random() * 2;
    this.leapT = 0;
    this.biteCd = 0;
    this.zig = Math.random() * 10;
    this.crouch = 0;
    this.speedMul = 0.9 + Math.random() * 0.25;
  }

  isHeadshot(point) {
    if (!this.headNode) return false;
    this.headNode.getWorldPosition(_head);
    return point.distanceTo(_head) < 0.32;
  }

  onAlert() {
    this.game.audio.play('crawlerAlert', this.currPos);
  }

  fixedUpdate(h) {
    if (this.leapT > 0) {
      this.leapT -= h;
      return;
    }
    super.fixedUpdate(h);
  }

  onCollide(other) {
    if (this.dead || this.leapT <= 0 || other?.type !== 'player') return;
    this.#bite(12);
    this.leapT = 0;
  }

  #bite(dmg) {
    const player = this.player;
    if (!player || player.dead || this.biteCd > 0) return;
    this.biteCd = 1.1;
    player.damage(dmg, { source: 'enemy', kind: 'bite', from: this.currPos.clone() });
    this.game.audio.play('crawlerBite', player.currPos);
    const away = _v.copy(player.currPos).sub(this.currPos).setY(0).normalize();
    player.knockback(away.multiplyScalar(1.2), 0.8);
  }

  think(dt) {
    const player = this.player;
    this.leapCd -= dt;
    this.biteCd -= dt;
    this.zig += dt;
    let crouchTarget = 0;

    if (!this.alerted || !player || player.dead) {
      this.wanderTimer -= dt;
      if (!this.wander || this.wanderTimer <= 0) {
        const a = Math.random() * Math.PI * 2;
        this.wander = this.home.clone().add(new THREE.Vector3(Math.cos(a) * 6, 0, Math.sin(a) * 6));
        this.wanderTimer = 3 + Math.random() * 4;
      }
      const d = this.steer(this.wander, 1.8, dt);
      if (d > 0.5) this.faceToward(this.wander, dt, 5);
      else this.wantVel.set(0, 0, 0);
    } else if (this.leapT <= 0) {
      const target = this.sees ? player.currPos : this.lastSeen;
      const dist = this.distance;
      this.faceToward(target, dt, 10);
      if (this.stagger > 0) {
        this.wantVel.set(0, 0, 0);
        crouchTarget = 1;
      } else if (dist < 1.6 && this.sees) {
        this.wantVel.set(0, 0, 0);
        crouchTarget = 0.6;
        this.#bite(9);
      } else if (this.sees && dist < 6.5 && dist > 2.5 && this.leapCd <= 0) {
        this.#leap(player);
      } else {
        // carrera en zigzag para ser más difícil de apuntar
        const goal = _v.copy(target);
        if (dist > 5) {
          const side = Math.sin(this.zig * 3.1) * Math.min(3, dist * 0.25);
          const dx = target.x - this.currPos.x;
          const dz = target.z - this.currPos.z;
          const l = Math.hypot(dx, dz) || 1;
          goal.x += (-dz / l) * side;
          goal.z += (dx / l) * side;
        }
        this.steer(goal, 6.2 * this.speedMul, dt);
      }
    }

    // patas procedurales según la velocidad real
    const v = this.body.linvel();
    const hs = Math.hypot(v.x, v.z);
    this.phase += dt * (2 + hs * 2.2);
    this.crouch += (crouchTarget - this.crouch) * Math.min(1, dt * 8);
    animateLegs(this.rig, this.phase, Math.min(1, hs / 3 + 0.15), this.crouch);
  }

  #leap(player) {
    this.leapCd = 2.6 + Math.random() * 1.5;
    this.leapT = 0.85;
    const target = player.chestPosition(_v).addScaledVector(player.velocity, 0.3);
    const dir = target.sub(this.currPos);
    const dist = Math.hypot(dir.x, dir.z);
    dir.y = 0;
    dir.normalize();
    const m = this.body.mass();
    const speed = Math.min(11, dist * 1.7 + 2);
    this.body.setLinvel({ x: dir.x * speed, y: 4.6, z: dir.z * speed }, true);
    void m;
    this.game.audio.play('crawlerLeap', this.currPos);
  }

  onDeath(info) {
    // se hace añicos: fragmentos de cristal con física
    const { game } = this;
    const p = this.currPos.clone();
    for (let i = 0; i < 7; i++) {
      const off = new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.5, (Math.random() - 0.5) * 0.8);
      const d = new Debris(game, p.clone().add(off), 'crystal', 1.2);
      const dir = off.normalize();
      if (info?.dir) dir.addScaledVector(info.dir, 0.7);
      dir.y += 0.5;
      d.push(dir.normalize(), 3 + Math.random() * 4);
      game.addEntity(d);
    }
    game.fx.burst('shards', p);
    game.audio.play('crawlerDie', p);
    this.destroy();
  }
}
