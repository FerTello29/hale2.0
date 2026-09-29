/**
 * Minimap — radar cenital (norte arriba). El fondo se hornea una vez por
 * nivel a partir de la función de altura (abismos, agua, pendientes); los
 * marcadores (objetivo, celdas, pilones, jefe, enemigos alertados, nave) se
 * redibujan ~20 veces por segundo.
 */
import { heightAt, isVoid } from '../world/TerrainField.js';

const PALETTES = {
  1: { low: [22, 60, 48], high: [70, 120, 84], water: [20, 70, 90], wall: [40, 56, 50] },
  2: { low: [48, 40, 72], high: [110, 96, 140], water: [20, 30, 60], wall: [56, 48, 70] },
  3: { low: [80, 40, 72], high: [150, 90, 140], water: [20, 10, 20], wall: [60, 30, 50] },
};

export class Minimap {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = canvas.width;
    this.bg = null;
    this.timer = 0;
    this.t = 0;
    this.bounds = { cx: 0, cz: 0, range: 58 };
  }

  /** Recalcula el fondo para el nivel cargado. */
  rebuild(level) {
    this.level = level;
    this.bounds = level.mapBounds ?? (level.index === 3 ? { cx: 0, cz: 18, range: 56 } : { cx: 0, cz: 0, range: 60 });
    this.bg = null;
  }

  toMap(x, z) {
    const { cx, cz, range } = this.bounds;
    const s = this.size;
    return [((x - cx + range) / (2 * range)) * s, ((z - cz + range) / (2 * range)) * s];
  }

  #buildBackground() {
    const s = this.size;
    const { cx, cz, range } = this.bounds;
    const pal = PALETTES[this.level?.index ?? 1];
    const off = document.createElement('canvas');
    off.width = off.height = s;
    const g = off.getContext('2d');
    const img = g.createImageData(s, s);
    for (let py = 0; py < s; py++) {
      for (let px = 0; px < s; px++) {
        const x = cx + (px / s) * 2 * range - range;
        const z = cz + (py / s) * 2 * range - range;
        const h = heightAt(x, z);
        let c;
        if (isVoid(x, z) || h < -8) c = [6, 6, 10];
        else if (h < -1.2) c = pal.water;
        else if (h > 12) c = pal.wall;
        else {
          const k = Math.max(0, Math.min(1, (h + 1) / 9));
          c = [pal.low[0] + (pal.high[0] - pal.low[0]) * k, pal.low[1] + (pal.high[1] - pal.low[1]) * k, pal.low[2] + (pal.high[2] - pal.low[2]) * k];
        }
        const dx = heightAt(x + 0.8, z) - heightAt(x - 0.8, z);
        const shade = Math.max(0.55, Math.min(1.3, 1 - dx * 0.1));
        const i = (py * s + px) * 4;
        img.data[i] = c[0] * shade;
        img.data[i + 1] = c[1] * shade;
        img.data[i + 2] = c[2] * shade;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // puente del santuario (nivel 3)
    if (this.level?.segments?.length) {
      g.fillStyle = 'rgba(200, 180, 220, 0.9)';
      const [x0, y0] = this.toMap(-2.3, 33);
      const [x1, y1] = this.toMap(2.3, 56);
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    // puentes de las ruinas (nivel 2)
    if (this.level?.index === 2) {
      g.fillStyle = 'rgba(200, 190, 230, 0.9)';
      for (const bx of [-20, 22]) {
        const [x0, y0] = this.toMap(bx - 2.2, 12.3);
        const [x1, y1] = this.toMap(bx + 2.2, 25.7);
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
    this.bg = off;
  }

  update(dt) {
    this.t += dt;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.05;
    this.draw();
  }

  #dot(x, z, color, r = 3, glow = false) {
    const { ctx } = this;
    const [px, py] = this.toMap(x, z);
    if (glow) {
      ctx.fillStyle = color.replace('rgb', 'rgba').replace(')', ', 0.3)');
      ctx.beginPath();
      ctx.arc(px, py, r + 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    return [px, py];
  }

  draw() {
    const { ctx, size: s, game } = this;
    const level = game.level;
    if (!level) return;
    if (!this.bg) this.#buildBackground();
    ctx.clearRect(0, 0, s, s);
    ctx.drawImage(this.bg, 0, 0);
    const pulse = 3 + Math.sin(this.t * 6) * 0.9;

    for (const e of game.entities) {
      if (!e.alive) continue;
      switch (e.type) {
        case 'cell':
          this.#dot(e.basePos.x, e.basePos.z, 'rgb(95, 240, 255)', pulse, true);
          break;
        case 'health':
        case 'ammo':
        case 'grenades':
          this.#dot(e.basePos.x, e.basePos.z, e.type === 'health' ? 'rgb(61, 255, 176)' : 'rgb(255, 196, 107)', 1.6);
          break;
        case 'weaponPickup':
          this.#dot(e.basePos.x, e.basePos.z, 'rgb(255, 224, 138)', 3.2, true);
          break;
        case 'pylon':
          if (!e.destroyed) this.#dot(e.pos.x, e.pos.z, 'rgb(176, 112, 255)', pulse, true);
          break;
        case 'node':
          if (!e.dead) this.#dot(e.center.x, e.center.z, 'rgb(255, 79, 216)', 3.5, true);
          break;
        case 'beacon':
          this.#dot(e.pos.x, e.pos.z, e.state === 'ready' ? 'rgb(255, 196, 107)' : 'rgb(127, 232, 255)', 3.5, e.state !== 'off');
          break;
        case 'dropship':
          if (!e.wreck && e.state !== 'hidden') {
            const [px, py] = this.toMap(e.pos.x, e.pos.z);
            ctx.fillStyle = e.state === 'ready' ? '#3dffb0' : '#8ab';
            ctx.fillRect(px - 4, py - 4, 8, 8);
          }
          break;
        default:
          break;
      }
    }
    // enemigos: solo los alertados o cercanos (el radar no es omnisciente)
    const player = game.player;
    for (const e of game.enemies) {
      if (e.dead || e.isBoss) continue;
      const near = player && e.currPos.distanceTo(player.currPos) < 26;
      if (!e.alerted && !near) continue;
      this.#dot(e.currPos.x, e.currPos.z, e.type === 'bastion' ? 'rgb(255, 150, 60)' : 'rgb(255, 74, 90)', e.type === 'bastion' ? 3.2 : 2.3);
    }
    const boss = game.boss;
    if (boss && !boss.dead) {
      const [px, py] = this.#dot(boss.currPos.x, boss.currPos.z, 'rgb(255, 79, 216)', 5 + Math.sin(this.t * 4), true);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    // objetivo actual
    const wp = level.waypoint;
    if (wp) {
      const [px, py] = this.toMap(wp.pos.x, wp.pos.z);
      ctx.save();
      ctx.translate(Math.max(6, Math.min(s - 6, px)), Math.max(6, Math.min(s - 6, py)));
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffc46b';
      ctx.strokeStyle = '#1a1206';
      ctx.lineWidth = 1.5;
      ctx.fillRect(-4, -4, 8, 8);
      ctx.strokeRect(-4, -4, 8, 8);
      ctx.restore();
    }
    // jugador + cono de visión
    if (player) {
      const [x, y] = this.toMap(player.currPos.x, player.currPos.z);
      const yaw = game.cameraRig.yaw;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-yaw);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
      grad.addColorStop(0, 'rgba(160,250,255,0.35)');
      grad.addColorStop(1, 'rgba(160,250,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 30, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-player.facing + Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#03151c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 11px Chakra Petch, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', s / 2, 12);
    ctx.strokeStyle = 'rgba(140, 240, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, s - 1, s - 1);
  }
}
