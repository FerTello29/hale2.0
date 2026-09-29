/**
 * DamageSystem — explosiones e impactos compartidos por armas, enemigos,
 * barriles y jefes. Combina física (impulsos de Rapier) con daño a todo lo
 * que tenga vida (enemigos, drones, jefes, cápsulas, cajas y el jugador).
 */
import * as THREE from 'three';
import { G, groups } from '../config.js';

const DYNAMIC_QUERY = groups(0xffff, G.PROP | G.ENEMY | G.DEBRIS);
const _d = new THREE.Vector3();

export class DamageSystem {
  constructor(game) {
    this.game = game;
  }

  /**
   * Explosión con impulso radial y daño decreciente con la distancia.
   * @param {THREE.Vector3} center
   * @param {object} o { radius, damage, deltaV, source: 'player'|'enemy', selfFactor, small, noFx, ignore }
   */
  explode(center, o = {}) {
    const { game } = this;
    const radius = o.radius ?? 6;
    const damage = o.damage ?? 100;
    const source = o.source ?? 'player';
    game.physics.radialImpulse(center, radius, o.deltaV ?? 14, { upBias: 0.55, groups: DYNAMIC_QUERY, exclude: o.ignore?.body });
    for (const t of [...game.damageables]) {
      if (!t.alive || t === o.ignore || t.dead) continue;
      const p = t.damagePoint ? t.damagePoint(_d) : t.currPos;
      if (!p) continue;
      const dist = p.distanceTo(center) - (t.hitRadius ?? 0.5);
      if (dist > radius) continue;
      const k = Math.pow(THREE.MathUtils.clamp(1 - Math.max(0, dist) / radius, 0, 1), 0.7);
      if (source === 'enemy' && t.faction === 'enemy' && !o.friendly) continue;
      t.takeDamage(damage * k + 5, {
        kind: 'explosion',
        source,
        point: center.clone(),
        dir: p.clone().sub(center).normalize(),
        force: (o.deltaV ?? 14) * k,
      });
    }
    const player = game.player;
    if (player && !player.dead) {
      const dist = player.currPos.distanceTo(center);
      const r = radius * 0.85;
      if (dist < r) {
        const k = 1 - dist / r;
        const factor = source === 'player' ? o.selfFactor ?? 0.35 : 1;
        player.damage(damage * 0.45 * k * factor + 3, { source, kind: 'explosion', from: center });
        const away = player.currPos.clone().sub(center).setY(0).normalize();
        player.knockback(away.multiplyScalar(8 * k), 5 * k);
      }
    }
    if (!o.noFx) {
      game.fx.burst(o.small ? 'smallExplosion' : 'explosion', center);
      game.fx.shockwave(center, radius * 0.9, o.color ?? 0xffa040);
      game.fx.flash(center, o.color ?? 0xff9a40, o.small ? 12 : 30, o.small ? 0.35 : 0.6);
      game.audio.play(o.small ? 'smallExplosion' : 'explosion', center);
      game.cameraRig.shakeFrom(center, o.small ? 0.6 : 1.3);
    }
    game.bus.emit('noise', { pos: center, radius: 40 });
  }

  /** Número flotante de daño (si el ajuste está activado). */
  number(pos, amount, { headshot = false, weak = false, shield = false } = {}) {
    this.game.bus.emit('damage:number', { pos: pos.clone(), amount: Math.round(amount), headshot, weak, shield });
  }
}
