/**
 * TacticalAI — director táctico con IA: toma decisiones sobre la partida.
 *
 * Cada AI.tacticsInterval segundos resume el estado (salud, munición,
 * presión enemiga, jefe, daño reciente…) y decide:
 *   - cuánto daño y puntería tienen los enemigos (solo puede SUAVIZARLOS),
 *   - cuántos suministros sueltan y si llegan refuerzos completos,
 *   - si la estación Vigía lanza un paquete de suministros junto al jugador,
 *   - qué consejo da la Cmdte. Ruiz por radio.
 *
 * Con servidor de IA la decisión la toma OpenAI (/api/tactics); sin él, la
 * misma decisión se calcula con una heurística local. Todo valor recibido se
 * valida y se acota en el cliente.
 */
import * as THREE from 'three';
import { AI, DIFFICULTIES } from '../config.js';
import { heightAt, isVoid } from '../world/TerrainField.js';

const clamp = THREE.MathUtils.clamp;
const LIMITS = {
  enemyDamage: [0.55, 1],
  enemyAccuracy: [0.65, 1],
  supplies: [1, 1.8],
  reinforcements: [0.65, 1],
};
const DROPS = ['none', 'health', 'ammo', 'grenade'];

const BOSS_TIPS = {
  'La Matriarca': 'Haz que embista contra un pilar de roca y dispara al saco luminoso de su espalda.',
  'El Coloso': 'Destruye los nodos de cristal que alimentan su escudo y salta la onda expansiva.',
  'El Eco': 'Rompe las anclas, cúbrete del rayo tras un pilar y salta el anillo de choque.',
};

export class TacticalAI {
  constructor(game) {
    this.game = game;
    this.timer = 8;
    this.busy = false;
    this.hintCd = 0;
    this.dropCd = 0;
    this.recentDamage = 0;
    this.recentKills = 0;
    this.last = null;
    game.bus.on('player:damaged', ({ amount }) => {
      this.recentDamage += amount * (game.difficulty?.enemyDmg ?? 1);
    });
    game.bus.on('enemy:killed', () => {
      this.recentKills += 1;
    });
  }

  /** Al construir un nivel: volver a los valores del preset. */
  reset() {
    this.timer = 8;
    this.hintCd = 15;
    this.dropCd = 25;
    this.recentDamage = 0;
    this.recentKills = 0;
    this.last = null;
  }

  update(dt) {
    const { game } = this;
    if (game.state !== 'playing' || !game.player || game.level?.menuMode) return;
    this.hintCd -= dt;
    this.dropCd -= dt;
    // el daño y las bajas "recientes" se olvidan con el tiempo
    const decay = Math.exp(-dt / 25);
    this.recentDamage *= decay;
    this.recentKills *= decay;
    if (!game.settings.get('aiDirector')) return;
    this.timer -= dt;
    if (this.timer > 0 || this.busy) return;
    this.timer = AI.tacticsInterval;
    this.#decide();
  }

  snapshot() {
    const { game } = this;
    const p = game.player;
    const w = game.weapons;
    let near = 0;
    for (const e of game.enemies) if (!e.dead && !e.isBoss && e.alerted && e.currPos.distanceTo(p.currPos) < 30) near++;
    const cur = w.ammo[w.current];
    const boss = game.boss;
    const objective = game.level?.objectives?.find((o) => o.active && !o.done) ?? game.level?.objectives?.find((o) => !o.done);
    return {
      level: game.levelIndex,
      difficulty: game.difficultyId,
      time: Math.round(game.level?.stats.time ?? 0),
      health: +(p.health / p.maxHealth).toFixed(2),
      shield: +(p.shield / p.maxShield).toFixed(2),
      ammoCurrent: cur.mag + cur.reserve,
      lowAmmo: cur.reserve < 12 && cur.mag < 6,
      grenades: w.grenades.frag + w.grenades.gravity,
      enemiesNear: near,
      enemiesAlive: game.director?.alive ?? 0,
      recentDamage: Math.round(this.recentDamage),
      recentKills: +this.recentKills.toFixed(1),
      boss: boss ? { name: boss.cfg?.name ?? 'Jefe', hp: +(boss.hp / boss.maxHp).toFixed(2), phase: boss.phase ?? boss.phaseIndex ?? 1 } : null,
      objective: objective?.text ?? null,
      current: this.last ? { enemyDamage: this.last.enemyDamage, enemyAccuracy: this.last.enemyAccuracy } : null,
    };
  }

  /** Heurística local: la misma decisión que se le pide a la IA. */
  static decideLocally(s) {
    const stress = clamp(s.recentDamage / 90 + (1 - s.health) * 0.7 + s.enemiesNear * 0.07 - s.recentKills * 0.05, 0, 1.4);
    let supplyDrop = 'none';
    if (s.health < 0.35 && s.recentDamage > 25) supplyDrop = 'health';
    else if (s.lowAmmo) supplyDrop = 'ammo';
    else if (s.boss && s.grenades === 0 && s.health > 0.5) supplyDrop = 'grenade';
    let hint = null;
    if (s.boss && (stress > 0.6 || s.boss.hp > 0.8)) hint = BOSS_TIPS[s.boss.name] ?? null;
    else if (stress > 0.9) hint = 'Te están rodeando, NOVA-7. Retrocede a cubierto y deja que se recargue tu escudo.';
    else if (s.lowAmmo) hint = 'Te queda poca munición: rompe cajas de suministros y recoge lo que suelten.';
    const d = {
      enemyDamage: 1 - 0.32 * stress,
      enemyAccuracy: 1 - 0.28 * stress,
      supplies: 1 + 0.45 * stress,
      reinforcements: 1 - 0.25 * Math.min(1, stress),
      supplyDrop,
      hint,
      source: 'local',
    };
    for (const [k, [lo, hi]] of Object.entries(LIMITS)) d[k] = +clamp(d[k], lo, hi).toFixed(3);
    return d;
  }

  /** Valida y acota cualquier decisión (también la de la IA). */
  static sanitize(d, fallback) {
    const out = { ...fallback };
    if (!d || typeof d !== 'object') return out;
    for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
      const v = Number(d[k]);
      if (Number.isFinite(v)) out[k] = clamp(v, lo, hi);
    }
    if (DROPS.includes(d.supplyDrop)) out.supplyDrop = d.supplyDrop;
    out.hint = typeof d.hint === 'string' && d.hint.trim() ? d.hint.trim().slice(0, 140) : null;
    out.source = 'ia';
    return out;
  }

  async #decide() {
    const { game } = this;
    const levelAtStart = game.level;
    const snap = this.snapshot();
    const local = TacticalAI.decideLocally(snap);
    let decision = local;
    if (game.ai.online) {
      this.busy = true;
      try {
        const res = await game.ai.tactics(snap);
        if (res) decision = TacticalAI.sanitize(res, local);
      } finally {
        this.busy = false;
      }
    }
    // la partida pudo cambiar mientras esperábamos a la IA
    if (game.level !== levelAtStart || game.state !== 'playing') return;
    this.apply(decision);
  }

  apply(d) {
    const { game } = this;
    const base = DIFFICULTIES[game.difficultyId];
    const diff = game.difficulty;
    diff.enemyDmg = base.enemyDmg * d.enemyDamage;
    diff.accuracy = base.accuracy * d.enemyAccuracy;
    diff.pickups = base.pickups * d.supplies;
    diff.count = base.count * d.reinforcements;
    this.last = d;
    game.bus.emit('ai:decision', d);
    if (d.supplyDrop !== 'none' && this.dropCd <= 0) {
      this.dropCd = 45;
      this.#supplyDrop(d.supplyDrop);
    }
    if (d.hint && this.hintCd <= 0 && !game.radio.busy) {
      this.hintCd = 40;
      game.radio.say([['ruiz', d.hint]]);
    }
  }

  #supplyDrop(kind) {
    const { game } = this;
    const p = game.player.currPos;
    const spot = game.spawner.findSpot(p, 5, { minRadius: 1.5, clearance: 0.5, tries: 20 });
    const pos = spot ?? (!isVoid(p.x + 1, p.z) ? new THREE.Vector3(p.x + 1, heightAt(p.x + 1, p.z), p.z) : null);
    if (!pos) return;
    game.spawner.spawnPickup(kind, pos.clone().setY(pos.y + 0.6), 40);
    game.fx.flash(pos, 0x7fe8ff, 10, 0.4);
    game.audio.play('objective');
    const names = { health: 'botiquín', ammo: 'munición', grenade: 'granadas' };
    game.bus.emit('hud:toast', { text: `Vigía lanzó ${names[kind]} cerca de ti`, type: 'info', icon: 'box-seam' });
  }
}
