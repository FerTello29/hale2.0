/**
 * Level — arma el escenario "Cerro Airoso": terreno, estructuras estáticas
 * (puentes, ruinas, mirador, vías, castillete), objetos dinámicos, torres,
 * drones, zonas de aparición y puntos de control.
 */
import * as THREE from 'three';
import { Terrain, heightAt, crevasseZ } from './Terrain.js';
import { Crate, SupplyCrate, Barrel, Boulder, MineCart } from '../entities/Props.js';
import { Tower } from '../entities/Tower.js';
import { Extraction } from '../entities/Extraction.js';
import { boxWithWorldUV } from '../core/AssetLibrary.js';
import { COLLISION } from '../config.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ground = (x, z) => V(x, heightAt(x, z), z);

export const SPAWN_POINT = { x: 0, z: 42 };

export class Level {
  constructor(game) {
    this.game = game;
    this.root = new THREE.Group();
    this.root.name = 'Level';
    this.towers = [];
    this.extraction = null;
    this.ownedGeometries = [];
    this.lanternLights = [];

    this.spawnZones = [
      { name: 'camp', minX: -20, maxX: 20, minZ: 30, maxZ: 46 },
      { name: 'patio', minX: -26, maxX: 24, minZ: -1, maxZ: 26 },
      { name: 'quarry', minX: -47, maxX: -27, minZ: 4, maxZ: 38 },
      { name: 'mesa', minX: 34, maxX: 48, minZ: -30, maxZ: 12 },
      { name: 'north', minX: -44, maxX: 28, minZ: -47, maxZ: -19 },
      { name: 'southeast', minX: 18, maxX: 30, minZ: 18, maxZ: 46 },
    ];
    this.coreZoneOrder = ['north', 'patio', 'quarry', 'mesa', 'north', 'camp', 'quarry', 'mesa', 'north', 'patio', 'southeast', 'north'];
    this.fallbackSpots = [
      { x: 0, z: 14 }, { x: -20, z: -30 }, { x: 44, z: -16 }, { x: -40, z: 32 }, { x: 8, z: -24 }, { x: -12, z: 40 },
    ];
    this.checkpoints = [
      { x: 0, z: 40, side: 1 },
      { x: 0, z: 14, side: 1 },
      { x: -32, z: -2, side: 1 },
      { x: -2, z: -2, side: 1 },
      { x: -30, z: 28, side: 1 },
      { x: -2, z: -19, side: -1 },
      { x: -32, z: -20, side: -1 },
      { x: 10, z: -32, side: -1 },
      { x: 40, z: 2, side: 0 },
    ];
    this.droneHomes = [];
  }

  zoneByName(name) {
    return this.spawnZones.find((z) => z.name === name) || this.spawnZones[0];
  }

  nearestCheckpoint(pos) {
    const side = Math.sign(pos.z - crevasseZ(pos.x)) || 1;
    let best = null;
    let bestD = Infinity;
    for (const c of this.checkpoints) {
      if (c.side !== 0 && c.side !== side) continue;
      const d = Math.hypot(c.x - pos.x, c.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return ground(best.x, best.z);
  }

  // ================================================================ build
  build(difficulty) {
    const { game } = this;
    game.scene.add(this.root);
    this.terrain = new Terrain(game);
    this.terrain.build(this.root);

    this.#buildCamp();
    this.#buildRails();
    this.#buildPatio();
    this.#buildQuarry();
    this.#buildMesa();
    this.#buildBridges();
    this.#buildNorth();
    this.#scatterRocks();

    // torres de interferencia
    const defs = [
      { id: 't1', name: 'Torre de la Cantera', x: -38, z: 19, blueprint: 'jenga', rotY: 0.3 },
      { id: 't2', name: 'Torre de la Meseta', x: 42, z: -4, blueprint: 'pyramid', rotY: Math.PI / 2 },
      { id: 't3', name: 'Torre del Norte', x: -26, z: -36, blueprint: 'pillars', rotY: -0.4 },
    ];
    this.towers = defs.map((d) => new Tower(game, d).build());
    const [t1, t2, t3] = this.towers;
    this.droneHomes = [
      { pos: V(-38, 0, 19), tower: t1 },
      { pos: V(42, 0, -4), tower: t2 },
      { pos: V(-26, 0, -36), tower: t3 },
      { pos: V(0, 0, 12), tower: null },
      { pos: V(6, 0, -30), tower: t3 },
      { pos: V(-30, 0, 34), tower: t1 },
    ];

    // extracción (malacate) en el norte
    this.extraction = new Extraction(game, 14, -42).build();
    game.addEntity(this.extraction);
    return this;
  }

  // ================================================================ helpers
  #own(geo) {
    this.ownedGeometries.push(geo);
    return geo;
  }

  /** Caja estática con textura a escala de mundo y collider opcional. */
  staticBox(center, size, material, { rotY = 0, rotX = 0, rotZ = 0, collide = true, tile = 2, cast = true } = {}) {
    const mesh = new THREE.Mesh(this.#own(boxWithWorldUV(size.x, size.y, size.z, tile)), material);
    mesh.position.copy(center);
    mesh.rotation.set(rotX, rotY, rotZ);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    if (collide) {
      const R = this.game.physics.R;
      const q = new THREE.Quaternion().setFromEuler(mesh.rotation);
      this.game.physics.createStatic(
        R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
          .setTranslation(center.x, center.y, center.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setFriction(0.8)
          .setCollisionGroups(COLLISION.world)
      );
    }
    return mesh;
  }

  /** Roca decorativa con collider de envolvente convexa. */
  staticRock(x, z, scale, { sink = 0.35, seed = x * 13.1 + z * 7.7, collide = true } = {}) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = Math.sin(v.x * 2.3 + seed) * Math.cos(v.y * 3.1 + seed * 0.7) * Math.sin(v.z * 2.7 + seed * 1.3);
      v.multiplyScalar(1 + n * 0.28);
      v.y *= 0.72;
      p.setXYZ(i, v.x * scale.x, v.y * scale.y, v.z * scale.z);
    }
    geo.computeVertexNormals();
    this.#own(geo);
    const mesh = new THREE.Mesh(geo, this.game.assets.materials.rock);
    const y = heightAt(x, z) + scale.y * (0.72 - sink);
    mesh.position.set(x, y, z);
    mesh.rotation.y = seed % 6.28;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    if (collide) {
      const R = this.game.physics.R;
      mesh.updateMatrixWorld(true);
      const pts = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
        pts[i * 3] = v.x;
        pts[i * 3 + 1] = v.y;
        pts[i * 3 + 2] = v.z;
      }
      const desc = R.ColliderDesc.convexHull(pts);
      if (desc) this.game.physics.createStatic(desc.setFriction(0.9).setCollisionGroups(COLLISION.world));
    }
    return mesh;
  }

  lantern(x, z, rotY = 0, withLight = false) {
    const obj = this.game.assets.cloneProp('Lantern');
    const g = ground(x, z);
    obj.position.copy(g);
    obj.rotation.y = rotY;
    this.root.add(obj);
    const R = this.game.physics.R;
    this.game.physics.createStatic(R.ColliderDesc.cuboid(0.1, 1.6, 0.1).setTranslation(g.x, g.y + 1.6, g.z).setCollisionGroups(COLLISION.world));
    if (withLight) {
      const light = new THREE.PointLight(0xffa850, 7, 14, 2);
      const off = new THREE.Vector3(0.78, 2.6, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      light.position.copy(g).add(off);
      this.root.add(light);
      this.lanternLights.push(light);
    }
    return obj;
  }

  sign(material, x, z, rotY, { w = 2.4, h = 1.2, height = 1.6 } = {}) {
    const g = ground(x, z);
    const { materials } = this.game.assets;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    board.position.set(0, height + h / 2, 0.08);
    const back = new THREE.Mesh(this.#own(boxWithWorldUV(w + 0.15, h + 0.15, 0.12, 1)), materials.wood);
    back.position.set(0, height + h / 2, 0);
    const group = new THREE.Group();
    group.add(board, back);
    for (const sx of [-w / 2 + 0.2, w / 2 - 0.2]) {
      const post = new THREE.Mesh(this.#own(boxWithWorldUV(0.14, height + h, 0.14, 1)), materials.wood);
      post.position.set(sx, (height + h) / 2, -0.1);
      post.castShadow = true;
      group.add(post);
    }
    group.position.copy(g);
    group.rotation.y = rotY;
    this.root.add(group);
    const R = this.game.physics.R;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    this.game.physics.createStatic(
      R.ColliderDesc.cuboid(w / 2, (height + h) / 2, 0.1).setTranslation(g.x, g.y + (height + h) / 2, g.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(COLLISION.world)
    );
    return group;
  }

  #add(entity) {
    this.game.addEntity(entity);
    return entity;
  }

  crateStack(x, z, layout = [3, 1], rotY = 0) {
    const s = 1;
    const baseY = heightAt(x, z) + 0.05;
    layout.forEach((n, row) => {
      for (let i = 0; i < n; i++) {
        const off = new THREE.Vector3((i - (n - 1) / 2) * 1.03, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
        const px = x + off.x;
        const pz = z + off.z;
        const y = Math.max(baseY, heightAt(px, pz) + 0.05) + s / 2 + row * (s + 0.01);
        this.#add(new Crate(this.game, V(px, y, pz), { size: s, rotY, sleeping: true }));
      }
    });
  }

  barrel(x, z) {
    return this.#add(new Barrel(this.game, V(x, heightAt(x, z) + 0.62, z), { rotY: Math.random() * 6, sleeping: true }));
  }

  supply(x, z) {
    return this.#add(new SupplyCrate(this.game, V(x, heightAt(x, z) + 0.5, z), { rotY: Math.random() * 6, sleeping: true }));
  }

  boulder(x, z, radius, sleeping = true) {
    return this.#add(new Boulder(this.game, V(x, heightAt(x, z) + radius * 0.95, z), { radius, sleeping }));
  }

  // ================================================================ zonas
  #buildCamp() {
    const { assets } = this.game;
    const R = this.game.physics.R;
    for (const [x, z, r] of [[-10, 45, 0.5], [9, 47, -0.4], [-2, 50, 0.1]]) {
      const tent = assets.cloneProp('Tent');
      tent.position.copy(ground(x, z));
      tent.rotation.y = r;
      this.root.add(tent);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r);
      const g = ground(x, z);
      this.game.physics.createStatic(R.ColliderDesc.cuboid(1.2, 0.8, 1.3).setTranslation(g.x, g.y + 0.8, g.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(COLLISION.world));
    }
    this.lantern(-4, 37, 0, true);
    this.lantern(5, 37.5, Math.PI, true);
    this.sign(assets.materials.signCamp, 2.5, 34.5, 0, { w: 2.8, h: 1.4 });
    this.crateStack(-13, 38, [3, 2, 1], 0.2);
    this.supply(10, 40);
    this.supply(-17, 31);
    this.barrel(16.5, 27);
    this.barrel(17.3, 28.1);
    // fogata apagada (piedras en círculo)
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this.staticRock(-3 + Math.cos(a) * 1.1, 43 + Math.sin(a) * 1.1, V(0.28, 0.25, 0.28), { collide: false, seed: i * 3.3 });
    }
  }

  #buildRails() {
    const { materials } = this.game.assets;
    const x = 14;
    const z0 = 46;
    const z1 = 1.5;
    const n = Math.floor(z0 - z1);
    const sleeperGeo = this.#own(new THREE.BoxGeometry(1.7, 0.12, 0.28));
    const sleepers = new THREE.InstancedMesh(sleeperGeo, materials.wood, n);
    const railGeo = this.#own(new THREE.BoxGeometry(0.08, 0.1, 1.02));
    const rails = new THREE.InstancedMesh(railGeo, materials.rail, n * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const z = z0 - i - 0.5;
      const y = heightAt(x, z);
      const slope = Math.atan2(heightAt(x, z - 0.5) - heightAt(x, z + 0.5), 1);
      q.setFromEuler(new THREE.Euler(slope, 0, 0));
      m.compose(V(x, y + 0.03, z), q, V(1, 1, 1));
      sleepers.setMatrixAt(i, m);
      for (const [k, sx] of [[0, -0.5], [1, 0.5]]) {
        m.compose(V(x + sx, y + 0.13, z), q, V(1, 1, 1));
        rails.setMatrixAt(i * 2 + k, m);
      }
    }
    sleepers.receiveShadow = true;
    rails.castShadow = true;
    this.root.add(sleepers, rails);
    // tope al final de la vía
    this.staticBox(ground(x, z1).add(V(0, 0.45, -0.2)), V(1.8, 0.9, 0.5), materials.wood, { tile: 1 });
    // vagonetas
    for (const z of [32, 20, 9]) this.#add(new MineCart(this.game, ground(x, z)));
  }

  #buildPatio() {
    const { materials } = this.game.assets;
    // casa de máquinas en ruinas
    const cx = -14;
    const cz = 14;
    const base = heightAt(cx, cz);
    const wall = (x, z, w, d, h = 3.2) => {
      const g = Math.min(heightAt(x, z), base);
      this.staticBox(V(x, g + h / 2 - 0.3, z), V(w, h, d), materials.wall, { tile: 2 });
    };
    wall(cx - 4, cz, 0.6, 8);
    wall(cx, cz - 4, 8.6, 0.6, 2.6);
    wall(cx + 2.8, cz + 4, 3, 0.6, 3.6);
    wall(cx - 2.6, cz + 4, 2.4, 0.6, 1.6);
    wall(cx + 4, cz - 2, 0.6, 4, 2.2);
    // columna caída
    this.staticBox(V(cx + 6.5, base + 0.35, cz + 2), V(3.5, 0.7, 0.7), materials.stone, { rotY: 0.6, tile: 1.2 });
    this.lantern(-3, 24, Math.PI / 2);
    this.lantern(7, 3, -Math.PI / 2);

    this.crateStack(-3, 18, [3, 1], 0.1);
    this.crateStack(6, 12, [2, 1], -0.4);
    this.supply(-18, 4);
    this.supply(-12.5, 13.5);
    this.barrel(-8, 5.5);
    this.barrel(-6.9, 6.6);
    this.barrel(-9.1, 6.9);
    this.barrel(4, 22);
    this.barrel(5.2, 22.7);
    this.boulder(-21, 22, 0.9);
    this.boulder(19, 12, 1.1);
  }

  #buildQuarry() {
    const { materials } = this.game.assets;
    // rocas en la pendiente: al empujarlas ruedan hacia la torre
    this.boulder(-48.5, 13.5, 1.1);
    this.boulder(-49, 19.2, 1.3);
    this.boulder(-48.2, 24.8, 1.0);
    this.boulder(-47.2, 30.5, 1.2);
    this.barrel(-33.2, 21.6);
    this.barrel(-33.6, 15.4);
    this.crateStack(-44, 37, [2, 1], 0.5);
    this.supply(-31, 36);
    this.lantern(-29.5, 23.5, Math.PI);

    // mirador de madera (buen punto para atacar la torre fuera del campo)
    const mx = -28.5;
    const mz = 30;
    const top = heightAt(mx, mz) + 2.4;
    this.staticBox(V(mx, top - 0.12, mz), V(4, 0.24, 4), materials.wood, { tile: 1.5 });
    for (const sx of [-1.8, 1.8]) {
      for (const sz of [-1.8, 1.8]) {
        const g = heightAt(mx + sx, mz + sz);
        const h = top - g;
        this.staticBox(V(mx + sx, g + h / 2 - 0.1, mz + sz), V(0.25, h + 0.2, 0.25), materials.wood, { tile: 1, collide: false });
      }
    }
    // barandal (norte, este, oeste)
    this.staticBox(V(mx, top + 0.55, mz - 1.95), V(4, 0.1, 0.1), materials.wood, { tile: 1 });
    this.staticBox(V(mx - 1.95, top + 0.55, mz), V(0.1, 0.1, 4), materials.wood, { tile: 1 });
    this.staticBox(V(mx + 1.95, top + 0.55, mz), V(0.1, 0.1, 4), materials.wood, { tile: 1 });
    for (const [px, pz] of [[-1.95, -1.95], [1.95, -1.95], [-1.95, 1.95], [1.95, 1.95], [0, -1.95]]) {
      this.staticBox(V(mx + px, top + 0.3, mz + pz), V(0.1, 0.6, 0.1), materials.wood, { tile: 1, collide: false });
    }
    // rampa de acceso (sube hacia el norte)
    const rampLen = 6.5;
    const gz = mz + 2 + rampLen / 2;
    const gStart = heightAt(mx, mz + 2 + rampLen);
    const rise = top - gStart;
    const angle = Math.atan2(rise, rampLen);
    const len = Math.hypot(rise, rampLen);
    this.staticBox(V(mx, gStart + rise / 2 - 0.1, gz), V(1.8, 0.2, len), materials.wood, { rotX: angle, tile: 1.5 });
  }

  #buildMesa() {
    this.barrel(37.8, -0.6);
    this.barrel(37.6, -7.6);
    this.supply(46, 8);
    this.boulder(46, -22, 1.0);
    this.lantern(33.5, 10, Math.PI / 2);
    this.lantern(40, -31, 0);
  }

  #buildBridges() {
    const { materials } = this.game.assets;
    for (const bx of [-32, -2]) {
      const zc = crevasseZ(bx);
      const len = 13;
      const width = 2.8;
      const zS = zc + len / 2;
      const zN = zc - len / 2;
      const yS = heightAt(bx, zS);
      const yN = heightAt(bx, zN);
      const y = Math.max(yS, yN) + 0.12;
      // tablero
      this.staticBox(V(bx, y - 0.1, zc), V(width, 0.2, len), materials.wood, { tile: 1.4 });
      // vigas inferiores
      for (const sx of [-1.1, 1.1]) {
        this.staticBox(V(bx + sx, y - 0.45, zc), V(0.3, 0.5, len + 1), materials.wood, { tile: 1.4, collide: false });
      }
      // barandales con postes
      for (const sx of [-width / 2, width / 2]) {
        this.staticBox(V(bx + sx, y + 0.95, zc), V(0.08, 0.08, len), materials.rope, { collide: false });
        this.staticBox(V(bx + sx, y + 0.5, zc), V(0.1, 1.0, len), materials.rope, { collide: true, cast: false }).visible = false;
        for (let k = 0; k <= 6; k++) {
          const z = zN + (k / 6) * len;
          this.staticBox(V(bx + sx, y + 0.5, z), V(0.14, 1.0, 0.14), materials.wood, { collide: false, tile: 1 });
        }
      }
      // letreros de peligro
      this.sign(materials.signDanger, bx + 3.4, zS + 1.2, 0, { w: 2.2, h: 1.1, height: 0.9 });
      this.sign(materials.signDanger, bx - 3.4, zN - 1.2, Math.PI, { w: 2.2, h: 1.1, height: 0.9 });
    }
    // barriles cerca de los puentes
    this.barrel(-35.5, -3.5);
    this.barrel(1.5, -3.2);
  }

  #buildNorth() {
    const { materials } = this.game.assets;
    // ruinas del norte
    const rx = -6;
    const rz = -30;
    const b = heightAt(rx, rz);
    this.staticBox(V(rx, b + 1.2, rz - 3), V(7, 3, 0.6), materials.wall);
    this.staticBox(V(rx - 3.5, b + 0.9, rz), V(0.6, 2.4, 6), materials.wall);
    this.staticBox(V(rx + 3.2, b + 0.5, rz + 1), V(0.6, 1.6, 3), materials.wall);
    const b2 = heightAt(-34, -24);
    this.staticBox(V(-34, b2 + 1, -24), V(5, 2.6, 0.6), materials.wall, { rotY: 0.5 });
    this.staticBox(V(-38, b2 + 0.7, -28), V(0.6, 2, 4), materials.wall, { rotY: 0.5 });

    this.crateStack(-10, -34, [3, 2], 0.3);
    this.supply(-12, -41);
    this.supply(23, -26);
    this.barrel(-21.4, -33.6);
    this.barrel(-22.2, -39.6);
    this.barrel(-5.5, -25.2);
    this.barrel(20, -38);
    this.boulder(-40, -40, 1.1);
    this.boulder(4, -22, 0.9);
    this.lantern(9.5, -35.5, 0, true);
    this.lantern(19, -35.5, Math.PI, true);
  }

  #scatterRocks() {
    const rocks = [
      // bordes de la grieta
      [-44, -5, 1.6], [-20, -4.5, 1.2], [10, -4.6, 1.4], [22, -5, 1.8], [-50, -16, 2.0], [-14, -16.5, 1.3], [16, -17, 1.6],
      // perímetro y ambientación
      [-50, 44, 2.6], [30, 48, 2.4], [48, 30, 2.2], [-52, -46, 3.0], [50, -48, 2.8], [-24, 48, 1.8], [26, 36, 1.4],
      [-42, 2, 1.2], [24, 2, 1.1], [-8, 30, 0.8], [30, -24, 1.4], [-44, -30, 1.6], [28, -46, 2.0], [-16, -48, 2.2],
      [20, 26, 0.9], [-26, 10, 0.9],
    ];
    for (const [x, z, s] of rocks) this.staticRock(x, z, V(s * 1.2, s, s * 1.1));
  }

  dispose() {
    this.root.parent?.remove(this.root);
    for (const g of this.ownedGeometries) g.dispose();
    this.terrain?.mesh?.geometry.dispose();
    this.terrain?.mesh?.material.dispose();
    this.ownedGeometries = [];
  }
}
