/**
 * Screens — pantallas de carga, menú con campaña, sesión informativa,
 * pausa, nivel completado, victoria final y derrota, además del modal de
 * ajustes (parámetros enlazados a Settings con efecto inmediato).
 */
import { DIFFICULTIES } from '../config.js';
import { SETTING_LIMITS, Progress } from '../core/Settings.js';
import { LEVELS, PROLOGUE, EPILOGUE } from '../gameplay/Story.js';
import { VOICE_HELP } from '../ai/VoiceCommands.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('es-MX');
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const DIFF_DESC = {
  recluta: 'Enemigos frágiles y poco certeros, muchos botiquines. Ideal para disfrutar la historia o jugar con voz y VR.',
  veterano: 'Desafío moderado: enemigos agresivos pero con recursos de sobra.',
  leyenda: 'Para expertos: enemigos más resistentes y certeros, y menos suministros.',
};

export class Screens {
  constructor(game) {
    this.game = game;
    this.screens = {
      loading: $('loading-screen'),
      menu: $('menu-screen'),
      briefing: $('briefing-screen'),
      pause: $('pause-screen'),
      complete: $('complete-screen'),
      victory: $('victory-screen'),
      defeat: $('defeat-screen'),
      file: $('file-warning'),
    };
    this.current = 'loading';
    $('prologue').innerHTML = PROLOGUE.map((p) => `<p>${p}</p>`).join('');
    document.querySelectorAll('[data-voice-commands]').forEach((el) => {
      el.innerHTML = VOICE_HELP.map(([say, does]) => `<div class="ctrl"><span>${does}</span><span class="ctrl__keys ctrl__say">${say}</span></div>`).join('');
    });
    this.#bindButtons();
    this.#bindSettings();
    this.#bindDifficulty();
  }

  show(name) {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('is-hidden', k !== name);
    this.current = name;
    document.body.dataset.screen = name || 'game';
  }

  hideAll() {
    this.show(null);
  }

  setLoading(progress, text) {
    $('loading-bar').style.width = `${Math.round(progress * 100)}%`;
    if (text) $('loading-text').textContent = text;
  }

  showError(message) {
    this.show('loading');
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
    click($('btn-campaign'), () => g.showBriefing(1));
    click($('btn-continue'), () => g.showBriefing(Progress.unlocked()));
    click($('btn-deploy'), () => g.startLevel(g.levelIndex));
    click($('btn-briefing-back'), () => (g.level?.menuMode ? this.showMenu() : g.quitToMenu()));
    click($('btn-resume'), () => g.resume());
    click($('btn-restart'), () => g.restartLevel());
    click($('btn-pause-checkpoint'), () => g.retryCheckpoint());
    click($('btn-menu'), () => g.quitToMenu());
    click($('btn-pause-touch'), () => g.pause());
    click($('btn-next'), () => g.nextLevel());
    click($('btn-checkpoint'), () => g.retryCheckpoint());
    // realidad virtual: deben iniciarse dentro del clic (gesto del usuario)
    $('btn-deploy-vr')?.addEventListener('click', () => g.playImmersive('xr', g.levelIndex));
    $('btn-deploy-cardboard')?.addEventListener('click', () => g.playImmersive('cardboard', g.levelIndex));
    $('btn-resume-vr')?.addEventListener('click', () => g.playImmersive('xr'));
    $('btn-resume-cardboard')?.addEventListener('click', () => g.playImmersive('cardboard'));
    g.bus.on('ai:status', () => this.#renderAIStatus());
    document.querySelectorAll('[data-action="restart"]').forEach((b) => click(b, () => g.restartLevel()));
    document.querySelectorAll('[data-action="menu"]').forEach((b) => click(b, () => g.quitToMenu()));
  }

  /** Muestra los botones de VR según lo que soporte el dispositivo. */
  updateImmersiveButtons() {
    const g = this.game;
    const xr = !!g.xr?.supported;
    // lentes para celular: solo en pantallas táctiles con giroscopio (o con ?vrbox para probar)
    const cardboard = !!g.cardboard?.supported && (g.touch?.enabled || new URLSearchParams(location.search).has('vrbox'));
    for (const id of ['btn-deploy-vr', 'btn-resume-vr']) $(id)?.classList.toggle('d-none', !xr);
    for (const id of ['btn-deploy-cardboard', 'btn-resume-cardboard']) $(id)?.classList.toggle('d-none', !cardboard);
    const info = $('vr-status');
    if (info) {
      info.textContent = xr
        ? 'Visor de realidad virtual detectado.'
        : cardboard
          ? 'Puedes jugar con lentes VR Box: pon el teléfono en horizontal dentro del visor.'
          : 'Abre el juego en el navegador de Meta Quest para jugar en VR, o en tu celular para usar lentes VR Box.';
    }
    const voice = $('voice-status');
    if (voice) voice.textContent = `Voz: ${g.voice?.label ?? '—'}.`;
    this.#renderAIStatus();
  }

  #renderAIStatus() {
    const el = $('ai-status');
    if (!el) return;
    const st = this.game.ai?.status ?? 'unknown';
    const text = {
      unknown: 'Comprobando el servidor de IA…',
      online: 'IA conectada (OpenAI vía Vercel): interpreta frases libres y dirige la táctica.',
      nokey: 'Servidor de IA sin API key: revisa OPENAI_API_KEY en Vercel. Se usa la lógica local.',
      offline: 'Sin servidor de IA: el juego usa la lógica local (comandos de voz básicos y director táctico local).',
    }[st];
    el.textContent = text;
    el.dataset.status = st;
  }

  #bindDifficulty() {
    const s = this.game.settings;
    const radios = document.querySelectorAll('input[name="difficulty"]');
    radios.forEach((r) => {
      r.checked = r.value === this.game.difficultyId;
      r.addEventListener('change', () => {
        if (!r.checked) return;
        s.set('difficulty', r.value);
        this.#describeDifficulty();
        this.#renderLevels();
        this.game.audio.play('ui');
      });
    });
    this.#describeDifficulty();
  }

  #describeDifficulty() {
    const id = this.game.difficultyId;
    const d = DIFFICULTIES[id];
    $('difficulty-desc').textContent = `${DIFF_DESC[id]} (vida enemiga ×${d.enemyHp}, daño recibido ×${d.enemyDmg})`;
  }

  // ---------------------------------------------------------------- menú y campaña
  showMenu() {
    if (this.game.state === 'briefing') this.game.state = 'menu';
    this.#renderLevels();
    const u = Progress.unlocked();
    $('continue-label').textContent = `${LEVELS[u - 1].code.toLowerCase().replace('operación', 'Operación')} · ${LEVELS[u - 1].title}`;
    $('btn-continue').classList.toggle('d-none', u <= 1);
    this.show('menu');
  }

  #renderLevels() {
    const unlocked = Progress.unlocked();
    const diff = this.game.difficultyId;
    const box = $('level-cards');
    box.innerHTML = LEVELS.map((l) => {
      const locked = l.id > unlocked;
      const best = Progress.best(l.id, diff);
      return `<button type="button" class="level-card${l.id === 3 ? ' is-boss' : ''}" data-level="${l.id}" ${locked ? 'disabled' : ''}>
        ${locked ? '<i class="bi bi-lock-fill level-card__lock"></i>' : ''}
        <i class="bi bi-${l.icon} level-card__icon"></i>
        <span class="level-card__code">${l.code}</span>
        <span class="level-card__title">${l.title}</span>
        <span class="small text-secondary-emphasis">Jefe: ${l.boss}</span>
        <span class="level-card__best">${best ? `<i class="bi bi-award"></i> ${fmt(best)}` : locked ? 'Bloqueado' : 'Sin récord'}</span>
      </button>`;
    }).join('');
    box.querySelectorAll('.level-card').forEach((b) => b.addEventListener('click', () => {
      this.game.audio.unlock();
      this.game.audio.play('ui');
      this.game.showBriefing(Number(b.dataset.level));
    }));
  }

  showBriefing(info, difficulty) {
    $('briefing-code').textContent = info.code;
    $('briefing-title').textContent = info.title;
    $('briefing-place').textContent = info.place;
    $('briefing-diff').textContent = difficulty.label;
    $('briefing-text').innerHTML = info.briefing.map((p) => `<p>${p}</p>`).join('');
    $('briefing-objectives').innerHTML = info.objectives.map((o) => `<li>${o}</li>`).join('');
    $('briefing-enemies').textContent = info.enemies.join(', ');
    $('briefing-boss').textContent = info.boss;
    $('briefing-loadout').textContent = info.loadout;
    const best = Progress.best(info.id, difficulty.id);
    $('briefing-best').textContent = best ? fmt(best) : '—';
    this.show('briefing');
  }

  showPause() {
    const g = this.game;
    const info = LEVELS[g.levelIndex - 1];
    $('pause-level').textContent = `${info.code} · ${info.title} · ${g.difficulty.label}`;
    $('btn-pause-checkpoint').classList.toggle('d-none', !(g.checkpointData && g.checkpointData.level === g.levelIndex));
    this.show('pause');
  }

  // ---------------------------------------------------------------- ajustes
  #bindSettings() {
    const s = this.game.settings;
    const format = {
      gravity: (v) => `${Number(v).toFixed(1)} m/s²`,
      sensitivity: (v) => `${Number(v).toFixed(2)}×`,
      fov: (v) => `${v}°`,
      volume: (v) => `${Math.round(v * 100)} %`,
      music: (v) => `${Math.round(v * 100)} %`,
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
    // abrir el modal durante el juego pausa la partida y libera el puntero
    $('settings-modal').addEventListener('show.bs.modal', () => {
      sync();
      if (this.game.state === 'playing') this.game.pause();
    });
  }

  // ---------------------------------------------------------------- resultados
  #stats(dl, s) {
    const rows = [
      ['Tiempo', fmtTime(s.time)],
      ['Enemigos abatidos', s.kills],
      ['Tiros a la cabeza', s.headshots],
      ['Precisión', `${Math.round((s.accuracy ?? 0) * 100)} %`],
      ['Disparos', s.shots ?? 0],
      ['Daño recibido', Math.round(s.damageTaken ?? 0)],
    ];
    if (s.bossTime) rows.push(['Duelo con el jefe', fmtTime(s.bossTime)]);
    dl.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  }

  showLevelComplete(r) {
    $('complete-rank').textContent = r.rank.rank;
    $('complete-rank').className = `end-rank rank-${r.rank.rank}`;
    $('complete-code').textContent = r.info.code;
    $('complete-subtitle').textContent = `${r.info.title} · ${r.rank.label}`;
    $('complete-score').textContent = fmt(r.score);
    $('complete-record').classList.toggle('d-none', !r.record);
    $('complete-breakdown').innerHTML = r.breakdown.map(([k, v]) => `<tr><td>${k}</td><td>+${fmt(v)}</td></tr>`).join('') + `<tr class="is-total"><td>Total</td><td>${fmt(r.score)}</td></tr>`;
    this.#stats($('complete-stats'), r.stats);
    $('btn-next').classList.toggle('d-none', r.level >= LEVELS.length);
    this.show('complete');
  }

  showVictory(r) {
    const ranks = [
      { min: 33000, rank: 'S', label: 'Leyenda de Orión' },
      { min: 25000, rank: 'A', label: 'Comando de élite' },
      { min: 18000, rank: 'B', label: 'Veterano curtido' },
      { min: 0, rank: 'C', label: 'Superviviente' },
    ];
    const full = r.levelsPlayed >= 3;
    const rank = full ? ranks.find((x) => r.campaignTotal >= x.min) : r.rank;
    $('victory-rank').textContent = rank.rank;
    $('victory-rank').className = `end-rank rank-${rank.rank}`;
    $('epilogue').innerHTML = EPILOGUE.map((p) => `<p>${p}</p>`).join('');
    $('victory-total').textContent = fmt(r.campaignTotal);
    $('victory-rank-label').textContent = full ? rank.label : `${rank.label} · juega las 3 operaciones seguidas para el rango de campaña`;
    const scores = this.game.campaign.scores;
    $('victory-levels').innerHTML = LEVELS.map((l) => `<tr><td>${l.code} · ${l.title}</td><td>${scores[l.id] ? fmt(scores[l.id]) : '—'}</td></tr>`).join('') + `<tr class="is-total"><td>Total</td><td>${fmt(r.campaignTotal)}</td></tr>`;
    this.show('victory');
  }

  showDefeat(r) {
    $('defeat-reason').textContent = r.reason;
    $('defeat-score').textContent = fmt(r.score);
    this.#stats($('defeat-stats'), { ...r.stats, accuracy: this.game.weapons.stats.shots ? this.game.weapons.stats.hits / this.game.weapons.stats.shots : 0, shots: this.game.weapons.stats.shots, damageTaken: this.game.player?.stats.damageTaken });
    $('btn-checkpoint').classList.toggle('d-none', !r.canCheckpoint);
    this.show('defeat');
  }
}
