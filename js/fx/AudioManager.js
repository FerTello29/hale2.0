/**
 * AudioManager — efectos de sonido sintetizados en tiempo real con Web Audio
 * (sin archivos de audio: cero derechos de autor y cero descargas) y música
 * procedural adaptativa (exploración → combate → jefe).
 *
 * Incluye paneo/atenuación por distancia respecto a la cámara, ambiente de
 * selva en bucle y el tono de carga del lanzaorbes.
 */
import * as THREE from 'three';

const _rel = new THREE.Vector3();
const _right = new THREE.Vector3();

export class AudioManager {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.master = null;
    this.volume = game.settings.get('volume');
    this.musicVolume = game.settings.get('music');
    this.noiseBuffer = null;
    this.lastPlay = new Map();
    this.music = null;
  }

  /** Debe llamarse tras un gesto del usuario (clic en "Jugar"). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(comp);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVolume * 0.55;
      this.musicBus.connect(comp);
      this.noiseBuffer = this.#makeNoise(2);
      this.#startAmbience();
      this.music = new MusicDirector(this.ctx, this.musicBus, this.noiseBuffer);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(v * 0.55, this.ctx.currentTime, 0.1);
  }

  suspend() {
    this.ctx?.suspend();
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  #makeNoise(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Ambiente de selva nocturna: brisa filtrada + insectos intermitentes. */
  #startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(filter.frequency);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    lfo.start();
    // insectos: tono alto modulado en amplitud
    const bug = ctx.createOscillator();
    bug.type = 'sine';
    bug.frequency.value = 4200;
    const bugGain = ctx.createGain();
    bugGain.gain.value = 0;
    const am = ctx.createOscillator();
    am.frequency.value = 23;
    const amGain = ctx.createGain();
    amGain.gain.value = 0.006;
    am.connect(amGain).connect(bugGain.gain);
    bug.connect(bugGain).connect(this.master);
    bug.start();
    am.start();
    this.ambience = { filter, gain, bugGain, amGain };
  }

  /** Tensión 0..1: sube el viento (colapso del santuario, jefes). */
  setTension(t) {
    if (!this.ambience) return;
    const now = this.ctx.currentTime;
    this.ambience.gain.gain.setTargetAtTime(0.035 + t * 0.12, now, 0.6);
    this.ambience.filter.frequency.setTargetAtTime(520 + t * 500, now, 0.6);
    this.ambience.amGain.gain.setTargetAtTime(0.006 * (1 - t), now, 0.6);
  }

  /** Canal espacial simple: ganancia por distancia + paneo estéreo. */
  #spatial(pos, gain = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let vol = gain;
    let pan = 0;
    if (pos) {
      const cam = this.game.camera;
      _rel.subVectors(pos, cam.position);
      const d = _rel.length();
      vol *= THREE.MathUtils.clamp(1 - (d - 5) / 60, 0.04, 1);
      _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      pan = d > 0.001 ? THREE.MathUtils.clamp(_rel.normalize().dot(_right), -1, 1) * 0.8 : 0;
    }
    g.gain.value = Number.isFinite(vol) ? vol : 0;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Number.isFinite(pan) ? pan : 0;
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  #osc(out, type, f0, f1, t0, dur, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  #noise(out, filterType, f0, f1, t0, dur, vol, q = 1) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuffer;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t0, Math.random() * 0.3);
    s.stop(t0 + dur + 0.05);
  }

  #chord(out, notes, t, step, dur, vol, type = 'triangle') {
    notes.forEach((f, i) => this.#osc(out, type, f, f, t + i * step, dur, vol));
  }

  play(name, pos = null, { gain = 1, pitch = 1 } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    // limitar repeticiones del mismo sonido en el mismo instante
    const nowMs = performance.now();
    const last = this.lastPlay.get(name) || 0;
    const minGap = name === 'rifle' || name === 'step' ? 20 : 35;
    if (nowMs - last < minGap) return;
    this.lastPlay.set(name, nowMs);

    const t = this.ctx.currentTime + 0.005;
    const out = this.#spatial(pos, gain);
    const p = pitch;
    switch (name) {
      // ------------------------------------------------ armas del jugador
      case 'rifle':
        this.#noise(out, 'bandpass', 2600 * p, 900, t, 0.09, 0.55, 1.2);
        this.#osc(out, 'square', 520 * p, 140, t, 0.08, 0.16);
        this.#osc(out, 'sine', 160, 60, t, 0.1, 0.35);
        break;
      case 'shotgun':
        this.#noise(out, 'lowpass', 3200, 300, t, 0.35, 1.0);
        this.#osc(out, 'sine', 140, 40, t, 0.3, 0.8);
        this.#noise(out, 'highpass', 4000, 2000, t, 0.06, 0.4);
        this.#noise(out, 'bandpass', 900, 600, t + 0.28, 0.08, 0.25, 3);
        break;
      case 'rail':
        this.#osc(out, 'sawtooth', 2400 * p, 180, t, 0.45, 0.35);
        this.#osc(out, 'sine', 90, 30, t, 0.6, 0.8);
        this.#noise(out, 'highpass', 6000, 2500, t, 0.25, 0.4);
        this.#osc(out, 'sine', 3200, 3200, t + 0.05, 0.6, 0.05);
        break;
      case 'orbLaunch':
        this.#osc(out, 'sine', 300 * p, 900 * p, t, 0.25, 0.5);
        this.#noise(out, 'bandpass', 800, 2400, t, 0.3, 0.35, 2);
        break;
      case 'reload':
        this.#noise(out, 'bandpass', 1800, 1200, t, 0.06, 0.4, 4);
        this.#noise(out, 'bandpass', 2400, 1600, t + 0.35, 0.05, 0.35, 4);
        this.#osc(out, 'square', 220, 180, t + 0.15, 0.05, 0.05);
        break;
      case 'reloadEnd':
        this.#noise(out, 'bandpass', 2200, 1500, t, 0.05, 0.5, 5);
        this.#osc(out, 'square', 660, 660, t + 0.05, 0.04, 0.06);
        this.#osc(out, 'square', 880, 880, t + 0.1, 0.05, 0.06);
        break;
      case 'empty':
        this.#noise(out, 'bandpass', 3000, 2800, t, 0.03, 0.4, 8);
        break;
      case 'switch':
        this.#noise(out, 'bandpass', 1500, 900, t, 0.08, 0.35, 3);
        this.#osc(out, 'triangle', 700, 900, t, 0.06, 0.06);
        break;
      case 'throw':
        this.#noise(out, 'bandpass', 600 * p, 2600 * p, t, 0.28, 0.5, 2);
        this.#osc(out, 'sine', 320 * p, 900 * p, t, 0.22, 0.2);
        break;
      case 'grenadeBounce':
        this.#osc(out, 'triangle', 900, 700, t, 0.05, 0.2);
        this.#noise(out, 'bandpass', 2000, 1500, t, 0.04, 0.2, 5);
        break;
      case 'whoosh':
        this.#noise(out, 'bandpass', 400 * p, 1600 * p, t, 0.18, 0.3, 1.5);
        break;
      case 'punch':
        this.#noise(out, 'lowpass', 900, 150, t, 0.2, 0.8);
        this.#osc(out, 'sine', 140, 50, t, 0.18, 0.7);
        break;
      case 'pulse':
        this.#osc(out, 'sine', 420, 35, t, 0.7, 0.9);
        this.#noise(out, 'lowpass', 1800, 100, t, 0.6, 0.6);
        this.#osc(out, 'sawtooth', 200, 60, t, 0.35, 0.12);
        break;
      case 'singularity':
        this.#osc(out, 'sine', 900, 40, t, 1.4, 0.6);
        this.#osc(out, 'sawtooth', 60, 30, t, 2.5, 0.15);
        this.#noise(out, 'lowpass', 400, 60, t, 2.6, 0.4);
        break;
      case 'denied':
        this.#osc(out, 'square', 220, 180, t, 0.18, 0.12);
        break;
      // ------------------------------------------------ jugador
      case 'shieldHit':
        this.#osc(out, 'sine', 1400, 900, t, 0.12, 0.15);
        this.#noise(out, 'highpass', 5000, 3000, t, 0.08, 0.15);
        break;
      case 'shieldBreak':
        this.#osc(out, 'sawtooth', 1600 * p, 120, t, 0.6, 0.3);
        this.#noise(out, 'highpass', 6000, 1500, t, 0.5, 0.45);
        this.#osc(out, 'square', 400, 90, t + 0.05, 0.4, 0.1);
        break;
      case 'shieldRecharge':
        this.#osc(out, 'sine', 300, 1400, t, 0.8, 0.12);
        this.#osc(out, 'triangle', 600, 2400, t + 0.1, 0.7, 0.05);
        break;
      case 'damage':
        this.#osc(out, 'sawtooth', 220, 70, t, 0.25, 0.3);
        this.#noise(out, 'bandpass', 900, 400, t, 0.15, 0.25, 2);
        break;
      case 'jump':
        this.#noise(out, 'bandpass', 700, 1500, t, 0.12, 0.12, 2);
        this.#osc(out, 'sine', 180, 320, t, 0.1, 0.08);
        break;
      case 'land':
        this.#noise(out, 'lowpass', 600, 120, t, 0.14, 0.3);
        this.#osc(out, 'sine', 90, 50, t, 0.12, 0.2);
        break;
      case 'step':
        this.#noise(out, 'lowpass', 700 + Math.random() * 300, 200, t, 0.08, 0.12);
        this.#osc(out, 'sine', 80, 50, t, 0.06, 0.06);
        break;
      case 'fall':
        this.#osc(out, 'sine', 700, 120, t, 0.8, 0.2);
        break;
      // ------------------------------------------------ recogidas y objetivos
      case 'heal':
        this.#chord(out, [523, 784, 1047], t, 0.06, 0.35, 0.18, 'sine');
        break;
      case 'ammo':
        this.#noise(out, 'bandpass', 2400, 1800, t, 0.05, 0.4, 5);
        this.#noise(out, 'bandpass', 2000, 1500, t + 0.08, 0.05, 0.35, 5);
        this.#osc(out, 'triangle', 880, 880, t + 0.12, 0.12, 0.1);
        break;
      case 'core':
        this.#chord(out, [880, 1109, 1319, 1760], t, 0.07, 0.3, 0.2);
        this.#osc(out, 'sine', 2637, 2637, t + 0.21, 0.5, 0.08);
        break;
      case 'weaponPickup':
        this.#noise(out, 'bandpass', 1500, 900, t, 0.1, 0.5, 3);
        this.#chord(out, [392, 523, 659, 784], t + 0.08, 0.07, 0.35, 0.18);
        break;
      case 'gold':
        this.#chord(out, [784, 988, 1175, 1568, 1976], t, 0.06, 0.35, 0.2);
        break;
      case 'objective':
        this.#chord(out, [659, 880, 1109], t, 0.09, 0.5, 0.2);
        this.#osc(out, 'sine', 1319, 1319, t + 0.27, 0.8, 0.1);
        break;
      case 'beacon':
        for (let i = 0; i < 4; i++) this.#osc(out, 'square', 1200, 1200, t + i * 0.18, 0.08, 0.08);
        this.#osc(out, 'sine', 300, 1800, t + 0.7, 0.8, 0.15);
        break;
      case 'dropship':
        this.#noise(out, 'lowpass', 300, 900, t, 2.5, 0.5);
        this.#osc(out, 'sawtooth', 70, 110, t, 2.5, 0.12);
        break;
      case 'rampOpen':
        this.#noise(out, 'lowpass', 700, 300, t, 1.4, 0.4);
        this.#osc(out, 'sawtooth', 55, 80, t, 1.4, 0.1);
        break;
      case 'barrierDown':
        this.#osc(out, 'sawtooth', 1800, 60, t, 1.6, 0.25);
        this.#noise(out, 'highpass', 5000, 800, t, 1.2, 0.35);
        break;
      case 'gateOpen':
        this.#noise(out, 'lowpass', 220, 90, t, 4, 0.8);
        this.#osc(out, 'sawtooth', 40, 55, t, 4, 0.2);
        break;
      case 'rumble':
        this.#noise(out, 'lowpass', 220, 70, t, 1.6, 0.6);
        break;
      case 'radio':
        this.#noise(out, 'bandpass', 2200, 2200, t, 0.08, 0.2, 2);
        this.#osc(out, 'square', 1800, 1800, t + 0.02, 0.04, 0.04);
        break;
      case 'ecoVoice':
        this.#osc(out, 'sine', 180, 120, t, 1.4, 0.18);
        this.#osc(out, 'sine', 271, 181, t, 1.4, 0.12);
        this.#osc(out, 'triangle', 1440, 960, t, 1.2, 0.03);
        break;
      // ------------------------------------------------ explosiones e impactos
      case 'explosion':
        this.#noise(out, 'lowpass', 2200, 90, t, 1.3, 1.0);
        this.#osc(out, 'sine', 90, 30, t, 1.0, 0.9);
        this.#noise(out, 'highpass', 2500, 1200, t, 0.18, 0.3);
        break;
      case 'smallExplosion':
        this.#noise(out, 'lowpass', 1800, 120, t, 0.7, 0.8);
        this.#osc(out, 'sine', 130, 40, t, 0.5, 0.6);
        break;
      case 'acid':
        this.#noise(out, 'bandpass', 1400, 400, t, 0.5, 0.6, 1.5);
        this.#noise(out, 'highpass', 4000, 3000, t + 0.1, 0.6, 0.2);
        break;
      case 'boltHit':
        this.#noise(out, 'bandpass', 2400, 800, t, 0.15, 0.35, 3);
        break;
      case 'crateBreak':
        this.#noise(out, 'bandpass', 1500, 500, t, 0.25, 0.8, 1.2);
        this.#noise(out, 'lowpass', 600, 200, t + 0.03, 0.3, 0.5);
        break;
      case 'fuse':
        this.#noise(out, 'highpass', 5000, 3000, t, 1.0, 0.18);
        break;
      case 'rockLand':
        this.#noise(out, 'lowpass', 700, 80, t, 0.6, 0.9);
        this.#osc(out, 'sine', 70, 30, t, 0.5, 0.7);
        break;
      case 'crystalHit':
        this.#osc(out, 'triangle', 2400 + Math.random() * 600, 1800, t, 0.18, 0.12);
        this.#osc(out, 'sine', 3600, 3000, t, 0.25, 0.05);
        break;
      case 'crystalShatter':
        for (let i = 0; i < 6; i++) this.#osc(out, 'triangle', 1800 + Math.random() * 2400, 900, t + i * 0.03, 0.4, 0.12);
        this.#noise(out, 'highpass', 6000, 2500, t, 0.7, 0.5);
        this.#osc(out, 'sine', 120, 40, t, 0.6, 0.5);
        break;
      // ------------------------------------------------ enemigos
      case 'enemyShot':
        this.#osc(out, 'sawtooth', 1300 * p, 260, t, 0.14, 0.14);
        this.#osc(out, 'square', 900 * p, 200, t, 0.1, 0.06);
        break;
      case 'espectroAlert':
        this.#osc(out, 'square', 700, 1400, t, 0.12, 0.08);
        this.#osc(out, 'square', 1400, 700, t + 0.14, 0.12, 0.08);
        break;
      case 'espectroCharge':
        this.#osc(out, 'sine', 400, 1400, t, 0.3, 0.1);
        break;
      case 'espectroDie':
        this.#osc(out, 'sawtooth', 800, 60, t, 0.9, 0.2);
        this.#noise(out, 'highpass', 3000, 1500, t, 0.3, 0.25);
        break;
      case 'crawlerAlert':
        this.#noise(out, 'bandpass', 3200, 5200, t, 0.25, 0.3, 6);
        this.#osc(out, 'square', 2600, 3400, t, 0.2, 0.04);
        break;
      case 'crawlerLeap':
        this.#noise(out, 'bandpass', 2800, 4800, t, 0.2, 0.25, 5);
        break;
      case 'crawlerBite':
        this.#noise(out, 'bandpass', 1800, 900, t, 0.12, 0.6, 3);
        this.#osc(out, 'square', 300, 120, t, 0.1, 0.1);
        break;
      case 'crawlerDie':
        for (let i = 0; i < 4; i++) this.#osc(out, 'triangle', 2000 + Math.random() * 2000, 1200, t + i * 0.03, 0.25, 0.1);
        this.#noise(out, 'highpass', 5000, 2000, t, 0.3, 0.3);
        break;
      case 'sentinelAlert':
        this.#osc(out, 'square', 1500, 1500, t, 0.08, 0.08);
        this.#osc(out, 'square', 1900, 1900, t + 0.11, 0.08, 0.08);
        break;
      case 'sentinelShot':
        this.#osc(out, 'square', 1200, 300, t, 0.16, 0.12);
        this.#osc(out, 'sawtooth', 900, 200, t, 0.12, 0.08);
        break;
      case 'sentinelDie':
        this.#osc(out, 'sawtooth', 900, 80, t, 0.7, 0.2);
        this.#noise(out, 'highpass', 3000, 1500, t, 0.2, 0.25);
        break;
      case 'bastionAlert':
        this.#osc(out, 'sawtooth', 110, 90, t, 0.6, 0.3);
        this.#osc(out, 'square', 220, 180, t, 0.6, 0.08);
        break;
      case 'bastionCharge':
        this.#osc(out, 'sawtooth', 80 * p, 300 * p, t, 0.9, 0.25);
        this.#noise(out, 'lowpass', 300, 900, t, 0.9, 0.3);
        break;
      case 'shieldDeflect':
        this.#osc(out, 'triangle', 2600, 1800, t, 0.08, 0.1);
        this.#noise(out, 'bandpass', 5000, 4000, t, 0.05, 0.12, 4);
        break;
      case 'mortar':
        this.#osc(out, 'sine', 160 * p, 60 * p, t, 0.4, 0.6);
        this.#noise(out, 'lowpass', 1200, 200, t, 0.35, 0.5);
        break;
      case 'stomp':
        this.#noise(out, 'lowpass', 600 * p, 60, t, 0.9, 1.0);
        this.#osc(out, 'sine', 70 * p, 25, t, 0.8, 1.0);
        break;
      case 'bastionDie':
        this.#osc(out, 'sawtooth', 300, 30, t, 1.4, 0.3);
        this.#noise(out, 'highpass', 5000, 1500, t, 0.7, 0.4);
        break;
      case 'portal':
        this.#osc(out, 'sine', 120, 900, t, 0.6, 0.25);
        this.#osc(out, 'triangle', 1800, 600, t + 0.1, 0.6, 0.06);
        this.#noise(out, 'bandpass', 600, 2000, t, 0.6, 0.25, 2);
        break;
      // ------------------------------------------------ jefes
      case 'bossRoar':
        this.#osc(out, 'sawtooth', 160 * p, 70 * p, t, 1.5, 0.45);
        this.#osc(out, 'sawtooth', 240 * p, 90 * p, t, 1.4, 0.2);
        this.#noise(out, 'bandpass', 900 * p, 400, t, 1.5, 0.6, 1.2);
        break;
      case 'bossCharge':
        this.#noise(out, 'lowpass', 400, 1500, t, 0.8, 0.5);
        break;
      case 'bossImpact':
        this.#noise(out, 'lowpass', 1500, 60, t, 1.2, 1.0);
        this.#osc(out, 'sine', 60, 25, t, 1, 1.0);
        break;
      case 'acidSpit':
        this.#noise(out, 'bandpass', 800, 2400, t, 0.4, 0.5, 2);
        this.#osc(out, 'sawtooth', 200, 90, t, 0.3, 0.1);
        break;
      case 'bossDie':
        this.#osc(out, 'sawtooth', 300 * p, 30, t, 2.5, 0.4);
        this.#noise(out, 'lowpass', 2000, 60, t, 2.5, 0.8);
        this.#osc(out, 'sine', 90, 20, t + 0.5, 2, 0.6);
        break;
      case 'colossusRoar':
        this.#osc(out, 'sawtooth', 70, 45, t, 2, 0.5);
        this.#osc(out, 'square', 105, 66, t, 2, 0.12);
        this.#noise(out, 'lowpass', 500, 150, t, 2, 0.6);
        break;
      case 'colossusStep':
        this.#noise(out, 'lowpass', 250, 50, t, 0.5, 0.8);
        this.#osc(out, 'sine', 55, 30, t, 0.45, 0.8);
        this.#noise(out, 'bandpass', 1200, 600, t, 0.08, 0.15, 3);
        break;
      case 'ecoScream':
        this.#osc(out, 'sine', 880 * p, 220 * p, t, 1.8, 0.3);
        this.#osc(out, 'sine', 1320 * p, 330 * p, t, 1.8, 0.2);
        this.#osc(out, 'triangle', 3300 * p, 1100, t, 1.5, 0.05);
        this.#noise(out, 'highpass', 4000, 1500, t, 1.2, 0.3);
        break;
      case 'homingLaunch':
        this.#osc(out, 'sine', 500, 1600, t, 0.35, 0.18);
        break;
      case 'crystalRain':
        for (let i = 0; i < 5; i++) this.#osc(out, 'triangle', 3000 - i * 300, 1500, t + i * 0.08, 0.5, 0.05);
        break;
      case 'ringWave':
        this.#osc(out, 'sawtooth', 60, 240, t, 1.2, 0.3);
        this.#noise(out, 'bandpass', 300, 1500, t, 1.4, 0.4, 1);
        break;
      case 'laserCharge':
        this.#osc(out, 'sawtooth', 200, 2400, t, 1.1, 0.12);
        this.#osc(out, 'sine', 400, 3200, t, 1.1, 0.08);
        break;
      case 'laserFire':
        this.#noise(out, 'lowpass', 5000, 400, t, 0.6, 0.8);
        this.#osc(out, 'sawtooth', 900, 100, t, 0.5, 0.35);
        break;
      // ------------------------------------------------ interfaz
      case 'hitmarker':
        this.#osc(out, 'square', 2600, 2600, t, 0.025, 0.05);
        break;
      case 'headshot':
        this.#osc(out, 'triangle', 2200, 2200, t, 0.06, 0.12);
        this.#osc(out, 'triangle', 3300, 3300, t + 0.05, 0.1, 0.1);
        break;
      case 'kill':
        this.#osc(out, 'triangle', 1400, 1900, t, 0.08, 0.1);
        break;
      case 'alarm':
        this.#osc(out, 'square', 880, 660, t, 0.35, 0.1);
        this.#osc(out, 'square', 880, 660, t + 0.4, 0.35, 0.1);
        break;
      case 'ui':
        this.#osc(out, 'triangle', 1200, 1200, t, 0.05, 0.08);
        break;
      case 'levelComplete':
        this.#chord(out, [523, 659, 784, 1047], t, 0.12, 0.7, 0.2);
        this.#osc(out, 'sine', 262, 262, t + 0.4, 1.5, 0.18);
        break;
      case 'victory':
        this.#chord(out, [523, 659, 784, 1047, 1319, 1568], t, 0.14, 0.9, 0.2);
        this.#osc(out, 'sine', 262, 262, t + 0.7, 2.5, 0.2);
        break;
      case 'defeat':
        this.#chord(out, [392, 311, 233], t, 0.25, 0.6, 0.12, 'sawtooth');
        this.#osc(out, 'sine', 98, 60, t + 0.75, 1.5, 0.3);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------ tono de carga del orbe
  startCharge() {
    if (!this.ctx || this.chargeOsc) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 220;
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.1);
    o.connect(g).connect(this.master);
    o.start();
    this.chargeOsc = { o, g };
  }

  updateCharge(k) {
    if (!this.chargeOsc) return;
    this.chargeOsc.o.frequency.setTargetAtTime(220 + k * 520, this.ctx.currentTime, 0.03);
  }

  stopCharge() {
    if (!this.chargeOsc) return;
    const { o, g } = this.chargeOsc;
    g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.03);
    o.stop(this.ctx.currentTime + 0.15);
    this.chargeOsc = null;
  }
}

/**
 * MusicDirector — música procedural adaptativa con un secuenciador de
 * anticipación (Web Audio). Intensidad 0 = exploración (pads y arpegio
 * suave), 1 = alerta, 2 = combate (bajo y percusión), 3 = jefe.
 */
const SCALE_ROOT = 110; // La2
const PROGRESSION = [
  [0, 3, 7, 10], // Am7
  [-4, 0, 3, 7], // Fmaj7
  [3, 7, 10, 14], // C
  [-2, 2, 5, 9], // G
];
const f = (semi, oct = 0) => SCALE_ROOT * 2 ** ((semi + oct * 12) / 12);

class MusicDirector {
  constructor(ctx, out, noise) {
    this.ctx = ctx;
    this.out = out;
    this.noise = noise;
    this.level = 0;
    this.target = 0;
    this.floor = 0;
    this.step = 0;
    this.bar = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.layers = {};
    for (const k of ['pad', 'arp', 'bass', 'drums', 'lead']) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(out);
      this.layers[k] = g;
    }
    this.#applyMix(0, true);
    this.timer = setInterval(() => this.#schedule(), 30);
  }

  /** Nivel mínimo fijado por el guion (jefe, defensa…). */
  setFloor(v) {
    this.floor = v;
  }

  update(auto) {
    const lvl = Math.max(this.floor, auto);
    if (lvl !== this.target) {
      this.target = lvl;
      this.#applyMix(lvl);
    }
  }

  #applyMix(l, instant = false) {
    const t = this.ctx.currentTime;
    const mix = [
      { pad: 0.5, arp: 0.18, bass: 0, drums: 0, lead: 0 },
      { pad: 0.45, arp: 0.3, bass: 0.35, drums: 0.25, lead: 0 },
      { pad: 0.35, arp: 0.35, bass: 0.55, drums: 0.6, lead: 0.15 },
      { pad: 0.35, arp: 0.4, bass: 0.7, drums: 0.8, lead: 0.3 },
    ][l];
    for (const [k, v] of Object.entries(mix)) this.layers[k].gain.setTargetAtTime(v, t, instant ? 0.01 : 1.2);
    this.tempo = [84, 96, 124, 132][l];
  }

  #note(out, type, freq, t, dur, vol, { cutoff, detune = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.08, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (cutoff) {
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = cutoff;
      o.connect(fl).connect(g);
    } else o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  #hit(out, kind, t, vol) {
    const ctx = this.ctx;
    if (kind === 'kick') {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.3);
      return;
    }
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const fl = ctx.createBiquadFilter();
    fl.type = kind === 'hat' ? 'highpass' : 'bandpass';
    fl.frequency.value = kind === 'hat' ? 7000 : 1800;
    const g = ctx.createGain();
    const dur = kind === 'hat' ? 0.04 : 0.16;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(out);
    s.start(t, Math.random());
    s.stop(t + dur + 0.02);
  }

  #schedule() {
    if (this.ctx.state !== 'running') {
      this.nextTime = this.ctx.currentTime + 0.1;
      return;
    }
    const L = this.layers;
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      const t = this.nextTime;
      const s16 = this.step % 16;
      const chord = PROGRESSION[Math.floor(this.bar / 2) % PROGRESSION.length];
      const spb = 60 / this.tempo;
      const d16 = spb / 4;
      if (s16 === 0 && this.bar % 2 === 0) {
        // pad: acorde completo, dos compases
        for (const n of chord) {
          this.#note(L.pad, 'sawtooth', f(n, 1), t, spb * 8, 0.05, { cutoff: 900, detune: -7 });
          this.#note(L.pad, 'sawtooth', f(n, 1), t, spb * 8, 0.05, { cutoff: 900, detune: 7 });
        }
      }
      // arpegio
      if (s16 % 2 === 0 || this.target >= 2) {
        const idx = [0, 1, 2, 3, 2, 1, 3, 0][(this.step >> (this.target >= 2 ? 0 : 1)) % 8];
        this.#note(L.arp, 'triangle', f(chord[idx], 2 + (s16 % 8 === 4 ? 1 : 0)), t, d16 * 1.8, 0.08);
      }
      // bajo
      if (s16 % 4 === 0 || (this.target >= 3 && s16 % 4 === 2)) this.#note(L.bass, 'square', f(chord[0], -1), t, d16 * 3, 0.12, { cutoff: 420 });
      // percusión
      if (s16 % 4 === 0) this.#hit(L.drums, 'kick', t, 0.5);
      if (s16 % 8 === 4) this.#hit(L.drums, 'snare', t, 0.25);
      if (s16 % 2 === 0 || this.target >= 3) this.#hit(L.drums, 'hat', t, s16 % 4 === 2 ? 0.12 : 0.06);
      // melodía de tensión (jefe)
      if (s16 === 0 || s16 === 6 || s16 === 10) this.#note(L.lead, 'square', f(chord[(this.bar + s16) % 4], 3), t, d16 * 3, 0.05, { cutoff: 2400 });
      this.nextTime += d16;
      this.step++;
      if (this.step % 16 === 0) this.bar++;
    }
  }
}
