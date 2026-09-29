/**
 * Player — NOVA-7, unidad de asalto blindada controlada por el jugador.
 *
 * - Modelo RobotExpressive.glb (GLTFLoader) vestido con armadura de props.glb.
 * - AnimationMixer: Idle, Walking (también hacia atrás), Running, Jump, Punch,
 *   Death, Dance, Wave, ThumbsUp; brazo derecho que apunta el arma (ArmAim).
 * - Cápsula cinemática de Rapier + KinematicCharacterController.
 * - Escudo recargable + salud, estamina para correr.
 */
import * as THREE from 'three';
import { Entity } from './Entity.js';
import { AnimationController, ArmAim, HeldWeapon, dressRobot } from './Rig.js';
import { COLLISION, PLAYER } from '../config.js';

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _sh = new THREE.Vector3();

export const PLAYER_PALETTE = {
  Main: { color: 0x8a939c, metalness: 0.45, roughness: 0.48 },
  Grey: { color: 0x39414b, metalness: 0.45, roughness: 0.5 },
  Black: { color: 0x14181d },
};

export class Player extends Entity {
  constructor(game, spawn, yaw = Math.PI) {
    super(game, 'player');
    const R = game.physics.R;

    // ------------------------------------------------ visual
    const { model, faces } = dressRobot(game.assets, { height: PLAYER.modelHeight, palette: PLAYER_PALETTE });
    this.model = model;
    this.faceMeshes = faces;
    this.object3d = new THREE.Group();
    this.object3d.name = 'NOVA-7';
    this.object3d.add(model);
    game.level.root.add(this.object3d);
    this.glowMats = [];
    model.traverse((o) => {
      if (o.isMesh && (o.material.name === 'ArmorGlow' || o.material.name === 'ArmorVisor')) {
        o.material.userData.baseGlow = o.material.name === 'ArmorVisor' ? 0.45 : 1.1;
        this.glowMats.push(o.material);
      }
    });

    this.anim = new AnimationController(model, game.assets.robot.animations);
    this.anim.loop('Idle', 1, 0);
    this.arm = new ArmAim(model, 'R');
    this.weaponView = new HeldWeapon(game.level.root);
    this.aimWeight = 0;

    // ------------------------------------------------ física
    this.halfHeight = PLAYER.capsuleHalfHeight;
    this.radius = PLAYER.capsuleRadius;
    this.centerOffset = this.halfHeight + this.radius;
    const start = { x: spawn.x, y: spawn.y + this.centerOffset + 0.05, z: spawn.z };
    const { body, colliders } = game.physics.createBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y, start.z),
      R.ColliderDesc.capsule(this.halfHeight, this.radius)
        .setFriction(0)
        .setCollisionGroups(COLLISION.player)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
        .setActiveCollisionTypes(R.ActiveCollisionTypes.DEFAULT | R.ActiveCollisionTypes.KINEMATIC_FIXED),
      this
    );
    this.body = body;
    this.collider = colliders[0];
    const cc = game.physics.world.createCharacterController(0.03);
    cc.setUp({ x: 0, y: 1, z: 0 });
    cc.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(52));
    cc.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(42));
    cc.enableAutostep(0.45, 0.22, false);
    cc.enableSnapToGround(0.45);
    cc.setSlideEnabled(true);
    cc.setApplyImpulsesToDynamicBodies(true);
    cc.setCharacterMass(PLAYER.characterMass);
    this.controller = cc;

    this.prevPos = new THREE.Vector3(start.x, start.y, start.z);
    this.currPos = this.prevPos.clone();

    // ------------------------------------------------ estado
    this.maxHealth = PLAYER.maxHealth;
    this.maxShield = PLAYER.maxShield;
    this.health = this.maxHealth;
    this.shield = this.maxShield;
    this.shieldDelay = 0;
    this.stamina = PLAYER.maxStamina;
    this.velocity = new THREE.Vector3();
    this.hVel = new THREE.Vector3();
    this.extVel = new THREE.Vector3(); // empujones (explosiones)
    this.vy = 0;
    this.grounded = false;
    this.airTime = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.facing = yaw;
    this.faceOverride = 0;
    this.running = false;
    this.dead = false;
    this.controlEnabled = true;
    this.surprise = 0;
    this.sad = 0;
    this.stepPhase = 0;
    this.shieldFlash = 0;
    this.stats = { damageTaken: 0 };
  }

  // ------------------------------------------------ utilidades
  get feetPosition() {
    return _v.copy(this.currPos).setY(this.currPos.y - this.centerOffset);
  }

  chestPosition(out = new THREE.Vector3()) {
    return out.copy(this.currPos).setY(this.currPos.y + 0.35);
  }

  canAct() {
    return !this.dead && this.controlEnabled;
  }

  teleport(pos, yaw) {
    const y = pos.y + this.centerOffset + 0.1;
    this.body.setTranslation({ x: pos.x, y, z: pos.z }, true);
    this.body.setNextKinematicTranslation({ x: pos.x, y, z: pos.z });
    this.currPos.set(pos.x, y, pos.z);
    this.prevPos.copy(this.currPos);
    this.vy = 0;
    this.hVel.set(0, 0, 0);
    this.extVel.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    if (yaw !== undefined) this.facing = yaw;
  }

  setWeaponModel(id, model) {
    this.weaponView.set(id, model);
  }

  muzzlePosition(out = new THREE.Vector3()) {
    return this.weaponView.muzzlePosition(out);
  }

  knockback(horizontal, up = 0) {
    this.extVel.add(horizontal);
    this.vy = Math.max(this.vy, up);
  }

  // ------------------------------------------------ salud
  /**
   * @param {number} amount
   * @param {{source?:string, kind?:string, from?:THREE.Vector3}} info
   */
  damage(amount, info = {}) {
    if (this.dead || this.game.state !== 'playing' || this.invulnerableCheat) return;
    const mult = info.source === 'enemy' ? this.game.difficulty.enemyDmg : 1;
    let real = amount * mult;
    if (real <= 0) return;
    this.stats.damageTaken += real;
    this.shieldDelay = PLAYER.shieldDelay;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, real);
      this.shield -= absorbed;
      real -= absorbed;
      this.shieldFlash = 1;
      if (this.shield <= 0) {
        this.game.audio.play('shieldBreak');
        this.game.bus.emit('player:shieldBroken');
      } else this.game.audio.play('shieldHit');
    }
    if (real > 0) {
      this.health = Math.max(0, this.health - real);
      this.surprise = 1;
      this.game.audio.play('damage');
    }
    this.game.bus.emit('player:damaged', { amount, from: info.from, kind: info.kind });
    if (this.health <= 0) this.die(info.kind);
  }

  heal(amount) {
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return this.health - before;
  }

  die(cause) {
    if (this.dead) return;
    this.dead = true;
    this.deathCause = cause;
    this.sad = 1;
    this.anim.once('Death', { fade: 0.15 });
    this.game.level?.onPlayerDied?.(cause);
  }

  celebrate() {
    this.anim.release();
    this.anim.loop('Dance', 1, 0.3);
    this.celebrating = true;
  }

  wave() {
    if (!this.anim.busy) this.anim.once('Wave', { timeScale: 1.1 });
  }

  playAction(kind) {
    if (kind === 'melee') this.anim.once('Punch', { timeScale: 1.5, fade: 0.06 });
    else if (kind === 'throw') this.anim.once('Punch', { timeScale: 1.2, fade: 0.08 });
    else if (kind === 'pulse') this.anim.once('Jump', { timeScale: 1.6, fade: 0.08 });
    this.faceOverride = 0.6;
  }

  // ------------------------------------------------ paso fijo: movimiento
  fixedUpdate(h) {
    this.prevPos.copy(this.currPos);
    const game = this.game;
    const g = game.physics.gravity;
    const input = game.input;
    const canMove = this.canAct() && game.state === 'playing';
    const axis = canMove ? input.axis() : { x: 0, y: 0, magnitude: 0 };
    const rig = game.cameraRig;
    rig.forward(_fwd);
    rig.right(_right);
    const wish = _v.set(0, 0, 0).addScaledVector(_fwd, axis.y).addScaledVector(_right, axis.x);
    if (wish.lengthSq() > 1) wish.normalize();

    const aiming = canMove && game.weapons?.aiming;
    const firing = game.weapons?.recentlyFired;
    this.running = canMove && input.down('run') && axis.magnitude > 0.2 && this.stamina > 1 && !aiming && axis.y > -0.2;
    let speed = axis.magnitude * (this.running ? PLAYER.runSpeed : PLAYER.walkSpeed);
    if (aiming) speed *= PLAYER.aimSpeedFactor;
    if (firing && !this.running) speed *= 0.85;
    if (this.anim.busy && !this.dead && this.grounded) speed *= 0.55;

    const accel = this.grounded ? PLAYER.acceleration : PLAYER.acceleration * PLAYER.airControl;
    const k = Math.min(1, accel * h);
    this.hVel.x += (wish.x * speed - this.hVel.x) * k;
    this.hVel.z += (wish.z * speed - this.hVel.z) * k;
    this.extVel.multiplyScalar(Math.max(0, 1 - h * (this.grounded ? 6 : 1.5)));

    this.jumpBuffer -= h;
    this.coyote -= h;
    if (canMove && this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      this.vy = PLAYER.jumpSpeed;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
      this.anim.once('Jump', { timeScale: 1.15, fade: 0.1 });
      game.audio.play('jump');
    }
    this.vy = Math.max(this.vy - g * h, -45);

    const desired = {
      x: (this.hVel.x + this.extVel.x) * h,
      y: this.vy * h,
      z: (this.hVel.z + this.extVel.z) * h,
    };
    this.controller.computeColliderMovement(this.collider, desired, game.physics.R.QueryFilterFlags.EXCLUDE_SENSORS, COLLISION.playerQuery);
    const mv = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(next);
    this.currPos.set(next.x, next.y, next.z);
    this.velocity.set(mv.x / h, mv.y / h, mv.z / h);

    if (this.grounded) {
      if (!wasGrounded && this.airTime > 0.1 && this.anim.current === this.anim.actions.Jump) this.anim.release();
      if (!wasGrounded && this.airTime > 0.35) {
        game.audio.play('land');
        if (this.vy < -12) game.fx.burst('dust', this.feetPosition.clone());
      }
      if (this.vy < 0) this.vy = -1.5;
      this.coyote = 0.12;
      this.airTime = 0;
    } else {
      this.airTime += h;
      if (this.vy > 0 && mv.y < desired.y * 0.5) this.vy = 0;
    }

    // estamina y escudo
    if (this.running && Math.hypot(this.velocity.x, this.velocity.z) > 1) {
      this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * h);
    } else {
      this.stamina = Math.min(PLAYER.maxStamina, this.stamina + PLAYER.staminaRegen * h);
    }
    if (!this.dead) {
      this.shieldDelay -= h;
      if (this.shieldDelay <= 0 && this.shield < this.maxShield) {
        if (this.shield === 0) game.audio.play('shieldRecharge');
        this.shield = Math.min(this.maxShield, this.shield + PLAYER.shieldRegen * h);
      }
    }

    if (this.currPos.y < PLAYER.fallLimitY && !this.dead) game.level?.onPlayerFell();
  }

  // ------------------------------------------------ cuadro: animación y visual
  update(dt, alpha = 1) {
    const game = this.game;
    const input = game.input;
    const playing = game.state === 'playing';
    if (this.canAct() && playing && input.pressed('jump')) this.jumpBuffer = 0.15;
    this.faceOverride -= dt;
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);

    const weapons = game.weapons;
    const combat = playing && this.canAct() && weapons && (weapons.aiming || weapons.recentlyFired || weapons.charging || weapons.reloading);

    // orientación
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    let target = this.facing;
    if (combat || this.faceOverride > 0) target = game.cameraRig.yaw + Math.PI;
    else if (hs > 0.4 && !this.dead) target = Math.atan2(this.velocity.x, this.velocity.z);
    let d = target - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, dt * (combat ? 20 : 11));

    this.object3d.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.object3d.position.y -= this.centerOffset;
    this.object3d.rotation.y = this.facing;

    // animación de locomoción (con marcha atrás al retroceder apuntando)
    if (!this.dead && !this.celebrating) {
      const fwdX = Math.sin(this.facing);
      const fwdZ = Math.cos(this.facing);
      const along = hs > 0.01 ? (this.velocity.x * fwdX + this.velocity.z * fwdZ) / hs : 1;
      if (!this.grounded && this.airTime > 0.25) {
        if (!this.anim.busy && this.anim.current !== this.anim.actions.Jump) this.anim.once('Jump', { timeScale: 0.6, fade: 0.2 });
      } else if (hs < 0.35) {
        this.anim.loop('Idle', 1);
      } else if (hs < 4.8) {
        const ts = THREE.MathUtils.clamp(hs / 3.1, 0.6, 1.5) * (along < -0.35 ? -1 : 1);
        this.anim.loop('Walking', ts);
      } else {
        this.anim.loop('Running', THREE.MathUtils.clamp(hs / 6.6, 0.8, 1.35));
      }
      if (this.grounded && hs > 0.5) {
        this.stepPhase += dt * hs * (this.running ? 0.36 : 0.55);
        if (this.stepPhase > 1) {
          this.stepPhase = 0;
          game.audio.play('step');
        }
      }
    }
    this.anim.update(dt);

    // brazo que apunta y arma en la mano
    this.object3d.updateMatrixWorld(true);
    const wantAim = this.dead ? 0 : combat ? 1 : 0.55;
    this.aimWeight += (wantAim - this.aimWeight) * Math.min(1, dt * 14);
    if (weapons?.reloading) this.aimWeight = Math.min(this.aimWeight, 0.35);
    const sh = this.arm.shoulderPosition(_sh);
    if (combat && weapons.aimPoint) {
      _aim.copy(weapons.aimPoint).sub(sh).normalize();
    } else {
      _aim.set(Math.sin(this.facing), -0.55, Math.cos(this.facing)).normalize();
    }
    if (this.arm.valid && !this.anim.busy) this.arm.apply(_aim, this.aimWeight);
    this.model.updateMatrixWorld(true);
    const hand = this.arm.handPosition(_v);
    const wdir = this.aimWeight > 0.6 && !this.anim.busy ? _aim : this.arm.forearmDirection(new THREE.Vector3());
    this.weaponView.place(hand, wdir, 1);
    this.weaponView.setVisible(!this.dead || this.anim.current !== this.anim.actions.Death);

    // expresiones y brillo del escudo
    this.surprise = Math.max(0, this.surprise - dt * 2.5);
    for (const m of this.faceMeshes) {
      const inf = m.morphTargetInfluences;
      const dict = m.morphTargetDictionary;
      if (dict.Surprised !== undefined) inf[dict.Surprised] = this.surprise;
      if (dict.Sad !== undefined) inf[dict.Sad] = this.sad;
      if (dict.Angry !== undefined) inf[dict.Angry] = combat ? 0.6 : 0;
    }
    const shieldK = this.shield / this.maxShield;
    for (const m of this.glowMats) {
      m.emissive.setHex(this.shieldFlash > 0.1 ? 0xffffff : shieldK > 0.01 ? 0x2fe6ff : 0xff3a2a);
      const base = m.userData.baseGlow ?? 1;
      m.emissiveIntensity = base * (1 + this.shieldFlash * 2 + (shieldK <= 0.01 ? Math.sin(game.time * 12) * 0.6 + 0.6 : 0));
    }
  }

  dispose() {
    this.game.physics.world?.removeCharacterController(this.controller);
    this.weaponView.dispose();
    super.dispose();
  }
}
