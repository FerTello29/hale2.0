/**
 * LevelBase — infraestructura común de los niveles de la campaña:
 *
 *  - Construcción: terreno, paleta del entorno, vegetación y utilidades para
 *    geometría estática con collider (muros, columnas, pilares de roca…).
 *  - Objetivos y progreso (el HUD se entera por eventos), puntaje y estadísticas.
 *  - Disparadores por zona, interactuables (tecla E) y punto de referencia
 *    (waypoint) que el HUD proyecta en pantalla.
 *  - Reglas de derrota (muerte, caída) y cálculo del resultado del nivel.
 */
import * as THREE from 'three';
import { Terrain } from '../world/Terrain.js';
import { Vegetation } from '../world/Vegetation.js';
import { setHeightFunction, heightAt, isVoid } from '../world/TerrainField.js';
import { boxWithWorldUV } from '../core/AssetLibrary.js';
import { COLLISION, SCORE } from '../config.js';
import { LEVELS } from '../gameplay/Story.js';
import { Crate, Canister } from '../entities/Props.js';
import { WeaponPickup, HealthPack, AmmoPack, GrenadePack } from '../entities/Pickups.js';

const yawQuat = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

export const LEVEL_RANKS = [
  { min: 11000, rank: 'S', label: 'Leyenda de Orión' },
  { min: 8500, rank: 'A', label: 'Comando de élite' },
  { min: 6000, rank: 'B', label: 'Veterano curtido' },
  { min: 0, rank: 'C', label: 'Recluta con suerte' },
];

export class LevelBase {
  constructor(game, index, opts = {}) {
    this.game = game;
    this.index = index;
    this.info = LEVELS[index - 1];
    this.opts = opts;
    this.stage = opts.stage ?? 'start';
    this.menuMode = !!opts.menu;
    this.root = new THREE.Group();
    this.root.name = `Nivel${index}`;
    game.scene.add(this.root);
    this.geometries = [];
    this.materials = [];
    this.objectives = [];
    this.triggers = [];
    this.interactables = [];
    this.markers = [];
    this.waypoint = null;
    this.hud = { timer: null, progress: null };
    this.score = opts.score ?? 0;
    this.stats = { kills: 0, headshots: 0, time: opts.time ?? 0, bossTime: 0, ...(opts.stats || {}) };
    this.finished = false;
    this.spawn = { pos: new THREE.Vector3(), yaw: Math.PI };
    this.lastSafe = new THREE.Vector3();
    this.safeTimer = 0;
    this.checkpoint = null;
    this.subs = [];
  }

  // ================================================================ construcción
  /** Implementado por cada nivel. */
  build() {}

  /** Implementado por cada nivel: arranca el guion al empezar a jugar. */
  start() {}

  setTerrain(heightFn, voidFn, palette) {
    setHeightFunction(heightFn, voidFn);
    this.terrain = new Terrain(this.game, palette);
    this.terrain.build(this.root);
  }

  vegetation(cfg) {
    this.flora = new Vegetation(this.game, this.root);
    for (const b of cfg.blocks || []) this.flora.block(b.x, b.z, b.r);
    this.flora.build(cfg);
    return this.flora;
  }

  #track(geo, mat) {
    if (geo) this.geometries.push(geo);
    if (mat) this.materials.push(mat);
  }

  /** Caja estática con textura a escala real y collider cuboide. */
  box(pos, size, { rotY = 0, rotX = 0, rotZ = 0, material, collider = true, tile = 2.5, shadow = true } = {}) {
    const geo = boxWithWorldUV(size.x, size.y, size.z, tile);
    this.#track(geo);
    const mesh = new THREE.Mesh(geo, material ?? this.game.assets.materials.stone);
    mesh.position.copy(pos);
    mesh.rotation.set(rotX, rotY, rotZ);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    let c = null;
    if (collider) {
      const R = this.game.physics.R;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ));
      c = this.game.physics.createStatic(
        R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(pos.x, pos.y, pos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.9).setCollisionGroups(COLLISION.world)
      );
    }
    return { mesh, collider: c };
  }

  /** Columna de piedra (cilindro) con collider. */
  column(pos, height, radius = 0.9, { material, broken = false } = {}) {
    const geo = new THREE.CylinderGeometry(radius * 0.92, radius, height, 12, 3);
    if (broken) {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > height / 2 - 0.01) p.setY(i, p.getY(i) - Math.random() * 0.9);
      }
      geo.computeVertexNormals();
    }
    this.#track(geo);
    const mesh = new THREE.Mesh(geo, material ?? this.game.assets.materials.ruin);
    mesh.position.set(pos.x, pos.y + height / 2, pos.z);
    mesh.castShadow = mesh.receiveShadow = true;
    this.root.add(mesh);
    const capGeo = new THREE.BoxGeometry(radius * 2.4, 0.5, radius * 2.4);
    this.#track(capGeo);
    if (!broken) {
      const cap = new THREE.Mesh(capGeo, this.game.assets.materials.ruinPlain);
      cap.position.set(pos.x, pos.y + height + 0.25, pos.z);
      cap.castShadow = cap.receiveShadow = true;
      this.root.add(cap);
    }
    const base = new THREE.Mesh(capGeo, this.game.assets.materials.ruinPlain);
    base.position.set(pos.x, pos.y + 0.25, pos.z);
    base.receiveShadow = true;
    this.root.add(base);
    const R = this.game.physics.R;
    this.game.physics.createStatic(R.ColliderDesc.cylinder(height / 2, radius).setTranslation(pos.x, pos.y + height / 2, pos.z).setCollisionGroups(COLLISION.world));
    return mesh;
  }

  /** Pilar de roca alienígena con vetas luminosas. */
  rockPillar(pos, height, radius, seed = 1) {
    const geo = new THREE.CylinderGeometry(radius * 0.55, radius, height, 9, 6);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const n = Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 + y * 0.8 + seed * 2) * 0.18 + Math.sin(y * 1.3 + seed) * 0.08;
      p.setXYZ(i, x * (1 + n), y, z * (1 + n));
    }
    geo.computeVertexNormals();
    this.#track(geo);
    const mesh = new THREE.Mesh(geo, this.game.assets.materials.rock);
    mesh.position.set(pos.x, pos.y + height / 2 - 0.4, pos.z);
    mesh.rotation.set((Math.sin(seed) * 0.08), seed, Math.cos(seed) * 0.08);
    mesh.castShadow = mesh.receiveShadow = true;
    this.root.add(mesh);
    const R = this.game.physics.R;
    this.game.physics.createStatic(R.ColliderDesc.cylinder(height / 2, radius * 0.85).setTranslation(pos.x, pos.y + height / 2 - 0.4, pos.z).setCollisionGroups(COLLISION.world));
    return mesh;
  }

  /** Farol de cristal decorativo (sin luz real: brillo + bloom). */
  lumen(pos, color = 0x45f5ff) {
    const m = this.game.assets.cloneProp('LumenPost');
    m.position.copy(pos);
    m.rotation.y = Math.random() * Math.PI;
    this.root.add(m);
    const g = this.game.fx.createGlowSprite(color, 2.4);
    g.position.set(pos.x, pos.y + 2.95, pos.z);
    this.root.add(g);
    const R = this.game.physics.R;
    this.game.physics.createStatic(R.ColliderDesc.cylinder(1.3, 0.18).setTranslation(pos.x, pos.y + 1.3, pos.z).setCollisionGroups(COLLISION.world));
    return m;
  }

  ground(x, z) {
    return new THREE.Vector3(x, heightAt(x, z), z);
  }

  addEntity(e) {
    return this.game.addEntity(e);
  }

  crates(center, n, { spread = 2.4, stack = true } = {}) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + center.x;
      const x = center.x + Math.cos(a) * spread * (0.5 + (i % 2) * 0.5);
      const z = center.z + Math.sin(a) * spread * (0.5 + (i % 2) * 0.5);
      const y = heightAt(x, z) + 0.52;
      this.addEntity(new Crate(this.game, new THREE.Vector3(x, y, z), { rotY: a }));
      if (stack && i % 3 === 0) this.addEntity(new Crate(this.game, new THREE.Vector3(x, y + 1.02, z), { rotY: a + 0.3 }));
    }
  }

  canisters(center, n, spread = 2) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.7;
      const x = center.x + Math.cos(a) * spread;
      const z = center.z + Math.sin(a) * spread;
      this.addEntity(new Canister(this.game, new THREE.Vector3(x, heightAt(x, z) + 0.6, z), { rotY: a }));
    }
  }

  weaponPickup(id, pos) {
    return this.addEntity(new WeaponPickup(this.game, pos, id));
  }

  pickup(kind, pos) {
    const C = kind === 'health' ? HealthPack : kind === 'grenade' ? GrenadePack : AmmoPack;
    return this.addEntity(new C(this.game, pos));
  }

  // ================================================================ objetivos
  setObjectives(list) {
    this.objectives = list.map((o) => ({ done: false, active: false, ...o }));
    this.#emitObjectives();
  }

  objective(id, patch) {
    const o = this.objectives.find((x) => x.id === id);
    if (!o) return;
    const wasDone = o.done;
    Object.assign(o, patch);
    if (!wasDone && o.done) {
      o.active = false;
      this.game.audio.play('objective');
      this.game.bus.emit('objective:done', { id, text: o.text });
    }
    this.#emitObjectives();
  }

  activate(id) {
    for (const o of this.objectives) o.active = o.id === id && !o.done;
    this.#emitObjectives();
  }

  #emitObjectives() {
    this.game.bus.emit('objectives:set', { title: `${this.info.code} · ${this.info.title}`, list: this.objectives });
  }

  addScore(points, reason) {
    this.score += Math.round(points);
    if (reason) this.game.bus.emit('score:add', { points: Math.round(points), reason });
  }

  // ================================================================ disparadores e interacción
  trigger(center, radius, fn, { once = true, height = Infinity } = {}) {
    const t = { center: center.clone(), radius, fn, once, height, done: false };
    this.triggers.push(t);
    return t;
  }

  /**
   * Interactuable: { pos(), radius, prompt(), can(), run() }
   */
  interactable(def) {
    this.interactables.push(def);
    return def;
  }

  /** Texto a mostrar si el jugador está al alcance de algo. */
  currentPrompt() {
    const p = this.game.player?.currPos;
    if (!p) return null;
    for (const it of this.interactables) {
      if (it.disabled) continue;
      if (p.distanceTo(it.pos()) < (it.radius ?? 3.5)) return { text: it.prompt(), ok: it.can() };
    }
    return null;
  }

  interact() {
    const p = this.game.player?.currPos;
    if (!p) return;
    for (const it of this.interactables) {
      if (it.disabled) continue;
      if (p.distanceTo(it.pos()) < (it.radius ?? 3.5)) {
        if (it.can()) it.run();
        else {
          this.game.audio.play('denied');
          if (it.denied) this.game.bus.emit('hud:toast', { text: it.denied(), type: 'danger', icon: 'lock-fill' });
        }
        return;
      }
    }
  }

  setWaypoint(pos, label, icon = 'geo-alt-fill') {
    this.waypoint = pos ? { pos: pos.clone(), label, icon } : null;
  }

  // ================================================================ ciclo
  begin() {
    // estadísticas: muertes de enemigos y puntuación
    this.subs.push(
      this.game.bus.on('enemy:killed', (e) => {
        if (e.source !== 'player' && !e.boss) return;
        this.stats.kills += 1;
        let pts = e.score ?? 50;
        if (e.headshot) {
          this.stats.headshots += 1;
          pts += SCORE.headshot;
        }
        this.addScore(pts);
        this.game.bus.emit('hud:kill', { name: e.name, points: pts, headshot: e.headshot, boss: e.boss });
      })
    );
    const p = this.game.player.feetPosition;
    this.lastSafe.copy(p);
    this.start();
  }

  update(dt) {
    if (this.terrain) this.terrain.update(dt);
    Vegetation.update(dt);
    if (this.menuMode || this.game.state !== 'playing') {
      this.tick?.(dt);
      return;
    }
    this.stats.time += dt;
    const player = this.game.player;
    if (player && !player.dead) {
      // última posición segura (para reaparecer tras una caída)
      this.safeTimer -= dt;
      if (this.safeTimer <= 0 && player.grounded) {
        this.safeTimer = 0.5;
        const f = player.feetPosition;
        if (!isVoid(f.x, f.z) && !isVoid(f.x + 1.5, f.z) && !isVoid(f.x - 1.5, f.z) && !isVoid(f.x, f.z + 1.5) && !isVoid(f.x, f.z - 1.5)) this.lastSafe.copy(f);
      }
      for (const t of this.triggers) {
        if (t.done) continue;
        const d = Math.hypot(player.currPos.x - t.center.x, player.currPos.z - t.center.z);
        if (d < t.radius && Math.abs(player.currPos.y - t.center.y) < t.height) {
          if (t.once) t.done = true;
          t.fn(t);
        }
      }
      this.triggers = this.triggers.filter((t) => !t.done);
    }
    this.tick?.(dt);
  }

  onPlayerFell() {
    const player = this.game.player;
    if (!player || player.dead) return;
    if (this.fallIsDeath) {
      player.damage(9999, { source: 'world', kind: 'fall' });
      return;
    }
    this.game.audio.play('fall');
    player.teleport(this.lastSafe.clone().setY(this.lastSafe.y + 0.5));
    player.damage(25, { source: 'world', kind: 'fall' });
    this.game.bus.emit('hud:toast', { text: 'Caíste al vacío · −25 de integridad', type: 'danger', icon: 'arrow-down-circle' });
  }

  onPlayerDied(cause) {
    const reasons = {
      fall: 'NOVA-7 cayó al abismo.',
      bolt: 'NOVA-7 fue abatido por fuego enemigo.',
      bite: 'Los acechadores despedazaron a NOVA-7.',
      explosion: 'Una explosión destruyó a NOVA-7.',
      charge: 'La embestida de la Matriarca aplastó a NOVA-7.',
      punch: 'El Coloso aplastó a NOVA-7.',
      shockwave: 'La onda de choque destrozó a NOVA-7.',
      ring: 'El anillo de choque del Eco desintegró a NOVA-7.',
      laser: 'El rayo del Eco atravesó a NOVA-7.',
      homing: 'Los orbes del Eco alcanzaron a NOVA-7.',
      collapse: 'El santuario se derrumbó con NOVA-7 dentro.',
    };
    this.fail(reasons[cause] || 'La integridad de NOVA-7 llegó a cero.', cause);
  }

  fail(reason, cause = 'death') {
    if (this.finished) return;
    this.finished = true;
    this.game.onDefeat({ reason, cause, score: this.score, stats: this.stats, level: this.index, checkpoint: this.checkpoint });
  }

  /** Resultado final con bonificaciones. */
  complete(extra = {}) {
    if (this.finished) return;
    this.finished = true;
    const player = this.game.player;
    const par = this.info.par;
    const timeBonus = Math.round(SCORE.timeBonusMax * THREE.MathUtils.clamp(1 - (this.stats.time - par * 0.5) / par, 0, 1));
    const healthBonus = Math.round((player?.health ?? 0) * SCORE.healthBonusPerPoint);
    const shots = this.game.weapons.stats.shots;
    const accuracy = shots ? this.game.weapons.stats.hits / shots : 0;
    const accBonus = Math.round(accuracy * 1000);
    const base = this.score;
    const total = base + SCORE.levelBonus + timeBonus + healthBonus + accBonus;
    const rank = LEVEL_RANKS.find((r) => total >= r.min) ?? LEVEL_RANKS[LEVEL_RANKS.length - 1];
    this.score = total;
    this.game.onLevelComplete({
      level: this.index,
      info: this.info,
      score: total,
      breakdown: [
        ['Combate y objetivos', base],
        ['Nivel completado', SCORE.levelBonus],
        ['Bono de tiempo', timeBonus],
        ['Bono de integridad', healthBonus],
        ['Bono de precisión', accBonus],
      ],
      stats: { ...this.stats, accuracy, shots, damageTaken: player?.stats.damageTaken ?? 0 },
      rank,
      ...extra,
    });
  }

  dispose() {
    for (const off of this.subs) off();
    this.subs = [];
    this.flora?.dispose();
    this.terrain?.mesh?.geometry.dispose();
    this.terrain?.mesh?.material.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.root.parent?.remove(this.root);
  }
}

export { yawQuat };
