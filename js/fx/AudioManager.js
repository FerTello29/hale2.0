/**
 * AudioManager — efectos de sonido sintetizados en tiempo real con Web Audio
 * (sin archivos de audio: cero derechos de autor y cero descargas).
 *
 * Incluye paneo/atenuación por distancia respecto a la cámara, viento de la
 * tormenta en bucle y el tono de carga del orbe.
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
    this.noiseBuffer = null;
    this.lastPlay = new Map();
  }

  /** Debe llamarse tras un gesto del usuario (clic en "Jugar"). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.noiseBuffer = this.#makeNoise(2);
      this.#startAmbience();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
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

  #startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(filter.frequency);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    lfo.start();
    this.wind = { filter, gain };
  }

  /** Ajusta el viento según la intensidad de la tormenta (0..1). */
  setStorm(t) {
    if (!this.wind) return;
    const now = this.ctx.currentTime;
    this.wind.gain.gain.setTargetAtTime(0.04 + t * 0.2, now, 0.5);
    this.wind.filter.frequency.setTargetAtTime(380 + t * 700, now, 0.5);
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
      vol *= THREE.MathUtils.clamp(1 - (d - 4) / 55, 0.05, 1);
      _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      pan = d > 0.001 ? THREE.MathUtils.clamp(_rel.normalize().dot(_right), -1, 1) * 0.8 : 0;
    }
    g.gain.value = vol;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
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
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t0, Math.random() * 0.3);
    s.stop(t0 + dur + 0.05);
  }

  play(name, pos = null, { gain = 1, pitch = 1 } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    // limitar repeticiones del mismo sonido en el mismo instante
    const nowMs = performance.now();
    const last = this.lastPlay.get(name) || 0;
    if (nowMs - last < 35) return;
    this.lastPlay.set(name, nowMs);

    const t = this.ctx.currentTime + 0.005;
    const out = this.#spatial(pos, gain);
    const p = pitch;
    switch (name) {
      case 'throw':
        this.#noise(out, 'bandpass', 600 * p, 2600 * p, t, 0.28, 0.5, 2);
        this.#osc(out, 'sine', 320 * p, 900 * p, t, 0.22, 0.25);
        break;
      case 'impact':
        this.#noise(out, 'lowpass', 1400, 200, t, 0.3, 0.7);
        this.#osc(out, 'sine', 180, 60, t, 0.25, 0.5);
        this.#osc(out, 'triangle', 1400, 700, t, 0.12, 0.08);
        break;
      case 'explosion':
        this.#noise(out, 'lowpass', 2200, 90, t, 1.3, 1.0);
        this.#osc(out, 'sine', 90, 30, t, 1.0, 0.9);
        this.#noise(out, 'highpass', 2500, 1200, t, 0.18, 0.3);
        break;
      case 'smallExplosion':
        this.#noise(out, 'lowpass', 1800, 120, t, 0.7, 0.8);
        this.#osc(out, 'sine', 130, 40, t, 0.5, 0.6);
        break;
      case 'core':
        [0, 0.07, 0.14, 0.21].forEach((d, i) => this.#osc(out, 'triangle', [880, 1109, 1319, 1760][i], [880, 1109, 1319, 1760][i], t + d, 0.3, 0.22));
        this.#osc(out, 'sine', 2637, 2637, t + 0.21, 0.5, 0.08);
        break;
      case 'gold':
        [0, 0.06, 0.12, 0.18, 0.24].forEach((d, i) => this.#osc(out, 'triangle', [784, 988, 1175, 1568, 1976][i], [784, 988, 1175, 1568, 1976][i], t + d, 0.35, 0.2));
        break;
      case 'goldSpawn':
        this.#osc(out, 'sine', 1568, 2093, t, 0.4, 0.12);
        break;
      case 'battery':
        this.#osc(out, 'square', 440, 440, t, 0.1, 0.08);
        this.#osc(out, 'square', 660, 660, t + 0.09, 0.14, 0.08);
        this.#osc(out, 'sine', 880, 1320, t + 0.18, 0.25, 0.15);
        break;
      case 'whoosh':
        this.#noise(out, 'bandpass', 400, 1600, t, 0.18, 0.3, 1.5);
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
      case 'droneShot':
        this.#osc(out, 'square', 1200, 300, t, 0.16, 0.12);
        this.#osc(out, 'sawtooth', 900, 200, t, 0.12, 0.08);
        break;
      case 'droneAlert':
        this.#osc(out, 'square', 1500, 1500, t, 0.08, 0.1);
        this.#osc(out, 'square', 1900, 1900, t + 0.11, 0.08, 0.1);
        break;
      case 'droneDown':
        this.#osc(out, 'sawtooth', 900, 80, t, 0.7, 0.2);
        this.#noise(out, 'highpass', 3000, 1500, t, 0.2, 0.25);
        break;
      case 'boltHit':
        this.#noise(out, 'bandpass', 2400, 800, t, 0.15, 0.35, 3);
        break;
      case 'damage':
        this.#osc(out, 'sawtooth', 220, 70, t, 0.25, 0.3);
        this.#noise(out, 'bandpass', 900, 400, t, 0.15, 0.25, 2);
        break;
      case 'towerDown':
        this.#osc(out, 'sawtooth', 600, 40, t, 1.6, 0.35);
        this.#osc(out, 'square', 300, 30, t + 0.1, 1.4, 0.12);
        this.#noise(out, 'lowpass', 3000, 100, t, 1.4, 0.6);
        break;
      case 'crateBreak':
        this.#noise(out, 'bandpass', 1500, 500, t, 0.25, 0.8, 1.2);
        this.#noise(out, 'lowpass', 600, 200, t + 0.03, 0.3, 0.5);
        break;
      case 'fuse':
        this.#noise(out, 'highpass', 5000, 3000, t, 1.0, 0.18);
        break;
      case 'rumble':
        this.#noise(out, 'lowpass', 220, 90, t, 1.6, 0.6);
        break;
      case 'rockLand':
        this.#noise(out, 'lowpass', 700, 80, t, 0.6, 0.9);
        this.#osc(out, 'sine', 70, 30, t, 0.5, 0.7);
        break;
      case 'jump':
        this.#osc(out, 'sine', 300, 520, t, 0.12, 0.08);
        break;
      case 'land':
        this.#noise(out, 'lowpass', 500, 120, t, 0.12, 0.25);
        break;
      case 'step':
        this.#noise(out, 'lowpass', 900 + Math.random() * 300, 300, t, 0.07, 0.08);
        break;
      case 'lever':
        this.#noise(out, 'lowpass', 1200, 200, t, 0.2, 0.6);
        this.#osc(out, 'sawtooth', 55, 110, t + 0.2, 3, 0.18);
        break;
      case 'denied':
        this.#osc(out, 'square', 220, 180, t, 0.18, 0.12);
        break;
      case 'ready':
        [0, 0.12, 0.24].forEach((d, i) => this.#osc(out, 'triangle', [523, 659, 784][i], [523, 659, 784][i], t + d, 0.4, 0.22));
        break;
      case 'alarm':
        this.#osc(out, 'square', 880, 660, t, 0.35, 0.1);
        this.#osc(out, 'square', 880, 660, t + 0.4, 0.35, 0.1);
        break;
      case 'fall':
        this.#osc(out, 'sine', 700, 120, t, 0.8, 0.2);
        break;
      case 'ui':
        this.#osc(out, 'triangle', 1200, 1200, t, 0.05, 0.08);
        break;
      case 'victory':
        [0, 0.15, 0.3, 0.45, 0.6].forEach((d, i) => this.#osc(out, 'triangle', [523, 659, 784, 1047, 1319][i], [523, 659, 784, 1047, 1319][i], t + d, 0.6, 0.22));
        this.#osc(out, 'sine', 262, 262, t + 0.6, 1.5, 0.2);
        break;
      case 'defeat':
        [0, 0.25, 0.5].forEach((d, i) => this.#osc(out, 'sawtooth', [392, 311, 233][i], [392, 311, 233][i] * 0.97, t + d, 0.6, 0.12));
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
