/**
 * EnemyDirector — crea enemigos por tipo, grupos y oleadas escalonadas.
 *
 * La cantidad se ajusta a la dificultad y cada aparición usa el Spawner para
 * validar la posición (suelo firme, hueco libre y lejos del jugador). Las
 * oleadas entran por "portales" de cristal con aviso visual y sonoro.
 */
import * as THREE from 'three';
import { Espectro } from '../enemies/Espectro.js';
import { Acechador } from '../enemies/Acechador.js';
import { Centinela } from '../enemies/Centinela.js';
import { Bastion } from '../enemies/Bastion.js';

const TYPES = {
  espectro: (g, p) => new Espectro(g, p),
  elite: (g, p) => new Espectro(g, p, { elite: true }),
  acechador: (g, p) => new Acechador(g, p),
  centinela: (g, p) => new Centinela(g, p),
  bastion: (g, p) => new Bastion(g, p),
};

export class EnemyDirector {
  constructor(game) {
    this.game = game;
    this.queue = [];
    this.spawned = 0;
    this.unsubscribe = game.bus.on('noise', ({ pos, radius }) => {
      for (const e of game.enemies) e.hear?.(pos, radius);
    });
  }

  get alive() {
    let n = 0;
    for (const e of this.game.enemies) if (!e.dead && !e.isBoss) n++;
    return n;
  }

  /** Crea un enemigo en una posición exacta (ya validada). */
  spawn(type, pos, { alerted = false, portal = false } = {}) {
    const make = TYPES[type];
    if (!make) throw new Error(`Tipo de enemigo desconocido: ${type}`);
    const e = make(this.game, pos);
    this.game.addEntity(e);
    this.spawned++;
    if (alerted) e.alert(false);
    if (portal) {
      this.game.fx.burst('portal', pos.clone().setY(pos.y + 1));
      this.game.fx.flash(pos, 0xff2bd6, 8, 0.4);
      this.game.audio.play('portal', pos);
    }
    this.game.physics.refreshQueries();
    return e;
  }

  /**
   * Grupo de enemigos alrededor de un punto.
   * @param {Array<[string, number]>} list p. ej. [['espectro', 2], ['acechador', 3]]
   */
  group(list, center, radius, { alerted = false, portal = false, minPlayerDist = 14, scale = true } = {}) {
    const out = [];
    const k = scale ? this.game.difficulty.count : 1;
    for (const [type, n] of list) {
      const count = Math.max(1, Math.round(n * k));
      for (let i = 0; i < count; i++) {
        const clearance = type === 'bastion' ? 1.3 : type === 'centinela' ? 0.6 : 0.75;
        const p = this.game.spawner.findSpot(center, radius, { minPlayerDist, clearance, tries: 30 });
        if (!p) continue;
        out.push(this.spawn(type, p, { alerted, portal }));
      }
    }
    return out;
  }

  /** Oleada escalonada: los enemigos aparecen de uno en uno. */
  wave(list, center, radius, { interval = 0.6, minPlayerDist = 12, onDone } = {}) {
    const k = this.game.difficulty.count;
    let delay = 0;
    const entries = [];
    for (const [type, n] of list) {
      const count = Math.max(1, Math.round(n * k));
      for (let i = 0; i < count; i++) entries.push(type);
    }
    // mezclar tipos para que la oleada sea variada
    entries.sort(() => Math.random() - 0.5);
    const spawned = [];
    entries.forEach((type, i) => {
      delay += interval;
      this.queue.push({
        at: delay,
        run: () => {
          const clearance = type === 'bastion' ? 1.3 : 0.75;
          const p = this.game.spawner.findSpot(center, radius, { minPlayerDist, clearance, tries: 30 });
          if (p) spawned.push(this.spawn(type, p, { alerted: true, portal: true }));
          if (i === entries.length - 1) onDone?.(spawned);
        },
      });
    });
    return spawned;
  }

  update(dt) {
    if (!this.queue.length) return;
    for (const q of this.queue) q.at -= dt;
    const ready = this.queue.filter((q) => q.at <= 0);
    if (!ready.length) return;
    this.queue = this.queue.filter((q) => q.at > 0);
    for (const q of ready) q.run();
  }

  /** Mata a todos los enemigos normales (al vencer a un jefe). */
  purge(source = 'world') {
    for (const e of [...this.game.enemies]) {
      if (!e.isBoss && !e.dead) e.takeDamage?.(99999, { kind: 'explosion', source, point: e.currPos.clone(), dir: new THREE.Vector3(0, 1, 0) });
    }
  }

  dispose() {
    this.unsubscribe?.();
    this.queue = [];
  }
}
