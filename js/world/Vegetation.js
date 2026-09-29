/**
 * Vegetation — flora alienígena instanciada (pocas llamadas de dibujo):
 * árboles farol con vainas luminosas, hongos gigantes, helechos, hierba y
 * flores bioluminiscentes. Los troncos y tallos llevan colliders estáticos.
 * El viento se simula en el vertex shader.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, normalAt } from './TerrainField.js';
import { COLLISION } from '../config.js';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const windUniform = { value: 0 };

/** Agrega balanceo por viento a un material (instanciado o no). */
function addWind(material, strength = 0.15, heightScale = 1) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        float hw = max(0.0, position.y) * ${heightScale.toFixed(3)};
        float ph = uWind * 1.3 + ip.x * 0.21 + ip.z * 0.17;
        transformed.x += sin(ph) * ${strength.toFixed(3)} * hw * hw;
        transformed.z += cos(ph * 0.8) * ${(strength * 0.7).toFixed(3)} * hw * hw;`
      );
  };
  material.customProgramCacheKey = () => `wind-${strength}-${heightScale}`;
  return material;
}

function crossedQuads(w, h) {
  const a = new THREE.PlaneGeometry(w, h);
  a.translate(0, h / 2, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const c = a.clone();
  c.rotateY(Math.PI / 4);
  return mergeGeometries([a, b, c]);
}

function treeGeometries() {
  // tronco curvado
  const trunk = new THREE.CylinderGeometry(0.28, 0.55, 8, 8, 6);
  trunk.translate(0, 4, 0);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + Math.sin(y * 0.35) * 0.4);
    p.setZ(i, p.getZ(i) + Math.cos(y * 0.28) * 0.25);
  }
  trunk.computeVertexNormals();
  // raíces
  const roots = [];
  for (let k = 0; k < 4; k++) {
    const r = new THREE.CylinderGeometry(0.08, 0.28, 2.2, 6);
    r.translate(0, 1.1, 0);
    r.rotateZ(0.9);
    r.rotateY((k / 4) * Math.PI * 2 + 0.4);
    r.translate(Math.cos((k / 4) * Math.PI * 2 + 0.4) * 0.2, -0.4, -Math.sin((k / 4) * Math.PI * 2 + 0.4) * 0.2);
    roots.push(r);
  }
  const trunkAll = mergeGeometries([trunk.toNonIndexed(), ...roots.map((r) => r.toNonIndexed())]);
  // copa: hojas largas colgantes
  const blades = [];
  for (let k = 0; k < 9; k++) {
    const blade = new THREE.SphereGeometry(1, 8, 6);
    blade.scale(0.55, 0.12, 2.6);
    blade.translate(0, 0, 2.2);
    blade.rotateX(0.35 + (k % 3) * 0.12);
    blade.rotateY((k / 9) * Math.PI * 2);
    blade.translate(Math.sin(8 * 0.35) * 0.4, 8.1, Math.cos(8 * 0.28) * 0.25);
    blades.push(blade.toNonIndexed());
  }
  const canopy = mergeGeometries(blades);
  // vainas luminosas
  const pods = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const pod = new THREE.SphereGeometry(0.16 + (k % 3) * 0.05, 8, 6);
    pod.scale(1, 1.5, 1);
    pod.translate(Math.cos(a) * (1.6 + (k % 2)), 6.9 - (k % 3) * 0.5, Math.sin(a) * (1.6 + (k % 2)));
    pods.push(pod.toNonIndexed());
  }
  const podGeo = mergeGeometries(pods);
  return { trunk: trunkAll, canopy, pods: podGeo };
}

function mushroomGeometries() {
  const stalk = new THREE.CylinderGeometry(0.22, 0.4, 3.2, 8, 3);
  stalk.translate(0, 1.6, 0);
  const cap = new THREE.SphereGeometry(1.6, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45);
  cap.scale(1, 0.55, 1);
  cap.translate(0, 3.0, 0);
  const under = new THREE.CircleGeometry(1.55, 16);
  under.rotateX(Math.PI / 2);
  under.translate(0, 3.02, 0);
  return { stalk, cap, under };
}

export class Vegetation {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.meshes = [];
    this.geometries = [];
    this.materials = [];
    this.occupied = [];
  }

  /** Marca zonas donde no debe crecer nada (caminos, estructuras). */
  block(x, z, r) {
    this.occupied.push({ x, z, r });
  }

  #free(x, z, r) {
    for (const o of this.occupied) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false;
    return true;
  }

  #scatter(count, { seed, area, minY = -1.5, maxY = 30, slope = 0.8, radius = 1, predicate }) {
    const rand = rng(seed);
    const out = [];
    const n = new THREE.Vector3();
    for (let i = 0; i < count * 8 && out.length < count; i++) {
      const x = area.minX + rand() * (area.maxX - area.minX);
      const z = area.minZ + rand() * (area.maxZ - area.minZ);
      if (predicate && !predicate(x, z)) continue;
      const y = heightAt(x, z);
      if (y < minY || y > maxY) continue;
      normalAt(x, z, n);
      if (n.y < slope) continue;
      if (!this.#free(x, z, radius)) continue;
      out.push({ x, y, z, r: rand(), s: rand() });
      if (radius > 1.2) this.occupied.push({ x, z, r: radius * 0.8 });
    }
    return out;
  }

  #instanced(geo, material, list, fn, { shadow = true, receive = true } = {}) {
    const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    list.forEach((it, i) => {
      const { scale, rotY = it.r * Math.PI * 2, tilt = 0, y = it.y } = fn(it);
      e.set(tilt * (it.s - 0.5), rotY, tilt * (it.r - 0.5));
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(it.x, y, it.z), q, new THREE.Vector3(scale, scale, scale));
      mesh.setMatrixAt(i, m);
    });
    mesh.count = list.length;
    mesh.castShadow = shadow;
    mesh.receiveShadow = receive;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.meshes.push(mesh);
    this.geometries.push(geo);
    return mesh;
  }

  /**
   * Siembra el nivel.
   * @param {object} cfg { area, trees, mushrooms, ferns, grass, flowers, seed, predicate, podColor }
   */
  build(cfg) {
    const { assets, physics } = this.game;
    const R = physics.R;
    const area = cfg.area;
    const seed = cfg.seed ?? 7;
    const podColor = new THREE.Color(cfg.podColor ?? 0x45f5ff);

    // --- árboles farol
    const trees = this.#scatter(cfg.trees ?? 0, { seed, area, slope: 0.78, radius: 2.4, predicate: cfg.predicate, maxY: cfg.maxY ?? 30 });
    if (trees.length) {
      const g = treeGeometries();
      const canopyMat = addWind(new THREE.MeshStandardMaterial({ color: 0x173a33, roughness: 0.75, emissive: 0x06261e, emissiveIntensity: 0.8, side: THREE.DoubleSide }), 0.09, 0.12);
      const podMat = new THREE.MeshStandardMaterial({ color: podColor, emissive: podColor, emissiveIntensity: 1.5, roughness: 0.3 });
      this.materials.push(canopyMat, podMat);
      const scaleOf = (t) => 0.8 + t.s * 0.7;
      this.#instanced(g.trunk, assets.materials.bark, trees, (t) => ({ scale: scaleOf(t), tilt: 0.12 }));
      this.#instanced(g.canopy, canopyMat, trees, (t) => ({ scale: scaleOf(t), tilt: 0.12 }));
      this.#instanced(g.pods, podMat, trees, (t) => ({ scale: scaleOf(t), tilt: 0.12 }), { shadow: false });
      for (const t of trees) {
        const s = scaleOf(t);
        physics.createStatic(R.ColliderDesc.cylinder(2.5 * s, 0.5 * s).setTranslation(t.x, t.y + 2.5 * s, t.z).setCollisionGroups(COLLISION.world));
      }
    }

    // --- hongos gigantes
    const shrooms = this.#scatter(cfg.mushrooms ?? 0, { seed: seed + 11, area, slope: 0.8, radius: 2.0, predicate: cfg.predicate, maxY: cfg.maxY ?? 30 });
    if (shrooms.length) {
      const g = mushroomGeometries();
      const capColor = new THREE.Color(cfg.capColor ?? 0x6a2c8f);
      const capMat = new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.55, emissive: capColor, emissiveIntensity: 0.12 });
      const underMat = new THREE.MeshStandardMaterial({ color: 0x8a4a80, emissive: cfg.gillColor ?? 0xff4fd8, emissiveIntensity: 0.75, side: THREE.DoubleSide });
      const stalkMat = new THREE.MeshStandardMaterial({ color: 0xcfc6d8, roughness: 0.7 });
      this.materials.push(capMat, underMat, stalkMat);
      const scaleOf = (t) => 0.7 + t.s * 1.1;
      this.#instanced(g.stalk, stalkMat, shrooms, (t) => ({ scale: scaleOf(t), tilt: 0.25 }));
      this.#instanced(g.cap, capMat, shrooms, (t) => ({ scale: scaleOf(t), tilt: 0.25 }));
      this.#instanced(g.under, underMat, shrooms, (t) => ({ scale: scaleOf(t), tilt: 0.25 }), { shadow: false });
      for (const t of shrooms) {
        const s = scaleOf(t);
        physics.createStatic(R.ColliderDesc.cylinder(1.6 * s, 0.35 * s).setTranslation(t.x, t.y + 1.6 * s, t.z).setCollisionGroups(COLLISION.world));
      }
    }

    // --- helechos
    const ferns = this.#scatter(cfg.ferns ?? 0, { seed: seed + 23, area, slope: 0.72, radius: 0.6, predicate: cfg.predicate, maxY: cfg.maxY ?? 30 });
    if (ferns.length) {
      const geo = crossedQuads(2.2, 2.0);
      const mat = addWind(assets.materials.fern.clone(), 0.12, 0.6);
      this.materials.push(mat);
      this.#instanced(geo, mat, ferns, (t) => ({ scale: 0.7 + t.s * 0.9, tilt: 0.2 }), { shadow: false });
    }

    // --- hierba
    const grass = this.#scatter(cfg.grass ?? 0, { seed: seed + 37, area, slope: 0.75, radius: 0.35, predicate: cfg.predicate, maxY: cfg.maxY ?? 30 });
    if (grass.length) {
      const geo = crossedQuads(1.2, 0.8);
      const mat = addWind(assets.materials.grass.clone(), 0.18, 1.2);
      this.materials.push(mat);
      this.#instanced(geo, mat, grass, (t) => ({ scale: 0.6 + t.s * 0.8 }), { shadow: false });
    }

    // --- flores bioluminiscentes (puntos)
    const flowers = this.#scatter(cfg.flowers ?? 0, { seed: seed + 51, area, slope: 0.7, radius: 0.2, predicate: cfg.predicate, maxY: cfg.maxY ?? 30 });
    if (flowers.length) {
      const pos = new Float32Array(flowers.length * 3);
      const col = new Float32Array(flowers.length * 3);
      const c1 = new THREE.Color(cfg.flowerA ?? 0x55ffe0);
      const c2 = new THREE.Color(cfg.flowerB ?? 0xff5ad8);
      flowers.forEach((f, i) => {
        pos.set([f.x, f.y + 0.25 + f.s * 0.4, f.z], i * 3);
        const c = f.r < 0.6 ? c1 : c2;
        col.set([c.r, c.g, c.b], i * 3);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({
        size: 0.35,
        vertexColors: true,
        map: this.game.fx.createGlowSprite(0xffffff, 1).material.map,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(mat);
      const pts = new THREE.Points(geo, mat);
      this.root.add(pts);
      this.meshes.push(pts);
      this.geometries.push(geo);
    }
    return this;
  }

  static update(dt) {
    windUniform.value += dt;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
