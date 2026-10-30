/**
 * NIVEL 3 — El Corazón del Eco (santuario sobre el abismo).
 *
 * Una plataforma circular flota sobre el vacío, unida por un puente de losas
 * a la plataforma donde espera la nave. Pilares para cubrirse del rayo,
 * cuatro anclas de cristal y el Eco flotando en el centro.
 *
 * Guion: romper 4 anclas → destruir el núcleo → HUIDA con cuenta atrás
 * mientras el puente se desploma (las losas pasan de estáticas a cuerpos
 * dinámicos de Rapier y caen al abismo).
 */
import * as THREE from 'three';
import { LevelBase } from './LevelBase.js';
import { smooth, mix, fbm2, heightAt } from '../world/TerrainField.js';
import { Dropship } from '../entities/Interactables.js';
import { StoneBlock, StoneOrb } from '../entities/Props.js';
import { Eco } from '../bosses/Eco.js';
import { SCORE } from '../config.js';

const ARENA_R = 34;
const PLAT = { x: 0, z: 66, r: 10.5 };
const BRIDGE = { from: 33.2, to: 56.2, width: 4.6, segments: 10 };

function height(x, z) {
  const da = Math.hypot(x, z);
  const dp = Math.hypot(x - PLAT.x, z - PLAT.z);
  const arena = smooth(ARENA_R + 1.5, ARENA_R - 0.3, da);
  const plat = smooth(PLAT.r + 1.5, PLAT.r - 0.3, dp);
  const solid = Math.max(arena, plat);
  const top = (fbm2(x * 0.08, z * 0.08, 3) - 0.5) * 0.3;
  // la parte inferior rocosa se estrecha hacia abajo (islas flotantes)
  return mix(-62 + fbm2(x * 0.05, z * 0.05, 3) * 10, top, solid);
}
const isVoid = (x, z) => Math.hypot(x, z) > ARENA_R - 0.6 && Math.hypot(x - PLAT.x, z - PLAT.z) > PLAT.r - 0.6;

export const PALETTE_L3 = {
  skyTop: 0x12020f,
  skyHorizon: 0x4a0f3a,
  fog: 0x220a1e,
  fogDensity: 0.016,
  moonDir: [0.2, 0.5, -0.84],
  moonColor: 0xffb0e8,
  moonIntensity: 1.2,
  hemiSky: 0x8a3a7a,
  hemiGround: 0x1a0612,
  hemiIntensity: 0.7,
  auroraA: 0xff5ad8,
  auroraB: 0x7a4dff,
  aurora: 1.3,
  spores: 0xff8fe6,
  sporeOpacity: 0.7,
  exposure: 1.2,
};

export class Level3 extends LevelBase {
  constructor(game, opts) {
    super(game, 3, opts);
    this.fallIsDeath = true;
    this.phase = 'approach';
    this.segments = [];
  }

  build() {
    const { game } = this;
    const M = game.assets.materials;
    game.env.applyPalette(PALETTE_L3);
    this.setTerrain(height, isVoid, { veinColor: new THREE.Color(0xff38c8), veinIntensity: 2.2, voidY: -8 });
    this.spawn.pos.set(0, heightAt(0, 56.6), 56.6);
    this.spawn.yaw = Math.PI;

    // ---------------------------------------------------- puente de losas
    const len = (BRIDGE.to - BRIDGE.from) / BRIDGE.segments;
    for (let i = 0; i < BRIDGE.segments; i++) {
      const z = BRIDGE.from + len * (i + 0.5);
      const size = new THREE.Vector3(BRIDGE.width, 0.6, len - 0.06);
      const pos = new THREE.Vector3(0, -0.3, z);
      const { mesh, collider } = this.box(pos, size, { material: i % 2 ? M.ruinPlain : M.ruin });
      this.segments.push({ mesh, collider, pos, size, fallen: false });
    }
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 4; k++) this.lumen(new THREE.Vector3(sx * 2.8, -0.1, BRIDGE.from + 2 + k * 6.5), 0xff5ad8);
    }

    // ---------------------------------------------------- plataforma de la nave
    this.dropship = this.addEntity(new Dropship(game, new THREE.Vector3(PLAT.x, heightAt(PLAT.x, PLAT.z + 1), PLAT.z + 1), 0, { landed: true }));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      if (Math.sin(a) < -0.6) continue;
      this.lumen(this.ground(PLAT.x + Math.cos(a) * 8.8, PLAT.z + Math.sin(a) * 8.8), 0xffc46b);
    }

    // ---------------------------------------------------- arena
    // anillo de arcos rotos en el borde
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      if (Math.cos(a) > 0.95) continue; // hueco del puente (sur)
      const x = Math.sin(a) * (ARENA_R - 1.4);
      const z = Math.cos(a) * (ARENA_R - 1.4);
      const h = 3 + (i % 3) * 2.5;
      this.box(new THREE.Vector3(x, h / 2, z), new THREE.Vector3(2.2, h, 1.4), { rotY: a, material: M.ruin });
    }
    // pilares de cobertura
    this.covers = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const p = new THREE.Vector3(Math.sin(a) * 14, 0, Math.cos(a) * 14);
      this.column(p, 6.5, 1.2);
      this.covers.push(p);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      if (i === 0) continue;
      this.box(new THREE.Vector3(Math.sin(a) * 22, 0.9, Math.cos(a) * 22), new THREE.Vector3(4, 1.8, 1), { rotY: a + Math.PI / 2, material: M.ruin });
    }
    // runas en el suelo (anillos luminosos decorativos)
    for (const r of [8, 20, 30]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.12, r + 0.12, 128),
        new THREE.MeshBasicMaterial({ color: 0xff38c8, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      this.root.add(ring);
      this.materialsToDispose(ring);
    }

    // ---------------------------------------------------- decorado del abismo
    this.#abyssDecor();
  }

  materialsToDispose(mesh) {
    this.geometries.push(mesh.geometry);
    this.materials.push(mesh.material);
  }

  #abyssDecor() {
    const { game } = this;
    // agujas de cristal gigantes que emergen del vacío
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0xd6c2ff, emissive: 0x7a2cff, emissiveIntensity: 0.9, flatShading: true, roughness: 0.2 });
    const hotMat = new THREE.MeshStandardMaterial({ color: 0xffd0f4, emissive: 0xff38c8, emissiveIntensity: 1.6, flatShading: true });
    this.materials.push(crystalMat, hotMat);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.3;
      const r = 55 + (i % 4) * 12;
      const h = 30 + (i % 5) * 12;
      const geo = new THREE.ConeGeometry(2.5 + (i % 3), h, 6);
      this.geometries.push(geo);
      const m = new THREE.Mesh(geo, i % 3 ? crystalMat : hotMat);
      m.position.set(Math.sin(a) * r, -40 + h / 2 + (i % 2) * 8, Math.cos(a) * r);
      m.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * 3, (Math.random() - 0.5) * 0.4);
      this.root.add(m);
    }
    // islas rocosas flotantes
    const rockGeo = new THREE.DodecahedronGeometry(1, 1);
    this.geometries.push(rockGeo);
    this.floaters = [];
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(rockGeo, game.assets.materials.rock);
      const a = (i / 12) * Math.PI * 2;
      const r = 44 + (i % 3) * 10;
      m.position.set(Math.sin(a) * r, -6 + (i % 4) * 5, Math.cos(a) * r);
      m.scale.set(3 + (i % 3), 2 + (i % 2), 3 + ((i + 1) % 3));
      m.castShadow = true;
      this.root.add(m);
      this.floaters.push({ m, base: m.position.y, ph: i });
    }
  }

  // ================================================================ guion
  start() {
    const { game } = this;
    this.setObjectives([
      { id: 'anchors', text: 'Destruye las anclas de cristal', progress: { cur: 0, max: 4 } },
      { id: 'core', text: 'Destruye el núcleo del Eco' },
      { id: 'escape', text: '¡Escapa a la nave antes del colapso!' },
    ]);
    const anchorsPos = [];
    if (this.stage !== 'core') {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        anchorsPos.push(new THREE.Vector3(Math.sin(a) * 26, 0, Math.cos(a) * 26));
      }
    }
    const portals = [new THREE.Vector3(0, 0, -27), new THREE.Vector3(27, 0, 0), new THREE.Vector3(-27, 0, 0), new THREE.Vector3(12, 0, -24), new THREE.Vector3(-12, 0, -24)];
    this.eco = game.addEntity(new Eco(game, new THREE.Vector3(0, 0, 0), {
      anchors: anchorsPos,
      portals,
      arenaRadius: ARENA_R,
      active: false,
      onDefeated: () => this.#onEcoDefeated(),
    }));
    this.subs.push(game.bus.on('anchor:destroyed', ({ left }) => this.#onAnchor(left)));
    this.subs.push(game.bus.on('eco:phase', ({ phase }) => this.#onPhase(phase)));

    // suministros que se reponen
    this.supplyPoints = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4 + 0.35;
      this.supplyPoints.push({ pos: new THREE.Vector3(Math.sin(a) * 19, 0, Math.cos(a) * 19), crate: null, t: 0 });
    }
    this.#refreshSupplies(true);
    game.spawner.spawnPickup('ammo', new THREE.Vector3(2.5, 0.6, 60));
    game.spawner.spawnPickup('grenade', new THREE.Vector3(-2.5, 0.6, 60));

    // el combate empieza al pisar la arena
    this.trigger(new THREE.Vector3(0, 0, 0), ARENA_R + 1, () => {
      this.eco.active = true;
      this.phase = 'fight';
      this.bossStart = this.stats.time;
      game.music?.setIntensity(3);
      if (this.stage !== 'core') game.radio.say([['eco', 'Cuarenta y dos voces me cantan. Pronto serás la cuarenta y tres.', 4]], { interrupt: true });
    });

    this.interactable({
      pos: () => this.dropship.interactPoint,
      radius: 3,
      prompt: () => (this.phase === 'escape' ? '¡Abordar la nave!' : 'Nave de extracción'),
      can: () => this.phase === 'escape',
      denied: () => 'Aún no: el Eco sigue vivo',
      run: () => this.#board(),
    });

    if (this.stage === 'core') {
      this.objective('anchors', { done: true, progress: { cur: 4, max: 4 } });
      this.activate('core');
      this.checkpoint = { stage: 'core' };
      game.player.teleport(new THREE.Vector3(0, 0, 30), Math.PI);
      game.cameraRig.reset(game.player.chestPosition(), 0);
      game.radio.say([['ruiz', 'Retomamos con el escudo abajo. Acaba con ese núcleo, NOVA-7.']]);
      return;
    }
    this.activate('anchors');
    game.radio.say([
      ['nova', 'Plataforma estable. Lectura de energía… inmensa.'],
      ['ruiz', 'Ese es el Eco. Cuatro anclas de cristal alimentan su escudo: rómpelas primero.'],
      ['ruiz', 'Y ojo con el borde. Ahí abajo no hay fondo.'],
    ], { delay: 1 });
  }

  #onAnchor(left) {
    const { game } = this;
    this.addScore(SCORE.pylon * 0.6, 'Ancla destruida');
    this.objective('anchors', { progress: { cur: 4 - left, max: 4 } });
    if (left === 3) game.radio.say([['eco', 'Duele… ¿así se siente olvidar?', 3.5]]);
    else if (left === 1) game.radio.say([['ruiz', '¡Solo queda una!']]);
  }

  #onPhase(phase) {
    const { game } = this;
    if (phase === 2) {
      this.objective('anchors', { done: true, progress: { cur: 4, max: 4 } });
      this.activate('core');
      this.checkpoint = { stage: 'core' };
      game.saveCheckpoint?.();
      game.radio.say([
        ['ruiz', '¡Escudo abajo! Dispara al ojo. Cuando cargue el rayo, cúbrete detrás de un pilar.'],
        ['ruiz', 'Y esos anillos que recorren el suelo… ¡sáltalos!'],
      ], { interrupt: true });
    } else if (phase === 3) {
      game.env.setTension(1);
      game.radio.say([['eco', '¡NO! ¡NO ME QUITARÁS SUS VOCES!', 3]], { interrupt: true });
    }
  }

  #onEcoDefeated() {
    const { game } = this;
    this.phase = 'escape';
    this.stats.bossTime = this.stats.time - (this.bossStart ?? this.stats.time);
    this.objective('core', { done: true });
    this.addScore(SCORE.boss * 0.3, 'El Eco destruido');
    this.activate('escape');
    game.director.purge();
    const limits = { recluta: 60, veterano: 50, leyenda: 42 };
    const first = { recluta: 20, veterano: 15, leyenda: 12 };
    this.escapeLimit = limits[game.difficulty.id] ?? 50;
    this.escapeT = 0;
    this.collapseStart = first[game.difficulty.id] ?? 15;
    this.rockT = 0;
    this.setWaypoint(this.dropship.interactPoint, 'Nave', 'airplane-fill');
    game.music?.setIntensity(3);
    game.env.setTension(1);
    game.radio.say([
      ['ruiz', '¡Lo lograste! El santuario se está desplomando: ¡corre a la nave, YA!'],
      ['nova', 'Cuarenta y dos firmas neuronales liberándose de la red… Están a salvo.'],
    ], { interrupt: true });
  }

  #collapse(i) {
    const seg = this.segments[i];
    if (!seg || seg.fallen) return;
    seg.fallen = true;
    const { game } = this;
    game.physics.removeCollider(seg.collider);
    seg.mesh.visible = false;
    // la losa pasa a ser un cuerpo dinámico que cae al abismo
    const block = new StoneBlock(game, seg.pos.clone(), seg.size, { sleeping: false, glyphs: i % 2 === 0 });
    block.body.setAngvel({ x: (Math.random() - 0.5) * 2, y: 0, z: (Math.random() - 0.5) * 1.5 }, true);
    block.body.setLinvel({ x: 0, y: -1, z: 0 }, true);
    game.addEntity(block);
    game.fx.burst('dust', seg.pos.clone().setY(0.2));
    game.audio.play('rumble', seg.pos);
    game.cameraRig.shakeFrom(seg.pos, 0.6);
  }

  #refreshSupplies(initial = false) {
    const { game } = this;
    for (const sp of this.supplyPoints) {
      if (sp.crate && sp.crate.alive) continue;
      if (!initial && sp.t > 0) continue;
      const p = sp.pos.clone();
      p.y = heightAt(p.x, p.z) + 0.5;
      sp.crate = game.spawner.spawnSupplies(1, sp.pos, 2.5, { minPlayerDist: 3 })[0] ?? null;
      sp.t = 32;
    }
  }

  #board() {
    const { game } = this;
    if (this.phase !== 'escape') return;
    this.phase = 'done';
    game.player.controlEnabled = false;
    game.player.wave();
    this.objective('escape', { done: true });
    const left = Math.max(0, this.escapeLimit - this.escapeT);
    this.addScore(left * 40, 'Tiempo sobrante en la huida');
    this.hud.timer = null;
    game.audio.play('dropship');
    this.game.after(1.2, () => this.complete({ final: true }));
  }

  tick(dt) {
    const { game } = this;
    for (const f of this.floaters || []) f.m.position.y = f.base + Math.sin(game.time * 0.4 + f.ph) * 0.8;
    if (this.menuMode || game.state !== 'playing') return;
    // reponer cajas de suministros durante el combate
    if (this.phase === 'fight' || this.phase === 'approach') {
      for (const sp of this.supplyPoints) if (!sp.crate?.alive) sp.t -= dt;
      this.#refreshSupplies();
    }
    if (this.phase !== 'escape') return;
    this.escapeT += dt;
    const left = this.escapeLimit - this.escapeT;
    this.hud.timer = { label: 'COLAPSO', value: Math.max(0, left), warn: left < 15 };
    // el puente cae de la arena hacia la nave
    const gap = (this.escapeLimit - this.collapseStart - 6) / BRIDGE.segments;
    for (let i = 0; i < this.segments.length; i++) {
      if (!this.segments[i].fallen && this.escapeT > this.collapseStart + i * gap) this.#collapse(i);
    }
    if (this.escapeT > this.collapseStart - 3 && !this.warned) {
      this.warned = true;
      game.radio.say([['ruiz', '¡El puente se está cayendo! ¡Muévete!']], { interrupt: true });
    }
    // rocas cayendo sobre la arena
    this.rockT -= dt;
    if (this.rockT <= 0) {
      this.rockT = 0.9;
      const player = game.player;
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 10;
      const x = player.currPos.x + Math.cos(a) * r;
      const z = player.currPos.z + Math.sin(a) * r;
      if (!isVoid(x, z)) {
        const target = new THREE.Vector3(x, heightAt(x, z), z);
        game.fx.warning(target, 1.6, 1.3, 0xffb347);
        const rock = new StoneOrb(game, target.clone().setY(target.y + 18), { radius: 0.7, thrown: true, damage: 18 });
        rock.transient = true;
        rock.body.setLinvel({ x: 0, y: -6, z: 0 }, true);
        game.addEntity(rock);
      }
    }
    game.cameraRig.shake(dt * 0.35);
    // llegar a la rampa también cuenta como abordar
    if (game.player.currPos.distanceTo(this.dropship.interactPoint) < 2.5) this.#board();
    if (left <= 0) {
      this.hud.timer = null;
      game.cameraRig.shake(1.5);
      game.player.damage(9999, { source: 'world', kind: 'collapse' });
    }
  }
}

