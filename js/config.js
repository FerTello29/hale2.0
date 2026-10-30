/**
 * config.js — constantes globales: grupos de colisión, armas, granadas,
 * dificultades y puntuación. Centralizar aquí los números facilita el balance.
 */

export const GAME_TITLE = 'ECO DE ORIÓN';
export const VERSION = '2.1.0';

/** Rutas de recursos (relativas a index.html, compatibles con GitHub Pages). */
export const PATHS = {
  robot: 'assets/models/RobotExpressive.glb',
  robotFallback: 'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
  props: 'assets/models/props.glb',
  textures: 'assets/textures/',
};

/**
 * Grupos de colisión de Rapier (16 bits de pertenencia + 16 bits de filtro).
 * Dos colliders interactúan si (A.pertenencia & B.filtro) y (B.pertenencia & A.filtro).
 */
export const G = {
  WORLD: 1 << 0,
  PLAYER: 1 << 1,
  PROP: 1 << 2,
  ORB: 1 << 3, // proyectiles del jugador (orbes, granadas)
  BOLT: 1 << 4, // proyectiles enemigos
  DRONE: 1 << 5, // enemigos voladores (cinemáticos)
  PICKUP: 1 << 6,
  DEBRIS: 1 << 7,
  ENEMY: 1 << 8, // enemigos terrestres (dinámicos)
  BOSS: 1 << 9,
};
export const groups = (membership, filter) => ((membership & 0xffff) << 16) | (filter & 0xffff);

const ALL_SOLID = G.WORLD | G.PROP | G.DRONE | G.ENEMY | G.BOSS;

export const COLLISION = {
  world: groups(G.WORLD, 0xffff),
  player: groups(G.PLAYER, G.WORLD | G.PROP | G.DRONE | G.BOLT | G.PICKUP | G.ENEMY | G.BOSS),
  playerQuery: groups(G.PLAYER, G.WORLD | G.PROP | G.DRONE | G.ENEMY | G.BOSS),
  prop: groups(G.PROP, G.WORLD | G.PLAYER | G.PROP | G.ORB | G.BOLT | G.DRONE | G.DEBRIS | G.ENEMY | G.BOSS),
  orb: groups(G.ORB, ALL_SOLID),
  bolt: groups(G.BOLT, G.WORLD | G.PROP | G.PLAYER),
  drone: groups(G.DRONE, G.WORLD | G.PLAYER | G.PROP | G.ORB),
  enemy: groups(G.ENEMY, G.WORLD | G.PLAYER | G.PROP | G.ORB | G.ENEMY | G.BOSS),
  boss: groups(G.BOSS, G.WORLD | G.PLAYER | G.PROP | G.ORB | G.ENEMY),
  pickup: groups(G.PICKUP, G.PLAYER),
  debris: groups(G.DEBRIS, G.WORLD | G.PROP),
  cameraQuery: groups(0xffff, G.WORLD),
  aimQuery: groups(0xffff, ALL_SOLID),
  bulletQuery: groups(0xffff, ALL_SOLID),
  enemySight: groups(0xffff, G.WORLD),
  spawnQuery: groups(0xffff, G.WORLD | G.PROP | G.PICKUP | G.DRONE | G.ENEMY | G.BOSS),
};

/** Parámetros del personaje. */
export const PLAYER = {
  modelHeight: 1.8,
  capsuleHalfHeight: 0.55,
  capsuleRadius: 0.35,
  walkSpeed: 3.6,
  runSpeed: 7.0,
  aimSpeedFactor: 0.62,
  airControl: 0.35,
  acceleration: 14,
  jumpSpeed: 6.6,
  maxHealth: 100,
  maxShield: 90,
  shieldDelay: 2.8,
  shieldRegen: 38,
  maxStamina: 100,
  staminaDrain: 14,
  staminaRegen: 18,
  fallLimitY: -9,
  fallDamage: 25,
  characterMass: 80,
};

/** Arsenal. Los valores de daño se multiplican por la dificultad solo para enemigos. */
export const WEAPONS = {
  rifle: {
    id: 'rifle', slot: 1, name: 'Rifle de pulsos RP-12', short: 'RIFLE', icon: 'rifle', prop: 'WeaponRifle',
    mode: 'auto', fireRate: 9.5, damage: 13, headMult: 1.8, pellets: 1, mag: 36, reserve: 216, maxReserve: 324,
    reload: 1.7, spread: 0.018, aimSpread: 0.005, range: 140, impulse: 2.4, recoil: 0.01, tracer: 0x7fe8ff, sound: 'rifle',
  },
  shotgun: {
    id: 'shotgun', slot: 2, name: 'Dispersor DS-4', short: 'DISPERSOR', icon: 'shotgun', prop: 'WeaponShotgun',
    mode: 'semi', fireRate: 1.3, damage: 11, headMult: 1.3, pellets: 10, mag: 6, reserve: 30, maxReserve: 48,
    reload: 2.3, spread: 0.08, aimSpread: 0.055, range: 38, impulse: 3.4, recoil: 0.055, tracer: 0xffc27a, sound: 'shotgun',
  },
  orb: {
    id: 'orb', slot: 3, name: 'Lanzaorbes LO-3', short: 'LANZAORBES', icon: 'orb', prop: 'WeaponOrb',
    mode: 'charge', fireRate: 1.5, damage: 95, radius: 4.2, mag: 5, reserve: 15, maxReserve: 25,
    reload: 2.1, chargeTime: 0.85, speed: 26, recoil: 0.04, sound: 'orbLaunch',
  },
  rail: {
    id: 'rail', slot: 4, name: 'Rifle de riel RR-1', short: 'RIEL', icon: 'rail', prop: 'WeaponRail',
    mode: 'semi', fireRate: 0.85, damage: 160, headMult: 2.0, pellets: 1, pierce: 4, mag: 4, reserve: 12, maxReserve: 20,
    reload: 2.6, spread: 0.03, aimSpread: 0.0, range: 260, impulse: 16, recoil: 0.09, tracer: 0xc49bff, sound: 'rail', scope: true,
  },
};
export const WEAPON_ORDER = ['rifle', 'shotgun', 'orb', 'rail'];

export const GRENADES = {
  frag: { id: 'frag', name: 'Fragmentación', max: 5, start: 3, fuse: 2.1, radius: 6.8, damage: 140, deltaV: 15, prop: 'FragGrenade' },
  gravity: { id: 'gravity', name: 'Singularidad', max: 3, start: 1, fuse: 1.0, radius: 11, duration: 2.8, pull: 22, damage: 110, prop: 'GravityGrenade' },
};

export const ABILITIES = {
  melee: { damage: 55, range: 1.8, cooldown: 0.75, deltaV: 10 },
  pulse: { damage: 30, radius: 7.5, cooldown: 9, deltaV: 13 },
};

/**
 * Presets de dificultad (v2.1: más accesibles que en v2.0). El director
 * táctico con IA puede suavizar aún más el daño y la puntería enemiga si el
 * jugador está en apuros, nunca endurecerlos por encima de estos valores.
 */
export const DIFFICULTIES = {
  recluta: { id: 'recluta', label: 'Recluta', enemyHp: 0.65, enemyDmg: 0.35, count: 0.65, bossHp: 0.6, accuracy: 0.55, pickups: 1.6 },
  veterano: { id: 'veterano', label: 'Veterano', enemyHp: 0.85, enemyDmg: 0.65, count: 0.85, bossHp: 0.8, accuracy: 0.8, pickups: 1.25 },
  leyenda: { id: 'leyenda', label: 'Leyenda', enemyHp: 1.1, enemyDmg: 1.1, count: 1.05, bossHp: 1.05, accuracy: 1.05, pickups: 0.95 },
};

export const SCORE = {
  espectro: 100,
  acechador: 60,
  centinela: 80,
  bastion: 250,
  headshot: 50,
  cell: 200,
  pylon: 500,
  boss: 2500,
  levelBonus: 1500,
  healthBonusPerPoint: 5,
  timeBonusMax: 3000,
};

export const PHYSICS = {
  fixedStep: 1 / 60,
  maxSubSteps: 4,
  defaultGravity: 9.81,
};

/**
 * Inteligencia artificial (OpenAI a través de las funciones de Vercel en /api).
 * La API key NUNCA está en el navegador: vive en las variables de entorno de
 * Vercel. Si el juego se abre desde otro dominio (p. ej. GitHub Pages), pon en
 * baseUrl la URL de tu despliegue de Vercel, p. ej. 'https://hale2-0.vercel.app'.
 * Sin servidor de IA, todo funciona igual con la lógica local.
 */
export const AI = {
  baseUrl: '',
  timeoutMs: 7000,
  tacticsInterval: 20,
};
