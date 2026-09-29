/**
 * NIVEL 2 — El Templo de los Ecos (Ruinas de Ashkar).
 *
 * Campo de ruinas al sur, un abismo que se cruza por dos puentes de piedra,
 * la gran plaza con columnatas, terrazas con los pilones de resonancia y el
 * patio frente a la puerta del templo.
 *
 * Guion: cruzar → derribar 3 pilones (torres de bloques con física) → la
 * puerta se abre y sale el Coloso → derrotarlo → entrar al templo.
 */
import * as THREE from 'three';
import { LevelBase } from './LevelBase.js';
import { fbm2, smooth, mix, canyonWalls, heightAt } from '../world/TerrainField.js';
import { ResonancePylon, TempleGate } from '../entities/Interactables.js';
import { StoneBlock } from '../entities/Props.js';
import { Coloso } from '../bosses/Coloso.js';
import { SCORE } from '../config.js';

const gauss = (x, z, cx, cz, r) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));
const flatten = (h, x, z, c, r, target) => mix(target, h, smooth(r * 0.55, r, Math.hypot(x - c.x, z - c.z)));
const CHASM_Z = 19;

const P = {
  spawn: { x: 0, z: 49 },
  south: { x: -4, z: 31 },
  plaza: { x: 0, z: -6 },
  court: { x: 0, z: -37 },
  pylonW: { x: -38, z: -10 },
  pylonE: { x: 38, z: -14 },
  pylonN: { x: 0, z: -30 },
  bridgeW: -20,
  bridgeE: 22,
  gate: { x: 0, z: -55 },
};

function height(x, z) {
  let h = (fbm2(x * 0.045 + 7, z * 0.045 + 2, 4) - 0.5) * 3.2;
  h += smooth(14, 4, z) * 3;
  h += 1.6 * gauss(x, z, -28, 36, 10) + 1.3 * gauss(x, z, 28, 38, 9);
  h += 2.4 * gauss(x, z, P.pylonW.x, P.pylonW.z, 10) + 2.4 * gauss(x, z, P.pylonE.x, P.pylonE.z, 10);
  h = flatten(h, x, z, P.spawn, 10, 0);
  h = flatten(h, x, z, P.plaza, 21, 3);
  h = flatten(h, x, z, P.court, 18, 3);
  h = flatten(h, x, z, P.pylonW, 7, 5.3);
  h = flatten(h, x, z, P.pylonE, 7, 5.3);
  for (const bx of [P.bridgeW, P.bridgeE]) {
    h = flatten(h, x, z, { x: bx, z: CHASM_Z + 6.4 }, 4.5, 0.05);
    h = flatten(h, x, z, { x: bx, z: CHASM_Z - 6.4 }, 4.5, 0.25);
  }
  // abismo
  h = mix(-42, h, smooth(3.6, 5.3, Math.abs(z - CHASM_Z)));
  // pasillo hacia el interior del templo
  const corridor = z < -50 ? smooth(4.2, 7.5, Math.abs(x)) : 1;
  if (z < -50) h = mix(3, h, corridor);
  h += canyonWalls(x, z, 58, 32) * corridor;
  return h;
}
const isVoid = (x, z) => Math.abs(z - CHASM_Z) < 4.3;

export const PALETTE_L2 = {
  skyTop: 0x0a0618,
  skyHorizon: 0x2a1c4a,
  fog: 0x191230,
  fogDensity: 0.02,
  moonColor: 0xc0b0ff,
  hemiSky: 0x5a4a9a,
  hemiGround: 0x140e1c,
  auroraA: 0xb070ff,
  auroraB: 0xff5ad8,
  aurora: 1.1,
  spores: 0xd6a8ff,
  exposure: 1.18,
};

export class Level2 extends LevelBase {
  constructor(game, opts) {
    super(game, 2, opts);
    this.pylonsDown = 0;
    this.pylons = [];
    this.phase = 'cross';
  }

  build() {
    const { game } = this;
    const M = game.assets.materials;
    game.env.applyPalette(PALETTE_L2);
    this.setTerrain(height, isVoid, { veinColor: new THREE.Color(0xb070ff), veinIntensity: 1.8, voidY: -4 });
    this.spawn.pos.set(P.spawn.x, heightAt(P.spawn.x, P.spawn.z), P.spawn.z);
    this.spawn.yaw = Math.PI;

    // ---------------------------------------------------- calzada de entrada
    for (let i = 0; i < 5; i++) {
      const z = 44 - i * 4;
      for (const sx of [-1, 1]) this.lumen(this.ground(sx * 4.5, z), 0xb070ff);
    }
    // ruinas del campo sur
    const walls = [[-12, 36, 6, 0.3], [9, 30, 5, -0.5], [-20, 28, 4, 1.2], [16, 40, 5, 0.9], [-4, 25, 3, 0], [24, 27, 4, -0.2]];
    for (const [x, z, w, r] of walls) {
      const y = heightAt(x, z);
      this.box(new THREE.Vector3(x, y + 1, z), new THREE.Vector3(w, 2 + (w % 2), 0.9), { rotY: r, material: M.ruin });
    }
    for (const [x, z, h] of [[-8, 42, 5], [7, 36, 3.5], [-25, 40, 6], [27, 33, 4], [3, 27, 5]]) this.column(this.ground(x, z).setY(heightAt(x, z) - 0.2), h, 0.75, { broken: h < 5 });
    this.crates(new THREE.Vector3(12, 0, 44), 3);
    this.canisters(new THREE.Vector3(-15, 0, 32), 2, 1);

    // ---------------------------------------------------- puentes sobre el abismo
    for (const bx of [P.bridgeW, P.bridgeE]) this.#bridge(bx);

    // ---------------------------------------------------- plaza y columnatas
    const py = 3;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.13;
      const x = P.plaza.x + Math.cos(a) * 17;
      const z = P.plaza.z + Math.sin(a) * 17;
      if (Math.abs(x) < 6 && z > 0) continue; // entrada sur libre
      if (i % 3 === 1) this.#drumColumn(new THREE.Vector3(x, py, z));
      else this.column(new THREE.Vector3(x, py - 0.2, z), 6 + (i % 2) * 2, 0.9, { broken: i % 4 === 0 });
    }
    // estrado central
    this.box(new THREE.Vector3(0, py + 0.3, -6), new THREE.Vector3(8, 0.6, 8), { material: M.ruinPlain });
    this.box(new THREE.Vector3(0, py + 0.8, -6), new THREE.Vector3(4, 0.4, 4), { material: M.ruin });
    for (const [x, z, r] of [[-9, 2, 0.2], [10, -12, -0.4], [-11, -14, 0.9], [8, 4, 1.4]]) this.box(new THREE.Vector3(x, py + 0.7, z), new THREE.Vector3(3, 1.4, 0.8), { rotY: r, material: M.ruin });
    this.canisters(new THREE.Vector3(-6, 0, -16), 2, 1);
    this.canisters(new THREE.Vector3(14, 0, 0), 2, 1);

    // ---------------------------------------------------- terrazas de los pilones
    for (const c of [P.pylonW, P.pylonE]) {
      const y = heightAt(c.x, c.z);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        this.column(new THREE.Vector3(c.x + Math.cos(a) * 6, y - 0.2, c.z + Math.sin(a) * 6), 4.5, 0.7, { broken: i % 2 === 0 });
      }
      this.canisters(new THREE.Vector3(c.x + 3, 0, c.z + 2.5), 2, 0.9);
    }

    // ---------------------------------------------------- patio y fachada del templo
    const gy = 3;
    this.gate = this.addEntity(new TempleGate(game, new THREE.Vector3(P.gate.x, gy, P.gate.z), 0));
    // fachada con hueco para la puerta
    this.box(new THREE.Vector3(-20, gy + 11, P.gate.z - 4.5), new THREE.Vector3(26, 22, 6), { material: M.ruin, tile: 4 });
    this.box(new THREE.Vector3(20, gy + 11, P.gate.z - 4.5), new THREE.Vector3(26, 22, 6), { material: M.ruin, tile: 4 });
    this.box(new THREE.Vector3(0, gy + 17.5, P.gate.z - 4.5), new THREE.Vector3(14, 9, 6), { material: M.ruin, tile: 4 });
    // pasillo interior (paredes y techo)
    this.box(new THREE.Vector3(-5.6, gy + 6, P.gate.z - 13), new THREE.Vector3(1.2, 12, 16), { material: M.ruinPlain });
    this.box(new THREE.Vector3(5.6, gy + 6, P.gate.z - 13), new THREE.Vector3(1.2, 12, 16), { material: M.ruinPlain });
    this.box(new THREE.Vector3(0, gy + 12.5, P.gate.z - 13), new THREE.Vector3(12.4, 1, 16), { material: M.ruinPlain });
    this.box(new THREE.Vector3(0, gy + 6, P.gate.z - 21.5), new THREE.Vector3(12, 12, 1), { material: M.ruin });
    this.innerGlow = game.fx.createGlowSprite(0xff38c8, 9);
    this.innerGlow.position.set(0, gy + 3, P.gate.z - 18);
    this.root.add(this.innerGlow);
    // estatuas/obeliscos del patio
    for (const sx of [-1, 1]) {
      this.box(new THREE.Vector3(sx * 11, gy + 4, P.gate.z + 4), new THREE.Vector3(2, 8, 2), { material: M.ruin });
      this.lumen(new THREE.Vector3(sx * 8, gy, P.gate.z + 8), 0xff5ad8);
      this.column(new THREE.Vector3(sx * 21, gy - 0.2, -26), 7, 0.9);
      this.column(new THREE.Vector3(sx * 21, gy - 0.2, -46), 7, 0.9, { broken: sx > 0 });
    }
    for (const [x, z, r] of [[-12, -30, 0.3], [13, -42, -0.2], [6, -26, 1.1], [-7, -45, 0.7]]) this.box(new THREE.Vector3(x, gy + 0.75, z), new THREE.Vector3(3.4, 1.5, 0.9), { rotY: r, material: M.ruin });

    // ---------------------------------------------------- pilones de resonancia (derribables)
    if (!this.menuMode && this.stage === 'start') {
      const defs = [
        [P.pylonW, 'Pilón oeste', 0.3],
        [P.pylonE, 'Pilón este', -0.4],
        [P.pylonN, 'Pilón del patio', 0],
      ];
      for (const [c, name, rot] of defs) {
        const pylon = new ResonancePylon(game, this.ground(c.x, c.z), { name, rotY: rot, hp: 260 * game.difficulty.enemyHp, onDestroyed: (p, how) => this.#onPylon(p, how) });
        this.addEntity(pylon);
        this.pylons.push(pylon);
      }
      this.weaponPickup('rail', new THREE.Vector3(P.bridgeW, 0, CHASM_Z));
    }

    // ---------------------------------------------------- vegetación (escasa, entre ruinas)
    this.vegetation({
      area: { minX: -56, maxX: 56, minZ: -50, maxZ: 56 },
      seed: 23,
      trees: 26,
      mushrooms: 30,
      ferns: 260,
      grass: 700,
      flowers: 380,
      maxY: 7,
      podColor: 0xd08aff,
      capColor: 0x3a2a7a,
      gillColor: 0xb070ff,
      blocks: [
        { ...P.spawn, r: 7 }, { x: 0, z: 36, r: 5 }, { ...P.plaza, r: 20 }, { ...P.court, r: 18 },
        { ...P.pylonW, r: 8 }, { ...P.pylonE, r: 8 }, { x: P.bridgeW, z: CHASM_Z, r: 9 }, { x: P.bridgeE, z: CHASM_Z, r: 9 },
      ],
      predicate: (x, z) => Math.abs(z - CHASM_Z) > 7 && !(z < -50),
    });
  }

  /** Puente de losas de piedra sobre el abismo. */
  #bridge(bx) {
    const M = this.game.assets.materials;
    const len = 13.5;
    this.box(new THREE.Vector3(bx, -0.25, CHASM_Z), new THREE.Vector3(4.4, 0.5, len), { material: M.ruinPlain });
    for (const sx of [-1, 1]) {
      this.box(new THREE.Vector3(bx + sx * 2.35, 0.35, CHASM_Z), new THREE.Vector3(0.35, 0.7, len), { material: M.ruin });
    }
    // arcos inferiores (decorativos)
    this.box(new THREE.Vector3(bx, -3, CHASM_Z), new THREE.Vector3(3.6, 5, 1.6), { material: M.ruin, collider: false });
    this.lumen(new THREE.Vector3(bx - 2.3, 0.7, CHASM_Z + 6.5), 0xb070ff);
    this.lumen(new THREE.Vector3(bx + 2.3, 0.7, CHASM_Z - 6.5), 0xb070ff);
  }

  /** Columna de tambores de piedra (bloques dinámicos): se puede derribar. */
  #drumColumn(base) {
    const { game } = this;
    for (let k = 0; k < 4; k++) {
      game.addEntity(new StoneBlock(game, new THREE.Vector3(base.x, base.y + 0.61 + k * 1.21, base.z), new THREE.Vector3(1.4, 1.2, 1.4), { rotY: k * 0.2, sleeping: true, glyphs: k % 2 === 0 }));
    }
  }

  // ================================================================ guion
  start() {
    const { game } = this;
    this.setObjectives([
      { id: 'cross', text: 'Cruza las ruinas hasta la gran plaza' },
      { id: 'pylons', text: 'Destruye los pilones de resonancia', progress: { cur: 0, max: 3 } },
      { id: 'boss', text: 'Derrota al Coloso' },
      { id: 'enter', text: 'Entra al templo' },
    ]);
    this.subs.push(game.bus.on('gate:open', () => this.#onGateOpen()));

    if (this.stage === 'boss') {
      this.#skipToBoss();
      return;
    }
    this.activate('cross');
    this.setWaypoint(new THREE.Vector3(0, 3, -6), 'Gran plaza', 'flag-fill');
    this.trigger(new THREE.Vector3(P.plaza.x, 3, P.plaza.z), 17, () => {
      this.objective('cross', { done: true });
      this.addScore(200, 'Plaza alcanzada');
      this.activate('pylons');
      this.phase = 'pylons';
      game.radio.say([
        ['nova', 'Tres fuentes de resonancia confirmadas: oeste, este y el patio del templo.'],
        ['ruiz', 'Destruye los cristales… o derriba las torres que los sostienen. Lo que te resulte más divertido.'],
      ]);
    });
    // zonas de enemigos
    this.#zone({ x: -4, z: 30 }, 22, [['acechador', 3], ['espectro', 2]], 10);
    this.#zone({ x: 0, z: 8 }, 30, [['espectro', 2], ['centinela', 2]], 12);
    this.#zone(P.plaza, 26, [['acechador', 3], ['espectro', 1]], 12);
    this.#zone(P.pylonW, 38, [['espectro', 2], ['centinela', 1]], 8);
    this.#zone(P.pylonE, 38, [['bastion', 1], ['acechador', 2]], 8);
    this.#zone(P.pylonN, 32, [['bastion', 1], ['espectro', 2]], 9);

    game.spawner.spawnSupplies(2, new THREE.Vector3(0, 0, 36), 10);
    game.spawner.spawnSupplies(1, new THREE.Vector3(0, 0, 9), 8);
    game.spawner.spawnSupplies(2, new THREE.Vector3(P.plaza.x, 0, P.plaza.z), 14);
    game.spawner.spawnSupplies(1, new THREE.Vector3(P.pylonW.x, 0, P.pylonW.z), 6);
    game.spawner.spawnSupplies(1, new THREE.Vector3(P.pylonE.x, 0, P.pylonE.z), 6);
    game.spawner.spawnSupplies(2, new THREE.Vector3(P.court.x, 0, P.court.z), 14);

    game.radio.say([
      ['ruiz', 'Ruinas de Ashkar. Los registros de la Dra. Ibáñez terminan aquí, frente al templo.'],
      ['nova', 'Detecto un campo de energía sellando la puerta. Lo alimentan tres pilones de cristal.'],
      ['ruiz', 'Cuidado con el abismo. Hay dos puentes… y en el oeste veo un rifle de riel de la expedición.'],
    ], { delay: 1 });
  }

  #zone(c, radius, list, spread) {
    const center = new THREE.Vector3(c.x, heightAt(c.x, c.z), c.z);
    this.trigger(center, radius, () => this.game.director.group(list, center, spread, { minPlayerDist: 15 }));
  }

  #onPylon(pylon, how) {
    const { game } = this;
    this.pylonsDown += 1;
    this.addScore(SCORE.pylon, how === 'toppled' ? 'Pilón derribado (¡física!)' : 'Pilón destruido');
    this.objective('pylons', { progress: { cur: this.pylonsDown, max: 3 } });
    if (how === 'toppled') game.bus.emit('hud:toast', { text: '¡Torre derribada! +500', type: 'gold', icon: 'bricks' });
    const lines = [
      [['eco', '¿Por qué rompes mis recuerdos, pequeña máquina?', 4]],
      [['ruiz', 'Uno más y el sello cae.']],
      [['ruiz', '¡El sello cayó! La puerta se está abriendo…'], ['nova', 'Firma térmica masiva detrás de la puerta. Se mueve.']],
    ];
    game.radio.say(lines[Math.min(2, this.pylonsDown - 1)]);
    if (this.pylonsDown >= 3) {
      this.objective('pylons', { done: true });
      this.phase = 'gate';
      this.setWaypoint(null);
      this.gate.unseal();
      setTimeout(() => this.gate.openDoors(), 1500);
    }
  }

  #skipToBoss() {
    const { game } = this;
    this.objective('cross', { done: true });
    this.objective('pylons', { done: true, progress: { cur: 3, max: 3 } });
    this.pylonsDown = 3;
    this.gate.sealed = false;
    this.gate.barrier.visible = false;
    this.gate.openDoors();
    this.phase = 'gate';
    game.player.teleport(new THREE.Vector3(0, 3, -16), Math.PI);
    game.cameraRig.reset(game.player.chestPosition(), 0);
    game.spawner.spawnSupplies(3, new THREE.Vector3(P.court.x, 0, P.court.z + 6), 14);
    game.radio.say([['ruiz', 'Retomamos frente al templo. La puerta se abre… prepárate.']]);
  }

  #onGateOpen() {
    const { game } = this;
    if (this.phase !== 'gate') return;
    this.phase = 'boss';
    this.bossStart = this.stats.time;
    this.checkpoint = { stage: 'boss' };
    game.saveCheckpoint?.();
    this.activate('boss');
    game.music?.setIntensity(3);
    const start = new THREE.Vector3(0, 3.2, P.gate.z - 9);
    this.boss = game.addEntity(new Coloso(game, start, {
      walkTo: new THREE.Vector3(0, 3, P.court.z + 2),
      nodes1: [new THREE.Vector3(-17, 3, -36), new THREE.Vector3(17, 3, -38)],
      nodes2: [new THREE.Vector3(-25, 3, -5), new THREE.Vector3(25, 3, -8), new THREE.Vector3(0, 3, 10)],
      onDefeated: () => this.#onBossDefeated(),
    }));
    this.boss.facing = 0;
    game.radio.say([
      ['ruiz', 'Es… la excavadora de la expedición. El Eco la fusionó con cristal.'],
      ['ruiz', 'Su escudo lo alimentan esos nodos. Rómpelos y apunta a la cabeza.'],
      ['ruiz', 'Y cuando pisotee el suelo… ¡salta!'],
    ]);
    this.subs.push(game.bus.on('boss:nodes', ({ left }) => {
      if (left === 3 && this.boss && this.boss.phaseIndex === 2) game.radio.say([['eco', 'Él también recuerda. Y no quiere olvidar.', 3.5]]);
    }));
  }

  #onBossDefeated() {
    const { game } = this;
    this.phase = 'enter';
    this.stats.bossTime = this.stats.time - (this.bossStart ?? this.stats.time);
    this.objective('boss', { done: true });
    this.addScore(SCORE.boss * 0.2, 'Jefe derrotado');
    this.activate('enter');
    game.director.purge();
    game.music?.setIntensity(0);
    this.setWaypoint(new THREE.Vector3(0, 3, P.gate.z - 6), 'Interior del templo', 'door-open-fill');
    game.radio.say([
      ['ruiz', 'Cayó el gigante. La puerta está abierta: entra, NOVA-7.'],
      ['eco', 'Ven… te mostraré todo lo que recuerdo.', 3.5],
    ]);
    this.trigger(new THREE.Vector3(0, 3, P.gate.z - 7), 3.5, () => {
      this.objective('enter', { done: true });
      game.player.controlEnabled = false;
      this.addScore(300, 'Templo alcanzado');
      setTimeout(() => this.complete(), 900);
    });
  }

  tick(dt) {
    if (this.menuMode || this.game.state !== 'playing') return;
    if (this.phase === 'pylons') {
      this.wpT = (this.wpT ?? 0) - dt;
      if (this.wpT <= 0) {
        this.wpT = 1;
        const player = this.game.player;
        const left = this.pylons.filter((p) => !p.destroyed);
        if (left.length && player) {
          left.sort((a, b) => a.pos.distanceTo(player.currPos) - b.pos.distanceTo(player.currPos));
          this.setWaypoint(left[0].center.clone().setY(left[0].pos.y + 6), left[0].label, 'gem');
        }
      }
    }
    if (this.innerGlow) this.innerGlow.material.opacity = 0.5 + Math.sin(this.game.time * 1.5) * 0.2;
  }
}
