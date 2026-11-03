/**
 * VoiceControl — controla a NOVA-7 con la voz.
 *
 * Modos (se elige el mejor disponible):
 *  - 'speech': Web Speech API (Chrome, Edge, Safari, Chrome para Android).
 *    Escucha continuamente mientras está activado (tecla V o botón 🎙).
 *  - 'record': navegadores sin reconocimiento (Meta Quest Browser, Firefox).
 *    "Presiona para hablar": se graba con MediaRecorder mientras se mantiene
 *    V / el botón / X en el control izquierdo, y el audio se transcribe con
 *    OpenAI en el servidor (/api/transcribe). Requiere el despliegue en Vercel.
 *
 * Cada frase se interpreta primero localmente (VoiceCommands.parseCommand) y,
 * si no se entiende, la interpreta la IA (/api/command).
 */
import { parseCommand, sanitizeActions, VoiceExecutor, coverage, quickCommand, normalize } from './VoiceCommands.js';

const $ = (id) => document.getElementById(id);
/** Si el intérprete local entiende menos de esta parte de la frase, se consulta a la IA. */
const MIN_COVERAGE = 0.6;

export class VoiceControl {
  constructor(game) {
    this.game = game;
    this.exec = new VoiceExecutor(game);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.mode = SR ? 'speech' : navigator.mediaDevices?.getUserMedia && window.MediaRecorder ? 'record' : 'none';
    this.enabled = false;
    this.listening = false;
    this.recording = false;
    this.quickDone = new Map(); // resultado → texto ya ejecutado con el provisional
    this.chip = $('voice-chip');
    this.text = $('voice-text');
    this.button = $('btn-voice');
    this.chipTimer = 0;
    if (SR) this.#setupRecognition(SR);
    this.#bindButton();
    game.bus.on('voice:done', ({ labels }) => this.#show(`✓ ${labels.join(' · ')}`, 'ok'));
  }

  get supported() {
    return this.mode !== 'none';
  }

  get label() {
    return { speech: 'reconocimiento del navegador', record: 'presiona para hablar (transcripción con IA)', none: 'no disponible en este navegador' }[this.mode];
  }

  #setupRecognition(SR) {
    const rec = new SR();
    rec.lang = 'es-MX';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.onstart = () => {
      this.listening = true;
      this.#render();
    };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const key = `${this.session}:${i}`;
        if (!r.isFinal) {
          const t = r[0].transcript;
          this.#show(`… ${t}`, 'interim');
          // solo órdenes de UNA palabra («alto», «salta»): «para…» puede ser «para la izquierda»
          const quick = quickCommand(t);
          if (quick.length && !this.quickDone.has(key)) {
            this.quickDone.set(key, normalize(t));
            this.exec.run(quick);
          }
          continue;
        }
        // si la frase final es la misma que ya se ejecutó, no repetirla
        if (this.quickDone.has(key) && this.quickDone.get(key) === normalize(r[0].transcript)) continue;
        const alts = Array.from(r, (a) => a.transcript);
        this.handleText(alts[0], alts.slice(1));
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.enabled = false;
        this.game.bus.emit('hud:toast', { text: 'Permiso de micrófono denegado', type: 'danger', icon: 'mic-mute-fill' });
      } else if (e.error === 'network') {
        this.#show('Sin conexión con el servicio de voz', 'error');
      }
    };
    rec.onend = () => {
      this.listening = false;
      this.#render();
      // Chrome corta la escucha tras un silencio: se reanuda mientras siga activada
      if (this.enabled) setTimeout(() => this.#startRecognition(), 250);
    };
    this.rec = rec;
    this.session = 0;
  }

  #startRecognition() {
    if (!this.rec || this.listening || !this.enabled) return;
    try {
      this.session++;
      this.quickDone.clear();
      this.rec.start();
    } catch {
      /* ya estaba escuchando */
    }
  }

  #bindButton() {
    const b = this.button;
    if (!b) return;
    b.classList.toggle('d-none', !this.supported);
    if (this.mode === 'record') {
      const down = (e) => {
        e.preventDefault();
        this.pushStart();
      };
      const up = (e) => {
        e.preventDefault();
        this.pushEnd();
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
    } else {
      b.addEventListener('click', () => this.toggle());
    }
  }

  // ---------------------------------------------------------------- API
  toggle() {
    if (this.enabled) this.stop();
    else this.start();
  }

  start() {
    if (!this.supported) {
      this.game.bus.emit('hud:toast', { text: 'Tu navegador no permite comandos de voz', type: 'danger', icon: 'mic-mute-fill' });
      return;
    }
    this.enabled = true;
    this.game.settings.set('voice', true);
    if (this.mode === 'speech') this.#startRecognition();
    else {
      this.game.ai.check();
      this.#show('Mantén V (o X en VR) para hablar', 'info');
    }
    this.#render();
  }

  stop() {
    this.enabled = false;
    this.game.settings.set('voice', false);
    try {
      this.rec?.stop();
    } catch {
      /* no estaba escuchando */
    }
    this.exec.stopAll();
    this.#render();
  }

  /** Presionar para hablar (o activar la escucha si el navegador reconoce voz). */
  async pushStart() {
    if (this.mode === 'speech') {
      if (!this.enabled) this.start();
      return;
    }
    if (this.mode !== 'record' || this.recording) return;
    this.enabled = true;
    try {
      this.stream ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported?.(t));
      this.recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
      this.chunks = [];
      this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.recorder.start();
      this.recording = true;
      this.recordStart = performance.now();
      this.#show('🎙 Grabando… suelta para enviar', 'interim');
      this.#render();
    } catch {
      this.game.bus.emit('hud:toast', { text: 'No se pudo usar el micrófono', type: 'danger', icon: 'mic-mute-fill' });
    }
  }

  pushEnd() {
    if (!this.recording || !this.recorder) return;
    this.recording = false;
    const rec = this.recorder;
    rec.onstop = async () => {
      this.#render();
      if (performance.now() - this.recordStart < 350) return;
      const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' });
      this.#show('Transcribiendo…', 'interim');
      const res = await this.game.ai.transcribe(blob);
      if (res?.text) this.handleText(res.text);
      else this.#show(this.game.ai.online ? 'No se entendió el audio' : 'La transcripción necesita el servidor de IA (Vercel)', 'error');
    };
    rec.stop();
  }

  /** Interpreta una frase (también sirve para pruebas desde la consola). */
  async handleText(text, alternatives = []) {
    const game = this.game;
    // 1) intérprete local con cada alternativa del reconocedor: la que mejor se entienda
    let local = [];
    let localText = text;
    let best = -1;
    for (const t of [text, ...alternatives]) {
      const actions = parseCommand(t);
      if (!actions.length) continue;
      const cov = coverage(t);
      if (cov > best) {
        best = cov;
        local = actions;
        localText = t;
      }
    }
    const aiOn = game.settings.get('aiVoice') && (await game.ai.check()) === 'online';
    if (local.length && (best >= MIN_COVERAGE || !aiOn)) {
      this.#show(`«${localText}»`, 'heard');
      this.exec.run(local);
      return local;
    }
    // 2) la IA interpreta frases libres o mal reconocidas (recibe también las alternativas)
    if (aiOn) {
      this.#show(`«${text}» · pensando…`, 'interim');
      const res = await game.ai.command(text, { ...this.#context(), alternatives: alternatives.slice(0, 4), localGuess: local });
      const actions = sanitizeActions(res?.actions);
      if (actions.length) {
        this.exec.run(actions);
        if (res.reply) this.#show(`IA: ${String(res.reply).slice(0, 80)}`, 'ok');
        return actions;
      }
    }
    if (local.length) {
      this.#show(`«${localText}»`, 'heard');
      this.exec.run(local);
      return local;
    }
    this.#show(`No entendí «${text}» · di «ayuda»`, 'error');
    return [];
  }

  #context() {
    const g = this.game;
    const w = g.weapons;
    const obj = g.level?.objectives?.find((o) => o.active && !o.done) ?? g.level?.objectives?.find((o) => !o.done);
    return {
      state: g.state,
      weapons: [...w.owned],
      current: w.current,
      grenadeType: w.grenadeType,
      objective: obj?.text ?? null,
      canInteract: g.level?.currentPrompt()?.text ?? null,
      boss: g.boss?.cfg?.name ?? null,
      health: Math.round(g.player?.health ?? 0),
    };
  }

  update(dt) {
    this.exec.update(dt);
    if (this.chipTimer > 0) {
      this.chipTimer -= dt;
      if (this.chipTimer <= 0) this.#render();
    }
  }

  /** Último mensaje (lo muestran el HUD normal y el HUD de VR). */
  #show(msg, kind) {
    this.lastMessage = msg;
    this.lastKind = kind;
    this.chipTimer = kind === 'interim' ? 6 : 3.5;
    if (this.text) this.text.textContent = msg;
    this.#render();
  }

  #render() {
    const active = this.enabled || this.recording;
    if (this.button) {
      this.button.classList.toggle('is-active', active);
      this.button.querySelector('i')?.setAttribute('class', `bi bi-${active ? 'mic-fill' : 'mic-mute'}`);
    }
    if (!this.chip) return;
    const visible = active && (this.chipTimer > 0 || this.recording || this.listening);
    this.chip.classList.toggle('is-hidden', !visible);
    this.chip.dataset.kind = this.recording ? 'rec' : this.lastKind ?? 'info';
    if (this.chipTimer <= 0 && !this.recording) this.text.textContent = this.mode === 'speech' ? 'Escuchando…' : 'Mantén V para hablar';
  }

  /** Estado resumido para el HUD de VR. */
  status() {
    if (!this.enabled && !this.recording) return null;
    if (this.chipTimer > 0) return this.lastMessage;
    if (this.recording) return '🎙 Grabando…';
    return this.mode === 'speech' ? '🎙 Escuchando' : '🎙 Mantén X para hablar';
  }
}
