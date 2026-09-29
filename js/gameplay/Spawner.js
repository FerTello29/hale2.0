/**
 * Spawner — generación dinámica de objetos en posiciones VÁLIDAS.
 *
 * Una posición es válida si:
 *   1. está dentro del área jugable y lejos de la grieta,
 *   2. un raycast vertical toca terreno/estructura fija (no una caja),
 *   3. la superficie es transitable (normal.y alta) y a una altura razonable,
 *   4. una esfera de holgura no se superpone con ningún collider,
 *   5. respeta distancias mínimas al jugador, a otros objetos y a las torres.
 *
 * Genera: núcleos de plata iniciales, baterías periódicas, núcleos dorados de
 * bonificación y derrumbes de rocas (con aviso previo en el suelo).
 */
import * as THREE from 'three';
import { SilverCore, GoldCore, BatteryPickup } from '../entities/Pickups.js';
import { Boulder } from '../entities/Props.js';
import { COLLISION, G, groups, ROCKFALL_INTERVALS } from '../config.js';
import { inCrevasse, heightAt } from '../world/Terrain.js';
import { INTERFERENCE_RADIUS } from '../entities/Tower.js';

const DOWN = { x: 0, y: -1, z: 0 };
const GROUND_QUERY = groups(0xffff, G.WORLD | G.PROP);

export class Spawner {
  constructor(game, level, difficulty) {
    this.game = game;
    this.level = level;
    this.difficulty = difficulty;
    this.batteryTimer = 25;
    this.goldTimer = 40;
    this.rockTimer = 20;
    this.pendingRocks = [];
    this.rng = Math.random;
    this.stats = { attempts: 0, rejected: 0 };
  }

  get items() {
    return [...this.game.entities].filter((e) => e.alive && (e.type === 'core' || e.type === 'battery' || e.type === 'goldcore'));
  }

  /**
   * Comprueba un punto (x, z). Devuelve la posición en el suelo o null.
   */
  validate(x, z, opts = {}) {
    const {
      minPlayerDist = 8,
      minSpacing = 6,
      clearance = 0.75,
      minY = -1.5,
      maxY = 6.5,
      avoidTowers = true,
      avoid = [],
    } = opts;
    this.stats.attempts++;
    const reject = () => {
      this.stats.rejected++;
      return null;
    };
    if (Math.abs(x) > 48 || Math.abs(z) > 48) return reject();
    if (inCrevasse(x, z, 2.5)) return reject();
    const physics = this.game.physics;
    const hit = physics.raycast({ x, y: 60, z }, DOWN, 100, { groups: GROUND_QUERY });
    if (!hit) return reject();
    if (hit.entity && hit.entity.type !== 'world') return reject(); // encima de una caja u objeto dinámico
    if (hit.normal.y < 0.82) return reject();
    const y = hit.point.y;
    if (y < minY || y > maxY) return reject();
    const probe = { x, y: y + 1.0, z };
    if (physics.overlapSphere(probe, clearance, { groups: COLLISION.spawnQuery, includeSensors: true }).length > 0) return reject();
    const p = new THREE.Vector3(x, y, z);
    const player = this.game.player;
    if (player && p.distanceTo(player.feetPosition) < minPlayerDist) return reject();
    for (const it of this.items) if (it.object3d.position.distanceTo(probe) < minSpacing) return reject();
    for (const a of avoid) if (a.distanceTo(p) < minSpacing) return reject();
    if (avoidTowers) {
      for (const t of this.level.towers) {
        if (Math.hypot(t.center.x - x, t.center.z - z) < INTERFERENCE_RADIUS + 1.5) return reject();
      }
    }
    const ex = this.level.extraction;
    if (ex && Math.hypot(ex.center.x - x, ex.center.z - z) < 6) return reject();
    return p;
  }

  findInZone(zone, opts = {}, tries = 80) {
    for (let i = 0; i < tries; i++) {
      const x = zone.minX + this.rng() * (zone.maxX - zone.minX);
      const z = zone.minZ + this.rng() * (zone.maxZ - zone.minZ);
      const p = this.validate(x, z, opts);
      if (p) return p;
    }
    return null;
  }

  findAnywhere(opts = {}) {
    const zones = this.level.spawnZones;
    for (let i = 0; i < 6; i++) {
      const zone = zones[Math.floor(this.rng() * zones.length)];
      const p = this.findInZone(zone, opts, 40);
      if (p) return p;
    }
    return null;
  }

  /** Núcleos iniciales repartidos por todas las zonas del mapa. */
  spawnCores(count) {
    const order = this.level.coreZoneOrder;
    const placed = [];
    for (let i = 0; i < count; i++) {
      const zone = this.level.zoneByName(order[i % order.length]);
      let p = this.findInZone(zone, { minSpacing: 7, minPlayerDist: 10, avoid: placed });
      if (!p) p = this.findAnywhere({ minSpacing: 5, minPlayerDist: 8, avoid: placed });
      if (!p) {
        // respaldo: punto seguro predefinido (nunca debería ocurrir)
        const f = this.level.fallbackSpots[i % this.level.fallbackSpots.length];
        p = new THREE.Vector3(f.x, heightAt(f.x, f.z), f.z);
      }
      placed.push(p);
      this.game.addEntity(new SilverCore(this.game, p));
    }
    return placed;
  }

  spawnBatteries(count) {
    for (let i = 0; i < count; i++) this.spawnBattery();
  }

  spawnBattery() {
    const p = this.findAnywhere({ minSpacing: 8, minPlayerDist: 12 });
    if (p) {
      this.game.addEntity(new BatteryPickup(this.game, p));
      return true;
    }
    return false;
  }

  /** Batería que cae de una caja de suministros (posición ya conocida). */
  spawnBatteryAt(pos) {
    const y = heightAt(pos.x, pos.z);
    const p = new THREE.Vector3(pos.x, Math.max(y, pos.y - 0.45), pos.z);
    this.game.addEntity(new BatteryPickup(this.game, p, 30));
  }

  spawnGoldCore() {
    const p = this.findAnywhere({ minSpacing: 8, minPlayerDist: 14, maxY: 6.5 });
    if (!p) return false;
    this.game.addEntity(new GoldCore(this.game, p, 28));
    this.game.bus.emit('hud:toast', { text: '¡Apareció un núcleo dorado! (28 s)', type: 'gold', icon: 'gem' });
    this.game.audio.play('goldSpawn');
    return true;
  }

  /** Derrumbe: aviso en el suelo cerca del jugador y luego cae una roca. */
  scheduleRockfall() {
    const player = this.game.player;
    if (!player || player.dead) return;
    const base = player.feetPosition.clone();
    for (let i = 0; i < 20; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = 3 + this.rng() * 9;
      const x = base.x + Math.cos(a) * r;
      const z = base.z + Math.sin(a) * r;
      const p = this.validate(x, z, { minPlayerDist: 2.5, minSpacing: 0, clearance: 0.6, maxY: 7, avoidTowers: false });
      if (!p) continue;
      const radius = 0.55 + this.rng() * 0.5;
      this.game.fx.warning(p, radius + 0.6, 1.7);
      this.game.audio.play('rumble', p);
      this.pendingRocks.push({ pos: p, radius, t: 1.7 });
      return;
    }
  }

  update(dt) {
    const game = this.game;
    const items = this.items;
    // baterías periódicas
    this.batteryTimer -= dt;
    if (this.batteryTimer <= 0) {
      this.batteryTimer = 28;
      if (items.filter((i) => i.type === 'battery').length < 3) this.spawnBattery();
    }
    // núcleo dorado de bonificación
    this.goldTimer -= dt;
    if (this.goldTimer <= 0) {
      this.goldTimer = 50;
      if (!items.some((i) => i.type === 'goldcore')) this.spawnGoldCore();
    }
    // derrumbes (más frecuentes al avanzar la tormenta)
    const base = ROCKFALL_INTERVALS[game.settings.get('rockfall')] ?? ROCKFALL_INTERVALS.normal;
    if (Number.isFinite(base)) {
      const storm = game.mission?.storm ?? 0;
      this.rockTimer -= dt * this.difficulty.rockfallMult * (1 + storm * 1.2);
      if (this.rockTimer <= 0) {
        this.rockTimer = base * (0.75 + this.rng() * 0.5);
        this.scheduleRockfall();
      }
    }
    for (const r of this.pendingRocks) {
      r.t -= dt;
      if (r.t <= 0) {
        const start = r.pos.clone();
        start.y += 20;
        const b = new Boulder(game, start, { radius: r.radius, rockfall: true });
        b.body.setLinvel({ x: 0, y: -14, z: 0 }, true);
        game.addEntity(b);
      }
    }
    this.pendingRocks = this.pendingRocks.filter((r) => r.t > 0);
  }
}
