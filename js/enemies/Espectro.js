/**
 * Espectro — unidad de combate de la expedición corrompida por el Eco.
 * Mismo modelo que NOVA-7 (RobotExpressive) con armadura obsidiana y visor
 * magenta. Dispara ráfagas de plasma, se mueve lateralmente para esquivar,
 * mantiene distancia y golpea si el jugador se acerca demasiado.
 */
import * as THREE from 'three';
import { Enemy } from './Enemy.js';
import { AnimationController, ArmAim, HeldWeapon, dressRobot } from '../entities/Rig.js';
import { EnemyBolt } from '../entities/Projectiles.js';

const _v = new THREE.Vector3();
const _aim = new THREE.Vector3();

let ENEMY_ARMOR = null;
function enemyPalette() {
  if (!ENEMY_ARMOR) {
    ENEMY_ARMOR = {
      ArmorGlow: new THREE.MeshStandardMaterial({ color: 0xffb3f0, emissive: 0xff2bd6, emissiveIntensity: 1.8 }),
      ArmorVisor: new THREE.MeshStandardMaterial({ color: 0x2a0626, emissive: 0xff2bd6, emissiveIntensity: 0.55, metalness: 0.55, roughness: 0.32, envMapIntensity: 0.35 }),
      ArmorMain: new THREE.MeshStandardMaterial({ color: 0x2a2233, metalness: 0.75, roughness: 0.3 }),
      ArmorDark: new THREE.MeshStandardMaterial({ color: 0x120e18, metalness: 0.7, roughness: 0.4 }),
    };
  }
  return {
    Main: { color: 0x221d2b, metalness: 0.5, roughness: 0.45 },
    Grey: { color: 0x3b2a45, metalness: 0.45, roughness: 0.5 },
    Black: { color: 0x0a080d, emissive: 0x3a0030, emissiveIntensity: 0.5 },
    armor: ENEMY_ARMOR,
  };
}

export class Espectro extends Enemy {
  constructor(game, pos, { elite = false } = {}) {
    super(game, pos, {
      type: 'espectro',
      name: elite ? 'Espectro de élite' : 'Espectro',
      hp: elite ? 140 : 85,
      shape: 'capsule',
      radius: 0.36,
      halfHeight: 0.55,
      mass: 75,
      sight: 36,
      score: elite ? 160 : 100,
      eyeHeight: 0.4,
      headY: 0.28,
      accel: 9,
    });
    this.elite = elite;
    const { model } = dressRobot(game.assets, { height: elite ? 2.05 : 1.8, palette: enemyPalette() });
    this.model = model;
    model.position.y = -this.centerOffset;
    this.object3d.add(model);
    this.collectFlashMaterials(model);
    this.anim = new AnimationController(model, game.assets.robot.animations);
    this.anim.loop('Idle', 1, 0);
    this.anim.mixer.setTime(Math.random() * 2);
    this.arm = new ArmAim(model, 'R');
    this.weapon = new HeldWeapon(game.level.root);
    this.weapon.set('caster', game.assets.cloneProp('WeaponCaster'));
    this.aimWeight = 0;
    this.burst = 0;
    this.burstTimer = 0;
    this.fireCd = 1 + Math.random() * 1.5;
    this.meleeCd = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 1 + Math.random() * 2;
    this.preferred = 9 + Math.random() * 6;
    this.lostTime = 0;
  }

  onAlert() {
    this.game.audio.play('espectroAlert', this.currPos);
  }

  think(dt) {
    const player = this.player;
    const diff = this.game.difficulty;
    this.fireCd -= dt;
    this.meleeCd -= dt;
    this.strafeTimer -= dt;
    let speed = 0;
    let combat = false;

    if (!this.alerted || !player || player.dead) {
      // patrulla tranquila alrededor de su punto de origen
      this.wanderTimer -= dt;
      if (!this.wander || this.wanderTimer <= 0) {
        const a = Math.random() * Math.PI * 2;
        this.wander = this.home.clone().add(new THREE.Vector3(Math.cos(a) * 5, 0, Math.sin(a) * 5));
        this.wanderTimer = 4 + Math.random() * 4;
      }
      const d = this.steer(this.wander, 1.6, dt);
      if (d > 0.5) {
        this.faceToward(this.wander, dt, 4);
        speed = 1.6;
      } else this.wantVel.set(0, 0, 0);
    } else {
      combat = true;
      const target = this.sees ? player.currPos : this.lastSeen;
      this.faceToward(player.currPos, dt, this.sees ? 9 : 5);
      if (this.sees) this.lostTime = 0;
      else this.lostTime += dt;
      const dist = this.distance;
      if (this.stagger > 0) {
        this.wantVel.set(0, 0, 0);
        this.burst = 0;
      } else if (dist < 2.2 && this.meleeCd <= 0 && this.sees) {
        this.#melee();
      } else if (!this.sees || dist > this.preferred + 4) {
        this.steer(target, this.elite ? 3.8 : 4.3, dt);
        speed = 4;
      } else {
        // mantener distancia y moverse lateralmente
        if (this.strafeTimer <= 0) {
          this.strafe *= -1;
          this.strafeTimer = 1.2 + Math.random() * 2;
        }
        _v.subVectors(this.currPos, player.currPos).setY(0).normalize();
        const back = dist < this.preferred - 3 ? 1 : 0;
        const side = new THREE.Vector3(-_v.z, 0, _v.x).multiplyScalar(this.strafe);
        const goal = this.currPos.clone().addScaledVector(side, 3).addScaledVector(_v, back * 3);
        this.steer(goal, 2.2, dt);
        speed = 2.2;
      }
      // disparos en ráfaga
      if (this.sees && dist < 40 && this.stagger <= 0 && this.game.state === 'playing') {
        if (this.burst > 0) {
          this.burstTimer -= dt;
          if (this.burstTimer <= 0) {
            this.#shoot(diff);
            this.burst -= 1;
            this.burstTimer = 0.16;
          }
        } else if (this.fireCd <= 0) {
          this.burst = this.elite ? 5 : 3;
          this.burstTimer = 0.35; // aviso: el arma brilla antes de disparar
          this.fireCd = (1.7 + Math.random() * 1.1) / diff.accuracy;
          this.game.audio.play('espectroCharge', this.currPos);
        }
      }
    }

    // animación
    const hs = Math.hypot(this.body.linvel().x, this.body.linvel().z);
    if (!this.anim.busy) {
      if (hs < 0.4) this.anim.loop('Idle', 1);
      else if (hs < 3.2) this.anim.loop('Walking', THREE.MathUtils.clamp(hs / 2.4, 0.6, 1.4));
      else this.anim.loop('Running', THREE.MathUtils.clamp(hs / 5.5, 0.8, 1.3));
    }
    this.anim.update(dt);
    this.object3d.updateMatrixWorld(true);
    const want = combat && this.sees ? 1 : 0.4;
    this.aimWeight += (want - this.aimWeight) * Math.min(1, dt * 8);
    if (player && combat) {
      _aim.copy(player.chestPosition(_v)).sub(this.arm.shoulderPosition(new THREE.Vector3())).normalize();
    } else {
      _aim.set(Math.sin(this.facing), -0.6, Math.cos(this.facing)).normalize();
    }
    if (!this.anim.busy) this.arm.apply(_aim, this.aimWeight);
    this.model.updateMatrixWorld(true);
    const hand = this.arm.handPosition(new THREE.Vector3());
    this.weapon.place(hand, this.aimWeight > 0.6 && !this.anim.busy ? _aim : this.arm.forearmDirection(new THREE.Vector3()), 1);
    void speed;
  }

  #shoot(diff) {
    const player = this.player;
    if (!player) return;
    const origin = this.weapon.muzzlePosition(new THREE.Vector3());
    const target = player.chestPosition(new THREE.Vector3());
    const dist = origin.distanceTo(target);
    const speed = 24;
    target.addScaledVector(player.velocity, (dist / speed) * 0.5);
    const dir = target.sub(origin).normalize();
    const err = (0.03 + dist * 0.0015) / diff.accuracy;
    dir.x += (Math.random() - 0.5) * err * 2;
    dir.y += (Math.random() - 0.5) * err;
    dir.z += (Math.random() - 0.5) * err * 2;
    dir.normalize();
    this.game.addEntity(new EnemyBolt(this.game, origin, dir.multiplyScalar(speed), this.elite ? 9 : 7));
    this.game.fx.muzzle(origin, dir, 0xff2bd6, 0.8);
    this.game.audio.play('enemyShot', origin);
  }

  #melee() {
    this.meleeCd = 1.4;
    this.anim.once('Punch', { timeScale: 1.4 });
    this.game.after(0.28, () => {
      const player = this.player;
      if (this.dead || !player || player.dead) return;
      if (player.currPos.distanceTo(this.currPos) < 2.4) {
        player.damage(18, { source: 'enemy', kind: 'melee', from: this.currPos.clone() });
        const away = player.currPos.clone().sub(this.currPos).setY(0).normalize();
        player.knockback(away.multiplyScalar(5), 3);
        this.game.audio.play('punch', player.currPos);
      }
    });
  }

  onDeath() {
    this.anim.release();
    this.anim.once('Death', { fade: 0.1 });
    this.game.audio.play('espectroDie', this.currPos);
    this.game.fx.burst('sparks', this.currPos.clone());
  }

  updateDead(dt) {
    this.anim.update(dt);
    this.model.updateMatrixWorld(true);
    const hand = this.arm.handPosition(new THREE.Vector3());
    this.weapon.place(hand, this.arm.forearmDirection(new THREE.Vector3()), 1);
  }

  dispose() {
    this.weapon.dispose();
    super.dispose();
  }
}
