/**
 * VRHud — HUD dentro de la escena 3D para los modos de realidad virtual.
 *
 * El HUD normal es HTML y no se ve dentro de un visor, así que en VR (Meta
 * Quest) y con lentes para celular (VR Box) se dibuja un panel en un canvas
 * 2D (textura) que flota bajo la mirada, más una retícula en el punto al que
 * se apunta.
 */
import * as THREE from 'three';
import { GRENADES } from '../config.js';

const W = 1024;
const H = 420;

export class VRHud {
  constructor(game) {
    this.game = game;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, (1.0 * H) / W),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
    );
    this.panel.renderOrder = 999;
    this.panel.frustumCulled = false;
    this.panel.position.set(0, -0.36, -1.25);
    this.panel.rotation.x = -0.32;
    this.panel.visible = false;

    // retícula en el punto de mira (tamaño angular constante)
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1, 32),
      new THREE.MeshBasicMaterial({ color: 0x9ff4ff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false })
    );
    this.reticle.renderOrder = 998;
    this.reticle.visible = false;
    this.reticle.frustumCulled = false;

    this.t = 0;
    this.toasts = [];
    this.pausedText = null;
    game.bus.on('hud:toast', (e) => this.toasts.push({ text: e.text, type: e.type, t: 3 }));
    game.bus.on('objective:done', (e) => this.toasts.push({ text: `✓ ${e.text}`, type: 'info', t: 3 }));
  }

  attach(scene, camera) {
    camera.add(this.panel);
    scene.add(this.reticle);
  }

  setVisible(v) {
    this.panel.visible = v;
    this.reticle.visible = v;
  }

  /** Coloca la retícula en el punto de mira, de cara a la cámara. */
  #updateReticle() {
    const { game } = this;
    const aim = game.weapons?.aimPoint;
    if (!aim || game.state !== 'playing') {
      this.reticle.visible = false;
      return;
    }
    const cam = game.camera.getWorldPosition(new THREE.Vector3());
    const d = Math.max(1, cam.distanceTo(aim));
    this.reticle.visible = true;
    this.reticle.position.copy(aim).lerp(cam, 0.02);
    this.reticle.lookAt(cam);
    this.reticle.scale.setScalar(d * 0.012);
    const t = game.weapons.aimTarget;
    this.reticle.material.color.setHex(t && (t.faction === 'enemy' || t.isBoss) ? 0xff4f6a : 0x9ff4ff);
  }

  update(dt) {
    if (!this.panel.visible) return;
    this.#updateReticle();
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter((t) => t.t > 0).slice(-3);
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1 / 12;
    this.#draw();
    this.texture.needsUpdate = true;
  }

  #bar(x, y, w, h, k, color, label) {
    const c = this.ctx;
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(x, y, w, h);
    c.fillStyle = color;
    c.fillRect(x, y, w * THREE.MathUtils.clamp(k, 0, 1), h);
    if (label) {
      c.fillStyle = '#e9f6ff';
      c.font = '600 22px "Chakra Petch", sans-serif';
      c.fillText(label, x + 8, y + h - 7);
    }
  }

  #draw() {
    const { game } = this;
    const c = this.ctx;
    const p = game.player;
    const w = game.weapons;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(4,12,20,0.62)';
    c.beginPath();
    c.roundRect(0, 0, W, H, 28);
    c.fill();
    c.strokeStyle = 'rgba(127,232,255,0.45)';
    c.lineWidth = 3;
    c.stroke();
    c.textBaseline = 'alphabetic';

    if (game.state === 'paused') {
      c.fillStyle = '#7fe8ff';
      c.font = '700 64px "Chakra Petch", sans-serif';
      c.textAlign = 'center';
      c.fillText('PAUSA', W / 2, 150);
      c.font = '500 30px "Chakra Petch", sans-serif';
      c.fillStyle = '#e9f6ff';
      for (const [i, line] of (this.pausedText ?? []).entries()) c.fillText(line, W / 2, 220 + i * 44);
      c.textAlign = 'left';
      return;
    }
    if (!p) return;

    // objetivo actual
    const obj = game.level?.objectives?.find((o) => o.active && !o.done) ?? game.level?.objectives?.find((o) => !o.done);
    c.fillStyle = '#ffd36e';
    c.font = '600 28px "Chakra Petch", sans-serif';
    const prog = obj?.progress ? (obj.progress.unit === '%' ? ` ${obj.progress.cur}%` : ` ${obj.progress.cur}/${obj.progress.max}`) : '';
    c.fillText(`▸ ${obj ? obj.text + prog : '—'}`.slice(0, 62), 28, 48);

    // jefe
    const boss = game.boss;
    if (boss && !boss.dead) {
      c.fillStyle = '#ff7ae0';
      c.font = '700 24px "Chakra Petch", sans-serif';
      c.fillText((boss.cfg?.name ?? 'JEFE').toUpperCase(), 28, 92);
      this.#bar(220, 72, 760, 24, boss.hp / boss.maxHp, '#ff4fd8');
    }

    // vitales
    this.#bar(28, 120, 470, 34, p.shield / p.maxShield, '#2fe6ff', `ESCUDO ${Math.round(p.shield)}`);
    this.#bar(28, 164, 470, 34, p.health / p.maxHealth, p.health < 35 ? '#ff4040' : '#5dff9a', `INTEGRIDAD ${Math.round(p.health)}`);

    // arma
    const a = w.state;
    c.fillStyle = '#e9f6ff';
    c.font = '700 34px "Chakra Petch", sans-serif';
    c.fillText(w.def.short, 540, 148);
    c.font = '700 52px "Chakra Petch", monospace';
    c.fillText(w.reloading ? 'RECARGANDO' : `${a.mag} / ${a.reserve}`, 540, 200);
    c.font = '500 24px "Chakra Petch", sans-serif';
    c.fillStyle = '#9fb7c9';
    c.fillText(`Granadas: ${w.grenades.frag} frag · ${w.grenades.gravity} sing. (${GRENADES[w.grenadeType].name})`, 540, 232);

    // aviso de interacción
    const prompt = game.level?.currentPrompt?.();
    let y = 268;
    if (prompt) {
      c.fillStyle = prompt.ok ? '#7fe8ff' : '#ff8a8a';
      c.font = '600 28px "Chakra Petch", sans-serif';
      c.fillText(`[${game.immersive === 'xr' ? 'Grip izq.' : 'di «usa»'}] ${prompt.text}`.slice(0, 60), 28, y);
      y += 38;
    }
    // radio
    const radio = game.radio.current;
    if (radio) {
      c.fillStyle = '#ffd36e';
      c.font = '500 26px "Chakra Petch", sans-serif';
      this.#wrap(radio.text, 28, y, W - 56, 32, 2);
      y += 66;
    }
    // avisos y voz
    c.font = '500 24px "Chakra Petch", sans-serif';
    for (const t of this.toasts) {
      c.fillStyle = t.type === 'danger' ? '#ff8a8a' : '#bfe9ff';
      c.fillText(t.text.slice(0, 70), 28, Math.min(H - 50, y));
      y += 30;
    }
    const voice = game.voice?.status();
    if (voice) {
      c.fillStyle = '#9ff4ff';
      c.fillText(voice.slice(0, 70), 28, H - 22);
    }
    c.fillStyle = '#9fb7c9';
    c.textAlign = 'right';
    c.fillText(`${Math.round(game.level?.score ?? 0)} pts`, W - 28, H - 22);
    c.textAlign = 'left';
  }

  #wrap(text, x, y, maxW, lh, maxLines) {
    const c = this.ctx;
    const words = text.split(' ');
    let line = '';
    let n = 0;
    for (const wd of words) {
      const test = line ? `${line} ${wd}` : wd;
      if (c.measureText(test).width > maxW && line) {
        c.fillText(line, x, y + n * lh);
        line = wd;
        if (++n >= maxLines) return;
      } else line = test;
    }
    if (line) c.fillText(line, x, y + n * lh);
  }
}
