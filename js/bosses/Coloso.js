/**
 * JEFE 2 — El Coloso.
 *
 * La excavadora autónoma de la Expedición Kepler, fusionada con cristal del
 * Eco: 6,4 m de acero y obsidiana (RobotExpressive escalado, con su
 * AnimationMixer: Walking, Punch, Jump, No, Death).
 *
 *  - Escudo de energía alimentado por NODOS de cristal: hay que destruirlos
 *    para poder dañarlo. Al 50 % se vuelve a blindar con nodos nuevos.
 *  - Puñetazo frontal, pisotón con onda expansiva (se esquiva SALTANDO),
 *    lanzamiento de rocas con física y, en la segunda fase, andanada de
 *    morteros de plasma.
 *  - Punto débil: la cabeza (tiros a la cabeza).
 */
import * as THREE from 'three';
import { Enemy } from '../enemies/Enemy.js';
import { AnimationController, dressRobot } from '../entities/Rig.js';
import { CrystalNode } from '../entities/Interactables.js';
import { StoneOrb, Debris } from '../entities/Props.js';
import { Lob } from '../entities/Projectiles.js';
import { COLLISION, SCORE } from '../config.js';
import { heightAt } from '../world/TerrainField.js';

const _v = new THREE.Vector3();
const _chest = new THREE.Vector3();

function colossusPalette() {
  return {
    Main: { color: 0x3a3440, metalness: 0.8, roughness: 0.32 },
    Grey: { color: 0x5b4a3a, metalness: 0.7, roughness: 0.45 },
    Black: { color: 0x0a080d, emissive: 0xff2bd6, emissiveIntensity: 0.6 },
    armor: {
      ArmorGlow: new THREE.MeshStandardMaterial({ color: 0xffb3f0, emissive: 0xff2bd6, emissiveIntensity: 3 }),
      ArmorVisor: new THREE.MeshStandardMaterial({ color: 0x2a0626, emissive: 0xff2bd6, emissiveIntensity: 0.9, metalness: 0.55, roughness: 0.32, envMapIntensity: 0.35 }),
      ArmorMain: new THREE.MeshStandardMaterial({ color: 0xc28a2e, metalness: 0.6, roughness: 0.45 }),
      ArmorDark: new THREE.MeshStandardMaterial({ color: 0x1a1512, metalness: 0.7, roughness: 0.5 }),
    },
  };
}

export class Coloso extends Enemy {
  /**
   * @param {object} opts { nodes1: Vector3[], nodes2: Vector3[], walkTo: Vector3, onDefeated }
   */
  constructor(game, pos, opts = {}) {
    super(game, pos, {
      type: 'coloso',
      name: 'El Coloso',
      hp: 1,
      shape: 'capsule',
      radius: 1.3,
      halfHeight: 1.9,
      mass: 8000,
      sight: 100,
      score: SCORE.boss,
      eyeHeight: 2.2,
      headY: 1.7,
      accel: 8,
      groups: COLLISION.boss,
      hitRadius: 2.2,
      knockback: 0.02,
    });
    this.isBoss = true;
    this.title = 'Guardián del templo';
    this.opts = opts;
    this.maxHp = 2300 * game.difficulty.bossHp;
    this.hp = this.maxHp;
    const { model } = dressRobot(game.assets, { height: 6.4, palette: colossusPalette() });
    this.model = model;
    model.position.y = -this.centerOffset;
    this.object3d.add(model);
    this.collectFlashMaterials(model);
    this.anim = new AnimationController(model, game.assets.robot.animations);
    this.anim.loop('Walking', 0.35, 0);
    this.handR = model.getObjectByName('Palm2R') || model.getObjectByName('LowerArmR');
    this.headBone = model.getObjectByName('Head');

    // escudo
    this.shieldMesh = new THREE.Group();
    const s1 = new THREE.Mesh(
      new THREE.IcosahedronGeometry(4.3, 2),
      new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    const s2 = new THREE.Mesh(
      new THREE.IcosahedronGeometry(4.35, 1),
      new THREE.MeshBasicMaterial({ color: 0xff8fe6, wireframe: true, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.shieldMesh.add(s1, s2);
    this.shieldMats = [s1.material, s2.material];
    this.shieldMesh.position.y = 0.6;
    this.object3d.add(this.shieldMesh);
    this.shieldOn = true;
    this.shieldFlash = 0;
    this.nodes = [];
    this.beams = [];
    this.phaseIndex = 1;

    this.state = 'intro';
    this.stateT = 0;
    this.attackCd = 2.5;
    this.stepT = 0;
    this.alerted = true;
    this.heldRock = null;
    game.boss = this;
    game.bus.emit('boss:show', { name: this.cfg.name, title: this.title, color: '#ffb347' });
    game.audio.play('colossusRoar', this.currPos);
    this.#spawnNodes(opts.nodes1 || []);
  }

  get shielded() {
    return this.shieldOn || this.state === 'intro';
  }

  get nodesLeft() {
    return this.nodes.filter((n) => !n.dead).length;
  }

  chest(out = _chest) {
    return out.copy(this.currPos).setY(this.currPos.y + 0.8);
  }

  damagePoint(out = new THREE.Vector3()) {
    return this.chest(out);
  }

  #spawnNodes(list) {
    const { game } = this;
    for (const b of this.beams) b.dispose();
    this.beams = [];
    this.nodes = [];
    list.forEach((p, i) => {
      const node = new CrystalNode(game, p, {
        hp: 200 * game.difficulty.enemyHp,
        name: `Nodo ${i + 1}`,
        onDestroyed: () => this.#nodeDestroyed(),
      });
      game.addEntity(node);
      this.nodes.push(node);
      this.beams.push(game.fx.createBeam(0xff4fd8, 0.18));
    });
    game.physics.refreshQueries();
    this.shieldOn = true;
    this.shieldMesh.visible = true;
    game.bus.emit('boss:nodes', { total: this.nodes.length, left: this.nodes.length });
  }

  #nodeDestroyed() {
    const { game } = this;
    const left = this.nodesLeft;
    game.bus.emit('boss:nodes', { total: this.nodes.length, left });
    if (left > 0) {
      game.bus.emit('hud:toast', { text: `Nodo destruido · quedan ${left}`, type: 'gold', icon: 'gem' });
      return;
    }
    this.shieldOn = false;
    this.shieldMesh.visible = false;
    game.fx.burst('crystalBlast', this.chest().clone());
    game.fx.flash(this.chest(), 0xff4fd8, 25, 0.7);
    game.audio.play('shieldBreak', this.currPos);
    game.bus.emit('hud:banner', { title: '¡Escudo abajo!', subtitle: 'El Coloso es vulnerable: apunta a la cabeza', type: 'success' });
  }

  modifyDamage(amount, info) {
    if (this.state === 'intro' || this.state === 'reshield') return 0;
    if (this.shieldOn) {
      this.shieldFlash = 1;
      if (info.point) this.game.fx.impact(info.point, _v.subVectors(info.point, this.chest()).normalize(), 'shield');
      this.game.audio.play('shieldDeflect', info.point ?? this.currPos);
      return 0;
    }
    return amount;
  }

  stun() {}

  #setState(s) {
    this.state = s;
    this.stateT = 0;
    this.did = false;
  }

  think(dt) {
    const { game } = this;
    const player = this.player;
    this.stateT += dt;
    this.attackCd -= dt;
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
    if (this.shieldMesh.visible) {
      this.shieldMesh.rotation.y += dt * 0.4;
      this.shieldMats[0].opacity = 0.1 + this.shieldFlash * 0.25 + Math.sin(game.time * 3) * 0.03;
      this.shieldMats[1].opacity = 0.2 + this.shieldFlash * 0.4;
    }
    // rayos de los nodos al pecho
    this.chest();
    this.nodes.forEach((n, i) => {
      const b = this.beams[i];
      if (!b) return;
      b.visible = !n.dead;
      if (!n.dead) b.set(n.center, _chest);
    });

    // segunda fase
    if (this.phaseIndex === 1 && this.hp < this.maxHp * 0.5 && this.state !== 'reshield') {
      this.phaseIndex = 2;
      this.#setState('reshield');
      this.anim.release();
      this.anim.once('No', { timeScale: 0.8 });
      game.audio.play('colossusRoar', this.currPos);
      game.bus.emit('hud:banner', { title: 'El Coloso se reactiva', subtitle: 'Nuevos nodos de energía protegen su escudo', type: 'danger' });
    }

    const dist = player ? player.currPos.distanceTo(this.currPos) : 99;
    switch (this.state) {
      case 'intro': {
        const target = this.opts.walkTo ?? this.home;
        const d = this.steer(target, 2.4, dt);
        this.faceToward(target, dt, 3);
        if (d < 1 || this.stateT > 6) {
          this.wantVel.set(0, 0, 0);
          this.#setState('walk');
          this.attackCd = 1.5;
          game.cameraRig.shake(0.8);
        }
        break;
      }
      case 'reshield':
        this.wantVel.set(0, 0, 0);
        if (this.stateT > 1.2 && !this.did) {
          this.did = true;
          this.#spawnNodes(this.opts.nodes2 || []);
          game.director.group([['espectro', 2], ['acechador', 2]], this.currPos, 16, { alerted: true, portal: true, minPlayerDist: 8 });
        }
        if (this.stateT > 2) this.#setState('walk');
        break;
      case 'walk': {
        if (!player || player.dead) {
          this.wantVel.set(0, 0, 0);
          break;
        }
        this.faceToward(player.currPos, dt, 1.8);
        if (dist > 5) this.steer(player.currPos, this.phaseIndex === 2 ? 3 : 2.4, dt);
        else this.wantVel.set(0, 0, 0);
        if (this.attackCd <= 0) {
          const r = Math.random();
          if (dist < 6.5) this.#setState(r < 0.65 ? 'punch' : 'pound');
          else if (dist < 15) this.#setState(r < 0.5 ? 'pound' : 'throw');
          else if (this.phaseIndex === 2 && r < 0.45) this.#setState('barrage');
          else this.#setState('throw');
          this.#startAttack();
        }
        break;
      }
      case 'punch':
        this.wantVel.set(0, 0, 0);
        if (player) this.faceToward(player.currPos, dt, 3);
        if (this.stateT > 0.55 && !this.did) {
          this.did = true;
          game.audio.play('whoosh', this.currPos, { pitch: 0.5 });
          if (player && !player.dead) {
            _v.subVectors(player.currPos, this.currPos).setY(0);
            const d = _v.length();
            _v.normalize();
            const fwd = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
            if (d < 6.8 && _v.dot(fwd) > 0.35) {
              player.damage(32, { source: 'enemy', kind: 'punch', from: this.currPos.clone() });
              player.knockback(_v.multiplyScalar(15), 6);
              game.audio.play('bossImpact', player.currPos);
              game.cameraRig.shake(0.7);
            }
          }
        }
        if (this.stateT > 1.3) this.#endAttack();
        break;
      case 'pound':
        this.wantVel.set(0, 0, 0);
        if (this.stateT > 1.2 && !this.did) {
          this.did = true;
          this.#shockwave();
        }
        if (this.stateT > 2) this.#endAttack();
        break;
      case 'throw':
        this.wantVel.set(0, 0, 0);
        if (player) this.faceToward(player.currPos, dt, 3);
        if (this.heldRock && this.handR) this.handR.getWorldPosition(this.heldRock.position);
        if (this.stateT > 0.6 && !this.did) {
          this.did = true;
          this.#throwRock();
        }
        if (this.stateT > 1.4) this.#endAttack();
        break;
      case 'barrage':
        this.wantVel.set(0, 0, 0);
        if (this.stateT > 0.5 && !this.did) {
          this.did = true;
          this.#barrage();
        }
        if (this.stateT > 1.6) this.#endAttack();
        break;
      default:
        break;
    }

    // animación de locomoción
    const v = this.body.linvel();
    const hs = Math.hypot(v.x, v.z);
    if (!this.anim.busy) {
      if (hs < 0.3) this.anim.loop('Idle', 0.7);
      else this.anim.loop('Walking', THREE.MathUtils.clamp(hs / 9, 0.22, 0.6));
    }
    if (hs > 0.5) {
      this.stepT += dt * hs * 0.16;
      if (this.stepT > 1) {
        this.stepT = 0;
        game.audio.play('colossusStep', this.currPos);
        game.cameraRig.shakeFrom(this.currPos, 0.25);
      }
    }
    this.anim.update(dt);
  }

  #startAttack() {
    const { game } = this;
    const s = this.state;
    if (s === 'punch') this.anim.once('Punch', { timeScale: 0.7 });
    else if (s === 'pound') {
      this.anim.once('Jump', { timeScale: 0.55 });
      game.fx.warning(this.feet.clone(), 9, 1.2, 0xff4fd8);
      game.bus.emit('boss:telegraph', { text: '¡SALTA!' });
      game.audio.play('bastionCharge', this.currPos, { pitch: 0.6 });
    } else if (s === 'throw') {
      this.anim.once('Punch', { timeScale: 0.55 });
      this.heldRock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), game.assets.materials.boulder);
      this.heldRock.castShadow = true;
      game.level.root.add(this.heldRock);
    } else if (s === 'barrage') {
      this.anim.once('Yes', { timeScale: 1.2 });
      game.audio.play('mortar', this.currPos, { pitch: 0.7 });
    }
  }

  #endAttack() {
    if (this.heldRock) {
      this.heldRock.parent?.remove(this.heldRock);
      this.heldRock.geometry.dispose();
      this.heldRock = null;
    }
    this.#setState('walk');
    this.attackCd = (this.phaseIndex === 2 ? 1.6 : 2.4) + Math.random() * 1.2;
  }

  #shockwave() {
    const { game } = this;
    const c = this.feet.clone();
    game.physics.radialImpulse(c, 10, 10, { upBias: 0.9 });
    game.fx.shockwave(c, 9, 0xff4fd8);
    game.fx.shockwave(c, 6, 0xffb347);
    game.fx.burst('dust', c);
    game.fx.burst('explosion', c.clone().setY(c.y + 0.3));
    game.fx.flash(c, 0xff4fd8, 20, 0.5);
    game.audio.play('stomp', c, { pitch: 0.6 });
    game.cameraRig.shakeFrom(c, 1.4);
    const player = this.player;
    if (player && !player.dead) {
      const d = player.feetPosition.distanceTo(c);
      const airborne = !player.grounded && player.feetPosition.y > heightAt(player.currPos.x, player.currPos.z) + 0.5;
      if (d < 9 && !airborne) {
        player.damage(38 * (1 - d / 11), { source: 'enemy', kind: 'shockwave', from: c });
        player.knockback(_v.subVectors(player.currPos, c).setY(0).normalize().multiplyScalar(12), 7);
      }
    }
  }

  #throwRock() {
    const { game } = this;
    const player = this.player;
    if (!player) return;
    const origin = this.heldRock ? this.heldRock.position.clone() : this.chest().clone().setY(this.currPos.y + 2.5);
    if (this.heldRock) {
      this.heldRock.parent?.remove(this.heldRock);
      this.heldRock.geometry.dispose();
      this.heldRock = null;
    }
    const T = 1.25;
    const target = player.feetPosition.clone().addScaledVector(player.velocity, T * 0.7);
    target.y = heightAt(target.x, target.z) + 0.9;
    const g = game.physics.gravity;
    const vel = new THREE.Vector3((target.x - origin.x) / T, (target.y - origin.y) / T + 0.5 * g * T, (target.z - origin.z) / T);
    const rock = new StoneOrb(game, origin, { radius: 0.9, thrown: true, damage: 30 });
    rock.transient = true;
    rock.body.setLinvel(vel, true);
    rock.body.setAngvel({ x: 3, y: 1, z: 2 }, true);
    game.addEntity(rock);
    game.fx.warning(target.clone().setY(target.y - 0.9), 2.2, T, 0xffb347);
    game.audio.play('throw', origin, { pitch: 0.5 });
  }

  #barrage() {
    const { game } = this;
    const player = this.player;
    if (!player) return;
    const origin = this.chest().clone().setY(this.currPos.y + 2.8);
    const T = 1.6;
    const g = game.physics.gravity;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = i === 0 ? 0 : 2 + Math.random() * 5;
      const target = player.feetPosition.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      target.y = heightAt(target.x, target.z);
      const vel = new THREE.Vector3((target.x - origin.x) / T, (target.y - origin.y) / T + 0.5 * g * T, (target.z - origin.z) / T);
      setTimeout(() => {
        if (this.dead) return;
        game.addEntity(new Lob(game, origin.clone(), vel, 'plasma', { warnAt: target, damageMult: 1.2 }));
      }, i * 110);
    }
  }

  onDeath() {
    const { game } = this;
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.lockRotations(true, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const b of this.beams) b.dispose();
    this.beams = [];
    this.shieldMesh.visible = false;
    if (this.heldRock) this.#endAttack();
    this.anim.release();
    this.anim.once('Death', { timeScale: 0.45, fade: 0.2 });
    game.audio.play('bossDie', this.currPos, { pitch: 0.7 });
    game.cameraRig.shake(1.2);
    game.bus.emit('boss:hide');
    game.boss = null;
    this.exploded = 0;
  }

  update(dt) {
    if (!this.dead) {
      super.update(dt);
      return;
    }
    // secuencia de muerte propia: explosiones en cadena y queda el armazón
    this.deathTime += dt;
    this.anim.update(dt);
    const { game } = this;
    if (this.deathTime > 0.6 && this.exploded < 6 && this.deathTime > 0.6 + this.exploded * 0.35) {
      this.exploded++;
      const p = this.currPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2 - 1, (Math.random() - 0.5) * 3));
      game.fx.burst('smallExplosion', p);
      game.fx.flash(p, 0xff8a3a, 12, 0.3);
      game.audio.play('smallExplosion', p);
      if (this.exploded === 6) {
        game.damage.explode(this.currPos.clone(), { radius: 7, damage: 10, deltaV: 12, source: 'player', color: 0xff4fd8 });
        for (let i = 0; i < 10; i++) {
          const d = new Debris(game, this.currPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2)), i % 2 ? 'metal' : 'crystal', 3);
          d.push(new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(), 7);
          game.addEntity(d);
        }
        this.opts.onDefeated?.(this);
        game.bus.emit('boss:defeated', { type: this.type });
      }
    }
  }

  dispose() {
    for (const b of this.beams) b.dispose();
    if (this.heldRock) this.heldRock.parent?.remove(this.heldRock);
    super.dispose();
  }
}
