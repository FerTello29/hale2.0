/**
 * PropFactory — construye por procedimiento los modelos 3D de ECO DE ORIÓN.
 *
 * Este mismo módulo se usa de dos formas:
 *   1. tools/build-props.mjs lo ejecuta en Node y exporta todo a
 *      assets/models/props.glb con GLTFExporter.
 *   2. En el navegador, AssetLibrary carga props.glb con GLTFLoader; solo si
 *      el archivo no pudiera cargarse, recurre a estas funciones como respaldo.
 *
 * Convenciones: +Z = frente, +Y = arriba, metros. Los nodos con nombre
 * (Muzzle, Leg0, Knee0, Shield, Ramp…) se animan o consultan en tiempo real.
 * Los materiales con nombre (RuinStone, HullPanel…) se sustituyen en tiempo
 * de ejecución por versiones con textura.
 */
import * as THREE from 'three';

const mat = (name, params) => {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.2, ...params });
  m.name = name;
  return m;
};

export const MATERIALS = () => ({
  gunmetal: mat('Gunmetal', { color: 0x3a4048, metalness: 0.85, roughness: 0.35 }),
  gunDark: mat('GunDark', { color: 0x1c2026, metalness: 0.8, roughness: 0.45 }),
  steel: mat('Steel', { color: 0x8b949e, metalness: 0.85, roughness: 0.3 }),
  armor: mat('ArmorMain', { color: 0x7d8792, metalness: 0.6, roughness: 0.38 }),
  armorDark: mat('ArmorDark', { color: 0x2a3038, metalness: 0.6, roughness: 0.45 }),
  armorGlow: mat('ArmorGlow', { color: 0x9ffcff, emissive: 0x2fe6ff, emissiveIntensity: 2.6, roughness: 0.2 }),
  visor: mat('ArmorVisor', { color: 0x0b2e36, emissive: 0x2fe6ff, emissiveIntensity: 1.2, metalness: 0.9, roughness: 0.08 }),
  hull: mat('HullPanel', { color: 0xa9b0b8, metalness: 0.55, roughness: 0.45 }),
  hullDark: mat('HullDark', { color: 0x3a3f46, metalness: 0.6, roughness: 0.5 }),
  orange: mat('SafetyOrange', { color: 0xe8801f, metalness: 0.2, roughness: 0.5 }),
  olive: mat('Olive', { color: 0x4d5a3c, metalness: 0.25, roughness: 0.7 }),
  white: mat('WhitePlastic', { color: 0xe6ebee, metalness: 0.1, roughness: 0.45 }),
  brass: mat('Brass', { color: 0xc9a24a, metalness: 0.9, roughness: 0.3 }),
  cyan: mat('GlowCyan', { color: 0xbff9ff, emissive: 0x3fe8ff, emissiveIntensity: 2.8, roughness: 0.2 }),
  teal: mat('GlowTeal', { color: 0x9dffe0, emissive: 0x19ffb0, emissiveIntensity: 2.4, roughness: 0.25 }),
  magenta: mat('GlowMagenta', { color: 0xffb3f0, emissive: 0xff2bd6, emissiveIntensity: 3.0, roughness: 0.25 }),
  violet: mat('GlowViolet', { color: 0xd7b8ff, emissive: 0x8a3dff, emissiveIntensity: 2.6, roughness: 0.25 }),
  amber: mat('GlowAmber', { color: 0xffe0a0, emissive: 0xffa21a, emissiveIntensity: 3.0, roughness: 0.3 }),
  red: mat('GlowRed', { color: 0xff9b90, emissive: 0xff2a1a, emissiveIntensity: 3.0, roughness: 0.3 }),
  obsidian: mat('Obsidian', { color: 0x16141d, metalness: 0.75, roughness: 0.28 }),
  chitin: mat('Chitin', { color: 0x231b2e, metalness: 0.5, roughness: 0.35 }),
  crystal: mat('Crystal', { color: 0xd6c2ff, emissive: 0x7a2cff, emissiveIntensity: 1.2, metalness: 0.3, roughness: 0.15, flatShading: true }),
  crystalHot: mat('CrystalHot', { color: 0xffd0f4, emissive: 0xff38c8, emissiveIntensity: 2.2, metalness: 0.2, roughness: 0.1, flatShading: true }),
  shield: mat('EnergyShield', { color: 0x9ef3ff, emissive: 0x2fb8ff, emissiveIntensity: 1.6, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  ruin: mat('RuinStone', { color: 0x5b5668, roughness: 0.9, metalness: 0.05 }),
  rubber: mat('Rubber', { color: 0x15171a, roughness: 0.9, metalness: 0 }),
  glass: mat('CockpitGlass', { color: 0x4fd8ff, emissive: 0x0c5a78, emissiveIntensity: 1.2, metalness: 0.9, roughness: 0.05 }),
});

const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cyl = (rt, rb, h, m, seg = 16) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
const sph = (r, m, ws = 16, hs = 12) => new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m);
const group = (name) => {
  const g = new THREE.Group();
  if (name) g.name = name;
  return g;
};
const at = (obj, x, y, z, rx = 0, ry = 0, rz = 0) => {
  obj.position.set(x, y, z);
  obj.rotation.set(rx, ry, rz);
  return obj;
};
const crystal = (h, r, m, detail = 0) => {
  const g = new THREE.OctahedronGeometry(1, detail);
  g.scale(r, h * 0.5, r);
  return new THREE.Mesh(g, m);
};
/** Cilindro orientado a lo largo de +Z (cañones). */
const barrel = (r, len, m, seg = 14) => {
  const mesh = cyl(r, r, len, m, seg);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
};
const muzzle = (z) => {
  const g = group('Muzzle');
  g.position.set(0, 0, z);
  return g;
};

// ======================================================================= ARMAS
export function buildRifle(M) {
  const root = group('WeaponRifle');
  root.add(at(box(0.09, 0.13, 0.62, M.gunmetal), 0, 0.02, 0.18));
  root.add(at(box(0.07, 0.05, 0.5, M.gunDark), 0, 0.105, 0.2));
  root.add(at(barrel(0.028, 0.34, M.gunDark), 0, 0.03, 0.62));
  root.add(at(box(0.05, 0.14, 0.07, M.gunDark), 0, -0.1, 0.02, 0.25));
  root.add(at(box(0.06, 0.16, 0.08, M.gunmetal), 0, -0.11, 0.3, -0.12));
  root.add(at(box(0.075, 0.1, 0.2, M.gunDark), 0, 0, -0.18));
  root.add(at(box(0.095, 0.02, 0.32, M.cyan), 0.047, 0.03, 0.2));
  root.add(at(box(0.05, 0.06, 0.12, M.steel), 0, 0.16, 0.12));
  root.add(at(box(0.03, 0.03, 0.03, M.cyan), 0, 0.2, 0.12));
  root.add(muzzle(0.8));
  return root;
}

export function buildShotgun(M) {
  const root = group('WeaponShotgun');
  root.add(at(box(0.12, 0.14, 0.5, M.gunmetal), 0, 0.02, 0.12));
  root.add(at(barrel(0.035, 0.55, M.gunDark), -0.03, 0.05, 0.5));
  root.add(at(barrel(0.035, 0.55, M.gunDark), 0.03, 0.05, 0.5));
  root.add(at(box(0.13, 0.06, 0.26, M.olive), 0, -0.04, 0.46));
  root.add(at(box(0.06, 0.15, 0.08, M.gunDark), 0, -0.1, 0.0, 0.25));
  root.add(at(box(0.09, 0.12, 0.2, M.gunDark), 0, -0.01, -0.2));
  root.add(at(box(0.125, 0.03, 0.12, M.orange), 0, 0.1, 0.1));
  root.add(muzzle(0.78));
  return root;
}

export function buildOrbLauncher(M) {
  const root = group('WeaponOrb');
  root.add(at(box(0.16, 0.16, 0.44, M.gunmetal), 0, 0.02, 0.1));
  const coil = group();
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 20), i % 2 ? M.cyan : M.steel);
    ring.position.set(0, 0.03, 0.34 + i * 0.08);
    coil.add(ring);
  }
  root.add(coil);
  root.add(at(barrel(0.075, 0.36, M.gunDark), 0, 0.03, 0.46));
  const core = sph(0.07, M.cyan);
  core.position.set(0, 0.13, 0.04);
  core.name = 'OrbCore';
  root.add(core);
  root.add(at(box(0.06, 0.15, 0.08, M.gunDark), 0, -0.1, 0.0, 0.25));
  root.add(muzzle(0.66));
  return root;
}

export function buildRail(M) {
  const root = group('WeaponRail');
  root.add(at(box(0.1, 0.12, 0.8, M.gunmetal), 0, 0.02, 0.28));
  root.add(at(box(0.03, 0.14, 0.72, M.gunDark), -0.055, 0.03, 0.62));
  root.add(at(box(0.03, 0.14, 0.72, M.gunDark), 0.055, 0.03, 0.62));
  root.add(at(box(0.075, 0.02, 0.68, M.violet), 0, 0.03, 0.62));
  root.add(at(barrel(0.045, 0.24, M.steel), 0, 0.17, 0.2));
  root.add(at(sph(0.03, M.violet), 0, 0.17, 0.33));
  root.add(at(box(0.06, 0.15, 0.08, M.gunDark), 0, -0.1, 0.0, 0.25));
  root.add(at(box(0.08, 0.12, 0.26, M.gunDark), 0, -0.01, -0.22));
  root.add(muzzle(1.0));
  return root;
}

export function buildPlasmaCaster(M) {
  const root = group('WeaponCaster');
  root.add(at(box(0.11, 0.12, 0.4, M.obsidian), 0, 0.0, 0.12));
  root.add(at(crystal(0.24, 0.06, M.magenta), 0, 0.1, 0.1, Math.PI / 2));
  root.add(at(barrel(0.04, 0.2, M.chitin), 0, 0.0, 0.4));
  root.add(at(box(0.12, 0.02, 0.3, M.magenta), 0, -0.07, 0.14));
  root.add(muzzle(0.52));
  return root;
}

// ======================================================================= GRANADAS
export function buildFragGrenade(M) {
  const root = group('FragGrenade');
  root.add(sph(0.11, M.olive, 14, 10));
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.016, 6, 18), M.gunDark);
  band.rotation.x = Math.PI / 2;
  root.add(band);
  root.add(at(cyl(0.035, 0.035, 0.06, M.steel), 0, 0.12, 0));
  root.add(at(sph(0.02, M.amber), 0, 0.155, 0));
  return root;
}

export function buildGravityGrenade(M) {
  const root = group('GravityGrenade');
  root.add(sph(0.11, M.gunDark, 14, 10));
  for (const r of [0, Math.PI / 2]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.014, 6, 22), M.violet);
    ring.rotation.set(Math.PI / 2, r, 0);
    root.add(ring);
  }
  root.add(at(sph(0.045, M.violet), 0, 0, 0));
  return root;
}

// ======================================================================= PICKUPS
export function buildEnergyCell(M) {
  const root = group('EnergyCell');
  const core = cyl(0.16, 0.16, 0.5, M.cyan, 6);
  core.name = 'CellCore';
  core.position.y = 0.35;
  root.add(core);
  root.add(at(cyl(0.2, 0.22, 0.08, M.gunmetal, 6), 0, 0.08, 0));
  root.add(at(cyl(0.2, 0.2, 0.08, M.gunmetal, 6), 0, 0.64, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    root.add(at(box(0.04, 0.56, 0.04, M.steel), Math.cos(a) * 0.2, 0.36, Math.sin(a) * 0.2));
  }
  root.add(at(cyl(0.05, 0.05, 0.08, M.orange), 0, 0.72, 0));
  return root;
}

export function buildMedKit(M) {
  const root = group('MedKit');
  root.add(at(box(0.5, 0.28, 0.34, M.white), 0, 0.14, 0));
  root.add(at(box(0.3, 0.07, 0.345, M.teal), 0, 0.14, 0));
  root.add(at(box(0.07, 0.24, 0.345, M.teal), 0, 0.14, 0));
  root.add(at(box(0.2, 0.04, 0.05, M.gunDark), 0, 0.31, 0));
  return root;
}

export function buildAmmoBox(M) {
  const root = group('AmmoBox');
  root.add(at(box(0.52, 0.26, 0.3, M.olive), 0, 0.13, 0));
  root.add(at(box(0.54, 0.05, 0.32, M.gunDark), 0, 0.27, 0));
  for (let i = 0; i < 5; i++) {
    root.add(at(cyl(0.025, 0.025, 0.16, M.brass, 8), -0.16 + i * 0.08, 0.36, 0.04));
    root.add(at(cyl(0.012, 0.025, 0.04, M.gunDark, 8), -0.16 + i * 0.08, 0.46, 0.04));
  }
  root.add(at(box(0.3, 0.06, 0.005, M.amber), 0, 0.13, 0.152));
  return root;
}

export function buildGrenadePack(M) {
  const root = group('GrenadePack');
  root.add(at(box(0.44, 0.1, 0.3, M.gunDark), 0, 0.05, 0));
  const f = buildFragGrenade(M);
  f.position.set(-0.1, 0.2, 0);
  root.add(f);
  const g = buildGravityGrenade(M);
  g.position.set(0.12, 0.2, 0);
  root.add(g);
  return root;
}

// ======================================================================= ARMADURA
export function buildArmorSet(M) {
  const root = group('ArmorSet');
  // Visor (se coloca en el hueso de la cabeza); centrado hacia +Z
  const visor = group('ArmorVisor');
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.625, 28, 8, Math.PI * 0.16, Math.PI * 0.68, Math.PI * 0.4, Math.PI * 0.13), M.visor);
  visor.add(shell);
  const band = new THREE.Mesh(new THREE.SphereGeometry(0.632, 28, 4, Math.PI * 0.1, Math.PI * 0.8, Math.PI * 0.35, Math.PI * 0.05), M.armorDark);
  const band2 = new THREE.Mesh(new THREE.SphereGeometry(0.632, 28, 4, Math.PI * 0.1, Math.PI * 0.8, Math.PI * 0.53, Math.PI * 0.035), M.armorGlow);
  visor.add(band2);
  visor.add(band);
  const ant = cyl(0.015, 0.02, 0.5, M.steel, 6);
  ant.position.set(0.45, 0.45, -0.25);
  visor.add(ant);
  const antTip = sph(0.035, M.armorGlow, 8, 6);
  antTip.position.set(0.45, 0.72, -0.25);
  visor.add(antTip);
  root.add(visor);
  // Hombreras
  for (const side of ['L', 'R']) {
    const pad = group(`ArmorShoulder${side}`);
    const shellPad = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), M.armor);
    shellPad.scale.set(1, 0.7, 1.15);
    pad.add(shellPad);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 20, Math.PI), M.armorGlow);
    stripe.rotation.set(0, Math.PI / 2, 0);
    stripe.position.y = 0.02;
    pad.add(stripe);
    root.add(pad);
  }
  // Peto
  const chest = group('ArmorChest');
  const plate = box(0.9, 0.55, 0.22, M.armor);
  chest.add(plate);
  chest.add(at(box(0.5, 0.08, 0.24, M.armorGlow), 0, 0.05, 0.02));
  chest.add(at(box(0.92, 0.1, 0.24, M.armorDark), 0, -0.26, 0));
  root.add(chest);
  // Mochila con propulsores
  const pack = group('ArmorPack');
  pack.add(box(0.7, 0.8, 0.3, M.armorDark));
  for (const sx of [-0.2, 0.2]) {
    pack.add(at(cyl(0.1, 0.12, 0.5, M.gunmetal, 10), sx, -0.2, -0.14));
    pack.add(at(cyl(0.07, 0.07, 0.04, M.armorGlow, 10), sx, -0.47, -0.14));
  }
  pack.add(at(box(0.4, 0.06, 0.02, M.armorGlow), 0, 0.2, -0.16));
  root.add(pack);
  return root;
}

// ======================================================================= ENEMIGOS
/** Criatura de cristal de seis patas (Acechador y, escalada, la Matriarca). */
export function buildCrawler(M, { spikes = 5, sac = false } = {}) {
  const root = group(sac ? 'Matriarch' : 'Crawler');
  const body = group('Body');
  body.position.y = 0.55;
  const abdomen = sph(0.42, M.chitin, 16, 12);
  abdomen.scale.set(0.9, 0.7, 1.25);
  abdomen.position.z = -0.45;
  body.add(abdomen);
  const thorax = sph(0.3, M.chitin, 14, 10);
  thorax.scale.set(1, 0.75, 1.1);
  thorax.position.z = 0.08;
  body.add(thorax);
  const head = group('Head');
  head.position.set(0, 0.02, 0.42);
  const skull = sph(0.2, M.obsidian, 14, 10);
  skull.scale.set(1, 0.8, 1.25);
  head.add(skull);
  for (const sx of [-1, 1]) {
    const eye = sph(0.045, M.magenta, 8, 6);
    eye.position.set(sx * 0.1, 0.07, 0.17);
    head.add(eye);
    const mand = crystal(0.26, 0.04, M.crystal);
    mand.position.set(sx * 0.1, -0.08, 0.26);
    mand.rotation.set(Math.PI / 2 - 0.3, 0, sx * 0.4);
    head.add(mand);
  }
  body.add(head);
  for (let i = 0; i < spikes; i++) {
    const t = i / Math.max(1, spikes - 1);
    const sp = crystal(0.45 - Math.abs(t - 0.5) * 0.3, 0.07, M.crystal);
    sp.position.set((i % 2 ? 0.12 : -0.12), 0.28 + (0.5 - Math.abs(t - 0.5)) * 0.1, -0.75 + t * 0.8);
    sp.rotation.set(-0.35, 0, i % 2 ? -0.3 : 0.3);
    body.add(sp);
  }
  if (sac) {
    const s = sph(0.22, M.crystalHot, 16, 12);
    s.name = 'Sac';
    s.position.set(0, 0.2, -0.62);
    body.add(s);
  }
  root.add(body);
  // patas: Leg{i} (cadera) → Knee{i} (rodilla)
  const zs = [0.22, -0.05, -0.32];
  let idx = 0;
  for (const side of [-1, 1]) {
    for (const z of zs) {
      const leg = group(`Leg${idx}`);
      leg.position.set(side * 0.24, 0.58, z);
      leg.rotation.y = side * (Math.PI / 2) - side * z * 0.8;
      const upper = cyl(0.045, 0.06, 0.55, M.chitin, 8);
      upper.rotation.z = Math.PI / 2;
      upper.position.x = 0.27;
      const pivot = group(`Hip${idx}`);
      pivot.rotation.z = 0.55;
      pivot.add(upper);
      const knee = group(`Knee${idx}`);
      knee.position.x = 0.55;
      knee.rotation.z = -1.6;
      const lower = crystal(0.7, 0.05, M.crystal);
      lower.rotation.z = Math.PI / 2;
      lower.position.x = 0.33;
      knee.add(lower);
      pivot.add(knee);
      leg.add(pivot);
      root.add(leg);
      idx++;
    }
  }
  return root;
}

export function buildSentinel(M) {
  const root = group('Sentinel');
  const core = crystal(0.9, 0.34, M.crystal, 0);
  core.name = 'SentinelCore';
  root.add(core);
  const eye = sph(0.12, M.magenta, 12, 8);
  eye.position.z = 0.26;
  eye.name = 'SentinelEye';
  root.add(eye);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const fin = crystal(0.7, 0.07, M.obsidian);
    fin.position.set(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45);
    fin.rotation.set(0, -a, Math.PI / 2.4);
    fin.name = `Fin${i}`;
    root.add(fin);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.03, 6, 30), M.violet);
  ring.rotation.x = Math.PI / 2;
  ring.name = 'SentinelRing';
  root.add(ring);
  return root;
}

export function buildBastion(M) {
  const root = group('Bastion');
  const core = crystal(1.6, 0.6, M.obsidian, 0);
  core.position.y = 0.2;
  root.add(core);
  const heart = crystal(0.7, 0.26, M.crystalHot, 0);
  heart.name = 'BastionCore';
  heart.position.set(0, 0.25, 0.35);
  root.add(heart);
  for (const sx of [-1, 1]) {
    const plate = box(0.18, 1.3, 0.9, M.chitin);
    plate.position.set(sx * 0.62, 0.25, 0);
    plate.rotation.z = sx * 0.2;
    root.add(plate);
    const cannon = group(`Cannon${sx < 0 ? 'L' : 'R'}`);
    cannon.position.set(sx * 0.95, 0.35, 0.1);
    cannon.add(barrel(0.12, 0.7, M.obsidian, 10));
    const glow = sph(0.09, M.magenta, 10, 8);
    glow.position.z = 0.38;
    cannon.add(glow);
    root.add(cannon);
  }
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 24, 1, true, -0.75, 1.5), M.shield);
  shield.name = 'BastionShield';
  shield.position.set(0, 0.2, -0.5);
  root.add(shield);
  const base = crystal(0.9, 0.35, M.crystal);
  base.position.y = -0.85;
  base.rotation.x = Math.PI;
  root.add(base);
  return root;
}

export function buildEcoCore(M) {
  const root = group('EcoCore');
  const outer = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 0), M.crystal);
  outer.name = 'EcoShell';
  root.add(outer);
  const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 1), M.crystalHot);
  inner.name = 'EcoInner';
  root.add(inner);
  const eye = sph(0.7, M.magenta, 20, 14);
  eye.name = 'EcoEye';
  eye.position.z = 1.1;
  root.add(eye);
  const shards = group('EcoShards');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = crystal(1.8, 0.28, M.crystal);
    s.position.set(Math.cos(a) * 4.6, Math.sin(i * 1.7) * 0.8, Math.sin(a) * 4.6);
    s.rotation.set(0.3, -a, 0.2);
    shards.add(s);
  }
  root.add(shards);
  const spine = crystal(3.4, 0.35, M.obsidian);
  spine.position.y = -3.4;
  root.add(spine);
  return root;
}

// ======================================================================= ESCENARIO
export function buildDropship(M) {
  const root = group('Dropship');
  const hull = group('Hull');
  hull.add(at(box(3.2, 2.2, 8.5, M.hull), 0, 2.2, 0));
  hull.add(at(box(2.6, 1.6, 3.0, M.hull), 0, 2.4, 5.2, 0.12));
  hull.add(at(box(2.0, 0.9, 1.6, M.glass), 0, 2.95, 6.2, 0.35));
  hull.add(at(box(3.24, 0.3, 8.6, M.orange), 0, 3.0, 0));
  hull.add(at(box(3.3, 0.6, 7.6, M.hullDark), 0, 1.2, -0.3));
  // alas y motores
  for (const sx of [-1, 1]) {
    hull.add(at(box(4.4, 0.25, 2.6, M.hull), sx * 3.6, 2.6, -1.0, 0, 0, sx * -0.08));
    for (const z of [0.2, -2.2]) {
      const eng = group(`Engine${sx < 0 ? 'L' : 'R'}${z > 0 ? 'F' : 'B'}`);
      eng.position.set(sx * 4.9, 2.45, z);
      eng.add(cyl(0.55, 0.65, 1.4, M.hullDark, 14));
      const glow = cyl(0.42, 0.42, 0.08, M.cyan, 14);
      glow.position.y = -0.72;
      glow.name = 'EngineGlow';
      eng.add(glow);
      hull.add(eng);
    }
  }
  hull.add(at(box(0.25, 1.6, 2.0, M.hullDark), 0, 3.9, -3.4));
  root.add(hull);
  // rampa trasera (bisagra en la parte baja de la popa)
  const pivot = group('RampPivot');
  pivot.position.set(0, 1.05, -4.25);
  const ramp = box(2.4, 0.18, 3.2, M.hullDark);
  ramp.position.set(0, 0, -1.6);
  ramp.name = 'Ramp';
  pivot.add(ramp);
  pivot.add(at(box(2.2, 0.02, 2.8, M.orange), 0, 0.1, -1.6));
  pivot.rotation.x = 0.0;
  root.add(pivot);
  // patas de aterrizaje
  for (const [x, z] of [[-1.3, 3], [1.3, 3], [-1.3, -3], [1.3, -3]]) {
    root.add(at(cyl(0.12, 0.12, 1.2, M.steel, 8), x, 0.6, z));
    root.add(at(box(0.5, 0.1, 0.7, M.gunDark), x, 0.05, z));
  }
  return root;
}

export function buildBeacon(M) {
  const root = group('RescueBeacon');
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = cyl(0.05, 0.07, 1.8, M.steel, 8);
    leg.position.set(Math.cos(a) * 0.55, 0.8, Math.sin(a) * 0.55);
    leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    root.add(leg);
  }
  root.add(at(box(0.6, 0.5, 0.6, M.hullDark), 0, 1.6, 0));
  root.add(at(box(0.62, 0.12, 0.62, M.orange), 0, 1.75, 0));
  root.add(at(cyl(0.04, 0.04, 1.6, M.steel, 8), 0, 2.6, 0));
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.35), M.hull);
  dish.position.set(0, 2.2, 0.2);
  dish.rotation.x = -1.1;
  root.add(dish);
  const light = sph(0.12, M.red, 12, 8);
  light.name = 'BeaconLight';
  light.position.y = 3.45;
  root.add(light);
  const panel = box(0.4, 0.3, 0.02, M.amber);
  panel.name = 'BeaconPanel';
  panel.position.set(0, 1.6, 0.31);
  root.add(panel);
  return root;
}

export function buildTempleGate(M) {
  const root = group('TempleGate');
  root.add(at(box(2.2, 11, 3.2, M.ruin), -6.4, 5.5, 0));
  root.add(at(box(2.2, 11, 3.2, M.ruin), 6.4, 5.5, 0));
  root.add(at(box(15, 2.4, 3.6, M.ruin), 0, 11.8, 0));
  root.add(at(crystal(3.2, 0.9, M.crystalHot), 0, 14.2, 0.3));
  for (const [x, name] of [[-2.65, 'DoorL'], [2.65, 'DoorR']]) {
    const door = group(name);
    door.position.set(x, 5.25, 0);
    door.add(box(5.3, 10.5, 0.9, M.obsidian));
    const seam = box(0.2, 10.5, 0.95, M.violet);
    seam.position.x = x < 0 ? 2.55 : -2.55;
    door.add(seam);
    for (let k = 0; k < 4; k++) {
      const g = box(3.4, 0.14, 0.95, M.violet);
      g.position.set(0, -3.6 + k * 2.4, 0);
      door.add(g);
    }
    root.add(door);
  }
  return root;
}

export function buildPylonCrystal(M) {
  const root = group('PylonCrystal');
  root.add(at(cyl(0.45, 0.55, 0.3, M.obsidian, 8), 0, -0.55, 0));
  const c = crystal(1.3, 0.35, M.crystalHot);
  c.name = 'PylonCore';
  root.add(c);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const s = crystal(0.7, 0.1, M.crystal);
    s.position.set(Math.cos(a) * 0.35, -0.2, Math.sin(a) * 0.35);
    s.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
    root.add(s);
  }
  return root;
}

export function buildLumenPost(M) {
  const root = group('LumenPost');
  root.add(at(cyl(0.12, 0.18, 2.6, M.obsidian, 6), 0, 1.3, 0));
  const c = crystal(0.7, 0.18, M.teal);
  c.name = 'LumenCrystal';
  c.position.y = 2.95;
  root.add(c);
  return root;
}

export const PROP_BUILDERS = {
  WeaponRifle: buildRifle,
  WeaponShotgun: buildShotgun,
  WeaponOrb: buildOrbLauncher,
  WeaponRail: buildRail,
  WeaponCaster: buildPlasmaCaster,
  FragGrenade: buildFragGrenade,
  GravityGrenade: buildGravityGrenade,
  EnergyCell: buildEnergyCell,
  MedKit: buildMedKit,
  AmmoBox: buildAmmoBox,
  GrenadePack: buildGrenadePack,
  ArmorSet: buildArmorSet,
  Crawler: (M) => buildCrawler(M),
  Matriarch: (M) => buildCrawler(M, { spikes: 9, sac: true }),
  Sentinel: buildSentinel,
  Bastion: buildBastion,
  EcoCore: buildEcoCore,
  Dropship: buildDropship,
  RescueBeacon: buildBeacon,
  TempleGate: buildTempleGate,
  PylonCrystal: buildPylonCrystal,
  LumenPost: buildLumenPost,
};

/** Construye todos los props compartiendo materiales (útil para exportar). */
export function buildAllProps() {
  const M = MATERIALS();
  const scene = new THREE.Scene();
  scene.name = 'EcoDeOrionProps';
  let x = 0;
  for (const [name, fn] of Object.entries(PROP_BUILDERS)) {
    const obj = fn(M);
    obj.name = name;
    obj.position.x = x; // separados solo para verlos en un visor glTF
    x += 6;
    scene.add(obj);
  }
  return scene;
}
