/**
 * Radio — cola de diálogos con subtítulos (Cmdte. Ruiz, NOVA-7, el Eco y los
 * registros de la Dra. Ibáñez). El HUD muestra cada línea al recibir el
 * evento 'radio:line'.
 */
import { SPEAKERS } from './Story.js';

export class Radio {
  constructor(game) {
    this.game = game;
    this.queue = [];
    this.current = null;
    this.t = 0;
    this.gap = 0;
  }

  /**
   * @param {Array<[string, string, number?]>} lines [hablante, texto, duración]
   */
  say(lines, { interrupt = false, delay = 0 } = {}) {
    if (interrupt) {
      this.queue = [];
      this.current = null;
      this.t = 0;
    }
    if (!this.current && !this.queue.length) this.gap = delay;
    lines.forEach(([who, text, dur], i) => {
      this.queue.push({ who, text, dur: dur ?? Math.min(7.5, 2 + text.length * 0.052), delay: i === 0 ? delay : 0.25 });
    });
  }

  get busy() {
    return !!this.current || this.queue.length > 0;
  }

  update(dt) {
    if (this.current) {
      this.t -= dt;
      if (this.t <= 0) {
        this.current = null;
        this.game.bus.emit('radio:clear');
        this.gap = this.queue[0]?.delay ?? 0;
      }
      return;
    }
    if (!this.queue.length) return;
    this.gap -= dt;
    if (this.gap > 0) return;
    const line = this.queue.shift();
    this.current = line;
    this.t = line.dur;
    const sp = SPEAKERS[line.who] || SPEAKERS.ruiz;
    this.game.bus.emit('radio:line', { speaker: sp, who: line.who, text: line.text, dur: line.dur });
    this.game.audio.play(line.who === 'eco' ? 'ecoVoice' : 'radio');
  }

  clear() {
    this.queue = [];
    this.current = null;
    this.game.bus.emit('radio:clear');
  }
}
