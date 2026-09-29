/**
 * Rig — utilidades para personajes basados en RobotExpressive.glb:
 *
 *  - AnimationController: fundidos cruzados, acciones únicas y fase sincronizada.
 *  - ArmAim: orienta el brazo derecho hacia un punto (apuntar un arma) después
 *    de que el AnimationMixer haya posado el esqueleto.
 *  - dressRobot: clona el modelo, lo recolorea y le coloca armadura (props.glb).
 *  - HeldWeapon: arma que sigue a la mano y apunta con precisión al objetivo.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

// ================================================================= animaciones
export class AnimationController {
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    for (const clip of clips) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.current = null;
    this.lock = null;
    this.callbacks = new Map();
    this.mixer.addEventListener('finished', (e) => {
      const cb = this.callbacks.get(e.action);
      if (this.lock === e.action) this.lock = null;
      if (cb) {
        this.callbacks.delete(e.action);
        cb();
      }
    });
  }

  #transition(action, fade) {
    if (this.current === action) return;
    const prev = this.current;
    action.enabled = true;
    action.reset();
    action.setEffectiveWeight(1);
    if (prev) {
      if (prev.loop === THREE.LoopRepeat && action.loop === THREE.LoopRepeat) {
        action.time = (prev.time / prev.getClip().duration) * action.getClip().duration;
      }
      prev.fadeOut(fade);
    }
    action.fadeIn(fade).play();
    this.current = action;
  }

  loop(name, timeScale = 1, fade = 0.22) {
    const action = this.actions[name];
    if (!action) return;
    action.setEffectiveTimeScale(timeScale);
    if (this.lock) return;
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    this.#transition(action, fade);
  }

  once(name, { timeScale = 1, fade = 0.12, onDone } = {}) {
    const action = this.actions[name];
    if (!action) return;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveTimeScale(timeScale);
    if (this.current === action) this.current = null;
    this.#transition(action, fade);
    this.lock = action;
    if (onDone) this.callbacks.set(action, onDone);
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

// ================================================================= brazo que apunta
export class ArmAim {
  constructor(model, side = 'R') {
    this.upper = model.getObjectByName(`UpperArm${side}`);
    this.lower = model.getObjectByName(`LowerArm${side}`);
    this.hand = model.getObjectByName(`Palm2${side}`) || this.lower;
    this.valid = !!(this.upper && this.lower);
    if (!this.valid) return;
    this.upperAxis = this.lower.position.clone().normalize();
    this.lowerAxis = this.hand.position.clone().normalize();
    this.weight = 0;
  }

  #aimBone(bone, axis, dirWorld, weight) {
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(_q).invert();
    const local = _v.copy(dirWorld).applyQuaternion(_q).normalize();
    _q2.setFromUnitVectors(axis, local);
    bone.quaternion.slerp(_q2, weight);
  }

  /** Llamar después de mixer.update(). */
  apply(dirWorld, weight) {
    if (!this.valid || weight <= 0.001) return;
    this.#aimBone(this.upper, this.upperAxis, dirWorld, weight);
    this.#aimBone(this.lower, this.lowerAxis, dirWorld, weight);
  }

  handPosition(out = new THREE.Vector3()) {
    this.hand.updateWorldMatrix(true, false);
    return this.hand.getWorldPosition(out);
  }

  shoulderPosition(out = new THREE.Vector3()) {
    this.upper.updateWorldMatrix(true, false);
    return this.upper.getWorldPosition(out);
  }

  forearmDirection(out = new THREE.Vector3()) {
    const a = this.lower.getWorldPosition(_v2);
    return this.hand.getWorldPosition(out).sub(a).normalize();
  }
}

// ================================================================= arma en la mano
export class HeldWeapon {
  constructor(parent) {
    this.root = new THREE.Group();
    this.root.name = 'HeldWeapon';
    parent.add(this.root);
    this.model = null;
    this.muzzle = null;
    this.id = null;
  }

  set(id, model) {
    if (this.model) this.root.remove(this.model);
    this.id = id;
    this.model = model;
    if (!model) return;
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    this.root.add(model);
    this.muzzle = model.getObjectByName('Muzzle') || model;
  }

  /** Coloca el arma en la mano y la orienta hacia dir (mundo). */
  place(handPos, dir, scale = 1) {
    this.root.position.copy(handPos);
    _m.lookAt(_v.set(0, 0, 0), _v2.copy(dir).negate(), UP);
    this.root.quaternion.setFromRotationMatrix(_m);
    this.root.scale.setScalar(scale);
    // desplazar para que la empuñadura quede en la mano
    this.root.position.addScaledVector(dir, -0.05 * scale);
  }

  muzzlePosition(out = new THREE.Vector3()) {
    if (!this.muzzle) return out.copy(this.root.position);
    this.root.updateMatrixWorld(true);
    return this.muzzle.getWorldPosition(out);
  }

  setVisible(v) {
    this.root.visible = v;
  }

  dispose() {
    this.root.parent?.remove(this.root);
  }
}

// ================================================================= vestir al robot
/** Colocación de cada pieza en el espacio del modelo original (pose de reposo). */
const ARMOR_BONES = {
  ArmorVisor: { bone: 'Head', pos: [-0.03, 3.66, 0.0], rot: [0, 0, 0], scale: 2.55 },
  ArmorShoulderL: { bone: 'ShoulderL', pos: [0.64, 2.5, -0.02], rot: [0, 0, -0.35], scale: 1.15 },
  ArmorShoulderR: { bone: 'ShoulderR', pos: [-0.66, 2.5, -0.02], rot: [0, 0, 0.35], scale: 1.15 },
  ArmorChest: { bone: 'Torso_1', pos: [0, 2.12, 0.64], rot: [-0.1, 0, 0], scale: 1.2 },
  ArmorPack: { bone: 'Torso_1', pos: [0, 2.2, -0.78], rot: [0.1, 0, 0], scale: 1.25 },
};

/**
 * Clona RobotExpressive, lo escala a `height` metros, recolorea sus materiales
 * y le añade las piezas de armadura de props.glb enganchadas a los huesos.
 */
export function dressRobot(assets, { height = 1.8, palette, armor = true } = {}) {
  const src = assets.robot;
  const model = cloneSkinned(src.scene);
  const box = new THREE.Box3().setFromObject(src.scene);
  const scale = height / (box.max.y - box.min.y);
  const faces = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.material = o.material.clone();
    const p = palette?.[o.material.name];
    if (p) {
      o.material.color.set(p.color);
      if (p.metalness !== undefined) o.material.metalness = p.metalness;
      if (p.roughness !== undefined) o.material.roughness = p.roughness;
      if (p.emissive !== undefined) {
        o.material.emissive.set(p.emissive);
        o.material.emissiveIntensity = p.emissiveIntensity ?? 1;
      }
    }
    if (o.morphTargetDictionary) faces.push(o);
  });
  if (armor && assets.props.ArmorSet) {
    const set = assets.props.ArmorSet;
    const armorMats = palette?.armor || {};
    model.updateMatrixWorld(true); // aún con escala 1: espacio del modelo original
    const desired = new THREE.Matrix4();
    const inv = new THREE.Matrix4();
    for (const [name, cfg] of Object.entries(ARMOR_BONES)) {
      const srcPiece = set.getObjectByName(name);
      const bone = model.getObjectByName(cfg.bone);
      if (!srcPiece || !bone) continue;
      const piece = srcPiece.clone(true);
      piece.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        const repl = armorMats[o.material.name];
        o.material = repl || o.material.clone();
      });
      desired.compose(
        new THREE.Vector3(...cfg.pos),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...cfg.rot)),
        new THREE.Vector3(cfg.scale, cfg.scale, cfg.scale)
      );
      inv.copy(bone.matrixWorld).invert();
      desired.premultiply(inv);
      desired.decompose(piece.position, piece.quaternion, piece.scale);
      bone.add(piece);
    }
  }
  model.scale.setScalar(scale);
  return { model, scale, faces };
}
