/**
 * HUD — visor táctico de NOVA-7 (DOM + Bootstrap 5).
 *
 * Valores continuos (salud, munición, jefe, temporizadores) se leen cada
 * cuadro y solo se escribe en el DOM lo que cambió. Los sucesos discretos
 * (radio, bajas, impactos, objetivos) llegan por el EventBus.
 */
import * as THREE from 'three';
import { WEAPONS, WEAPON_ORDER, ABILITIES } from '../config.js';

export const CONTROLS = [
  { keys: ['W', 'A', 'S', 'D'], label: 'Mover' },
  { keys: ['Mouse'], label: 'Cámara' },
  { keys: ['Shift'], label: 'Correr' },
  { keys: ['Espacio'], label: 'Saltar' },
  { keys: ['Clic izq.'], label: 'Disparar (mantener: cargar orbe)' },
  { keys: ['Clic der.'], label: 'Apuntar · mira del riel' },
  { keys: ['R'], label: 'Recargar' },
  { keys: ['1', '2', '3', '4', 'Rueda'], label: 'Cambiar arma' },
  { keys: ['G'], label: 'Granada (mantener y soltar)' },
  { keys: ['T'], label: 'Tipo de granada' },
  { keys: ['F'], label: 'Golpe' },
  { keys: ['Q'], label: 'Pulso de choque' },
  { keys: ['E'], label: 'Interactuar' },
  { keys: ['H'], label: 'Ayuda' },
  { keys: ['Esc', 'P'], label: 'Pausa' },
];

export function renderControls(container) {
  container.innerHTML = CONTROLS.map(
    (c) => `<div class="ctrl"><span>${c.label}</span><span class="ctrl__keys">${c.keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span></div>`
  ).join('');
}

const $ = (id) => document.getElementById(id);
const _p = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = $('hud');
    const ids = [
      'objective-list', 'objectives-title', 'boss-bar', 'boss-name', 'boss-title', 'boss-nodes', 'boss-fill', 'boss-ghost', 'boss-telegraph',
      'hud-timer', 'timer-label', 'timer-value', 'hud-progress', 'progress-label', 'progress-value', 'progress-fill',
      'score', 'killfeed', 'shield-bar', 'shield-text', 'health-bar', 'health-ghost', 'health-text', 'stamina-bar',
      'pulse-ring', 'melee-ring', 'ability-pulse', 'ability-melee',
      'weapon-name', 'ammo-mag', 'ammo-reserve', 'reload-bar', 'weapon-slots', 'frag-count', 'gravity-count', 'grenade-frag', 'grenade-gravity',
      'crosshair', 'cross-lines', 'charge-ring', 'hitmarker', 'damage-indicators', 'waypoint', 'waypoint-icon', 'waypoint-label', 'waypoint-dist',
      'floaters', 'prompt', 'prompt-text', 'banner', 'banner-title', 'banner-subtitle', 'toasts', 'hint', 'hint-keys', 'hint-text',
      'radio', 'radio-name', 'radio-text', 'radio-icon', 'help-panel', 'vignette-damage', 'vignette-low', 'vignette-shield', 'scope',
    ];
    this.el = {};
    for (const id of ids) this.el[id] = $(id);
    this.cache = {};
    this.floaters = [];
    this.hints = [];
    this.hintT = 0;
    this.bannerTimer = 0;
    this.scoreShown = 0;
    this.damageFlash = 0;
    this.shieldFlash = 0;
    this.bossGhost = 1;
    this.healthGhost = 1;
    document.querySelectorAll('[data-controls]').forEach(renderControls);
    this.#buildSlots();

    const bus = game.bus;
    bus.on('objectives:set', (e) => this.#renderObjectives(e));
    bus.on('objective:done', (e) => this.toast(`Objetivo completado: ${e.text}`, 'battery', 'check2-circle'));
    bus.on('hud:toast', (e) => this.toast(e.text, e.type, e.icon));
    bus.on('hud:banner', (e) => this.banner(e.title, e.subtitle, e.type));
    bus.on('hud:hint', (e) => this.hints.push({ ...e, at: this.game.time + (e.delay ?? 0) }));
    bus.on('hud:kill', (e) => this.#kill(e));
    bus.on('score:add', (e) => this.#feed(`${e.reason} <b>+${e.points}</b>`, 'is-score'));
    bus.on('radio:line', (e) => this.#radio(e));
    bus.on('radio:clear', () => {
      this.el.radio.classList.add('is-hidden');
      this.el.radio.classList.remove('is-talking');
    });
    bus.on('hitmarker', (e) => this.#hitmarker(e.head ? 'is-head' : ''));
    bus.on('enemy:killed', (e) => {
      if (e.source === 'player') this.#hitmarker('is-kill');
    });
    bus.on('player:damaged', (e) => this.#damaged(e));
    bus.on('player:shieldBroken', () => {
      this.shieldFlash = 1;
      this.toast('¡Escudo agotado!', 'danger', 'shield-slash-fill');
    });
    bus.on('damage:number', (e) => this.#number(e));
    bus.on('boss:show', (e) => {
      this.el['boss-name'].textContent = e.name;
      this.el['boss-title'].textContent = e.title ?? '';
      this.el['boss-bar'].style.setProperty('--boss', e.color ?? '#ff4fd8');
      this.el['boss-nodes'].textContent = '';
      this.el['boss-bar'].classList.remove('is-hidden');
      this.bossGhost = 1;
    });
    bus.on('boss:hide', () => this.el['boss-bar'].classList.add('is-hidden'));
    bus.on('boss:nodes', ({ total, left }) => {
      this.el['boss-nodes'].innerHTML = left > 0 ? `<i class="bi bi-gem"></i> ${left}/${total} ${total > 3 ? 'anclas' : 'nodos'}` : '';
    });
    bus.on('boss:telegraph', ({ text }) => {
      const t = this.el['boss-telegraph'];
      t.textContent = text;
      t.classList.remove('is-on');
      void t.offsetWidth;
      t.classList.add('is-on');
    });
    bus.on('weapon:switched', () => {
      this.el['weapon-name'].classList.remove('is-flash');
    });
    this.el['boss-telegraph'].addEventListener('animationend', () => this.el['boss-telegraph'].classList.remove('is-on'));
  }

  #buildSlots() {
    this.el['weapon-slots'].innerHTML = WEAPON_ORDER.map((id) => {
      const d = WEAPONS[id];
      return `<div class="wslot" data-slot="${id}"><kbd>${d.slot}</kbd>${d.short}<small data-ammo="${id}">–</small></div>`;
    }).join('');
    this.slots = {};
    for (const id of WEAPON_ORDER) {
      this.slots[id] = {
        el: this.el['weapon-slots'].querySelector(`[data-slot="${id}"]`),
        ammo: this.el['weapon-slots'].querySelector(`[data-ammo="${id}"]`),
      };
    }
  }

  // ---------------------------------------------------------------- utilidades DOM
  #set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  #text(id, value) {
    this.#set(`t:${id}`, value, (v) => {
      this.el[id].textContent = v;
    });
  }

  #scaleX(id, k) {
    const v = Math.round(THREE.MathUtils.clamp(k, 0, 1) * 1000) / 1000;
    this.#set(`s:${id}`, v, (x) => {
      this.el[id].style.transform = `scaleX(${x})`;
    });
  }

  #toggle(id, cls, on) {
    this.#set(`c:${id}:${cls}`, on, (v) => this.el[id].classList.toggle(cls, v));
  }

  reset() {
    this.cache = {};
    this.el.killfeed.innerHTML = '';
    this.el.toasts.innerHTML = '';
    this.el.floaters.innerHTML = '';
    this.el['damage-indicators'].innerHTML = '';
    this.el['boss-bar'].classList.add('is-hidden');
    this.el.radio.classList.add('is-hidden');
    this.el.hint.classList.add('is-hidden');
    this.el['help-panel'].classList.add('is-hidden');
    this.el['objective-list'].innerHTML = '';
    this.floaters = [];
    this.hints = [];
    this.scoreShown = this.game.level?.score ?? 0;
    this.healthGhost = 1;
  }

  show() {
    this.root.classList.remove('is-hidden');
    document.body.dataset.screen = 'game';
  }

  hide() {
    this.root.classList.add('is-hidden');
    this.el.scope.classList.add('is-hidden');
    for (const id of ['vignette-damage', 'vignette-low', 'vignette-shield']) this.el[id].style.opacity = 0;
  }

  toggleHelp() {
    this.el['help-panel'].classList.toggle('is-hidden');
  }

  // ---------------------------------------------------------------- objetivos
  #renderObjectives({ title, list }) {
    this.el['objectives-title'].innerHTML = `<i class="bi bi-flag-fill"></i> ${title}`;
    const firstOpen = list.findIndex((o) => !o.done);
    const html = list.map((o, i) => {
      const cls = o.done ? 'is-done' : o.active ? 'is-active' : i > firstOpen ? 'is-pending' : '';
      const icon = o.done ? 'check-circle-fill' : o.active ? 'caret-right-fill' : 'circle';
      let count = '';
      let bar = '';
      if (o.progress && !o.done) {
        const unit = o.progress.unit ?? '';
        count = unit === '%' ? `${o.progress.cur}%` : `${o.progress.cur}/${o.progress.max}`;
        bar = `<div class="obj-bar"><span style="width:${(o.progress.cur / o.progress.max) * 100}%"></span></div>`;
      }
      return `<li class="${cls}" data-id="${o.id}"><i class="bi bi-${icon} obj-icon"></i><span class="obj-label">${o.text}</span><span class="obj-count">${count}</span>${bar}</li>`;
    });
    this.el['objective-list'].innerHTML = html.join('');
    // resaltar el que se acaba de completar
    const prev = this.prevDone || new Set();
    const now = new Set(list.filter((o) => o.done).map((o) => o.id));
    for (const id of now) {
      if (!prev.has(id)) this.el['objective-list'].querySelector(`[data-id="${id}"]`)?.classList.add('is-flash');
    }
    this.prevDone = now;
  }

  // ---------------------------------------------------------------- mensajes
  toast(text, type = 'info', icon = 'info-circle') {
    const el = document.createElement('div');
    el.className = `toast-item toast-item--${type}`;
    el.innerHTML = `<i class="bi bi-${icon}"></i><span>${text}</span>`;
    this.el.toasts.prepend(el);
    while (this.el.toasts.children.length > 4) this.el.toasts.lastChild.remove();
    setTimeout(() => el.classList.add('is-out'), 3200);
    setTimeout(() => el.remove(), 3700);
  }

  banner(title, subtitle = '', type = 'info') {
    const b = this.el.banner;
    this.el['banner-title'].textContent = title;
    this.el['banner-subtitle'].textContent = subtitle;
    b.className = `banner is-${type}`;
    void b.offsetWidth;
    this.bannerTimer = 3.6;
  }

  #feed(html, cls = '') {
    const el = document.createElement('div');
    el.className = `kill-item ${cls}`;
    el.innerHTML = html;
    this.el.killfeed.prepend(el);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
    setTimeout(() => el.classList.add('is-out'), 3000);
    setTimeout(() => el.remove(), 3500);
  }

  #kill(e) {
    const extra = e.headshot ? ' <i class="bi bi-bullseye"></i>' : '';
    this.#feed(`${e.name}${extra} <b>+${e.points}</b>`, e.boss ? 'is-boss' : e.headshot ? 'is-head' : '');
  }

  #radio({ speaker, who, text }) {
    const r = this.el.radio;
    r.style.setProperty('--speaker', speaker.color);
    this.el['radio-name'].textContent = `${speaker.name}${speaker.role ? ` · ${speaker.role}` : ''}`;
    this.el['radio-text'].textContent = text;
    this.el['radio-icon'].className = `bi bi-${speaker.icon}`;
    r.classList.toggle('is-eco', who === 'eco');
    r.classList.remove('is-hidden');
    r.classList.add('is-talking');
    r.style.animation = 'none';
    void r.offsetWidth;
    r.style.animation = '';
  }

  #hitmarker(cls) {
    const h = this.el.hitmarker;
    h.classList.remove('is-on', 'is-head', 'is-kill');
    void h.getBoundingClientRect();
    h.classList.add('is-on');
    if (cls) h.classList.add(cls);
  }

  #damaged(e) {
    this.damageFlash = Math.min(1, this.damageFlash + 0.25 + e.amount * 0.02);
    const player = this.game.player;
    if (!e.from || !player) return;
    const yaw = this.game.cameraRig.yaw;
    const dx = e.from.x - player.currPos.x;
    const dz = e.from.z - player.currPos.z;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const angle = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    const arc = document.createElement('div');
    arc.className = 'dmg-arc';
    arc.style.transform = `rotate(${angle}rad)`;
    this.el['damage-indicators'].appendChild(arc);
    while (this.el['damage-indicators'].children.length > 6) this.el['damage-indicators'].firstChild.remove();
    setTimeout(() => arc.remove(), 1150);
  }

  #number({ pos, amount, headshot, weak }) {
    if (!this.game.settings.get('damageNumbers') || amount < 1) return;
    const el = document.createElement('div');
    el.className = `floater${headshot ? ' is-head' : weak ? ' is-weak' : ''}`;
    el.textContent = amount;
    this.el.floaters.appendChild(el);
    const jitter = new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.4, (Math.random() - 0.5) * 0.5);
    this.floaters.push({ el, pos: pos.clone().add(jitter), t: 0.9 });
    if (this.floaters.length > 24) {
      const f = this.floaters.shift();
      f.el.remove();
    }
  }

  // ---------------------------------------------------------------- cuadro a cuadro
  #project(world, out) {
    const cam = this.game.camera;
    _p.copy(world).project(cam);
    cam.getWorldDirection(_fwd);
    const behind = _fwd.dot(out.copy(world).sub(cam.position)) < 0;
    return { x: (_p.x * 0.5 + 0.5) * window.innerWidth, y: (-_p.y * 0.5 + 0.5) * window.innerHeight, behind };
  }

  update(dt) {
    const { game } = this;
    const player = game.player;
    const level = game.level;
    const w = game.weapons;
    if (!player || !level) return;

    // ------------------------------------------- vitales
    const hk = player.health / player.maxHealth;
    this.#scaleX('shield-bar', player.shield / player.maxShield);
    this.#scaleX('health-bar', hk);
    this.healthGhost = Math.max(hk, this.healthGhost - dt * 0.35);
    this.#scaleX('health-ghost', this.healthGhost);
    this.#scaleX('stamina-bar', player.stamina / 100);
    this.#text('shield-text', Math.ceil(player.shield));
    this.#text('health-text', Math.ceil(player.health));
    this.#toggle('health-bar', 'is-low', hk < 0.3);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.8);
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 1.5);
    this.#set('v:dmg', Math.round(this.damageFlash * 20) / 20, (v) => {
      this.el['vignette-damage'].style.opacity = v;
    });
    this.#set('v:shield', Math.round(this.shieldFlash * 20) / 20, (v) => {
      this.el['vignette-shield'].style.opacity = v;
    });
    this.#set('v:low', hk < 0.3 && !player.dead ? 1 : 0, (v) => {
      this.el['vignette-low'].style.opacity = v * 0.8;
    });

    // ------------------------------------------- habilidades
    const pulseK = 1 - Math.max(0, w.pulseCd) / ABILITIES.pulse.cooldown;
    const meleeK = 1 - Math.max(0, w.meleeCd) / ABILITIES.melee.cooldown;
    this.#set('r:pulse', Math.round(pulseK * 100), (v) => {
      this.el['pulse-ring'].style.strokeDashoffset = 100 - v;
    });
    this.#set('r:melee', Math.round(meleeK * 100), (v) => {
      this.el['melee-ring'].style.strokeDashoffset = 100 - v;
    });
    this.#toggle('ability-pulse', 'is-cooling', pulseK < 1);
    this.#toggle('ability-melee', 'is-cooling', meleeK < 1);

    // ------------------------------------------- arma
    const d = w.def;
    const a = w.state;
    this.#text('weapon-name', game.touch?.enabled ? d.short : d.name);
    this.#text('ammo-mag', a.mag);
    this.#text('ammo-reserve', a.reserve);
    this.#set('lowammo', a.mag <= Math.ceil(d.mag * 0.25), (v) => this.el['ammo-mag'].parentElement.classList.toggle('is-low', v));
    const reloading = w.reloading;
    this.#set('reloadOn', reloading, (v) => this.el['reload-bar'].parentElement.classList.toggle('is-on', v));
    if (reloading) this.#scaleX('reload-bar', 1 - w.reloadT / d.reload);
    for (const id of WEAPON_ORDER) {
      const s = this.slots[id];
      const owned = w.owned.has(id);
      this.#set(`slot:${id}`, `${owned}|${w.current === id}`, () => {
        s.el.classList.toggle('is-locked', !owned);
        s.el.classList.toggle('is-current', w.current === id);
      });
      this.#set(`slotAmmo:${id}`, owned ? `${w.ammo[id].mag + w.ammo[id].reserve}` : '–', (v) => {
        s.ammo.textContent = v;
      });
    }
    this.#text('frag-count', w.grenades.frag);
    this.#text('gravity-count', w.grenades.gravity);
    this.#toggle('grenade-frag', 'is-selected', w.grenadeType === 'frag');
    this.#toggle('grenade-gravity', 'is-selected', w.grenadeType === 'gravity');

    // ------------------------------------------- mira
    const scoped = game.state === 'playing' && w.scoped && !w.reloading && game.cameraRig.currentDistance < 0.9;
    this.#set('scope', scoped, (v) => this.el.scope.classList.toggle('is-hidden', !v));
    this.#set('xmode', d.id, (v) => {
      this.el.crosshair.classList.remove('mode-rifle', 'mode-shotgun', 'mode-orb', 'mode-rail');
      this.el.crosshair.classList.add(`mode-${v}`);
    });
    this.#toggle('crosshair', 'is-scoped', scoped);
    this.#toggle('crosshair', 'is-enemy', !!w.aimTarget && w.aimTarget.faction === 'enemy' && !w.aimTarget.dead);
    const spread = ((w.aiming ? d.aimSpread ?? 0 : d.spread ?? 0) + w.bloom) * 180;
    this.#set('spread', Math.round(spread), (v) => {
      this.el['cross-lines'].style.transform = `scale(${1 + Math.min(1.4, v / 10)})`;
    });
    const charge = w.charging ? w.charge : w.grenadeAiming ? 1 : 0;
    this.#set('charge', Math.round(charge * 100), (v) => {
      this.el['charge-ring'].style.strokeDashoffset = 100 - v;
    });

    // ------------------------------------------- jefe
    const boss = game.boss;
    if (boss && !boss.dead) {
      const k = Math.max(0, boss.hp / boss.maxHp);
      this.#scaleX('boss-fill', k);
      this.bossGhost = Math.max(k, this.bossGhost - dt * 0.25);
      this.#scaleX('boss-ghost', this.bossGhost);
      this.#toggle('boss-bar', 'is-shielded', !!boss.shielded);
    }

    // ------------------------------------------- temporizador y progreso
    const timer = level.hud.timer;
    this.#toggle('hud-timer', 'is-hidden', !timer);
    if (timer) {
      this.#text('timer-label', timer.label);
      this.#text('timer-value', fmtTime(timer.value));
      this.#toggle('hud-timer', 'is-critical', !!timer.warn);
    }
    const prog = level.hud.progress;
    this.#toggle('hud-progress', 'is-hidden', !prog);
    if (prog) {
      this.#text('progress-label', prog.label);
      this.#text('progress-value', `${Math.floor(prog.value * 100)} %`);
      this.#scaleX('progress-fill', prog.value);
      this.#toggle('hud-progress', 'is-warn', !!prog.warn);
    }

    // ------------------------------------------- puntaje (cuenta progresiva)
    const target = level.score;
    if (this.scoreShown !== target) {
      this.scoreShown += Math.sign(target - this.scoreShown) * Math.max(1, Math.ceil(Math.abs(target - this.scoreShown) * dt * 6));
      if (Math.abs(target - this.scoreShown) < 2) this.scoreShown = target;
      this.#text('score', this.scoreShown.toLocaleString('es-MX'));
    }

    // ------------------------------------------- aviso de interacción
    const prompt = game.state === 'playing' ? level.currentPrompt() : null;
    this.#toggle('prompt', 'is-hidden', !prompt);
    if (prompt) {
      this.#text('prompt-text', prompt.text);
      this.#toggle('prompt', 'is-locked', !prompt.ok);
    }

    // ------------------------------------------- marcador del objetivo
    const wp = level.waypoint;
    const showWp = !!wp && game.state === 'playing' && !scoped;
    this.#toggle('waypoint', 'is-hidden', !showWp);
    if (showWp) {
      const pr = this.#project(wp.pos, new THREE.Vector3());
      const W = window.innerWidth;
      const H = window.innerHeight;
      let { x, y } = pr;
      let edge = false;
      if (pr.behind) {
        x = W - x;
        y = H - 60;
        edge = true;
      }
      const m = 50;
      if (x < m || x > W - m || y < m + 40 || y > H - m) edge = true;
      x = THREE.MathUtils.clamp(x, m, W - m);
      y = THREE.MathUtils.clamp(y, m + 40, H - m);
      this.el.waypoint.style.left = `${x}px`;
      this.el.waypoint.style.top = `${y}px`;
      this.#toggle('waypoint', 'is-edge', edge);
      this.#text('waypoint-label', wp.label);
      this.#text('waypoint-dist', `${Math.round(wp.pos.distanceTo(player.currPos))} m`);
      this.#set('wpicon', wp.icon, (v) => {
        this.el['waypoint-icon'].className = `bi bi-${v}`;
      });
    }

    // ------------------------------------------- números flotantes
    for (const f of this.floaters) {
      f.t -= dt;
      const pr = this.#project(f.pos, new THREE.Vector3());
      f.el.style.left = `${pr.x}px`;
      f.el.style.top = `${pr.y}px`;
      f.el.style.display = pr.behind ? 'none' : '';
      if (f.t <= 0) f.el.remove();
    }
    this.floaters = this.floaters.filter((f) => f.t > 0);

    // ------------------------------------------- pistas
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.el.hint.classList.add('is-hidden');
    } else if (this.hints.length && this.hints[0].at <= game.time && game.state === 'playing') {
      const h = this.hints.shift();
      this.el['hint-keys'].innerHTML = h.keys.map((k) => `<kbd>${k}</kbd>`).join('');
      this.el['hint-text'].textContent = h.text;
      this.el.hint.classList.remove('is-hidden');
      this.hintT = 6.5;
    }

    // ------------------------------------------- cartel
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.classList.add('is-hidden');
    }
  }
}
