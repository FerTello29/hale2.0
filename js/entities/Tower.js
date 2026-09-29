/**
 * Tower — torre de interferencia: una estructura de bloques dinámicos apilados
 * con una antena (Beacon) en la cima. Se considera DERRIBADA cuando la antena
 * cae/se desplaza o cuando la mayoría de sus bloques pierden su posición.
 *
 * Mientras está en pie genera un campo de interferencia que descarga la
 * batería del jugador si entra en él (obliga a atacar a distancia).
 */
import * as THREE from 'three';
import { PhysicsEntity } from './Entity.js';
import { StoneBlock, Crate } from './Props.js';
import { COLLISION } from '../config.js';
import { heightAt } from '../world/Terrain.js';
import { boxWithWorldUV } from '../core/AssetLibrary.js';

export const INTERFERENCE_RADIUS = 7.5;

class Beacon extends PhysicsEntity {
  constructor(game, pos, tower) {
    super(game, 'beacon');
    const R = game.physics.R;
    this.tower = tower;
    this.object3d = game.assets.cloneProp('Beacon', { cloneMaterials: true });
    this.core = this.object3d.getObjectByName('BeaconCore');
    this.halo = this.object3d.getObjectByName('BeaconHalo');
    this.redMats = [];
    this.object3d.traverse((o) => {
      if (o.isMesh && o.material.name === 'GlowRed') this.redMats.push(o.material);
    });
    game.level.root.add(this.object3d);
    this.attachBody(
      R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setSleeping(true).setAngularDamping(0.2),
      R.ColliderDesc.cuboid(0.36, 0.62, 0.36).setDensity(14).setFriction(0.8).setCollisionGroups(COLLISION.prop)
    );
    this.spawnPos = this.currPos.clone();
    this.t = Math.random() * 5;
  }

  update(dt) {
    this.t += dt;
    if (this.core) this.core.rotation.y += dt * (this.tower.destroyed ? 0.2 : 2.2);
    if (this.halo && !this.tower.destroyed) {
      this.halo.scale.setScalar(1 + Math.sin(this.t * 4) * 0.12);
      for (const m of this.redMats) m.emissiveIntensity = 2.2 + Math.sin(this.t * 6) * 0.8;
    }
  }

  deactivate() {
    for (const m of this.redMats) {
      m.color.setHex(0x3a3a40);
      m.emissive.setHex(0x111111);
      m.emissiveIntensity = 0.2;
    }
  }

  hit(info) {
    // la antena es frágil: un orbe directo la desestabiliza con fuerza extra
    if (info.kind === 'orb' && info.dir) this.push(info.dir, 2.5);
  }
}

/** Campo de interferencia: cilindro translúcido animado por shader. */
function createField(radius, height) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 48, 1, true);
  geo.translate(0, height / 2, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uColor: { value: new THREE.Color(0xff3b2f) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uOpacity; uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float bands = smoothstep(0.35, 0.5, abs(fract(vUv.y * 6.0 - uTime * 0.6) - 0.5));
        float hex = smoothstep(0.42, 0.5, abs(fract(vUv.x * 48.0) - 0.5));
        float fade = (1.0 - vUv.y) * smoothstep(0.0, 0.08, vUv.y);
        float a = (0.05 + bands * 0.10 + hex * 0.05) * fade * uOpacity;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.25, radius, 64),
    new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  mesh.add(ring);
  return mesh;
}

export class Tower {
  constructor(game, { id, name, x, z, blueprint, rotY = 0 }) {
    this.game = game;
    this.id = id;
    this.name = name;
    this.blueprint = blueprint;
    this.rotY = rotY;
    this.destroyed = false;
    this.pieces = [];
    this.beacon = null;
    this.field = null;
    this.fieldOpacity = 1;
    this.center = new THREE.Vector3(x, 0, z);
  }

  build() {
    const { game } = this;
    const { x, z } = this.center;
    const R = game.physics.R;
    // cimiento estático nivelado (el terreno no es perfectamente plano)
    const foot = { jenga: [3.4, 3.4], pyramid: [5.6, 2.4], pillars: [4.6, 2.2] }[this.blueprint];
    let top = -Infinity;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) top = Math.max(top, heightAt(x + (i * foot[0]) / 2, z + (j * foot[1]) / 2));
    }
    top += 0.3;
    this.baseY = top;
    const plinthH = 1.6;
    const plinth = new THREE.Mesh(boxWithWorldUV(foot[0], plinthH, foot[1], 1.6), game.assets.materials.wall);
    plinth.position.set(x, top - plinthH / 2, z);
    plinth.rotation.y = this.rotY;
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    game.level.root.add(plinth);
    const q = { x: 0, y: Math.sin(this.rotY / 2), z: 0, w: Math.cos(this.rotY / 2) };
    game.physics.createStatic(
      R.ColliderDesc.cuboid(foot[0] / 2, plinthH / 2, foot[1] / 2)
        .setTranslation(x, top - plinthH / 2, z)
        .setRotation(q)
        .setFriction(0.9)
        .setCollisionGroups(COLLISION.world)
    );
    this.center.y = top;

    const local = (lx, ly, lz) => {
      const v = new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotY);
      return v.add(new THREE.Vector3(x, top, z));
    };
    let beaconY = 0;
    const eps = 0.002;
    if (this.blueprint === 'jenga') {
      const size = new THREE.Vector3(1.8, 0.4, 0.58);
      const layers = 7;
      for (let l = 0; l < layers; l++) {
        const y = size.y / 2 + l * (size.y + eps);
        for (let k = -1; k <= 1; k++) {
          const along = l % 2 === 0;
          const p = along ? local(0, y, k * 0.6) : local(k * 0.6, y, 0);
          this.#add(new StoneBlock(game, p, size, { rotY: this.rotY + (along ? 0 : Math.PI / 2), tower: this }));
        }
      }
      beaconY = layers * (size.y + eps) + 0.62;
    } else if (this.blueprint === 'pyramid') {
      const s = 1.0;
      const rows = [4, 3, 2, 1];
      rows.forEach((n, r) => {
        for (let i = 0; i < n; i++) {
          const lx = (i - (n - 1) / 2) * (s + 0.02);
          this.#add(new Crate(game, local(lx, s / 2 + r * (s + eps), 0), { size: s, rotY: this.rotY, sleeping: true, tower: this }));
        }
      });
      beaconY = rows.length * (s + eps) + 0.62;
    } else {
      // pilares con dintel
      const cube = new THREE.Vector3(0.8, 0.8, 0.8);
      const levels = 4;
      for (const sx of [-1.35, 1.35]) {
        for (let l = 0; l < levels; l++) {
          this.#add(new StoneBlock(game, local(sx, cube.y / 2 + l * (cube.y + eps), 0), cube, { rotY: this.rotY, tower: this }));
        }
      }
      const lintel = new THREE.Vector3(3.9, 0.4, 0.9);
      const ly = levels * (cube.y + eps) + lintel.y / 2;
      this.#add(new StoneBlock(game, local(0, ly, 0), lintel, { rotY: this.rotY, tower: this }));
      const small = new THREE.Vector3(0.7, 0.5, 0.7);
      this.#add(new StoneBlock(game, local(0, ly + lintel.y / 2 + small.y / 2 + eps, 0), small, { rotY: this.rotY, tower: this }));
      beaconY = ly + lintel.y / 2 + small.y + eps + 0.62;
    }
    this.beacon = new Beacon(game, local(0, beaconY + 0.01, 0), this);
    game.addEntity(this.beacon);
    this.beaconStart = this.beacon.currPos.clone();

    this.field = createField(INTERFERENCE_RADIUS, 7);
    this.field.position.set(x, top - 0.3, z);
    game.level.root.add(this.field);
    return this;
  }

  #add(entity) {
    this.pieces.push(entity);
    this.game.addEntity(entity);
  }

  /** ¿El jugador está dentro del campo? */
  affects(pos) {
    if (this.destroyed) return false;
    const dx = pos.x - this.center.x;
    const dz = pos.z - this.center.z;
    return dx * dx + dz * dz < INTERFERENCE_RADIUS * INTERFERENCE_RADIUS && pos.y < this.center.y + 7;
  }

  update(dt) {
    if (this.field) {
      this.field.material.uniforms.uTime.value += dt;
      if (this.destroyed) {
        this.fieldOpacity = Math.max(0, this.fieldOpacity - dt * 0.8);
        this.field.material.uniforms.uOpacity.value = this.fieldOpacity;
        this.field.children[0].material.opacity = 0.55 * this.fieldOpacity;
        if (this.fieldOpacity <= 0) {
          this.field.visible = false;
        }
      }
    }
    if (this.destroyed) return;
    const b = this.beacon;
    const drop = this.beaconStart.y - b.currPos.y;
    const shift = Math.hypot(b.currPos.x - this.beaconStart.x, b.currPos.z - this.beaconStart.z);
    let displaced = 0;
    for (const p of this.pieces) {
      if (!p.alive || p.currPos.distanceTo(p.spawnPos) > 1.0) displaced++;
    }
    const ratio = displaced / this.pieces.length;
    if (!b.alive || drop > 1.3 || shift > 1.8 || ratio > 0.55) this.#collapse();
  }

  #collapse() {
    this.destroyed = true;
    this.beacon.deactivate();
    const p = this.beacon.currPos.clone();
    this.game.fx.burst('towerDown', p);
    this.game.fx.shockwave(new THREE.Vector3(this.center.x, this.center.y + 0.2, this.center.z), INTERFERENCE_RADIUS + 2, 0xff5040);
    this.game.audio.play('towerDown', p);
    this.game.mission?.towerDestroyed(this);
  }
}
