/**
 * AutoAim — apuntado automático al disparar con la voz o con gestos.
 *
 * Sin mouse no se puede apuntar con precisión, así que mientras la voz o los
 * gestos mantienen el disparo se elige el mejor blanco con TIRO LIMPIO
 * (raycast contra el escenario y los objetos):
 *   - enemigos y jefes, prefiriendo los cercanos y los que están al frente;
 *   - si el jefe tiene escudo, los nodos / anclas de cristal que lo alimentan;
 *   - los orbes teledirigidos del Eco cuando ya están cerca (se derriban);
 *   - los pilones de resonancia (operación 2).
 * El punto de mira se fija en el blanco y la cámara gira hacia él, así que
 * NOVA-7 también se voltea y se ve a quién dispara.
 */
import * as THREE from 'three';
import { G, groups } from '../config.js';

const RANGE = 75;
const RETARGET = 0.25; // s
const _p = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _from = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/** Lo que tapa un disparo: escenario y objetos (cajas, cápsulas), no otros enemigos. */
const SHOT_BLOCKERS = groups(0xffff, G.WORLD | G.PROP);

const EXTRA_TYPES = new Set(['node', 'pylon', 'homing']);

export class AutoAim {
  constructor(game) {
    this.game = game;
    this.until = 0;
    this.target = null;
    this.retarget = 0;
    this.point = new THREE.Vector3();
  }

  get enabled() {
    return this.game.settings.get('autoAim') !== false;
  }

  /** La voz o los gestos lo piden mientras disparan. */
  request(seconds = 0.35) {
    if (!this.enabled) return;
    this.until = Math.max(this.until, this.game.time + seconds);
  }

  get active() {
    return this.enabled && this.game.time < this.until && this.game.state === 'playing';
  }

  reset() {
    this.until = 0;
    this.target = null;
  }

  #pointOf(t, out) {
    if (t.damagePoint) return t.damagePoint(out);
    if (t.currPos) return out.copy(t.currPos);
    return t.object3d ? t.object3d.getWorldPosition(out) : null;
  }

  #valid(t) {
    return t && t.alive !== false && !t.dead && !t.destroyed;
  }

  /**
   * Busca en el cuerpo del blanco un punto con tiro limpio (centro, más arriba
   * o más abajo: un desnivel del terreno puede tapar solo una parte).
   * Deja el punto en `out` y devuelve true si lo encontró.
   */
  #clearShot(t, out) {
    if (!this.#pointOf(t, out)) return false;
    const h = Math.min(0.9, (t.hitRadius ?? 0.5) * 0.9);
    for (const dy of [0, h, -h * 0.6]) {
      _p2.copy(out);
      _p2.y += dy;
      if (this.#visible(_p2)) {
        out.copy(_p2);
        return true;
      }
    }
    return false;
  }

  #visible(point) {
    const { game } = this;
    game.player.chestPosition(_from);
    _dir.subVectors(point, _from);
    const d = _dir.length();
    if (d > RANGE || d < 0.5) return false;
    _dir.divideScalar(d);
    const hit = game.physics.raycast(_from, _dir, d, { groups: SHOT_BLOCKERS, excludeCollider: game.player.collider });
    return !hit || hit.distance > d - 0.6;
  }

  #pick() {
    const { game } = this;
    const player = game.player;
    game.cameraRig.forward(_fwd);
    const boss = game.boss && !game.boss.dead ? game.boss : null;
    const shielded = !!boss?.shielded;
    let best = null;
    let bestScore = Infinity;
    const consider = (t, bonus = 0) => {
      if (!this.#valid(t) || !this.#clearShot(t, _p)) return;
      const d = _p.distanceTo(player.currPos);
      _dir.subVectors(_p, player.currPos).setY(0).normalize();
      const facing = _fwd.dot(_dir); // 1 = al frente, -1 = detrás
      // distancia + castigo por estar detrás + quedarse con el blanco actual
      const score = d + (1 - facing) * 12 + bonus - (t === this.target ? 6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    };
    for (const e of game.enemies) consider(e, e.isBoss && shielded ? 40 : 0);
    for (const t of game.damageables) {
      if (!EXTRA_TYPES.has(t.type)) continue;
      if (t.type === 'homing') {
        if (t.currPos && t.currPos.distanceTo(player.currPos) < 14) consider(t, -8);
      } else consider(t, t.type === 'node' && shielded ? -10 : 4);
    }
    return best;
  }

  update(dt) {
    const { game } = this;
    if (!this.active || !game.player) {
      this.target = null;
      return;
    }
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.#valid(this.target)) {
      this.retarget = RETARGET;
      this.target = this.#pick();
    }
    if (!this.target) return;
    if (this.#clearShot(this.target, _p)) {
      this.point.copy(_p);
      this.lostT = 0;
    } else {
      // si deja de verse un instante se sigue su posición; si se pierde, se busca otro
      this.lostT = (this.lostT ?? 0) + dt;
      if (this.lostT > 0.4 || !this.#pointOf(this.target, this.point)) {
        this.target = null;
        this.retarget = 0;
        return;
      }
    }
    // girar la cámara (y con ella a NOVA-7) hacia el blanco; dentro del visor
    // no se gira la vista del jugador (marearía): solo se corrige la bala
    if (game.immersive === 'xr') return;
    const p = game.player.currPos;
    const want = Math.atan2(-(this.point.x - p.x), -(this.point.z - p.z));
    let d = want - game.cameraRig.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    game.turnView(d * Math.min(1, dt * 10));
  }

  /** Punto de mira forzado (o null si no hay blanco). */
  aimPoint() {
    return this.active && this.target ? this.point : null;
  }
}
