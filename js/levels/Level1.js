/**
 * NIVEL 1 — Caída en la selva (Valle del Descenso).
 *
 * Selva nocturna con río, restos de la nave, una atalaya en ruinas que se
 * puede derribar, un claro con la baliza de rescate y un cráter al norte
 * donde duerme la Matriarca.
 *
 * Guion: 3 celdas (posiciones generadas y validadas) → activar baliza →
 * defenderla 50 s ante oleadas → jefe → nave de extracción.
 */
import * as THREE from 'three';
import { LevelBase } from './LevelBase.js';
import { fbm2, smooth, mix, canyonWalls, heightAt } from '../world/TerrainField.js';
import { RescueBeacon, Dropship } from '../entities/Interactables.js';
import { StoneBlock } from '../entities/Props.js';
import { Matriarca } from '../bosses/Matriarca.js';
import { LOGS } from '../gameplay/Story.js';
import { SCORE } from '../config.js';

const gauss = (x, z, cx, cz, r) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));
const flatten = (h, x, z, c, r, target) => mix(target, h, smooth(r * 0.55, r, Math.hypot(x - c.x, z - c.z)));
const riverZ = (x) => 14 + Math.sin(x * 0.07) * 5;

const P = {
  spawn: { x: 4, z: 47 },
  crash: { x: -10, z: 35 },
  clearing: { x: 0, z: -8 },
  beacon: { x: 0, z: -6 },
  lz: { x: -23, z: -5 },
  crater: { x: 0, z: -41, r: 15 },
  west: { x: -40, z: 0 },
  east: { x: 34, z: -9 },
  north: { x: -31, z: -35 },
};

function height(x, z) {
  let h = (fbm2(x * 0.035 + 3.1, z * 0.035 - 1.7, 4) - 0.5) * 9;
  h += Math.sin(x * 0.05) * 1.2 + Math.cos(z * 0.043) * 1.0;
  h += 5.5 * gauss(x, z, 36, -9, 14);
  h += 2.5 * gauss(x, z, -38, 4, 16);
  h = flatten(h, x, z, P.spawn, 11, 0.3);
  h = flatten(h, x, z, P.crash, 10, 0.2);
  h = flatten(h, x, z, P.clearing, 14, 0.6);
  h = flatten(h, x, z, P.lz, 10, 0.6);
  h = flatten(h, x, z, P.north, 11, 1.2);
  h = flatten(h, x, z, { x: 34, z: -9 }, 8, heightRidge());
  h = flatten(h, x, z, { x: 29.5, z: -13 }, 6, heightRidge());
  // río
  const dr = Math.abs(z - riverZ(x));
  h = mix(-1.7, h, smooth(2.4, 6.5, dr));
  // cráter
  const dc = Math.hypot(x - P.crater.x, z - P.crater.z);
  if (dc < P.crater.r + 9) {
    const inner = -3.2 + (dc / P.crater.r) ** 2 * 5.8;
    const w = smooth(P.crater.r, P.crater.r + 9, dc);
    h = mix(dc < P.crater.r ? inner : 2.6, h, w);
  }
  h += canyonWalls(x, z, 58, 30);
  return h;
}
let RIDGE = null;
function heightRidge() {
  if (RIDGE === null) {
    // altura del lomo este sin aplanar (se calcula una vez)
    const x = 34;
    const z = -9;
    RIDGE = (fbm2(x * 0.035 + 3.1, z * 0.035 - 1.7, 4) - 0.5) * 9 + Math.sin(x * 0.05) * 1.2 + Math.cos(z * 0.043) * 1.0 + 5.5 * gauss(x, z, 36, -9, 14) + 2.5 * gauss(x, z, -38, 4, 16);
  }
  return RIDGE;
}

export const PALETTE_L1 = {
  skyTop: 0x040a16,
  skyHorizon: 0x10363c,
  fog: 0x0a2226,
  fogDensity: 0.021,
  auroraA: 0x38ffb0,
  auroraB: 0x7a4dff,
  spores: 0x7dffd6,
};

export class Level1 extends LevelBase {
  constructor(game, opts) {
    super(game, 1, opts);
    this.cells = 0;
    this.cellsTotal = 3;
    this.phase = 'cells';
    this.zones = {};
  }

  build() {
    const { game } = this;
    game.env.applyPalette(PALETTE_L1);
    this.setTerrain(height, () => false, { veinColor: new THREE.Color(0x35e8ff), veinIntensity: 1.5 });
    this.spawn.pos.set(P.spawn.x, heightAt(P.spawn.x, P.spawn.z), P.spawn.z);
    this.spawn.yaw = Math.PI;

    // ---------------------------------------------------- restos de la nave
    this.wreck = this.addEntity(new Dropship(game, this.ground(P.crash.x, P.crash.z), 0.7, { wreck: true }));
    this.crates(new THREE.Vector3(-3, 0, 33), 5);
    this.crates(new THREE.Vector3(-16, 0, 29), 4);
    this.canisters(new THREE.Vector3(-1, 0, 43), 3, 1.4);
    if (!this.menuMode && this.stage === 'start') {
      this.weaponPickup('shotgun', this.ground(-1.5, 38));
      this.pickup('grenade', this.ground(-6, 41));
    }

    // ---------------------------------------------------- río
    this.#water();

    // ---------------------------------------------------- claro de la baliza
    const beaconPos = this.ground(P.beacon.x, P.beacon.z);
    this.beacon = this.addEntity(new RescueBeacon(game, beaconPos, { radius: 16, duration: 50 }));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      this.lumen(this.ground(P.beacon.x + Math.cos(a) * 12.5, P.beacon.z + Math.sin(a) * 12.5));
    }
    // restos de muro para cubrirse durante la defensa
    for (const [x, z, r] of [[7, -2, 0.4], [-8, -12, -0.8], [6, -15, 1.2], [-9, 1, 2.2]]) {
      this.box(this.ground(x, z).setY(heightAt(x, z) + 0.7), new THREE.Vector3(3.2, 1.6, 0.9), { rotY: r, material: game.assets.materials.ruin });
    }
    this.canisters(new THREE.Vector3(11, 0, -9), 2, 1.1);

    // ---------------------------------------------------- zona de aterrizaje
    this.dropship = this.addEntity(new Dropship(game, this.ground(P.lz.x, P.lz.z), -Math.PI / 2));
    for (const [x, z] of [[-29, -11], [-29, 3], [-15, -11], [-15, 3]]) this.lumen(this.ground(x, z), 0xffc46b);

    // ---------------------------------------------------- cresta este: atalaya derribable
    const ridgeY = heightAt(P.east.x, P.east.z);
    this.#watchtower(new THREE.Vector3(29.5, heightAt(29.5, -13), -13));
    this.box(new THREE.Vector3(38.5, ridgeY + 0.45, -5.5), new THREE.Vector3(2.2, 0.9, 1.4), { material: game.assets.materials.ruin });
    if (!this.menuMode && this.stage === 'start') this.weaponPickup('orb', new THREE.Vector3(38.5, ridgeY + 0.9, -5.5));
    this.box(new THREE.Vector3(41, ridgeY + 1.2, -12), new THREE.Vector3(0.9, 2.4, 6), { rotY: 0.3, material: game.assets.materials.ruin });
    this.column(new THREE.Vector3(27, ridgeY - 0.3, -3), 5, 0.8, { broken: true });
    this.canisters(new THREE.Vector3(33, 0, -3), 2, 1);

    // ---------------------------------------------------- ruinas del norte
    const ny = heightAt(P.north.x, P.north.z);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.column(new THREE.Vector3(P.north.x + Math.cos(a) * 8, ny - 0.2, P.north.z + Math.sin(a) * 8), 4 + (i % 3) * 1.5, 0.8, { broken: i % 2 === 1 });
    }
    this.box(new THREE.Vector3(P.north.x - 2, ny + 1, P.north.z + 3), new THREE.Vector3(6, 2, 1), { rotY: 0.2, material: game.assets.materials.ruin });
    this.box(new THREE.Vector3(P.north.x + 3, ny + 0.6, P.north.z - 3), new THREE.Vector3(1, 1.2, 4), { rotY: -0.3, material: game.assets.materials.ruin });

    // ---------------------------------------------------- bosque oeste
    for (const [x, z] of [[-34, 12], [-42, 0], [-31, -1]]) this.box(this.ground(x, z).setY(heightAt(x, z) + 0.6), new THREE.Vector3(2.6, 1.3, 0.9), { rotY: x * 0.3, material: game.assets.materials.ruin });

    // ---------------------------------------------------- cráter: pilares para la Matriarca
    const pillars = [[-8, -35], [9, -44], [-6, -50], [8, -32], [-12, -44], [1, -54]];
    pillars.forEach(([x, z], i) => this.rockPillar(this.ground(x, z), 6 + (i % 3) * 1.5, 1.5, i * 1.7 + 0.5));

    // ---------------------------------------------------- vegetación
    const blocks = [
      { ...P.spawn, r: 8 }, { ...P.crash, r: 10 }, { ...P.clearing, r: 15 }, { ...P.lz, r: 10 },
      { x: P.crater.x, z: P.crater.z, r: P.crater.r + 3 }, { ...P.north, r: 10 }, { ...P.east, r: 8 }, { x: 29.5, z: -13, r: 5 },
    ];
    this.vegetation({
      area: { minX: -56, maxX: 56, minZ: -56, maxZ: 56 },
      seed: 11,
      trees: 64,
      mushrooms: 26,
      ferns: 380,
      grass: 900,
      flowers: 520,
      maxY: 9,
      blocks,
      predicate: (x, z) => Math.abs(z - riverZ(x)) > 4.5,
    });
  }

  #water() {
    const { game } = this;
    const geo = new THREE.PlaneGeometry(116, 22, 58, 1);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + riverZ(p.getX(i)));
    const tex = game.assets.textures.groundNormal;
    const normal = tex.clone();
    normal.repeat.set(12, 2.5);
    normal.needsUpdate = true;
    this.waterNormal = normal;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0e3c44, roughness: 0.08, metalness: 0.4, transparent: true, opacity: 0.78,
      emissive: 0x0a4a4a, emissiveIntensity: 0.35, normalMap: normal, normalScale: new THREE.Vector2(0.35, 0.35),
    });
    const water = new THREE.Mesh(geo, mat);
    water.position.y = -0.95;
    water.receiveShadow = true;
    water.renderOrder = 1;
    this.root.add(water);
    this.water = water;
  }

  /** Atalaya en ruinas: bloques dinámicos dormidos que se pueden derribar. */
  #watchtower(base) {
    const { game } = this;
    const s = new THREE.Vector3(1.3, 1.3, 1.3);
    for (const dx of [-1.6, 1.6]) {
      for (let k = 0; k < 4; k++) {
        game.addEntity(new StoneBlock(game, new THREE.Vector3(base.x + dx, base.y + 0.66 + k * 1.31, base.z), s, { rotY: k * 0.05, sleeping: true, glyphs: k % 2 === 0 }));
      }
    }
    game.addEntity(new StoneBlock(game, new THREE.Vector3(base.x, base.y + 5.9, base.z), new THREE.Vector3(5, 0.8, 1.5), { sleeping: true }));
    game.addEntity(new StoneBlock(game, new THREE.Vector3(base.x, base.y + 6.9, base.z), new THREE.Vector3(1.2, 1.2, 1.2), { sleeping: true, glyphs: true }));
  }

  // ================================================================ guion
  start() {
    const { game } = this;
    this.setObjectives([
      { id: 'cells', text: 'Recupera las celdas de energía', progress: { cur: 0, max: this.cellsTotal } },
      { id: 'beacon', text: 'Activa la baliza de rescate' },
      { id: 'defend', text: 'Defiende la baliza mientras transmite', progress: { cur: 0, max: 100, unit: '%' } },
      { id: 'boss', text: 'Derrota a la Matriarca' },
      { id: 'extract', text: 'Aborda la nave de extracción' },
    ]);

    this.subs.push(game.bus.on('cell:collected', () => this.#onCell()));
    this.subs.push(game.bus.on('beacon:done', () => this.#onBeaconDone()));
    this.subs.push(game.bus.on('dropship:ready', () => {
      this.setWaypoint(this.dropship.interactPoint, 'Nave de extracción', 'airplane-fill');
      game.radio.say([['ruiz', 'Rampa abajo. ¡Sube a bordo, NOVA-7!']]);
    }));

    // interactuables
    this.interactable({
      pos: () => this.beacon.pos,
      radius: 3.6,
      prompt: () => (this.beacon.state === 'ready' ? 'Activar la baliza de rescate' : this.beacon.state === 'off' ? 'Baliza sin energía' : 'Baliza transmitiendo'),
      can: () => this.beacon.state === 'ready',
      denied: () => (this.beacon.state === 'off' ? `Faltan ${this.cellsTotal - this.cells} celda(s) de energía` : 'La baliza ya está transmitiendo'),
      run: () => this.#activateBeacon(),
    });
    this.interactable({
      pos: () => this.dropship.interactPoint,
      radius: 4.2,
      prompt: () => 'Abordar la nave',
      can: () => this.dropship.state === 'ready',
      denied: () => 'La nave aún no ha aterrizado',
      run: () => this.#board(),
      disabled: true,
    });

    if (this.stage === 'boss') {
      this.#skipToBoss();
      return;
    }
    // enemigos por zonas (aparecen al acercarse: ahorra rendimiento)
    this.#zone('river', { x: 1, z: 12 }, 30, [['acechador', 3]], 9);
    this.#zone('west', P.west, 46, [['espectro', 2], ['acechador', 2], ['centinela', 1]], 11);
    this.#zone('east', P.east, 44, [['espectro', 3], ['centinela', 1]], 9);
    this.#zone('north', P.north, 44, [['espectro', 2], ['acechador', 3], ['centinela', 1]], 10);
    this.#zone('clearing', P.clearing, 40, [['espectro', 2]], 10);
    // celdas en posiciones generadas y validadas
    this.cellEntities = game.spawner.spawnCells([
      { name: 'Bosque oeste', center: new THREE.Vector3(P.west.x, 0, P.west.z), radius: 8 },
      { name: 'Cresta este', center: new THREE.Vector3(36, 0, -8), radius: 6 },
      { name: 'Ruinas del norte', center: new THREE.Vector3(P.north.x, 0, P.north.z), radius: 7 },
    ]);
    game.spawner.spawnSupplies(2, new THREE.Vector3(P.crash.x, 0, P.crash.z), 9);
    game.spawner.spawnSupplies(1, new THREE.Vector3(P.west.x, 0, P.west.z), 8);
    game.spawner.spawnSupplies(2, new THREE.Vector3(P.east.x, 0, P.east.z), 7);
    game.spawner.spawnSupplies(1, new THREE.Vector3(P.north.x, 0, P.north.z), 8);
    game.spawner.spawnSupplies(2, new THREE.Vector3(P.clearing.x, 0, P.clearing.z), 11);
    this.activate('cells');
    this.#updateCellWaypoint();

    game.radio.say([
      ['ruiz', 'NOVA-7, aquí la estación Vigía. Perdimos tu nave en el descenso. ¿Me recibes?'],
      ['nova', 'Integridad al cien por ciento. La nave no tuvo tanta suerte.'],
      ['ruiz', 'La carga quedó regada por el valle. Recupera tres celdas de energía para tu baliza de rescate.'],
      ['ruiz', 'Hay un dispersor entre los restos. Tómalo: algo se mueve en esa selva.'],
    ], { delay: 1.2 });
    game.bus.emit('hud:hint', { keys: ['W', 'A', 'S', 'D'], text: 'Muévete · Shift para correr · Espacio para saltar', delay: 2 });
    game.bus.emit('hud:hint', { keys: ['Clic'], text: 'Dispara · Clic derecho para apuntar · R recarga · 1-4 cambia de arma', delay: 9 });
    game.bus.emit('hud:hint', { keys: ['G'], text: 'Mantén G para apuntar la granada y suelta para lanzar · T cambia el tipo', delay: 17 });
    game.bus.emit('hud:hint', { keys: ['Q', 'F'], text: 'Q: pulso de choque · F: golpe cuerpo a cuerpo', delay: 25 });
  }

  #zone(name, c, radius, list, spread) {
    const center = new THREE.Vector3(c.x, heightAt(c.x, c.z), c.z);
    this.trigger(center, radius, () => {
      this.zones[name] = this.game.director.group(list, center, spread, { minPlayerDist: 16 });
    });
  }

  #updateCellWaypoint() {
    const player = this.game.player;
    const left = (this.cellEntities || []).filter((c) => c.alive);
    if (!left.length || !player) return;
    left.sort((a, b) => a.basePos.distanceTo(player.currPos) - b.basePos.distanceTo(player.currPos));
    this.setWaypoint(left[0].basePos, `Celda · ${left[0].zone}`, 'battery-charging');
  }

  #onCell() {
    const { game } = this;
    this.cells += 1;
    this.addScore(SCORE.cell, 'Celda de energía');
    this.objective('cells', { progress: { cur: this.cells, max: this.cellsTotal } });
    const log = LOGS[this.cells - 1];
    if (this.cells === 1) game.radio.say([['ibanez', log], ['ruiz', 'Esa es la Dra. Ibáñez… la Expedición Kepler. Las celdas guardaron sus registros.']]);
    else game.radio.say([['ibanez', log]]);
    if (this.cells >= this.cellsTotal) {
      this.objective('cells', { done: true });
      this.beacon.setReady();
      this.activate('beacon');
      this.setWaypoint(this.beacon.pos, 'Baliza de rescate', 'broadcast-pin');
      game.radio.say([['ruiz', 'Tienes las tres celdas. Vuelve al claro y activa la baliza con E.']]);
    } else {
      this.#updateCellWaypoint();
    }
  }

  #activateBeacon() {
    const { game } = this;
    if (!this.beacon.activate()) return;
    this.phase = 'defend';
    this.defendT = 0;
    this.waveIndex = 0;
    this.objective('beacon', { done: true });
    this.activate('defend');
    this.setWaypoint(null);
    this.addScore(250, 'Baliza activada');
    game.music?.setIntensity(2);
    game.radio.say([
      ['ruiz', 'Transmisión en curso. Quédate dentro del perímetro: si sales, la señal se detiene.'],
      ['eco', '…otra voz… otra mente que recordar…', 3.5],
      ['nova', 'Interferencia en la frecuencia. Contactos hostiles convergiendo.'],
    ]);
    for (let i = 0; i < 2; i++) game.spawner.spawnPickup('ammo', this.beacon.pos.clone().add(new THREE.Vector3(3 - i * 6, 0.5, 3)));
  }

  #onBeaconDone() {
    const { game } = this;
    this.objective('defend', { done: true, progress: { cur: 100, max: 100, unit: '%' } });
    this.addScore(600, 'Transmisión completada');
    this.hud.progress = null;
    this.phase = 'quake';
    this.quakeT = 0;
    this.checkpoint = { stage: 'boss' };
    game.saveCheckpoint?.();
    game.radio.say([
      ['ruiz', '¡Señal recibida! La nave Garza va en camino, llega en unos minutos.'],
      ['nova', 'Actividad sísmica bajo el cráter norte. Algo grande.'],
    ]);
  }

  #skipToBoss() {
    this.objective('cells', { done: true, progress: { cur: 3, max: 3 } });
    this.objective('beacon', { done: true });
    this.objective('defend', { done: true, progress: { cur: 100, max: 100, unit: '%' } });
    this.beacon.state = 'done';
    this.beacon.progress = 1;
    this.cells = 3;
    this.phase = 'quake';
    this.quakeT = 1.5;
    this.checkpoint = { stage: 'boss' };
    this.game.player.teleport(this.ground(0, -4), Math.PI);
    this.game.cameraRig.reset(this.game.player.chestPosition(), 0);
    this.game.spawner.spawnSupplies(3, new THREE.Vector3(P.clearing.x, 0, P.clearing.z), 11);
    this.game.radio.say([['ruiz', 'Retomamos desde la señal: algo se mueve bajo el cráter. Prepárate.']]);
  }

  #spawnBoss() {
    const { game } = this;
    this.phase = 'boss';
    this.bossStart = this.stats.time;
    this.activate('boss');
    this.setWaypoint(null);
    game.music?.setIntensity(3);
    this.boss = game.addEntity(new Matriarca(game, this.ground(P.crater.x, P.crater.z + 2), { onDefeated: () => this.#onBossDefeated() }));
    this.boss.faceToward(game.player.currPos, 1, 100);
    game.radio.say([
      ['ruiz', '¡Por todos los…! Es la madre de esas criaturas. ¡NOVA-7, retrocede!'],
      ['ruiz', 'Su caparazón es demasiado duro. Haz que embista contra los pilares de roca y dispara al saco luminoso de su espalda.'],
    ]);
  }

  #onBossDefeated() {
    const { game } = this;
    this.phase = 'extract';
    this.stats.bossTime = this.stats.time - (this.bossStart ?? this.stats.time);
    this.objective('boss', { done: true });
    this.addScore(SCORE.boss * 0.2, 'Jefe derrotado');
    this.activate('extract');
    game.director.purge();
    game.music?.setIntensity(0);
    this.dropship.arrive(7);
    this.interactables[1].disabled = false;
    this.setWaypoint(this.dropship.pos, 'Zona de aterrizaje', 'airplane-fill');
    game.radio.say([
      ['ruiz', '¡La derribaste! Garza está entrando al oeste del claro.'],
      ['eco', 'La madre descansa… pero yo sigo recordando. Ven al templo, pequeña máquina.', 5],
      ['nova', '¿Vigía, escucharon eso?'],
      ['ruiz', 'Lo escuchamos. Sube a la nave: vamos a averiguar qué es.'],
    ]);
  }

  #board() {
    const { game } = this;
    this.phase = 'done';
    game.player.controlEnabled = false;
    game.player.wave();
    game.audio.play('dropship');
    this.addScore(300, 'Extracción');
    this.objective('extract', { done: true });
    this.game.after(1.2, () => this.complete());
  }

  tick(dt) {
    if (this.waterNormal) this.waterNormal.offset.x += dt * 0.02;
    if (this.menuMode || this.game.state !== 'playing') return;
    const { game } = this;
    if (this.phase === 'cells') {
      this.wpT = (this.wpT ?? 0) - dt;
      if (this.wpT <= 0) {
        this.wpT = 1;
        this.#updateCellWaypoint();
      }
    } else if (this.phase === 'defend') {
      this.defendT += dt;
      const pct = Math.round(this.beacon.progress * 100);
      this.objective('defend', { progress: { cur: pct, max: 100, unit: '%' } });
      this.hud.progress = { label: this.beacon.inside ? 'Transmisión' : '¡Vuelve al perímetro!', value: this.beacon.progress, warn: !this.beacon.inside };
      const waves = [
        { at: 2, list: [['acechador', 4], ['espectro', 2]] },
        { at: 17, list: [['centinela', 2], ['espectro', 2], ['acechador', 2]] },
        { at: 32, list: [['acechador', 5], ['elite', 1], ['espectro', 1]] },
      ];
      const w = waves[this.waveIndex];
      if (w && this.beacon.progress * 50 >= w.at) {
        this.waveIndex++;
        game.director.wave(w.list, this.beacon.pos, 24, { interval: 0.7, minPlayerDist: 13 });
        game.bus.emit('hud:toast', { text: `Oleada ${this.waveIndex} de 3`, type: 'danger', icon: 'exclamation-diamond-fill' });
        if (this.waveIndex === 2) game.spawner.spawnPickup('health', this.beacon.pos.clone().add(new THREE.Vector3(0, 0.5, -4)));
      }
    } else if (this.phase === 'quake') {
      this.quakeT += dt;
      game.cameraRig.shake(dt * 0.6);
      if (Math.random() < dt * 3) game.audio.play('rumble');
      if (this.quakeT > 5.5) this.#spawnBoss();
    }
  }
}
