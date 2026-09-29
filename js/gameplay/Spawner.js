/**
 * Spawner — generación dinámica en posiciones VÁLIDAS.
 *
 * Cada candidato se valida con:
 *  1. la función de altura del nivel (sin abismos, pendiente caminable),
 *  2. un raycast vertical de Rapier (para apoyarse sobre estructuras),
 *  3. una consulta de superposición (el hueco debe estar libre de muros,
 *     objetos, enemigos y otros pickups),
 *  4. distancia mínima al jugador.
 *
 * También gestiona el botín que sueltan enemigos y cajas.
 */
import * as THREE from 'three';
import { COLLISION, G, groups, WEAPONS } from '../config.js';
import { heightAt, isVoid, normalAt } from '../world/TerrainField.js';
import { HealthPack, AmmoPack, GrenadePack, EnergyCell } from '../entities/Pickups.js';
import { SupplyCrate } from '../entities/Props.js';

const GROUND_QUERY = groups(0xffff, G.WORLD | G.PROP);
const _n = new THREE.Vector3();

const LOOT = {
  espectro: { ammo: 0.32, health: 0.14, grenade: 0.08 },
  acechador: { ammo: 0.14, health: 0.1, grenade: 0.04 },
  centinela: { ammo: 0.25, health: 0.08, grenade: 0.12 },
  bastion: { ammo: 0.9, health: 0.7, grenade: 0.5 },
};

export class Spawner {
  constructor(game) {
    this.game = game;
    this.stats = { attempts: 0, rejected: 0 };
  }

  /**
   * Busca un punto libre en un disco.
   * @returns {THREE.Vector3|null} punto sobre el suelo
   */
  findSpot(center, radius, { minPlayerDist = 0, maxPlayerDist = Infinity, clearance = 0.7, tries = 40, slope = 0.78, minRadius = 0, avoid = [], minHeight = -Infinity } = {}) {
    const { physics } = this.game;
    const player = this.game.player;
    for (let i = 0; i < tries; i++) {
      this.stats.attempts++;
      const a = Math.random() * Math.PI * 2;
      const r = minRadius + Math.sqrt(Math.random()) * (radius - minRadius);
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      if (isVoid(x, z)) {
        this.stats.rejected++;
        continue;
      }
      const h = heightAt(x, z);
      if (h < minHeight) {
        this.stats.rejected++;
        continue;
      }
      normalAt(x, z, _n);
      // raycast vertical: suelo real (terreno o estructura)
      const hit = physics.raycast({ x, y: h + 25, z }, { x: 0, y: -1, z: 0 }, 40, { groups: GROUND_QUERY });
      const y = hit ? hit.point.y : h;
      const flat = hit ? hit.normal.y : _n.y;
      if (flat < slope || y < h - 0.5) {
        this.stats.rejected++;
        continue;
      }
      const p = new THREE.Vector3(x, y, z);
      if (player && minPlayerDist > 0) {
        const d = player.currPos.distanceTo(p);
        if (d < minPlayerDist || d > maxPlayerDist) {
          this.stats.rejected++;
          continue;
        }
      }
      if (avoid.some((q) => q.distanceTo(p) < clearance * 2.5)) {
        this.stats.rejected++;
        continue;
      }
      const test = new THREE.Vector3(x, y + clearance + 0.15, z);
      if (physics.overlapSphere(test, clearance, { groups: COLLISION.spawnQuery, includeSensors: true }).length) {
        this.stats.rejected++;
        continue;
      }
      return p;
    }
    return null;
  }

  /** Coloca una celda de energía en cada zona indicada. */
  spawnCells(zones) {
    const cells = [];
    const avoid = [];
    for (const z of zones) {
      let p = this.findSpot(z.center, z.radius, { clearance: 0.9, avoid, minPlayerDist: 12, minHeight: -0.6 });
      if (!p) p = new THREE.Vector3(z.center.x, heightAt(z.center.x, z.center.z), z.center.z);
      avoid.push(p);
      const cell = new EnergyCell(this.game, p);
      cell.zone = z.name;
      this.game.addEntity(cell);
      cells.push(cell);
    }
    this.game.physics.refreshQueries();
    return cells;
  }

  /** Cajas de suministros rompibles repartidas en posiciones válidas. */
  spawnSupplies(count, center, radius, opts = {}) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = this.findSpot(center, radius, { clearance: 0.8, minPlayerDist: opts.minPlayerDist ?? 4, ...opts });
      if (!p) continue;
      p.y += 0.5;
      const c = new SupplyCrate(this.game, p, { rotY: Math.random() * Math.PI, sleeping: true });
      this.game.addEntity(c);
      out.push(c);
      this.game.physics.refreshQueries();
    }
    return out;
  }

  spawnPickup(kind, pos, lifetime = Infinity) {
    const C = kind === 'health' ? HealthPack : kind === 'grenade' ? GrenadePack : AmmoPack;
    const p = pos.clone();
    const ground = heightAt(p.x, p.z);
    if (!isVoid(p.x, p.z)) p.y = Math.max(p.y - 0.6, ground);
    return this.game.addEntity(new C(this.game, p, lifetime));
  }

  /** ¿El jugador anda corto de munición? (para soltar más cajas de balas) */
  #lowAmmo() {
    const w = this.game.weapons;
    if (!w) return false;
    let total = 0;
    let max = 0;
    for (const id of w.owned) {
      total += w.ammo[id].mag + w.ammo[id].reserve;
      max += WEAPONS[id].maxReserve + WEAPONS[id].mag;
    }
    const a = w.ammo[w.current];
    return a.reserve < 12 || total < max * 0.25;
  }

  dropLoot(pos, type) {
    const { game } = this;
    const k = game.difficulty?.pickups ?? 1;
    const at = (i) => pos.clone().add(new THREE.Vector3(Math.cos(i * 2.1) * 0.7, 0.2, Math.sin(i * 2.1) * 0.7));
    if (type === 'crate') {
      const r = Math.random();
      const player = game.player;
      const hurt = player && player.health < player.maxHealth * 0.6;
      const kind = this.#lowAmmo() && r < 0.6 ? 'ammo' : hurt && r < 0.7 ? 'health' : r < 0.45 ? 'ammo' : r < 0.8 ? 'health' : 'grenade';
      this.spawnPickup(kind, at(0));
      return;
    }
    const t = LOOT[type];
    if (!t) return;
    let i = 0;
    const low = this.#lowAmmo();
    if (Math.random() < Math.min(1, (t.ammo + (low ? 0.35 : 0)) * k)) this.spawnPickup('ammo', at(i++), 30);
    if (Math.random() < Math.min(1, t.health * k)) this.spawnPickup('health', at(i++), 30);
    if (Math.random() < Math.min(1, t.grenade * k)) this.spawnPickup('grenade', at(i++), 30);
  }
}
