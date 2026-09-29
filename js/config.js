/**
 * config.js — constantes globales, grupos de colisión y presets de dificultad.
 * Centralizar aquí los números "mágicos" facilita ajustar el balance del juego.
 */

export const GAME_TITLE = 'VETA AIROSA';
export const VERSION = '1.0.0';

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
  ORB: 1 << 3,
  BOLT: 1 << 4,
  DRONE: 1 << 5,
  PICKUP: 1 << 6,
  DEBRIS: 1 << 7,
};
export const groups = (membership, filter) => ((membership & 0xffff) << 16) | (filter & 0xffff);

export const COLLISION = {
  world: groups(G.WORLD, 0xffff),
  player: groups(G.PLAYER, G.WORLD | G.PROP | G.DRONE | G.BOLT | G.PICKUP),
  playerQuery: groups(G.PLAYER, G.WORLD | G.PROP | G.DRONE),
  prop: groups(G.PROP, G.WORLD | G.PLAYER | G.PROP | G.ORB | G.BOLT | G.DRONE | G.DEBRIS),
  orb: groups(G.ORB, G.WORLD | G.PROP | G.DRONE),
  bolt: groups(G.BOLT, G.WORLD | G.PROP | G.PLAYER),
  drone: groups(G.DRONE, G.WORLD | G.PLAYER | G.PROP | G.ORB),
  pickup: groups(G.PICKUP, G.PLAYER),
  debris: groups(G.DEBRIS, G.WORLD | G.PROP),
  cameraQuery: groups(0xffff, G.WORLD),
  aimQuery: groups(0xffff, G.WORLD | G.PROP | G.DRONE),
  spawnQuery: groups(0xffff, G.WORLD | G.PROP | G.PICKUP | G.DRONE),
};

/** Parámetros del personaje y la jugabilidad. */
export const PLAYER = {
  modelHeight: 1.8,
  capsuleHalfHeight: 0.55,
  capsuleRadius: 0.35,
  walkSpeed: 3.4,
  runSpeed: 6.8,
  airControl: 0.35,
  acceleration: 14,
  jumpSpeed: 6.4,
  maxBattery: 100,
  maxEnergy: 100,
  maxStamina: 100,
  staminaDrain: 14,
  staminaRegen: 18,
  energyRegen: 11,
  fallLimitY: -7,
  fallDamage: 20,
  invulnerableTime: 0.45,
  characterMass: 70,
};

export const COMBAT = {
  orbCost: 12,
  orbRadius: 0.2,
  orbMass: 3,
  orbMinSpeedFactor: 0.55,
  chargeTime: 0.9,
  orbLifetime: 6,
  orbBurstRadius: 2.4,
  orbBurstDeltaV: 7.5,
  punchRange: 1.6,
  punchRadius: 1.0,
  punchDeltaV: 9,
  punchCooldown: 0.55,
  pulseCost: 35,
  pulseRadius: 7.5,
  pulseDeltaV: 13,
  pulseCooldown: 6,
  barrelRadius: 7.5,
  barrelDeltaV: 16,
  barrelPlayerDamage: 38,
};

/** Presets de dificultad: cambian tiempo, núcleos, drones y daño. */
export const DIFFICULTIES = {
  explorador: {
    id: 'explorador',
    label: 'Explorador',
    time: 480,
    cores: 8,
    drones: 2,
    droneFireInterval: 3.4,
    droneRespawn: 40,
    damageMult: 0.6,
    interferenceDrain: 2.5,
    rockfallMult: 0.6,
  },
  minero: {
    id: 'minero',
    label: 'Minero',
    time: 390,
    cores: 10,
    drones: 4,
    droneFireInterval: 2.5,
    droneRespawn: 30,
    damageMult: 1.0,
    interferenceDrain: 4,
    rockfallMult: 1.0,
  },
  leyenda: {
    id: 'leyenda',
    label: 'Leyenda',
    time: 300,
    cores: 12,
    drones: 6,
    droneFireInterval: 1.8,
    droneRespawn: 22,
    damageMult: 1.4,
    interferenceDrain: 6,
    rockfallMult: 1.5,
  },
};

/** Frecuencia base (segundos entre derrumbes) según el ajuste del usuario. */
export const ROCKFALL_INTERVALS = { off: Infinity, low: 26, normal: 16, high: 9 };

export const SCORE = {
  core: 250,
  goldCore: 400,
  tower: 600,
  drone: 150,
  supplyCrate: 50,
  barrel: 25,
  batteryOverflow: 40,
  timeBonusPerSecond: 8,
  batteryBonusPerPoint: 4,
};

/** Rango final según el puntaje obtenido. */
export const RANKS = [
  { min: 9000, rank: 'S', label: 'Leyenda de la veta' },
  { min: 7000, rank: 'A', label: 'Capataz honorario' },
  { min: 5000, rank: 'B', label: 'Minero experto' },
  { min: 0, rank: 'C', label: 'Aprendiz de socavón' },
];

export const PHYSICS = {
  fixedStep: 1 / 60,
  maxSubSteps: 4,
  defaultGravity: 9.81,
};
