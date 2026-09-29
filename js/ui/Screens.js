/**
 * Screens — pantallas de carga, menú, pausa, victoria y derrota, y el modal
 * de ajustes (parámetros configurables enlazados a Settings).
 */
import { DIFFICULTIES } from '../config.js';
import { SETTING_LIMITS, BestScores } from '../core/Settings.js';

const $ = (id) => document.getElementById(id);

const DEFEAT_TEXT = {
  battery: { title: 'Batería agotada', icon: 'battery', text: 'CHISPA se quedó sin energía en el cañón.' },
  storm: { title: 'La tormenta llegó', icon: 'tornado', text: 'El polvo sepultó la mina antes de la extracción.' },
};

const formatTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Screens {
  constructor(game) {
    this.game = game;
    this.screens = {
      loading: $('loading-screen'),
      menu: $('menu-screen'),
      pause: $('pause-screen'),
      victory: $('victory-screen'),
      defeat: $('defeat-screen'),
      file: $('file-warning'),
    };
    this.current = 'loading';
    this.#bindButtons();
    this.#bindSettings();
    this.#bindDifficulty();
  }

  show(name) {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('is-hidden', k !== name);
    this.current = name;
    document.body.dataset.screen = name || 'game';
    if (name === 'menu') this.#refreshBest();
  }

  hideAll() {
    this.show(null);
  }

  setLoading(progress, text) {
    $('loading-bar').style.width = `${Math.round(progress * 100)}%`;
    if (text) $('loading-text').textContent = text;
  }

  showError(message) {
    const el = $('loading-error');
    el.textContent = message;
    el.classList.remove('d-none');
  }

  // ---------------------------------------------------------------- botones
  #bindButtons() {
    const g = this.game;
    const click = (el, fn) => el?.addEventListener('click', () => {
      g.audio.unlock();
      g.audio.play('ui');
      fn();
    });
    click($('btn-play'), () => g.startGame());
    click($('btn-resume'), () => g.resume());
    click($('btn-restart'), () => g.startGame());
    click($('btn-menu'), () => g.quitToMenu());
    click($('btn-pause-touch'), () => g.pause());
    document.querySelectorAll('[data-action="restart"]').forEach((b) => click(b, () => g.startGame()));
    document.querySelectorAll('[data-action="menu"]').forEach((b) => click(b, () => g.quitToMenu()));
  }

  #bindDifficulty() {
    const s = this.game.settings;
    const radios = document.querySelectorAll('input[name="difficulty"]');
    const desc = $('difficulty-desc');
    const describe = (id) => {
      const d = DIFFICULTIES[id];
      desc.textContent = `${formatTime(d.time)} min · ${d.cores} núcleos · ${d.drones} drones · daño ×${d.damageMult}`;
      $('best-diff').textContent = d.label;
      $('best-score').textContent = BestScores.get(id).toLocaleString('es-MX');
    };
    radios.forEach((r) => {
      r.checked = r.value === s.get('difficulty');
      r.addEventListener('change', () => {
        if (!r.checked) return;
        s.set('difficulty', r.value);
        describe(r.value);
        this.game.audio.play('ui');
      });
    });
    describe(s.get('difficulty'));
  }

  #refreshBest() {
    const id = this.game.settings.get('difficulty');
    $('best-score').textContent = BestScores.get(id).toLocaleString('es-MX');
  }

  #bindSettings() {
    const s = this.game.settings;
    const format = {
      gravity: (v) => `${Number(v).toFixed(1)} m/s²`,
      throwPower: (v) => `${v} m/s`,
      sensitivity: (v) => `${Number(v).toFixed(2)}×`,
      fov: (v) => `${v}°`,
      volume: (v) => `${Math.round(v * 100)} %`,
    };
    const inputs = document.querySelectorAll('[data-setting]');
    const sync = () => {
      inputs.forEach((el) => {
        const key = el.dataset.setting;
        const v = s.get(key);
        if (el.type === 'checkbox') el.checked = !!v;
        else el.value = v;
        const out = $(`val-${key}`);
        if (out && format[key]) out.textContent = format[key](v);
      });
    };
    inputs.forEach((el) => {
      const key = el.dataset.setting;
      const lim = SETTING_LIMITS[key];
      if (lim && el.type === 'range') {
        el.min = lim.min;
        el.max = lim.max;
        el.step = lim.step;
      }
      const evt = el.type === 'range' ? 'input' : 'change';
      el.addEventListener(evt, () => {
        const value = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
        s.set(key, value);
        const out = $(`val-${key}`);
        if (out && format[key]) out.textContent = format[key](s.get(key));
      });
    });
    $('btn-reset-settings').addEventListener('click', () => {
      const diff = s.get('difficulty');
      s.reset();
      s.set('difficulty', diff);
      sync();
    });
    sync();
    this.syncSettings = sync;

    // Al abrir el modal durante el juego, liberar el puntero y pausar
    const modal = $('settings-modal');
    modal.addEventListener('show.bs.modal', () => {
      sync();
      if (this.game.state === 'playing') this.game.pause();
    });
  }

  // ---------------------------------------------------------------- resultados
  #fillStats(dl, r) {
    const rows = [
      ['Dificultad', r.difficulty],
      ['Tiempo', formatTime(r.time)],
      ['Núcleos', r.cores],
      ['Torres', r.towers],
      ['Drones derribados', r.drones],
      ['Barriles detonados', r.barrels],
      ['Suministros abiertos', r.crates],
      ['Núcleos dorados', r.goldCores],
      ['Orbes lanzados', r.orbs],
      ['Caídas a la grieta', r.falls],
    ];
    if (r.victory) {
      rows.push(['Bono de tiempo', `+${r.timeBonus}`]);
      rows.push(['Bono de batería', `+${r.batteryBonus}`]);
    }
    dl.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  }

  showVictory(r) {
    $('victory-rank').textContent = r.rank.rank;
    $('victory-rank-label').textContent = `${r.rank.label} · CHISPA salvó la veta de plata.`;
    $('victory-score').textContent = r.score.toLocaleString('es-MX');
    $('victory-record').classList.toggle('d-none', !r.newRecord);
    this.#fillStats($('victory-stats'), r);
    this.show('victory');
  }

  showDefeat(r) {
    const info = DEFEAT_TEXT[r.reason] || DEFEAT_TEXT.battery;
    $('defeat-title').textContent = info.title;
    $('defeat-icon').className = `bi bi-${info.icon}`;
    $('defeat-reason').textContent = info.text;
    $('defeat-score').textContent = r.score.toLocaleString('es-MX');
    this.#fillStats($('defeat-stats'), r);
    this.show('defeat');
  }
}
