/**
 * Mission — "Operación Veta Airosa".
 *
 * Objetivos:
 *   1. Recuperar todos los núcleos de plata.
 *   2. Derribar las torres de interferencia.
 *   3. Activar el malacate para la extracción.
 *
 * Derrota: batería agotada o la tormenta de polvo llega (tiempo en cero).
 * Lleva el puntaje, estadísticas y el rango final.
 */
import { SCORE, RANKS } from '../config.js';
import { BestScores } from '../core/Settings.js';

export class Mission {
  constructor(game, difficulty, { coresTotal, towersTotal }) {
    this.game = game;
    this.difficulty = difficulty;
    this.coresTotal = coresTotal;
    this.coresCollected = 0;
    this.towersTotal = towersTotal;
    this.towersDown = 0;
    this.timeTotal = difficulty.time;
    this.timeLeft = difficulty.time;
    this.elapsed = 0;
    this.score = 0;
    this.finished = false;
    this.result = null;
    this.ready = false;
    this.warned = new Set();
    this.interferenceTime = 0;
    this.stats = {
      drones: 0,
      barrels: 0,
      crates: 0,
      goldCores: 0,
      batteries: 0,
      falls: 0,
      damageTaken: 0,
      hits: 0,
    };
  }

  get storm() {
    return 1 - this.timeLeft / this.timeTotal;
  }

  objectives() {
    return [
      {
        id: 'cores',
        icon: 'gem',
        label: 'Recupera los núcleos de plata',
        progress: this.coresCollected,
        total: this.coresTotal,
        done: this.coresCollected >= this.coresTotal,
      },
      {
        id: 'towers',
        icon: 'broadcast-pin',
        label: 'Derriba las torres de interferencia',
        progress: this.towersDown,
        total: this.towersTotal,
        done: this.towersDown >= this.towersTotal,
      },
      {
        id: 'extract',
        icon: 'arrow-up-square',
        label: this.ready ? 'Activa el malacate (tecla E)' : 'Extracción bloqueada',
        progress: this.finished && this.result?.victory ? 1 : 0,
        total: 1,
        done: !!(this.finished && this.result?.victory),
        locked: !this.ready,
      },
    ];
  }

  addScore(points, label, pos) {
    this.score += Math.round(points);
    this.game.bus.emit('score', { points: Math.round(points), label, pos, total: this.score });
  }

  // ------------------------------------------------------------ eventos del juego
  collectCore(pos) {
    if (this.finished) return;
    this.coresCollected++;
    this.addScore(SCORE.core, 'Núcleo', pos);
    this.game.bus.emit('hud:toast', {
      text: `Núcleo de plata ${this.coresCollected}/${this.coresTotal}`,
      type: 'core',
      icon: 'gem',
    });
    this.#emitObjectives();
    this.#checkReady();
  }

  collectGoldCore(pos) {
    this.stats.goldCores++;
    this.addScore(SCORE.goldCore, 'Núcleo dorado', pos);
    this.game.player.energy = this.game.player.maxEnergy;
    this.game.bus.emit('hud:toast', { text: 'Núcleo dorado: energía al máximo', type: 'gold', icon: 'gem' });
  }

  batteryCollected(pos, overflow) {
    this.stats.batteries++;
    if (overflow > 0) this.addScore(SCORE.batteryOverflow, 'Batería extra', pos);
    this.game.bus.emit('hud:toast', { text: '+25 % de batería', type: 'battery', icon: 'battery-charging' });
  }

  towerDestroyed(tower) {
    if (this.finished) return;
    this.towersDown++;
    this.addScore(SCORE.tower, 'Torre derribada', tower.beacon.currPos.clone());
    this.game.bus.emit('hud:banner', { title: '¡Torre derribada!', subtitle: `${tower.name} · ${this.towersDown}/${this.towersTotal}`, type: 'success' });
    this.#emitObjectives();
    this.#checkReady();
  }

  droneDowned(pos) {
    this.stats.drones++;
    this.addScore(SCORE.drone, 'Dron derribado', pos);
  }

  crateBroken(pos) {
    this.stats.crates++;
    this.addScore(SCORE.supplyCrate, 'Suministros', pos);
  }

  barrelExploded(pos) {
    this.stats.barrels++;
    this.addScore(SCORE.barrel, 'Explosión', pos);
  }

  registerHit() {
    this.stats.hits++;
  }

  onPlayerFell() {
    const { game } = this;
    const player = game.player;
    if (!player || player.dead || this.finished) return;
    this.stats.falls++;
    player.damage(18, 'fall');
    if (player.dead) return;
    const cp = game.level.nearestCheckpoint(player.currPos);
    player.teleport(cp);
    game.cameraRig.reset(player.chestPosition(), game.cameraRig.yaw);
    game.bus.emit('hud:toast', { text: 'Caíste a la grieta: −batería', type: 'danger', icon: 'exclamation-triangle' });
    game.audio.play('fall');
  }

  #checkReady() {
    if (this.ready) return;
    if (this.coresCollected >= this.coresTotal && this.towersDown >= this.towersTotal) {
      this.ready = true;
      this.game.level.extraction.setReady();
      this.game.bus.emit('hud:banner', { title: 'Extracción disponible', subtitle: 'Llega al malacate del norte y activa la palanca', type: 'info' });
      this.game.audio.play('ready');
      this.#emitObjectives();
    }
  }

  #emitObjectives() {
    this.game.bus.emit('objectives', this.objectives());
  }

  // ------------------------------------------------------------ ciclo
  update(dt) {
    if (this.finished) return;
    const { game } = this;
    if (game.level.extraction?.state === 'rising') return; // el reloj se detiene durante la extracción
    this.elapsed += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    for (const mark of [120, 60, 30, 10]) {
      if (this.timeLeft <= mark && !this.warned.has(mark)) {
        this.warned.add(mark);
        game.bus.emit('hud:banner', {
          title: mark >= 60 ? `Tormenta en ${mark / 60} min` : `¡${mark} segundos!`,
          subtitle: 'La tormenta de polvo está por sepultar la mina',
          type: 'danger',
        });
        game.audio.play('alarm');
      }
    }
    // interferencia de torres
    const player = game.player;
    let inField = false;
    if (player && !player.dead && !player.attached) {
      for (const t of game.level.towers) {
        if (t.affects(player.currPos)) {
          inField = true;
          player.damage(this.difficulty.interferenceDrain * dt, 'interference');
          break;
        }
      }
    }
    if (inField !== this.inField) {
      this.inField = inField;
      game.bus.emit('interference', inField);
    }
    if (this.timeLeft <= 0) this.fail('storm');
  }

  complete() {
    if (this.finished) return;
    this.finished = true;
    const player = this.game.player;
    const timeBonus = Math.round(this.timeLeft * SCORE.timeBonusPerSecond);
    const batteryBonus = Math.round(player.battery * SCORE.batteryBonusPerPoint);
    this.score += timeBonus + batteryBonus;
    const rank = RANKS.find((r) => this.score >= r.min);
    const best = BestScores.submit(this.difficulty.id, this.score);
    this.result = {
      victory: true,
      score: this.score,
      timeBonus,
      batteryBonus,
      rank,
      newRecord: best,
      best: BestScores.get(this.difficulty.id),
      ...this.#summary(),
    };
    this.#emitObjectives();
    this.game.onVictory(this.result);
  }

  fail(reason) {
    if (this.finished) return;
    this.finished = true;
    this.result = { victory: false, reason, score: this.score, ...this.#summary() };
    this.game.onDefeat(this.result);
  }

  #summary() {
    return {
      difficulty: this.difficulty.label,
      time: this.elapsed,
      cores: `${this.coresCollected}/${this.coresTotal}`,
      towers: `${this.towersDown}/${this.towersTotal}`,
      orbs: this.game.combat.stats.orbs,
      ...this.stats,
    };
  }
}
