/**
 * HUD — interfaz de juego (DOM + Bootstrap 5).
 * Escucha eventos del EventBus y actualiza solo lo que cambia.
 */
import * as THREE from 'three';
import { COMBAT } from '../config.js';

export const CONTROLS = [
  { keys: ['W', 'A', 'S', 'D'], label: 'Mover' },
  { keys: ['Mouse'], label: 'Cámara' },
  { keys: ['Shift'], label: 'Correr' },
  { keys: ['Espacio'], label: 'Saltar' },
  { keys: ['Clic izq.'], label: 'Cargar y lanzar orbe' },
  { keys: ['Clic der.'], label: 'Apuntar' },
  { keys: ['F'], label: 'Golpe' },
  { keys: ['Q'], label: 'Onda sísmica' },
  { keys: ['E'], label: 'Interactuar' },
  { keys: ['Rueda'], label: 'Zoom' },
  { keys: ['H'], label: 'Ayuda' },
  { keys: ['Esc', 'P'], label: 'Pausa' },
];

export function renderControls(container) {
  container.innerHTML = CONTROLS.map(
    (c) => `<div class="ctrl"><span class="ctrl__keys">${c.keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span><span>${c.label}</span></div>`
  ).join('');
}

const $ = (id) => document.getElementById(id);
const _proj = new THREE.Vector3();

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = $('hud');
    this.el = {
      objectives: $('objective-list'),
      timer: $('timer'),
      timerChip: $('timer-chip'),
      storm: $('storm-fill'),
      score: $('score'),
      batteryBar: $('battery-bar'),
      batteryGhost: $('battery-ghost'),
      batteryText: $('battery-text'),
      energyBar: $('energy-bar'),
      energyText: $('energy-text'),
      staminaBar: $('stamina-bar'),
      gravity: $('gravity-text'),
      cdPunch: $('cd-punch'),
      cdPulse: $('cd-pulse'),
      actionThrow: $('action-throw'),
      actionPulse: $('action-pulse'),
      crosshair: $('crosshair'),
      chargeRing: $('charge-ring'),
      prompt: $('prompt'),
      promptText: $('prompt-text'),
      banner: $('banner'),
      bannerTitle: $('banner-title'),
      bannerSubtitle: $('banner-subtitle'),
      toasts: $('toasts'),
      floaters: $('floaters'),
      interference: $('interference-warning'),
      vDamage: $('vignette-damage'),
      vInterference: $('vignette-interference'),
      help: $('help-panel'),
    };
    this.cache = {};
    this.floaters = [];
    this.bannerTimer = 0;
    document.querySelectorAll('[data-controls]').forEach(renderControls);

    const bus = game.bus;
    bus.on('objectives', (list) => this.renderObjectives(list));
    bus.on('score', (e) => this.onScore(e));
    bus.on('hud:toast', (e) => this.toast(e.text, e.type, e.icon));
    bus.on('hud:banner', (e) => this.banner(e.title, e.subtitle, e.type));
    bus.on('player:damaged', () => this.flashDamage());
    bus.on('interference', (on) => {
      this.el.interference.classList.toggle('is-hidden', !on);
      this.el.vInterference.style.opacity = on ? 1 : 0;
    });
  }

  show() {
    this.root.classList.remove('is-hidden');
  }

  hide() {
    this.root.classList.add('is-hidden');
    this.el.help.classList.add('is-hidden');
  }

  toggleHelp(force) {
    const hidden = force !== undefined ? !force : !this.el.help.classList.contains('is-hidden');
    this.el.help.classList.toggle('is-hidden', hidden);
  }

  reset(mission) {
    this.cache = {};
    this.el.toasts.innerHTML = '';
    this.el.floaters.innerHTML = '';
    this.floaters = [];
    this.el.banner.classList.add('is-hidden');
    this.el.interference.classList.add('is-hidden');
    this.el.vInterference.style.opacity = 0;
    this.el.vDamage.style.opacity = 0;
    this.el.score.textContent = '0';
    this.renderObjectives(mission.objectives(), true);
  }

  renderObjectives(list, silent = false) {
    const prev = this.lastObjectives || [];
    this.el.objectives.innerHTML = list
      .map((o, i) => {
        const pct = Math.round((o.progress / o.total) * 100);
        const changed = !silent && prev[i] && (prev[i].progress !== o.progress || prev[i].locked !== o.locked);
        const cls = [o.done ? 'is-done' : '', o.locked ? 'is-locked' : '', changed ? 'is-pulse' : ''].join(' ');
        const count = o.id === 'extract' ? (o.locked ? '<i class="bi bi-lock-fill"></i>' : '<i class="bi bi-unlock-fill"></i>') : `${o.progress}/${o.total}`;
        return `<li class="${cls}"><i class="bi bi-${o.done ? 'check-circle-fill' : o.icon} obj-icon"></i><span class="obj-label">${o.label}</span><span class="obj-count">${count}</span><div class="obj-bar"><span style="width:${pct}%"></span></div></li>`;
      })
      .join('');
    this.lastObjectives = list.map((o) => ({ progress: o.progress, locked: o.locked }));
  }

  onScore({ points, label, pos, total }) {
    this.el.score.textContent = total.toLocaleString('es-MX');
    if (pos) this.floater(pos, `+${points}`, label);
  }

  floater(pos, text, label) {
    const div = document.createElement('div');
    div.className = 'floater';
    div.innerHTML = `${text}${label ? `<small>${label}</small>` : ''}`;
    this.el.floaters.appendChild(div);
    this.floaters.push({ div, pos: pos.clone().add(new THREE.Vector3(0, 1.2, 0)), t: 0 });
  }

  toast(text, type = 'info', icon = 'info-circle') {
    const div = document.createElement('div');
    div.className = `toast-item toast-item--${type}`;
    div.innerHTML = `<i class="bi bi-${icon}"></i><span>${text}</span>`;
    this.el.toasts.prepend(div);
    while (this.el.toasts.children.length > 5) this.el.toasts.lastChild.remove();
    setTimeout(() => div.classList.add('is-out'), 2800);
    setTimeout(() => div.remove(), 3300);
  }

  banner(title, subtitle = '', type = 'info') {
    const b = this.el.banner;
    this.el.bannerTitle.textContent = title;
    this.el.bannerSubtitle.textContent = subtitle;
    b.className = `banner is-${type}`;
    // reiniciar la animación
    void b.offsetWidth;
    this.bannerTimer = 3;
  }

  flashDamage() {
    this.el.vDamage.style.opacity = 1;
    clearTimeout(this.damageTimeout);
    this.damageTimeout = setTimeout(() => {
      this.el.vDamage.style.opacity = 0;
    }, 180);
  }

  #set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  update(dt) {
    const { game } = this;
    const mission = game.mission;
    const player = game.player;
    if (!mission || !player) return;
    const el = this.el;

    // tiempo
    const t = Math.ceil(mission.timeLeft);
    this.#set('time', t, (v) => {
      const m = Math.floor(v / 60);
      const s = v % 60;
      el.timer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      el.timerChip.classList.toggle('is-critical', v <= 30);
    });
    this.#set('storm', Math.round(mission.storm * 100), (v) => {
      el.storm.style.width = `${v}%`;
    });

    // barras
    const bat = Math.round(player.battery);
    this.#set('battery', bat, (v) => {
      el.batteryBar.style.width = `${v}%`;
      el.batteryGhost.style.width = `${v}%`;
      el.batteryText.textContent = v;
      el.batteryBar.classList.toggle('is-low', v <= 25);
    });
    this.#set('energy', Math.round(player.energy), (v) => {
      el.energyBar.style.width = `${v}%`;
      el.energyText.textContent = v;
      el.actionThrow.classList.toggle('is-disabled', v < COMBAT.orbCost);
      el.actionPulse.classList.toggle('is-disabled', v < COMBAT.pulseCost);
    });
    this.#set('stamina', Math.round(player.stamina), (v) => {
      el.staminaBar.style.width = `${v}%`;
    });
    this.#set('gravity', game.physics.gravity.toFixed(1), (v) => {
      el.gravity.textContent = v;
    });

    // enfriamientos
    const combat = game.combat;
    this.#set('cdPunch', Math.max(0, Math.round((combat.punchCooldown / COMBAT.punchCooldown) * 100)), (v) => {
      el.cdPunch.style.height = `${v}%`;
    });
    this.#set('cdPulse', Math.max(0, Math.round((combat.pulseCooldown / COMBAT.pulseCooldown) * 100)), (v) => {
      el.cdPulse.style.height = `${v}%`;
    });

    // mira
    const charge = combat.charging ? Math.round(combat.charge * 100) : 0;
    this.#set('charge', charge, (v) => {
      el.chargeRing.style.strokeDasharray = `${v} 100`;
    });
    const aiming = game.input.down('aim') || combat.charging;
    this.#set('aiming', aiming, (v) => el.crosshair.classList.toggle('is-aiming', v));
    const showCross = game.state === 'playing' && !player.dead;
    this.#set('cross', showCross, (v) => el.crosshair.classList.toggle('is-hidden', !v));

    // indicación de interacción
    const ex = game.level.extraction;
    let prompt = null;
    if (ex && !player.dead && ex.canInteract(player.currPos)) {
      prompt = ex.state === 'ready' ? 'Activar el malacate' : 'Malacate bloqueado: completa los objetivos';
    }
    this.#set('prompt', prompt, (v) => {
      el.prompt.classList.toggle('is-hidden', !v);
      if (v) {
        el.promptText.textContent = v;
        el.prompt.classList.toggle('is-locked', ex.state !== 'ready');
      }
    });

    // banner
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) el.banner.classList.add('is-hidden');
    }

    // textos flotantes proyectados desde el mundo 3D
    const cam = game.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const f of this.floaters) {
      f.t += dt;
      _proj.copy(f.pos);
      _proj.y += f.t * 1.2;
      _proj.project(cam);
      const visible = _proj.z < 1;
      f.div.style.display = visible ? '' : 'none';
      f.div.style.left = `${(_proj.x * 0.5 + 0.5) * w}px`;
      f.div.style.top = `${(-_proj.y * 0.5 + 0.5) * h}px`;
      f.div.style.opacity = String(Math.max(0, 1 - Math.max(0, f.t - 0.8) / 0.6));
    }
    this.floaters = this.floaters.filter((f) => {
      if (f.t > 1.4) {
        f.div.remove();
        return false;
      }
      return true;
    });
  }
}
