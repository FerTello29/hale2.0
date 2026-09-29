/**
 * Player — CHISPA, el robot minero controlado por el jugador.
 *
 * - Modelo GLB (RobotExpressive, CC0) cargado con GLTFLoader y clonado con
 *   SkeletonUtils para poder reiniciar la partida.
 * - AnimationMixer con Idle, Walking, Running, Jump, Punch, Death, Dance y Wave.
 * - Cápsula cinemática de Rapier movida con KinematicCharacterController
 *   (pendientes, escalones, empuje de objetos dinámicos, gravedad propia).
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Entity } from './Entity.js';
import { COLLISION, PLAYER } from '../config.js';

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

/** Controlador de animaciones con fundidos cruzados. */
export class AnimationController {
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    for (const clip of clips) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.current = null;
    this.lock = null;
    this.lockCallbacks = new Map();
    this.mixer.addEventListener('finished', (e) => {
      const cb = this.lockCallbacks.get(e.action);
      if (this.lock === e.action) this.lock = null;
      if (cb) {
        this.lockCallbacks.delete(e.action);
        cb();
      }
    });
  }

  has(name) {
    return !!this.actions[name];
  }

  #transition(action, fade) {
    if (this.current === action) return;
    const prev = this.current;
    action.enabled = true;
    action.reset();
    action.setEffectiveWeight(1);
    if (prev) {
      // sincronizar fase entre ciclos de caminar/correr
      if (prev.loop === THREE.LoopRepeat && action.loop === THREE.LoopRepeat) {
        action.time = (prev.time / prev.getClip().duration) * action.getClip().duration;
      }
      prev.fadeOut(fade);
    }
    action.fadeIn(fade).play();
    this.current = action;
  }

  /** Animación en bucle de locomoción (ignorada mientras haya una acción única activa). */
  loop(name, timeScale = 1, fade = 0.22) {
    const action = this.actions[name];
    if (!action) return;
    action.setEffectiveTimeScale(timeScale);
    if (this.lock) return;
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    this.#transition(action, fade);
  }

  /** Acción única (golpe, salto, muerte…). */
  once(name, { timeScale = 1, fade = 0.12, hold = false, onDone } = {}) {
    const action = this.actions[name];
    if (!action) return;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveTimeScale(timeScale);
    if (this.current === action) this.current = null; // permitir repetir
    this.#transition(action, fade);
    this.lock = action;
    if (onDone) this.lockCallbacks.set(action, onDone);
    this.holding = hold;
  }

  release() {
    this.lock = null;
  }

  get busy() {
    return !!this.lock;
  }

  update(dt) {
    this.mixer.update(dt);
  }
}

export class Player extends Entity {
  constructor(game, spawn) {
    super(game, 'player');
    const R = game.physics.R;
    const src = game.assets.robot;

    // ------------------------------------------------ visual
    this.model = cloneSkinned(src.scene);
    const box = new THREE.Box3().setFromObject(src.scene);
    const scale = PLAYER.modelHeight / (box.max.y - box.min.y);
    this.model.scale.setScalar(scale);
    this.faceMeshes = [];
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.material = o.material.clone();
      if (o.material.name === 'Main') {
        o.material.color.set(0xd58a3c); // cobre pulido
        o.material.metalness = 0.55;
        o.material.roughness = 0.38;
      } else if (o.material.name === 'Grey') {
        o.material.color.set(0xb8c2cc);
        o.material.metalness = 0.6;
        o.material.roughness = 0.35;
      }
      if (o.morphTargetDictionary) this.faceMeshes.push(o);
    });
    this.object3d = new THREE.Group();
    this.object3d.name = 'CHISPA';
    this.object3d.add(this.model);
    game.level.root.add(this.object3d);

    // luz de "linterna" pegada al pecho (ayuda a leer al personaje en la tormenta)
    this.handBone = this.model.getObjectByName('LowerArmR') || this.model;
    this.chargeGlow = game.fx.createGlowSprite(0x7fe8ff, 0.01);
    this.chargeGlow.visible = false;
    game.level.root.add(this.chargeGlow);

    this.anim = new AnimationController(this.model, src.animations);
    this.anim.loop('Idle', 1, 0);

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
    cc.enableAutostep(0.42, 0.22, false);
    cc.enableSnapToGround(0.4);
    cc.setSlideEnabled(true);
    cc.setApplyImpulsesToDynamicBodies(true);
    cc.setCharacterMass(PLAYER.characterMass);
    this.controller = cc;

    this.prevPos = new THREE.Vector3(start.x, start.y, start.z);
    this.currPos = this.prevPos.clone();

    // ------------------------------------------------ estado
    this.maxBattery = PLAYER.maxBattery;
    this.maxEnergy = PLAYER.maxEnergy;
    this.battery = PLAYER.maxBattery;
    this.energy = PLAYER.maxEnergy;
    this.stamina = PLAYER.maxStamina;
    this.velocity = new THREE.Vector3(); // velocidad real (m/s)
    this.hVel = new THREE.Vector3(); // velocidad horizontal deseada
    this.vy = 0;
    this.grounded = false;
    this.airTime = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.facing = 0;
    this.faceOverride = 0; // tiempo durante el cual mira hacia la cámara
    this.running = false;
    this.invulnerable = 0;
    this.dead = false;
    this.controlEnabled = true;
    this.attached = null;
    this.attachOffset = new THREE.Vector3();
    this.surprise = 0;
    this.sad = 0;
    this.stepPhase = 0;
    this.idleTimer = 0;
  }

  // ------------------------------------------------ utilidades
  get feetPosition() {
    return _v.copy(this.currPos).setY(this.currPos.y - this.centerOffset);
  }

  chestPosition(out = new THREE.Vector3()) {
    return out.copy(this.currPos).setY(this.currPos.y + 0.35);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  canAct() {
    return !this.dead && this.controlEnabled && !this.attached;
  }

  teleport(pos) {
    const y = pos.y + this.centerOffset + 0.1;
    this.body.setTranslation({ x: pos.x, y, z: pos.z }, true);
    this.body.setNextKinematicTranslation({ x: pos.x, y, z: pos.z });
    this.currPos.set(pos.x, y, pos.z);
    this.prevPos.copy(this.currPos);
    this.vy = 0;
    this.hVel.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
  }

  // ------------------------------------------------ salud / energía
  damage(amount, source = 'unknown') {
    if (this.dead || this.invulnerable > 0 || this.attached) return;
    const mult = this.game.mission?.difficulty.damageMult ?? 1;
    const real = amount * (source === 'interference' ? 1 : mult);
    if (real <= 0) return;
    this.battery = Math.max(0, this.battery - real);
    if (source !== 'interference') {
      this.invulnerable = PLAYER.invulnerableTime;
      this.surprise = 1;
      this.game.bus.emit('player:damaged', { amount: real, source });
      this.game.audio.play('damage');
    }
    this.game.mission?.stats && (this.game.mission.stats.damageTaken += real);
    if (this.battery <= 0) this.die(source);
  }

  /** Recupera batería; devuelve el excedente (para convertirlo en puntos). */
  heal(amount) {
    const before = this.battery;
    this.battery = Math.min(this.maxBattery, this.battery + amount);
    return amount - (this.battery - before);
  }

  die(cause) {
    if (this.dead) return;
    this.dead = true;
    this.deathCause = cause;
    this.sad = 1;
    this.chargeGlow.visible = false;
    this.anim.once('Death', { hold: true, fade: 0.15 });
    this.game.mission?.fail('battery');
  }

  celebrate() {
    this.anim.release();
    this.anim.loop('Dance', 1, 0.3);
    this.celebrating = true;
  }

  wave() {
    if (!this.anim.busy) this.anim.once('Wave', { timeScale: 1.1 });
  }

  /** Acción de ataque: bloquea la animación de locomoción por un instante. */
  playAttack(kind) {
    if (kind === 'throw') this.anim.once('Punch', { timeScale: 1.7, fade: 0.08 });
    else if (kind === 'punch') this.anim.once('Punch', { timeScale: 1.35, fade: 0.08 });
    else if (kind === 'pulse') this.anim.once('Jump', { timeScale: 1.6, fade: 0.08 });
    this.faceOverride = 0.6;
  }

  attachTo(extraction) {
    this.attached = extraction;
    this.attachOffset.copy(this.currPos).sub(new THREE.Vector3(extraction.center.x, extraction.platformY, extraction.center.z));
    this.hVel.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.vy = 0;
  }

  // ------------------------------------------------ paso fijo: movimiento con KCC
  fixedUpdate(h) {
    this.prevPos.copy(this.currPos);
    if (this.attached) {
      const e = this.attached;
      const p = { x: e.center.x + this.attachOffset.x, y: e.platformY + this.attachOffset.y, z: e.center.z + this.attachOffset.z };
      this.body.setNextKinematicTranslation(p);
      this.currPos.set(p.x, p.y, p.z);
      return;
    }
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

    const aiming = canMove && (input.down('aim') || game.combat?.charging);
    this.running = canMove && input.down('run') && axis.magnitude > 0.2 && this.stamina > 1 && !aiming;
    let speed = axis.magnitude * (this.running ? PLAYER.runSpeed : PLAYER.walkSpeed);
    if (aiming) speed *= 0.6;
    if (this.anim.busy && !this.dead && this.grounded) speed *= 0.45;

    const accel = this.grounded ? PLAYER.acceleration : PLAYER.acceleration * PLAYER.airControl;
    const k = Math.min(1, accel * h);
    this.hVel.x += (wish.x * speed - this.hVel.x) * k;
    this.hVel.z += (wish.z * speed - this.hVel.z) * k;

    // salto con "coyote time" y búfer de entrada
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

    const desired = { x: this.hVel.x * h, y: this.vy * h, z: this.hVel.z * h };
    this.controller.computeColliderMovement(
      this.collider,
      desired,
      game.physics.R.QueryFilterFlags.EXCLUDE_SENSORS,
      COLLISION.playerQuery
    );
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
      if (this.vy > 0 && mv.y < desired.y * 0.5) this.vy = 0; // golpe en el techo
    }

    // estamina
    if (this.running && Math.hypot(this.velocity.x, this.velocity.z) > 1) {
      this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * h);
    } else {
      this.stamina = Math.min(PLAYER.maxStamina, this.stamina + PLAYER.staminaRegen * h);
    }
    if (!this.dead) this.energy = Math.min(this.maxEnergy, this.energy + PLAYER.energyRegen * h);

    // caída a la grieta
    if (this.currPos.y < PLAYER.fallLimitY && !this.dead) game.mission?.onPlayerFell();
  }

  // ------------------------------------------------ cuadro: animación y visual
  update(dt, alpha = 1) {
    const game = this.game;
    const input = game.input;
    if (this.canAct() && game.state === 'playing' && input.pressed('jump')) this.jumpBuffer = 0.15;
    this.invulnerable -= dt;
    this.faceOverride -= dt;

    // orientación del modelo
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    let target = this.facing;
    const aiming = this.canAct() && (input.down('aim') || game.combat?.charging);
    if (aiming || this.faceOverride > 0) {
      target = game.cameraRig.yaw + Math.PI;
    } else if (hs > 0.4 && !this.dead) {
      target = Math.atan2(this.velocity.x, this.velocity.z);
    }
    let d = target - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, dt * (aiming ? 18 : 11));

    // posición interpolada
    this.object3d.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.object3d.position.y -= this.centerOffset;
    this.object3d.rotation.y = this.facing;

    // selección de animación
    if (!this.dead && !this.celebrating) {
      if (!this.grounded && this.airTime > 0.25) {
        // en el aire (caída larga): mantener la pose de salto sin repetirla
        if (!this.anim.busy && this.anim.current !== this.anim.actions.Jump) {
          this.anim.once('Jump', { timeScale: 0.6, fade: 0.2 });
        }
      } else if (hs < 0.35) {
        this.idleTimer += dt;
        this.anim.loop('Idle', 1);
      } else if (hs < 4.6) {
        this.idleTimer = 0;
        this.anim.loop('Walking', THREE.MathUtils.clamp(hs / 3.0, 0.6, 1.5));
      } else {
        this.idleTimer = 0;
        this.anim.loop('Running', THREE.MathUtils.clamp(hs / 6.4, 0.8, 1.35));
      }
      // pasos
      if (this.grounded && hs > 0.5) {
        this.stepPhase += dt * hs * (this.running ? 0.36 : 0.55);
        if (this.stepPhase > 1) {
          this.stepPhase = 0;
          game.audio.play('step');
        }
      }
    }
    this.anim.update(dt);

    // expresiones faciales (morph targets del modelo)
    this.surprise = Math.max(0, this.surprise - dt * 2.5);
    for (const m of this.faceMeshes) {
      const inf = m.morphTargetInfluences;
      const dict = m.morphTargetDictionary;
      if (dict.Surprised !== undefined) inf[dict.Surprised] = this.surprise;
      if (dict.Sad !== undefined) inf[dict.Sad] = this.sad;
    }

    // brillo de carga en la mano
    const combat = game.combat;
    if (combat?.charging && this.canAct()) {
      this.chargeGlow.visible = true;
      this.handBone.getWorldPosition(this.chargeGlow.position);
      const s = 0.6 + combat.charge * 1.4;
      this.chargeGlow.scale.set(s, s, s);
    } else {
      this.chargeGlow.visible = false;
    }
  }

  dispose() {
    this.game.physics.world?.removeCharacterController(this.controller);
    this.chargeGlow.parent?.remove(this.chargeGlow);
    super.dispose();
  }
}
