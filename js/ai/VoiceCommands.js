/**
 * VoiceCommands — convierte frases en español en acciones de NOVA-7 y las
 * ejecuta a través de Input (como si fueran teclas mantenidas o pulsadas).
 *
 * parseCommand() reconoce las órdenes habituales sin conexión. Las frases que
 * no entiende las puede interpretar la IA (/api/command), que responde con
 * las mismas acciones; VoiceExecutor valida todo antes de ejecutarlo.
 *
 * Acciones: move{dir, seconds?} · stop · stopFire · run{on} · jump · reload ·
 * melee · pulse · interact · fire{seconds?} · grenade{type?} · weapon{id} ·
 * aim{on} · turn{degrees} (+izquierda / −derecha) · look{dir} · goto ·
 * pause · resume · help · exitVR
 */
import * as THREE from 'three';
import { WEAPONS } from '../config.js';

const SOURCE = 'voice';
const NUMBERS = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cuarenta_y_cinco: 45, noventa: 90 };
const DIRS = ['forward', 'back', 'left', 'right'];
const WEAPON_IDS = ['rifle', 'shotgun', 'orb', 'rail', 'next'];
const MAX_MOVE = 30;
const MAX_FIRE = 8;

export const VOICE_HELP = [
  ['«avanza», «atrás», «izquierda», «derecha»', 'Moverse (hasta decir «alto»)'],
  ['«avanza 3 segundos»', 'Moverse un tiempo'],
  ['«corre» / «camina»', 'Correr o caminar'],
  ['«alto», «detente»', 'Detenerse y dejar de disparar'],
  ['«dispara», «ráfaga», «fuego sin parar»', 'Disparar'],
  ['«salta», «recarga», «golpea», «pulso»', 'Acciones'],
  ['«granada», «granada de singularidad»', 'Lanzar granada'],
  ['«rifle», «dispersor», «lanzaorbes», «riel»', 'Cambiar de arma'],
  ['«gira a la izquierda 90», «media vuelta»', 'Girar la cámara'],
  ['«mira arriba / abajo / al frente»', 'Inclinar la cámara'],
  ['«ve al objetivo»', 'Caminar solo hacia el objetivo'],
  ['«usa», «activa», «aborda»', 'Interactuar (tecla E)'],
  ['«pausa», «continúa», «ayuda»', 'Partida'],
];

/** Minúsculas, sin acentos ni signos. */
export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.;:"«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberIn(t) {
  const m = t.match(/(\d+(?:[.,]\d+)?)/);
  if (m) return Number(m[1].replace(',', '.'));
  for (const [w, n] of Object.entries(NUMBERS)) if (new RegExp(`\\b${w.replace('_', ' ')}\\b`).test(t)) return n;
  return null;
}

function seconds(t) {
  return /\bsegundo/.test(t) ? numberIn(t) : null;
}

/** Una cláusula ("avanza", "dispara 2 segundos") → lista de acciones. */
function parseClause(t) {
  const out = [];
  if (!t) return out;
  if (/(alto el fuego|deja de disparar|no dispares|cese el fuego)/.test(t)) return [{ do: 'stopFire' }];
  // «para» solo al inicio: «avanza para allá» no debe detener a NOVA-7
  if (/\b(alto|detente|deten|quieto|frena|stop|espera)\b|^para(te)?\b/.test(t)) return [{ do: 'stop' }];
  if (/(sal(ir|te)? de (la )?(realidad virtual|vr|modo vr)|quitar vr)/.test(t)) return [{ do: 'exitVR' }];
  if (/\b(pausa|pausar|pon pausa)\b/.test(t)) return [{ do: 'pause' }];
  if (/\b(continua|continuar|reanuda|reanudar|seguir jugando)\b/.test(t) && !/(avanz|camin|adelante)/.test(t)) return [{ do: 'resume' }];
  if (/\bayuda\b|que puedo decir|comandos/.test(t)) return [{ do: 'help' }];
  if (/(objetivo|mision|baliza|marcador|destino)/.test(t) && /\b(ve|ir|vamos|llevame|guiame|sigue|camina|avanza|hacia|al)\b/.test(t)) return [{ do: 'goto' }];

  // giros de cámara
  if (/(media vuelta|date la vuelta|da la vuelta|voltea atras|mira atras|gira atras)/.test(t)) return [{ do: 'turn', degrees: 180 }];
  const turn = t.match(/\b(gira|girar|voltea|voltear|rota|rotar|mira|dobla)\b.*\b(izquierda|derecha)\b/);
  if (turn) {
    const deg = Math.min(180, numberIn(t) ?? 45);
    return [{ do: 'turn', degrees: turn[2] === 'izquierda' ? deg : -deg }];
  }
  if (/\bmira (hacia )?(arriba)\b/.test(t)) return [{ do: 'look', dir: 'up' }];
  if (/\bmira (hacia )?(abajo|el suelo)\b/.test(t)) return [{ do: 'look', dir: 'down' }];
  if (/\bmira (al )?(frente|adelante|centro)\b/.test(t)) return [{ do: 'look', dir: 'center' }];

  // armas
  if (/(siguiente arma|cambia (de )?arma|otra arma)/.test(t)) out.push({ do: 'weapon', id: 'next' });
  else if (/\b(escopeta|dispersor)\b/.test(t)) out.push({ do: 'weapon', id: 'shotgun' });
  else if (/\b(orbe|orbes|lanzaorbes|lanzador)\b/.test(t)) out.push({ do: 'weapon', id: 'orb' });
  else if (/\b(riel|francotirador|sniper)\b/.test(t)) out.push({ do: 'weapon', id: 'rail' });
  else if (/\b(rifle|ametralladora)\b/.test(t)) out.push({ do: 'weapon', id: 'rifle' });
  else {
    const slot = t.match(/\barma (\d|uno|dos|tres|cuatro)\b/);
    if (slot) {
      const n = numberIn(slot[0]);
      const id = Object.values(WEAPONS).find((w) => w.slot === n)?.id;
      if (id) out.push({ do: 'weapon', id });
    }
  }

  if (/\bgranada|explosivo\b/.test(t)) {
    out.push({ do: 'grenade', type: /(singularidad|gravedad|agujero|vortice)/.test(t) ? 'gravity' : /(fragmentacion|normal)/.test(t) ? 'frag' : undefined });
  }
  if (/\b(salta|saltar|brinca|brincar|salto)\b/.test(t)) out.push({ do: 'jump' });
  if (/\brecarg/.test(t)) out.push({ do: 'reload' });
  if (/\b(golpe|golpea|golpear|punetazo|pega|empuja|patea)\b/.test(t)) out.push({ do: 'melee' });
  if (/\b(pulso|onda de choque|choque)\b/.test(t)) out.push({ do: 'pulse' });
  // «usa el pulso» es el pulso, no interactuar
  if (!out.length && /\b(usa|usar|interactua|interactuar|activa|activar|aborda|abordar|abre|recoge|toma|sube)\b/.test(t)) out.push({ do: 'interact' });
  if (/(deja de apuntar|baja el arma|no apuntes)/.test(t)) out.push({ do: 'aim', on: false });
  else if (/\bapunta\b/.test(t)) out.push({ do: 'aim', on: true });

  if (/\b(dispara|disparale|disparen|disparar|fuego|ataca|atacar|rafaga|tira|mata)\b/.test(t)) {
    const s = seconds(t) ?? (/(sin parar|continuo|todo)/.test(t) ? 6 : /rafaga/.test(t) ? 1 : 1.5);
    out.push({ do: 'fire', seconds: s });
  }

  // movimiento
  const s = seconds(t);
  if (/\b(corre|correr|sprint|esprinta)\b/.test(t)) {
    out.push({ do: 'run', on: true });
    if (!/(atras|retrocede|izquierda|derecha)/.test(t)) out.push({ do: 'move', dir: 'forward', seconds: s ?? undefined });
  } else if (/\b(despacio|lento|camina normal)\b/.test(t)) out.push({ do: 'run', on: false });
  if (/\b(atras|retrocede|retroceder|recula)\b/.test(t)) out.push({ do: 'move', dir: 'back', seconds: s ?? undefined });
  else if (/\b(izquierda)\b/.test(t)) out.push({ do: 'move', dir: 'left', seconds: s ?? undefined });
  else if (/\b(derecha)\b/.test(t)) out.push({ do: 'move', dir: 'right', seconds: s ?? undefined });
  else if (/\b(avanza|avanzar|adelante|camina|caminar|muevete|sigue|ve)\b/.test(t) && !out.some((a) => a.do === 'move')) {
    out.push({ do: 'move', dir: 'forward', seconds: s ?? undefined });
  }
  return out;
}

/** Frase completa → acciones (vacío si no se entendió). */
export function parseCommand(text) {
  const t = normalize(text);
  if (!t) return [];
  const clauses = t.split(/,|\by luego\b|\bluego\b|\bdespues\b|\by\b|\be\b/).map((c) => c.trim()).filter(Boolean);
  const actions = [];
  for (const c of clauses) actions.push(...parseClause(c));
  return actions;
}

/** Valida acciones que vienen de la IA (o de cualquier fuente externa). */
export function sanitizeActions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list.slice(0, 6)) {
    if (!a || typeof a.do !== 'string') continue;
    const num = (v, lo, hi) => (Number.isFinite(Number(v)) ? THREE.MathUtils.clamp(Number(v), lo, hi) : undefined);
    switch (a.do) {
      case 'move':
        if (DIRS.includes(a.dir)) out.push({ do: 'move', dir: a.dir, seconds: num(a.seconds, 0.2, MAX_MOVE) });
        break;
      case 'fire':
        out.push({ do: 'fire', seconds: num(a.seconds, 0.2, MAX_FIRE) ?? 1.5 });
        break;
      case 'run':
      case 'aim':
        out.push({ do: a.do, on: a.on !== false });
        break;
      case 'grenade':
        out.push({ do: 'grenade', type: a.type === 'gravity' || a.type === 'frag' ? a.type : undefined });
        break;
      case 'weapon':
        if (WEAPON_IDS.includes(a.id)) out.push({ do: 'weapon', id: a.id });
        break;
      case 'turn': {
        const d = num(a.degrees, -180, 180);
        if (d) out.push({ do: 'turn', degrees: d });
        break;
      }
      case 'look':
        if (['up', 'down', 'center'].includes(a.dir)) out.push({ do: 'look', dir: a.dir });
        break;
      case 'stop': case 'stopFire': case 'jump': case 'reload': case 'melee': case 'pulse':
      case 'interact': case 'goto': case 'pause': case 'resume': case 'help': case 'exitVR':
        out.push({ do: a.do });
        break;
      default:
        break;
    }
  }
  return out;
}

const KEY_OF = { forward: 'forward', back: 'back', left: 'left', right: 'right' };

/** Ejecuta acciones a lo largo del tiempo (movimientos con duración, ráfagas…). */
export class VoiceExecutor {
  constructor(game) {
    this.game = game;
    this.move = null; // { dir, t }
    this.fire = 0;
    this.grenade = null; // { t }
    this.turn = 0; // radianes pendientes
    this.goto = null; // { stuck, last }
    this.semiTimer = 0;
  }

  get input() {
    return this.game.input;
  }

  /** Suelta todo lo que la voz mantiene presionado. */
  stopAll() {
    this.move = null;
    this.fire = 0;
    this.goto = null;
    this.turn = 0;
    this.input.releaseAll(SOURCE);
  }

  /** @returns {string[]} descripciones breves de lo ejecutado */
  run(actions) {
    const { game } = this;
    const done = [];
    for (const a of actions) {
      const label = this.#one(a);
      if (label) done.push(label);
    }
    if (done.length) game.bus.emit('voice:done', { labels: done });
    return done;
  }

  #one(a) {
    const { game, input } = this;
    const playing = game.state === 'playing';
    switch (a.do) {
      case 'pause':
        game.pause();
        return 'Pausa';
      case 'resume':
        game.resume();
        return 'Continuar';
      case 'help':
        if (playing) game.hud.toggleHelp();
        return 'Ayuda';
      case 'exitVR':
        game.exitImmersive();
        return 'Salir de VR';
      default:
        break;
    }
    if (!playing || !game.player?.canAct()) return null;
    switch (a.do) {
      case 'stop':
        this.stopAll();
        return 'Alto';
      case 'stopFire':
        this.fire = 0;
        input.setHold(SOURCE, 'fire', false);
        return 'Alto el fuego';
      case 'move':
        this.goto = null;
        for (const d of DIRS) input.setHold(SOURCE, KEY_OF[d], false);
        this.move = { dir: a.dir, t: a.seconds ?? MAX_MOVE };
        input.setHold(SOURCE, KEY_OF[a.dir], true);
        return { forward: 'Avanzar', back: 'Atrás', left: 'Izquierda', right: 'Derecha' }[a.dir];
      case 'run':
        input.setHold(SOURCE, 'run', a.on);
        return a.on ? 'Correr' : 'Caminar';
      case 'aim':
        input.setHold(SOURCE, 'aim', a.on);
        return a.on ? 'Apuntar' : 'Bajar arma';
      case 'fire':
        this.fire = a.seconds ?? 1.5;
        this.semiTimer = 0;
        return 'Disparar';
      case 'jump':
        input.tap('jump');
        return 'Saltar';
      case 'reload':
        input.tap('reload');
        return 'Recargar';
      case 'melee':
        input.tap('melee');
        return 'Golpe';
      case 'pulse':
        input.tap('pulse');
        return 'Pulso';
      case 'interact':
        game.tryInteract();
        return 'Interactuar';
      case 'grenade':
        if (a.type && a.type !== game.weapons.grenadeType) input.tap('grenadeSwitch');
        // mantener G un instante para mostrar la trayectoria y soltar
        this.grenade = { t: 0.45, started: false };
        return 'Granada';
      case 'weapon':
        if (a.id === 'next') input.tap('nextWeapon');
        else if (game.weapons.owned.has(a.id)) input.tap(`weapon${WEAPONS[a.id].slot}`);
        else {
          game.bus.emit('hud:toast', { text: `Aún no tienes el ${WEAPONS[a.id].short.toLowerCase()}`, type: 'danger', icon: 'x-circle' });
          return null;
        }
        return a.id === 'next' ? 'Siguiente arma' : WEAPONS[a.id].short;
      case 'turn':
        this.turn += THREE.MathUtils.degToRad(a.degrees);
        return `Girar ${Math.abs(Math.round(a.degrees))}°`;
      case 'look': {
        const rig = game.cameraRig;
        rig.pitch = a.dir === 'up' ? -0.4 : a.dir === 'down' ? 0.9 : 0.28;
        return 'Mirar';
      }
      case 'goto':
        if (!game.level?.waypoint) {
          game.bus.emit('hud:toast', { text: 'No hay un objetivo marcado ahora', type: 'warn', icon: 'geo-alt' });
          return null;
        }
        this.move = null;
        for (const d of DIRS) input.setHold(SOURCE, KEY_OF[d], false);
        this.goto = { stuck: 0, last: game.player.currPos.clone(), t: 60 };
        return 'Ir al objetivo';
      default:
        return null;
    }
  }

  update(dt) {
    const { game, input } = this;
    if (game.state !== 'playing' || !game.player) return;
    // movimiento con duración
    if (this.move) {
      this.move.t -= dt;
      if (this.move.t <= 0) {
        input.setHold(SOURCE, KEY_OF[this.move.dir], false);
        this.move = null;
      }
    }
    // disparo sostenido: automático = mantener; semiautomático = pulsar a su cadencia; orbe = cargar y soltar
    if (this.fire > 0) {
      const w = game.weapons;
      const mode = w.def.mode;
      this.fire -= dt;
      if (mode === 'auto') input.setHold(SOURCE, 'fire', this.fire > 0);
      else if (mode === 'charge') {
        if (!w.charging && this.fire > 0) {
          input.setHold(SOURCE, 'fire', true);
          input.tap('fire');
        } else if (w.charging && w.charge >= 1) {
          input.setHold(SOURCE, 'fire', false);
          input.untap('fire');
          this.fire = Math.min(this.fire, 0);
        }
      } else {
        this.semiTimer -= dt;
        if (this.semiTimer <= 0) {
          input.tap('fire');
          this.semiTimer = 1 / w.def.fireRate + 0.05;
        }
      }
      if (this.fire <= 0) input.setHold(SOURCE, 'fire', false);
    }
    // granada: pulsar, mantener y soltar
    if (this.grenade) {
      if (!this.grenade.started) {
        this.grenade.started = true;
        input.setHold(SOURCE, 'grenade', true);
        input.tap('grenade');
      }
      this.grenade.t -= dt;
      if (this.grenade.t <= 0) {
        input.setHold(SOURCE, 'grenade', false);
        input.untap('grenade');
        this.grenade = null;
      }
    }
    // giro suave de la cámara
    if (Math.abs(this.turn) > 0.001) {
      const step = Math.sign(this.turn) * Math.min(Math.abs(this.turn), dt * 5);
      this.turn -= step;
      game.turnView(step);
    }
    this.#updateGoto(dt);
  }

  /** Piloto automático hacia el marcador del objetivo (sin búsqueda de rutas). */
  #updateGoto(dt) {
    const { game, input } = this;
    const g = this.goto;
    if (!g) return;
    const wp = game.level?.waypoint;
    const p = game.player.currPos;
    g.t -= dt;
    if (!wp || g.t <= 0) {
      this.goto = null;
      input.setAxis(SOURCE, 0, 0);
      return;
    }
    const dx = wp.pos.x - p.x;
    const dz = wp.pos.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 3) {
      this.goto = null;
      input.setAxis(SOURCE, 0, 0);
      game.bus.emit('hud:toast', { text: `Llegaste: ${wp.label ?? 'objetivo'}`, type: 'info', icon: 'geo-alt-fill' });
      return;
    }
    const fwd = game.cameraRig.forward(new THREE.Vector3());
    const right = game.cameraRig.right(new THREE.Vector3());
    const nx = dx / dist;
    const nz = dz / dist;
    input.setAxis(SOURCE, nx * right.x + nz * right.z, nx * fwd.x + nz * fwd.z);
    // en pantalla normal la cámara gira poco a poco hacia el destino
    if (!game.immersive) {
      const want = Math.atan2(-nx, -nz);
      let d = want - game.cameraRig.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      game.cameraRig.yaw += d * Math.min(1, dt * 1.5);
    }
    // si casi no avanza, intenta saltar el obstáculo
    g.stuck += dt;
    if (g.stuck > 1.5) {
      if (g.last.distanceTo(p) < 0.6) input.tap('jump');
      g.last.copy(p);
      g.stuck = 0;
    }
  }
}
