/**
 * Minimap — radar con vista cenital (norte arriba). El fondo se pinta una sola
 * vez a partir de la función de altura del terreno; los marcadores se
 * redibujan ~20 veces por segundo.
 */
import { heightAt, CREVASSE_DEPTH } from '../world/Terrain.js';
import { INTERFERENCE_RADIUS } from '../entities/Tower.js';

const RANGE = 58; // metros desde el centro hasta el borde del mapa

export class Minimap {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = canvas.width;
    this.bg = null;
    this.timer = 0;
    this.t = 0;
  }

  toMap(x, z) {
    const s = this.size;
    return [((x + RANGE) / (2 * RANGE)) * s, ((z + RANGE) / (2 * RANGE)) * s];
  }

  buildBackground() {
    const s = this.size;
    const off = document.createElement('canvas');
    off.width = off.height = s;
    const g = off.getContext('2d');
    const img = g.createImageData(s, s);
    for (let py = 0; py < s; py++) {
      for (let px = 0; px < s; px++) {
        const x = (px / s) * 2 * RANGE - RANGE;
        const z = (py / s) * 2 * RANGE - RANGE;
        const h = heightAt(x, z);
        let r;
        let gg;
        let b;
        if (h < -3) {
          const k = Math.min(1, (h + 3) / (CREVASSE_DEPTH + 3));
          r = 40 - k * 25; gg = 24 - k * 14; b = 18 - k * 10;
        } else if (h > 8) {
          r = 150; gg = 104; b = 74;
        } else {
          const k = Math.max(0, Math.min(1, (h + 1) / 7));
          r = 96 + k * 60; gg = 66 + k * 40; b = 44 + k * 26;
        }
        // sombreado por pendiente
        const dx = heightAt(x + 0.8, z) - heightAt(x - 0.8, z);
        const shade = Math.max(0.6, Math.min(1.25, 1 - dx * 0.12));
        const i = (py * s + px) * 4;
        img.data[i] = r * shade;
        img.data[i + 1] = gg * shade;
        img.data[i + 2] = b * shade;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // puentes
    g.strokeStyle = 'rgba(222, 180, 120, 0.95)';
    g.lineWidth = 4;
    for (const bx of [-32, -2]) {
      const [x0, y0] = this.toMap(bx, -17);
      const [, y1] = this.toMap(bx, -4);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0, y1);
      g.stroke();
    }
    // vía
    g.strokeStyle = 'rgba(200, 200, 210, 0.5)';
    g.lineWidth = 1.5;
    const [rx, ry0] = this.toMap(14, 46);
    const [, ry1] = this.toMap(14, 1.5);
    g.beginPath();
    g.moveTo(rx, ry0);
    g.lineTo(rx, ry1);
    g.stroke();
    this.bg = off;
  }

  update(dt) {
    this.t += dt;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.05;
    this.draw();
  }

  draw() {
    const { ctx, size: s, game } = this;
    if (!this.bg) this.buildBackground();
    ctx.clearRect(0, 0, s, s);
    ctx.drawImage(this.bg, 0, 0);

    const level = game.level;
    // torres con su campo
    for (const t of level.towers) {
      const [x, y] = this.toMap(t.center.x, t.center.z);
      const r = (INTERFERENCE_RADIUS / (2 * RANGE)) * s;
      if (!t.destroyed) {
        ctx.fillStyle = 'rgba(255, 60, 40, 0.22)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff4a3a';
      } else {
        ctx.fillStyle = '#6b6b70';
      }
      ctx.fillRect(x - 4, y - 4, 8, 8);
      if (t.destroyed) {
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 4);
        ctx.lineTo(x + 4, y + 4);
        ctx.moveTo(x + 4, y - 4);
        ctx.lineTo(x - 4, y + 4);
        ctx.stroke();
      }
    }
    // malacate
    const ex = level.extraction;
    if (ex) {
      const [x, y] = this.toMap(ex.center.x, ex.center.z);
      const ready = ex.state !== 'locked';
      ctx.fillStyle = ready ? '#4ee39a' : '#a0525a';
      ctx.strokeStyle = '#0c0806';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(x - 5, y - 5, 10, 10);
      ctx.fill();
      ctx.stroke();
      if (ready) {
        ctx.strokeStyle = `rgba(78, 227, 154, ${0.5 + Math.sin(this.t * 5) * 0.4})`;
        ctx.beginPath();
        ctx.arc(x, y, 9 + Math.sin(this.t * 5) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // coleccionables y drones
    const pulse = 2.6 + Math.sin(this.t * 6) * 0.8;
    for (const e of game.entities) {
      if (!e.alive) continue;
      if (e.type === 'core' || e.type === 'goldcore' || e.type === 'battery') {
        const p = e.object3d.position;
        const [x, y] = this.toMap(p.x, p.z);
        ctx.fillStyle = e.type === 'core' ? '#d9f6ff' : e.type === 'goldcore' ? '#ffd36b' : '#5dffa8';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(x, y, e.type === 'battery' ? 2.2 : pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (e.type === 'drone' && e.isActive) {
        const [x, y] = this.toMap(e.currPos.x, e.currPos.z);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-e.yaw + Math.PI);
        ctx.fillStyle = e.state === 'chase' ? '#ff5a3a' : '#ff9a3a';
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(4, 4);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    // jugador + cono de visión
    const player = game.player;
    if (player) {
      const [x, y] = this.toMap(player.currPos.x, player.currPos.z);
      const yaw = game.cameraRig.yaw;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-yaw);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
      grad.addColorStop(0, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 34, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-player.facing + Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#1b120b';
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
    // brújula
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 11px Chakra Petch, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', s / 2, 12);
    ctx.strokeStyle = 'rgba(255, 226, 196, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, s - 1, s - 1);
  }
}
