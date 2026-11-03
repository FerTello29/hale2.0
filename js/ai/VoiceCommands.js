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
const NUMBERS = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cuarenta_y_cinco: 45, sesenta: 60, noventa: 90, ciento_ochenta: 180 };
const DIRS = ['forward', 'back', 'left', 'right'];
const WEAPON_IDS = ['rifle', 'shotgun', 'orb', 'rail', 'next'];
const MAX_MOVE = 30;
const MAX_FIRE = 8;
/** Pasos laterales: «izquierda» sin más mueve a NOVA-7 un momento hacia ese lado. */
const SIDE_STEP = 1.6;

export const VOICE_HELP = [
  ['«avanza», «adelante», «pa\'lante», «atrás»', 'Avanzar o retroceder (hasta decir «alto»)'],
  ['«izquierda», «para la derecha»', 'Paso lateral hacia ese lado'],
  ['«gira / voltea / dobla a la izquierda»', 'Girar 90° (o los grados que digas)'],
  ['«avanza 3 segundos», «un poco a la derecha»', 'Moverse un tiempo'],
  ['«corre» / «camina»', 'Correr o caminar'],
  ['«alto», «detente», «para»', 'Detenerse y dejar de disparar'],
  ['«dispara», «dispárales», «fuego sin parar»', 'Disparar con apuntado automático'],
  ['«salta», «recarga», «golpea», «pulso»', 'Acciones'],
  ['«granada», «granada de singularidad»', 'Lanzar granada'],
  ['«rifle», «dispersor», «lanzaorbes», «riel»', 'Cambiar de arma'],
  ['«media vuelta», «mira arriba / abajo»', 'Mover la cámara'],
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
    .replace(/[¿?¡!.;:"«»'’`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Palabras clave que el reconocedor de voz a veces escribe mal («isquierda»,
 * «disparar» → «disparan»…). Una palabra desconocida a 1-2 letras de
 * distancia de una de estas se corrige.
 */
const KEYWORDS = [
  'izquierda', 'derecha', 'adelante', 'atras', 'avanza', 'retrocede', 'dispara', 'recarga', 'salta', 'brinca', 'granada',
  'corre', 'camina', 'detente', 'gira', 'voltea', 'dobla', 'rifle', 'dispersor', 'escopeta', 'lanzaorbes', 'riel',
  'objetivo', 'baliza', 'pausa', 'continua', 'golpea', 'pulso', 'rafaga', 'singularidad', 'interactua', 'francotirador',
];
const KNOWN = new Set([...KEYWORDS, 'alto', 'para', 'fuego', 'arma', 'mira', 'vuelta', 'media', 'segundos', 'segundo', 'grados', 'ayuda', 'usa', 'activa', 'aborda', 'derecho', 'recto', 'continuo', 'frente', 'rapido', 'hacia', 'falta', 'carga']);

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function fixWord(w) {
  if (w.length < 5 || KNOWN.has(w)) return w;
  let best = w;
  let bestD = w.length >= 8 ? 2 : 1;
  for (const k of KEYWORDS) {
    // conjugaciones y pronombres pegados («disparales», «correle») se tratan aparte
    if (w.startsWith(k.slice(0, -1))) continue;
    const d = levenshtein(w, k);
    if (d <= bestD && d < (bestD === 2 ? 3 : 2)) {
      bestD = d;
      best = k;
      if (d === 0) break;
    }
  }
  return best;
}

/** Español coloquial de México → forma que entiende el intérprete. */
export function canonical(text) {
  let t = normalize(text);
  t = t
    .split(' ')
    .map(fixWord)
    .join(' ')
    // «pa'lante», «palante», «pa delante», «patras», «pa tras»
    .replace(/\b(pa ?lante|pa ?delante|para delante|palante)\b/g, 'adelante')
    .replace(/\b(pa ?tras|pa ?atras)\b/g, 'atras')
    // «pa la izquierda», «para la derecha», «para adelante»: «para» = hacia, no «alto»
    .replace(/\b(pa|para) (la |el |los |las |mi |tu |su )?(izquierda|derecha|adelante|atras|alla|aca|arriba|abajo|frente|objetivo|baliza|nave|lado)\b/g, 'hacia $2$3')
    // «sigue derecho», «ve recto», «de frente»: hacia adelante
    .replace(/\b(derecho|recto|de frente|al frente)\b/g, (m, _x, i, s) => (/mira\s*$/.test(s.slice(0, i)) ? m : 'adelante'))
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

function numberIn(t) {
  const m = t.match(/(\d+(?:[.,]\d+)?)/);
  if (m) return Number(m[1].replace(',', '.'));
  for (const [w, n] of Object.entries(NUMBERS).sort((a, b) => b[0].length - a[0].length)) {
    if (new RegExp(`\\b${w.replace(/_/g, ' ')}\\b`).test(t)) return n;
  }
  return null;
}

function seconds(t) {
  if (/\bsegundo/.test(t)) return numberIn(t);
  if (/\b(un poco|poquito|tantito|un paso)\b/.test(t)) return 0.8;
  if (/\b(mucho|bastante)\b/.test(t)) return 4;
  return null;
}

/** Una cláusula ("avanza", "dispara 2 segundos") → lista de acciones. */
function parseClause(t) {
  const out = [];
  if (!t) return out;
  if (/(alto el fuego|deja de disparar|no dispares|cese el fuego|ya no dispares)/.test(t)) return [{ do: 'stopFire' }];
  // «para» solo si va sola o como «parate» / «para ya» («para la izquierda» ya se convirtió en «hacia la izquierda»)
  if (/\b(alto|detente|deten|detengase|quieto|frena|stop|espera|ya no te muevas)\b|^para(te)?( ya| ahi)?$/.test(t)) return [{ do: 'stop' }];
  if (/(sal(ir|te)? de (la )?(realidad virtual|vr|modo vr)|quitar vr)/.test(t)) return [{ do: 'exitVR' }];
  if (/\b(pausa|pausar|pon pausa)\b/.test(t)) return [{ do: 'pause' }];
  if (/\b(continua|continuar|reanuda|reanudar|seguir jugando)\b/.test(t) && !/(avanz|camin|adelante)/.test(t)) return [{ do: 'resume' }];
  if (/\bayuda\b|que puedo decir|comandos/.test(t)) return [{ do: 'help' }];
  if (/(objetivo|mision|baliza|marcador|destino)/.test(t) && /\b(ve|ir|vamos|llevame|guiame|sigue|camina|avanza|hacia|al)\b/.test(t)) return [{ do: 'goto' }];

  // giros de cámara
  if (/(media vuelta|date la vuelta|da la vuelta|dese la vuelta|voltea atras|voltea hacia atras|mira atras|gira atras|vuelta completa)/.test(t)) return [{ do: 'turn', degrees: 180 }];
  const turn = t.match(/\b(gira\w*|volte\w*|rota\w*|mira|dobla\w*|da vuelta|vuelta|tuerce)\b.*\b(izquierda|derecha)\b/);
  if (turn) {
    // «un poco» no es «1 grado»
    const deg = Math.min(180, /\b(un poco|poquito|tantito)\b/.test(t) ? 30 : numberIn(t) ?? 90);
    return [{ do: 'turn', degrees: turn[2] === 'izquierda' ? deg : -deg }];
  }
  if (/\bmira (hacia )?(arriba)\b/.test(t)) return [{ do: 'look', dir: 'up' }];
  if (/\bmira (hacia )?(abajo|el suelo)\b/.test(t)) return [{ do: 'look', dir: 'down' }];
  if (/\bmira (hacia )?(al )?(adelante|centro|frente)\b/.test(t)) return [{ do: 'look', dir: 'center' }];

  // armas
  if (/(siguiente arma|cambia (de )?arma|otra arma|cambia el arma)/.test(t)) out.push({ do: 'weapon', id: 'next' });
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

  if (/\b(granada|explosivo|bomba)\b/.test(t)) {
    out.push({ do: 'grenade', type: /(singularidad|gravedad|agujero|vortice)/.test(t) ? 'gravity' : /(fragmentacion|normal)/.test(t) ? 'frag' : undefined });
  }
  if (/\b(salt\w*|brinc\w*|brinque\w*)\b/.test(t)) out.push({ do: 'jump' });
  if (/\brecarg/.test(t)) out.push({ do: 'reload' });
  if (/\b(golpe\w*|punetazo|pega\w*|empuja|patea\w*|madrazo)\b/.test(t)) out.push({ do: 'melee' });
  if (/\b(pulso|onda de choque|choque)\b/.test(t)) out.push({ do: 'pulse' });
  // «usa el pulso» es el pulso, no interactuar
  if (!out.length && /\b(usa|usar|interactua\w*|activa\w*|aborda\w*|abre|recoge|toma|sube\w*)\b/.test(t)) out.push({ do: 'interact' });
  if (/(deja de apuntar|baja el arma|no apuntes)/.test(t)) out.push({ do: 'aim', on: false });
  else if (/\bapunta\b/.test(t)) out.push({ do: 'aim', on: true });

  if (/\b(dispar\w*|fuego|ataca\w*|rafaga|tira(le|les)?|tirale\w*|mata\w*|balea\w*|plomo|acaba con)\b/.test(t)) {
    const s = seconds(t) ?? (/(sin parar|continuo|todo|mucho)/.test(t) ? 6 : /rafaga/.test(t) ? 1 : 1.5);
    out.push({ do: 'fire', seconds: s });
  }

  // movimiento
  const s = seconds(t);
  if (/\b(corr\w*|sprint|esprinta|rapido)\b/.test(t) && !/\bfuego rapido\b/.test(t)) {
    out.push({ do: 'run', on: true });
    if (!/(atras|retroce|izquierda|derecha)/.test(t)) out.push({ do: 'move', dir: 'forward', seconds: s ?? undefined });
  } else if (/\b(despacio|lento|camina normal|ya no corras)\b/.test(t)) out.push({ do: 'run', on: false });
  if (/\b(atras|retroce\w*|recula|regresa\w*|reversa)\b/.test(t)) out.push({ do: 'move', dir: 'back', seconds: s ?? undefined });
  else if (/\b(izquierda)\b/.test(t)) out.push({ do: 'move', dir: 'left', seconds: s ?? SIDE_STEP });
  else if (/\b(derecha)\b/.test(t)) out.push({ do: 'move', dir: 'right', seconds: s ?? SIDE_STEP });
  else if (/\b(avanz\w*|adelante|camin\w*|muevete|sigue|ve|vamos|vete|hacia)\b/.test(t) && !out.some((a) => a.do === 'move')) {
    out.push({ do: 'move', dir: 'forward', seconds: s ?? undefined });
  }
  return out;
}

/** Frase completa → acciones (vacío si no se entendió). */
export function parseCommand(text) {
  const t = canonical(text);
  if (!t) return [];
  const clauses = t.split(/,|\by luego\b|\bluego\b|\bdespues\b|\by\b|\be\b/).map((c) => c.trim()).filter(Boolean);
  const actions = [];
  for (const c of clauses) actions.push(...parseClause(c));
  return actions;
}

/** Palabras que no aportan a la orden (para medir cuánto se entendió). */
const FILLER = new Set(['a', 'al', 'la', 'el', 'los', 'las', 'de', 'del', 'y', 'e', 'que', 'ya', 'por', 'favor', 'porfa', 'nova', 'robot', 'oye', 'hacia', 'un', 'una', 'poco', 'mas', 'muy', 'se', 'te', 'me', 'lo', 'le', 'en', 'con', 'ahora', 'ahi', 'aqui', 'eh', 'este', 'pues', 'bueno', 'vale', 'okay', 'ok']);

/**
 * Qué parte de la frase se entendió (0..1): si es baja y hay IA, se le pide a
 * la IA que la interprete aunque el intérprete local haya sacado algo.
 */
export function coverage(text) {
  const words = canonical(text).split(' ').filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w));
  if (!words.length) return 1;
  let hit = 0;
  // raíces de verbos de órdenes: «voltéate», «dóblale», «muévete»… forman parte de frases que sí se entienden
  const STEMS = /^(gir|volt|dobl|rot|tuerc|dispar|corr|camin|avanz|retroc|regres|salt|brinc|recarg|golpe|mir|tir|mat|atac|activ|abord|interact|sub|usa|muev|vete|sigue|segundo|grado|ves|veces|todo|sin|parar|lado|izquierd|derech)/;
  for (const w of words) if (parseClause(w).length || KNOWN.has(w) || STEMS.test(w)) hit++;
  return hit / words.length;
}

/** Órdenes de una sola palabra seguras de ejecutar con el resultado provisional. */
export function quickCommand(text) {
  const t = normalize(text);
  return /^(alto|detente|quieto|stop|salta|brinca|recarga)$/.test(t) ? parseCommand(t) : [];
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
        game.autoAim?.request(this.fire + 0.3);
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
      game.autoAim?.request();
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
