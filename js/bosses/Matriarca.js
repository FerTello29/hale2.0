/**
 * JEFE 1 — La Matriarca.
 *
 * Madre de los acechadores: 4,5 m de caparazón de cristal sobre seis patas.
 *  - Embestida: ruge, apunta y carga a 15 m/s. Si choca contra un pilar de roca
 *    o un árbol queda ATURDIDA y su saco de cristal queda expuesto.
 *  - Escupitajo ácido: proyectiles balísticos con aviso en el suelo.
 *  - Zarpazo frontal a corta distancia.
 *  - Invoca acechadores al 66 % y al 33 % de vida.
 * Punto débil: el saco luminoso de su espalda (daño ×3). El resto del
 * caparazón absorbe parte de las balas.
 */
import * as THREE from 'three';
import { Enemy } from '../enemies/Enemy.js';
import { rigLegs, animateLegs } from '../enemies/Acechador.js';
import { Lob } from '../entities/Projectiles.js';
import { Debris } from '../entities/Props.js';
import { COLLISION, SCORE } from '../config.js';
import { heightAt } from '../world/TerrainField.js';

const _v = new THREE.Vector3();
const _sac = new THREE.Vector3();

export class Matriarca extends Enemy {
  constructor(game, pos, { onDefeated } = {}) {
    super(game, pos, {
      type: 'matriarca',
      name: 'La Matriarca',
      hp: 1,
      shape: 'ball',
      radius: 1.35,
      mass: 1400,
      sight: 90,
      score: SCORE.boss,
      eyeHeight: 0.4,
      accel: 8,
      groups: COLLISION.boss,
      hitRadius: 2.3,
      weakMult: 3,
      knockback: 0.04,
    });
    this.isBoss = true;
    this.title = 'Madre de la colmena';
    this.onDefeated = onDefeated;
    this.maxHp = 1500 * game.difficulty.bossHp;
    this.hp = this.maxHp;
    this.model = game.assets.cloneProp('Matriarch');
    this.model.scale.setScalar(3.1);
    this.baseY = -this.centerOffset;
    this.model.position.y = this.baseY - 4;
    this.object3d.add(this.model);
    this.collectFlashMaterials(this.model);
    this.rig = rigLegs(this.model);
    this.sac = this.model.getObjectByName('Sac');
    this.sacMat = this.sac?.material;
    this.sacGlow = game.fx.createGlowSprite(0xff38c8, 2.6);
    this.sac?.add(this.sacGlow);
    this.sacGlow.scale.setScalar(0.9);
    this.state = 'emerge';
    this.stateT = 0;
    this.attackCd = 2;
    this.phase = 0;
    this.gait = 0;
    this.crouch = 0;
    this.summons = [0.66, 0.33];
    this.chargeDir = new THREE.Vector3();
    this.hitPlayer = false;
    this.enraged = false;
    this.alerted = true;
    game.boss = this;
    game.bus.emit('boss:show', { name: this.cfg.name, title: this.title, color: '#ff38c8' });
    game.audio.play('bossRoar', this.currPos);
    game.cameraRig.shake(1);
  }

  get shielded() {
    return this.state === 'emerge' || this.state === 'summon';
  }

  isWeakPoint(point) {
    if (!this.sac) return false;
    this.sac.getWorldPosition(_sac);
    return point.distanceTo(_sac) < 1.15;
  }

  modifyDamage(amount, info) {
    if (this.state === 'emerge') return 0;
    if (this.state === 'summon') return amount * 0.2;
    let k = 1;
    if (this.state === 'stunned') k *= 1.5;
    if (!info.weak && info.kind === 'bullet') k *= 0.55;
    return amount * k;
  }

  stun() {}

  #setState(s, t = 0) {
    this.state = s;
    this.stateT = t;
  }

  fixedUpdate(h) {
    if (this.dead || !this.body) return;
    if (this.state === 'charge') {
      const v = this.body.linvel();
      const speed = this.enraged ? 17 : 15;
      this.body.setLinvel({ x: this.chargeDir.x * speed, y: v.y, z: this.chargeDir.z * speed }, true);
      return;
    }
    super.fixedUpdate(h);
  }

  think(dt) {
    const { game } = this;
    const player = this.player;
    this.stateT += dt;
    this.attackCd -= dt;
    let crouch = 0;
    const hpK = this.hp / this.maxHp;
    if (!this.enraged && hpK < 0.5) {
      this.enraged = true;
      game.bus.emit('hud:toast', { text: '¡La Matriarca está furiosa!', type: 'danger', icon: 'exclamation-triangle-fill' });
    }
    if (this.summons.length && hpK < this.summons[0] && this.state !== 'emerge' && this.state !== 'charge') {
      this.summons.shift();
      this.#setState('summon');
      this.summoned = false;
      game.audio.play('bossRoar', this.currPos);
    }

    switch (this.state) {
      case 'emerge': {
        const k = Math.min(1, this.stateT / 2.6);
        this.model.position.y = this.baseY - 4 * (1 - k * k * (3 - 2 * k));
        if (Math.random() < dt * 25) game.fx.burst('dust', this.feet.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, 0.2, (Math.random() - 0.5) * 5)));
        if (k >= 1) {
          this.model.position.y = this.baseY;
          this.#setState('stalk');
          this.attackCd = 1.5;
        }
        this.wantVel.set(0, 0, 0);
        break;
      }
      case 'stalk': {
        if (!player || player.dead) {
          this.wantVel.set(0, 0, 0);
          break;
        }
        this.faceToward(player.currPos, dt, 3);
        const dist = player.currPos.distanceTo(this.currPos);
        if (dist > 5) this.steer(player.currPos, this.enraged ? 4.4 : 3.4, dt);
        else this.wantVel.set(0, 0, 0);
        if (this.attackCd <= 0) {
          if (dist < 5.2) this.#setState('swipe');
          else if (dist > 9 && Math.random() < 0.6) this.#setState('windup');
          else this.#setState(Math.random() < 0.55 ? 'spit' : 'windup');
        }
        break;
      }
      case 'windup': {
        this.wantVel.set(0, 0, 0);
        crouch = 1;
        if (player) this.faceToward(player.currPos, dt, 6);
        if (this.stateT < dt * 1.5) {
          game.audio.play('bossRoar', this.currPos, { pitch: 1.2 });
          game.bus.emit('boss:telegraph', { text: 'EMBESTIDA' });
        }
        if (this.stateT > (this.enraged ? 0.7 : 0.95)) {
          this.chargeDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
          this.hitPlayer = false;
          this.#setState('charge');
          game.audio.play('bossCharge', this.currPos);
        }
        break;
      }
      case 'charge': {
        crouch = 0.4;
        const v = this.body.linvel();
        const hs = Math.hypot(v.x, v.z);
        if (Math.random() < dt * 30) game.fx.burst('dust', this.feet.clone());
        // golpear al jugador
        if (!this.hitPlayer && player && !player.dead && player.currPos.distanceTo(this.currPos) < 2.6) {
          this.hitPlayer = true;
          player.damage(34, { source: 'enemy', kind: 'charge', from: this.currPos.clone() });
          player.knockback(this.chargeDir.clone().multiplyScalar(16), 6);
          game.cameraRig.shake(0.8);
          game.audio.play('punch', player.currPos);
        }
        // ¿hay algo sólido justo delante? (pilares, árboles, paredes del cráter)
        let blocked = false;
        if (this.stateT > 0.2 && !this.hitPlayer) {
          // tres rayos (centro y costados) para que los choques de refilón también cuenten
          for (const side of [0, -1, 1]) {
            _v.set(-this.chargeDir.z, 0, this.chargeDir.x).multiplyScalar(side * 1.0).add(this.currPos);
            if (game.physics.raycast(_v, this.chargeDir, this.radius + 0.9, { groups: COLLISION.enemySight, excludeCollider: this.colliders[0] })) {
              blocked = true;
              break;
            }
          }
        }
        if (this.stateT > 0.25 && hs < 5 && this.hitPlayer) {
          this.#setState('recover');
        } else if (blocked || (this.stateT > 0.25 && hs < 5)) {
          // chocó contra algo sólido
          this.#setState('stunned');
          game.fx.burst('dust', this.currPos.clone().addScaledVector(this.chargeDir, 1.6));
          game.fx.burst('shards', this.currPos.clone().addScaledVector(this.chargeDir, 1.6));
          game.audio.play('bossImpact', this.currPos);
          game.cameraRig.shakeFrom(this.currPos, 1.2);
          game.bus.emit('hud:toast', { text: '¡Aturdida! Dispara al saco de su espalda', type: 'gold', icon: 'bullseye' });
        } else if (this.stateT > 1.5) {
          this.#setState('recover');
        }
        break;
      }
      case 'recover':
        this.wantVel.set(0, 0, 0);
        if (this.stateT > 0.9) this.#endAttack();
        break;
      case 'stunned':
        this.wantVel.set(0, 0, 0);
        crouch = 1.4;
        if (this.stateT > 2.6) this.#endAttack();
        break;
      case 'spit': {
        this.wantVel.set(0, 0, 0);
        crouch = 0.6;
        if (player) this.faceToward(player.currPos, dt, 6);
        if (this.stateT > 0.65 && !this.spat) {
          this.spat = true;
          this.#spit();
        }
        if (this.stateT > 1.3) {
          this.spat = false;
          this.#endAttack();
        }
        break;
      }
      case 'swipe': {
        this.wantVel.set(0, 0, 0);
        if (player) this.faceToward(player.currPos, dt, 8);
        crouch = this.stateT < 0.45 ? 0.8 : -0.4;
        if (this.stateT > 0.45 && !this.swiped) {
          this.swiped = true;
          game.audio.play('whoosh', this.currPos, { pitch: 0.6 });
          if (player && !player.dead) {
            _v.subVectors(player.currPos, this.currPos).setY(0);
            const d = _v.length();
            _v.normalize();
            const fwd = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
            if (d < 4.6 && _v.dot(fwd) > 0.2) {
              player.damage(24, { source: 'enemy', kind: 'swipe', from: this.currPos.clone() });
              player.knockback(_v.multiplyScalar(12), 5);
              game.audio.play('punch', player.currPos);
            }
          }
        }
        if (this.stateT > 1) {
          this.swiped = false;
          this.#endAttack();
        }
        break;
      }
      case 'summon': {
        this.wantVel.set(0, 0, 0);
        crouch = Math.sin(this.stateT * 12) * 0.3 + 0.5;
        if (this.stateT > 0.8 && !this.summoned) {
          this.summoned = true;
          const n = 3 + (game.difficulty.id === 'leyenda' ? 2 : game.difficulty.id === 'veterano' ? 1 : 0);
          game.director.group([['acechador', n]], this.currPos, 9, { alerted: true, portal: true, minPlayerDist: 4, scale: false });
          game.bus.emit('hud:toast', { text: 'La Matriarca llama a su prole', type: 'danger', icon: 'bug-fill' });
        }
        if (this.stateT > 1.6) this.#endAttack();
        break;
      }
      default:
        break;
    }

    // patas y cuerpo
    const v = this.body.linvel();
    const hs = Math.hypot(v.x, v.z);
    this.gait += dt * (1.5 + hs * 1.1);
    this.crouch += (crouch - this.crouch) * Math.min(1, dt * 6);
    animateLegs(this.rig, this.gait, Math.min(1, hs / 3 + (this.state === 'stunned' ? 0.6 : 0.1)), this.crouch);
    if (this.state === 'stunned') this.model.rotation.z = Math.sin(this.stateT * 18) * 0.05;
    else this.model.rotation.z *= 0.9;
    // saco brillante (más intenso cuando está aturdida)
    const pulse = 0.5 + 0.5 * Math.sin(game.time * (this.state === 'stunned' ? 14 : 4));
    if (this.sacMat) this.sacMat.emissiveIntensity = 2 + pulse * (this.state === 'stunned' ? 5 : 1.5);
    this.sacGlow.material.opacity = 0.5 + pulse * 0.5;
  }

  #endAttack() {
    this.#setState('stalk');
    this.attackCd = (this.enraged ? 1.4 : 2.2) + Math.random() * 1.2;
  }

  #spit() {
    const { game } = this;
    const player = this.player;
    if (!player) return;
    const head = this.model.getObjectByName('Head');
    const origin = head ? head.getWorldPosition(new THREE.Vector3()) : this.currPos.clone();
    origin.y += 0.5;
    const n = this.enraged ? 5 : 3;
    const T = 1.15;
    const g = game.physics.gravity;
    for (let i = 0; i < n; i++) {
      const target = player.feetPosition.clone().addScaledVector(player.velocity, T * 0.6);
      const a = (i / n) * Math.PI * 2 + Math.random();
      const r = i === 0 ? 0 : 2 + Math.random() * 2.5;
      target.x += Math.cos(a) * r;
      target.z += Math.sin(a) * r;
      target.y = heightAt(target.x, target.z);
      const vel = new THREE.Vector3((target.x - origin.x) / T, (target.y - origin.y) / T + 0.5 * g * T, (target.z - origin.z) / T);
      game.addEntity(new Lob(game, origin.clone(), vel, 'acid', { warnAt: target, damageMult: 1.2 }));
    }
    game.audio.play('acidSpit', origin);
  }

  onDeath() {
    const { game } = this;
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.lockRotations(true, true);
    game.audio.play('bossDie', this.currPos);
    game.cameraRig.shake(1.2);
    game.bus.emit('boss:hide');
    game.boss = null;
    this.shattered = false;
  }

  updateDead(dt) {
    // se desploma y luego estalla en cristales
    animateLegs(this.rig, 0, 0, Math.min(2, this.deathTime * 1.5));
    this.model.rotation.z = Math.sin(this.deathTime * 20) * 0.04 * (1 - this.deathTime / 2);
    if (Math.random() < dt * 20) this.game.fx.burst('shards', this.currPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)));
    if (!this.shattered && this.deathTime > 1.8) {
      this.shattered = true;
      const { game } = this;
      const p = this.currPos.clone();
      for (let i = 0; i < 16; i++) {
        const d = new Debris(game, p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), 'crystal', 3);
        d.push(new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(), 6 + Math.random() * 5);
        game.addEntity(d);
      }
      game.damage.explode(p, { radius: 6, damage: 0, deltaV: 14, source: 'player', color: 0xff38c8 });
      game.fx.burst('crystalBlast', p);
      this.model.visible = false;
      this.onDefeated?.(this);
      game.bus.emit('boss:defeated', { type: this.type });
      this.destroy();
    }
  }
}
