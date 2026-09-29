/**
 * Extraction — el malacate (castillete minero) donde termina la misión.
 *
 * Estructura estática de vigas + plataforma cinemática que sube con el
 * jugador al activar la palanca (tecla E). Solo se habilita cuando se
 * cumplieron los demás objetivos.
 */
import * as THREE from 'three';
import { Entity } from './Entity.js';
import { COLLISION } from '../config.js';
import { heightAt } from '../world/Terrain.js';
import { boxWithWorldUV } from '../core/AssetLibrary.js';

export class Extraction extends Entity {
  constructor(game, x, z) {
    super(game, 'extraction');
    this.state = 'locked'; // locked | ready | rising | done
    this.center = new THREE.Vector3(x, 0, z);
    this.riseTime = 0;
    this.platformY = 0;
    this.t = 0;
  }

  build() {
    const { game } = this;
    const R = game.physics.R;
    const { materials } = game.assets;
    const root = new THREE.Group();
    this.object3d = root;
    game.level.root.add(root);
    const { x, z } = this.center;
    let ground = -Infinity;
    for (const [dx, dz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5], [0, 0]]) ground = Math.max(ground, heightAt(x + dx, z + dz));
    this.center.y = ground;

    // --- losa de concreto/piedra bajo el castillete
    const slabH = 1.5;
    const slab = new THREE.Mesh(boxWithWorldUV(7, slabH, 7, 2), materials.wall);
    slab.position.set(x, ground + 0.15 - slabH / 2, z);
    slab.receiveShadow = true;
    root.add(slab);
    game.physics.createStatic(R.ColliderDesc.cuboid(3.5, slabH / 2, 3.5).setTranslation(x, ground + 0.15 - slabH / 2, z)
      .setCollisionGroups(COLLISION.world));
    const floorY = ground + 0.15;

    // --- castillete de madera (4 postes + travesaños + tornapuntas)
    const H = 13;
    const beam = (w, h, d, px, py, pz, rx = 0, rz = 0, collide = true) => {
      const m = new THREE.Mesh(boxWithWorldUV(w, h, d, 1.5), materials.wood);
      m.position.set(px, py, pz);
      m.rotation.set(rx, 0, rz);
      m.castShadow = true;
      m.receiveShadow = true;
      root.add(m);
      if (collide) {
        const q = new THREE.Quaternion().setFromEuler(m.rotation);
        game.physics.createStatic(R.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(px, py, pz)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(COLLISION.world));
      }
      return m;
    };
    const half = 2.3;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) beam(0.36, H, 0.36, x + sx * half, floorY + H / 2, z + sz * half);
    }
    for (let level = 1; level <= 4; level++) {
      const y = floorY + (level * H) / 4.2;
      beam(half * 2 + 0.36, 0.26, 0.26, x, y, z - half, 0, 0, false);
      beam(half * 2 + 0.36, 0.26, 0.26, x, y, z + half, 0, 0, false);
      beam(0.26, 0.26, half * 2 + 0.36, x - half, y, z, 0, 0, false);
      beam(0.26, 0.26, half * 2 + 0.36, x + half, y, z, 0, 0, false);
    }
    // tornapuntas inclinadas hacia el norte
    for (const sx of [-1, 1]) {
      const m = beam(0.3, H * 0.95, 0.3, x + sx * half, floorY + H * 0.45, z - half - 3.2, -0.5, 0, false);
      m.userData.decor = true;
    }
    // cabezal con poleas
    beam(half * 2 + 1.2, 0.5, half * 2 + 1.2, x, floorY + H + 0.25, z, 0, 0, false);
    this.wheels = [];
    for (const sx of [-0.9, 0.9]) {
      const wheel = new THREE.Group();
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.09, 8, 32), materials.rail);
      wheel.add(rim);
      for (let i = 0; i < 6; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.1, 0.06), materials.rail);
        spoke.rotation.z = (i / 6) * Math.PI;
        wheel.add(spoke);
      }
      wheel.position.set(x + sx, floorY + H + 1.5, z);
      wheel.rotation.y = Math.PI / 2;
      wheel.traverse((o) => { o.castShadow = true; });
      root.add(wheel);
      this.wheels.push(wheel);
    }
    // cables
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.6 });
    this.cables = [];
    for (const sx of [-0.9, 0.9]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), cableMat);
      c.position.set(x + sx, 0, z);
      root.add(c);
      this.cables.push(c);
    }

    // --- plataforma (jaula) cinemática
    const pw = 1.8;
    const ph = 0.2;
    this.platformBaseY = floorY + 0.05 + ph / 2;
    this.platformY = this.platformBaseY;
    const plat = new THREE.Group();
    const deck = new THREE.Mesh(boxWithWorldUV(pw * 2, ph, pw * 2, 1.5), materials.metal);
    deck.receiveShadow = true;
    deck.castShadow = true;
    plat.add(deck);
    // barandales de la jaula (solo visuales, parte trasera y laterales)
    const railMat = materials.rail;
    for (const [px, pz, w, d] of [[0, -pw, pw * 2, 0.06], [-pw, 0, 0.06, pw * 2], [pw, 0, 0.06, pw * 2]]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), railMat);
      r.position.set(px, 1.1, pz);
      plat.add(r);
      for (const k of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), railMat);
        post.position.set(px + (w > 0.1 ? k * pw : 0), 0.55, pz + (d > 0.1 ? k * pw : 0));
        plat.add(post);
      }
    }
    // palanca sobre la plataforma
    this.lever = game.assets.cloneProp('Lever', { cloneMaterials: true });
    this.lever.position.set(pw - 0.55, ph / 2, -pw + 0.55);
    this.lever.rotation.y = -Math.PI / 4;
    plat.add(this.lever);
    this.handle = this.lever.getObjectByName('Handle');
    this.leverMats = [];
    this.lever.traverse((o) => {
      if (o.isMesh && (o.material.name === 'GlowRed' || o.material.name === 'GlowAmber')) this.leverMats.push(o.material);
    });
    plat.position.set(x, this.platformY, z);
    root.add(plat);
    this.platform = plat;
    const { body } = game.physics.createBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, this.platformY, z),
      [
        R.ColliderDesc.cuboid(pw, ph / 2, pw).setFriction(1).setCollisionGroups(COLLISION.world),
        R.ColliderDesc.cuboid(0.35, 0.45, 0.25).setTranslation(pw - 0.55, ph / 2 + 0.45, -pw + 0.55).setCollisionGroups(COLLISION.world),
      ],
      this
    );
    this.body = body;

    // --- lámparas de estado + haz de luz vertical cuando está listo
    this.statusMat = new THREE.MeshStandardMaterial({ color: 0xff5040, emissive: 0xff2a1a, emissiveIntensity: 2.4 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), this.statusMat);
        lamp.position.set(x + sx * half, floorY + 3.2, z + sz * half + (sz > 0 ? 0.22 : -0.22));
        root.add(lamp);
      }
    }
    const beamGeo = new THREE.CylinderGeometry(1.2, 2.2, 60, 24, 1, true);
    beamGeo.translate(0, 30, 0);
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0x5dffb0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.position.set(x, floorY, z);
    this.beam.visible = false;
    root.add(this.beam);

    // letrero
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), materials.signHoist);
    sign.position.set(x, floorY + 4.3, z + half + 0.2);
    root.add(sign);
    this.leverWorld = new THREE.Vector3();
    return this;
  }

  get leverPosition() {
    return this.lever.getWorldPosition(this.leverWorld);
  }

  setReady() {
    if (this.state !== 'locked') return;
    this.state = 'ready';
    this.statusMat.color.setHex(0x5dffb0);
    this.statusMat.emissive.setHex(0x1fff7a);
    for (const m of this.leverMats) {
      m.color.setHex(0x5dffb0);
      m.emissive.setHex(0x1fff7a);
    }
    this.beam.visible = true;
  }

  canInteract(playerPos) {
    return (this.state === 'locked' || this.state === 'ready') && playerPos.distanceTo(this.leverPosition) < 2.3;
  }

  /** Devuelve true si se activó la extracción. */
  activate() {
    if (this.state !== 'ready') {
      this.game.audio.play('denied');
      return false;
    }
    this.state = 'rising';
    this.riseTime = 0;
    this.game.audio.play('lever');
    return true;
  }

  fixedUpdate(h) {
    if (this.state !== 'rising') return;
    this.riseTime += h;
    const t = Math.max(0, this.riseTime - 0.8);
    const lift = Math.min(14, t * t * 0.9);
    this.platformY = this.platformBaseY + lift;
    const c = this.center;
    this.body.setNextKinematicTranslation({ x: c.x, y: this.platformY, z: c.z });
    if (this.riseTime > 6.5 && this.state === 'rising') {
      this.state = 'done';
      this.game.mission.complete();
    }
  }

  update(dt) {
    this.t += dt;
    this.platform.position.y = this.platformY;
    if (this.handle) {
      const target = this.state === 'rising' || this.state === 'done' ? 0.6 : -0.6;
      this.handle.rotation.x += (target - this.handle.rotation.x) * Math.min(1, dt * 6);
    }
    for (const w of this.wheels) w.rotation.z += dt * (this.state === 'rising' ? 3 : 0);
    const top = this.center.y + 0.15 + 13 + 1.5;
    for (const c of this.cables) {
      const bottom = this.platformY + 1.2;
      const len = Math.max(0.1, top - bottom);
      c.scale.y = len;
      c.position.y = bottom + len / 2;
    }
    if (this.state === 'ready') {
      this.beamMat.opacity = 0.12 + Math.sin(this.t * 3) * 0.04;
    } else if (this.state === 'rising' || this.state === 'done') {
      this.beamMat.opacity = Math.max(0, this.beamMat.opacity - dt * 0.05);
    }
  }
}
