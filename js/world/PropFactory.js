/**
 * PropFactory — construye por procedimiento los modelos 3D de utilería.
 *
 * Este mismo módulo se usa de dos formas:
 *   1. tools/build-props.mjs lo ejecuta en Node y exporta todo a
 *      assets/models/props.glb con GLTFExporter.
 *   2. En el navegador, AssetLibrary carga props.glb con GLTFLoader; solo si
 *      el archivo no pudiera cargarse, recurre a estas funciones como respaldo.
 *
 * Cada constructor devuelve un THREE.Group con un nombre único que luego se
 * busca dentro del GLB (SilverCore, Battery, Drone, MineCart, Beacon, Lantern,
 * Lever, Tent).
 */
import * as THREE from 'three';

const mat = (name, params) => {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1, ...params });
  m.name = name;
  return m;
};

const MATERIALS = () => ({
  silver: mat('Silver', { color: 0xe8eef5, metalness: 0.95, roughness: 0.18, emissive: 0x7fc8ff, emissiveIntensity: 0.55 }),
  silverDark: mat('SilverDark', { color: 0x9fb3c8, metalness: 0.9, roughness: 0.3, emissive: 0x3a6f9a, emissiveIntensity: 0.35 }),
  glowCyan: mat('GlowCyan', { color: 0xbff4ff, emissive: 0x6fe3ff, emissiveIntensity: 2.4, roughness: 0.2 }),
  steel: mat('Steel', { color: 0x5b6470, metalness: 0.85, roughness: 0.38 }),
  steelDark: mat('SteelDark', { color: 0x2b3038, metalness: 0.8, roughness: 0.45 }),
  rust: mat('RustMetal', { color: 0x8a5a3a, metalness: 0.55, roughness: 0.7 }),
  green: mat('GlowGreen', { color: 0x7dffb0, emissive: 0x2cff8a, emissiveIntensity: 2.0, roughness: 0.3 }),
  red: mat('GlowRed', { color: 0xff6a5a, emissive: 0xff2a1a, emissiveIntensity: 2.6, roughness: 0.3 }),
  amber: mat('GlowAmber', { color: 0xffd08a, emissive: 0xffa640, emissiveIntensity: 2.2, roughness: 0.4 }),
  wood: mat('WoodDark', { color: 0x6b4a2e, roughness: 0.85 }),
  canvas: mat('Canvas', { color: 0xc9b48a, roughness: 0.95, side: THREE.DoubleSide }),
  ore: mat('Ore', { color: 0xa9b4bd, metalness: 0.7, roughness: 0.35, emissive: 0x2a4a66, emissiveIntensity: 0.3 }),
  black: mat('Rubber', { color: 0x1b1d20, roughness: 0.9 }),
});

function crystal(height, radius, material) {
  const g = new THREE.OctahedronGeometry(1, 0);
  g.scale(radius, height * 0.5, radius);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}

export function buildSilverCore(M = MATERIALS()) {
  const root = new THREE.Group();
  root.name = 'SilverCore';
  const main = crystal(0.9, 0.22, M.silver);
  main.name = 'CoreMain';
  root.add(main);
  const angles = [0, 1.7, 3.3, 4.8];
  angles.forEach((a, i) => {
    const c = crystal(0.45 + (i % 2) * 0.12, 0.1, M.silverDark);
    c.position.set(Math.cos(a) * 0.17, -0.18, Math.sin(a) * 0.17);
    c.rotation.z = Math.cos(a) * 0.6;
    c.rotation.x = -Math.sin(a) * 0.6;
    root.add(c);
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 8, 40), M.glowCyan);
  ring.name = 'CoreRing';
  ring.rotation.x = Math.PI / 2;
  root.add(ring);
  return root;
}

export function buildBattery(M = MATERIALS()) {
  const root = new THREE.Group();
  root.name = 'Battery';
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.46, 20), M.steelDark);
  body.castShadow = true;
  root.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.178, 0.178, 0.2, 20, 1, true), M.green);
  root.add(band);
  const capT = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 20), M.steel);
  capT.position.y = 0.25;
  root.add(capT);
  const capB = capT.clone();
  capB.position.y = -0.25;
  root.add(capB);
  const term = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 12), M.steel);
  term.position.y = 0.31;
  root.add(term);
  return root;
}

export function buildDrone(M = MATERIALS()) {
  const root = new THREE.Group();
  root.name = 'Drone';
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 16), M.steelDark);
  shell.castShadow = true;
  root.add(shell);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.045, 10, 36), M.red);
  belt.rotation.x = Math.PI / 2;
  belt.name = 'DroneBelt';
  root.add(belt);
  const eyeRim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.08, 20), M.steel);
  eyeRim.rotation.x = Math.PI / 2;
  eyeRim.position.z = 0.33;
  root.add(eyeRim);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), M.red);
  eye.position.z = 0.37;
  eye.name = 'DroneEye';
  root.add(eye);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.07), M.steel);
    arm.position.set(Math.cos(a) * 0.45, 0.12, Math.sin(a) * 0.45);
    arm.rotation.y = -a;
    root.add(arm);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.015, 18), M.black);
    rotor.position.set(Math.cos(a) * 0.68, 0.18, Math.sin(a) * 0.68);
    rotor.name = `Rotor${i}`;
    root.add(rotor);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 10), M.steel);
    hub.position.copy(rotor.position);
    root.add(hub);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 6), M.steel);
  antenna.position.set(0, 0.48, -0.08);
  root.add(antenna);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), M.red);
  tip.position.set(0, 0.66, -0.08);
  root.add(tip);
  return root;
}

export function buildMineCart(M = MATERIALS()) {
  const root = new THREE.Group();
  root.name = 'MineCart';
  const W = 1.0;
  const L = 1.5;
  const H = 0.7;
  const t = 0.06;
  const tub = new THREE.Group();
  tub.position.y = 0.42;
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, t, L - 0.1), M.rust);
  bottom.position.y = t / 2;
  tub.add(bottom);
  const sideGeo = new THREE.BoxGeometry(t, H, L);
  const endGeo = new THREE.BoxGeometry(W, H, t);
  const s1 = new THREE.Mesh(sideGeo, M.rust);
  s1.position.set(W / 2, H / 2, 0);
  s1.rotation.z = -0.12;
  const s2 = s1.clone();
  s2.position.x = -W / 2;
  s2.rotation.z = 0.12;
  const e1 = new THREE.Mesh(endGeo, M.rust);
  e1.position.set(0, H / 2, L / 2);
  e1.rotation.x = 0.12;
  const e2 = e1.clone();
  e2.position.z = -L / 2;
  e2.rotation.x = -0.12;
  [s1, s2, e1, e2].forEach((m) => { m.castShadow = true; m.receiveShadow = true; tub.add(m); });
  // bordes de refuerzo
  const rim = new THREE.Mesh(new THREE.BoxGeometry(W + 0.14, 0.06, 0.08), M.steel);
  rim.position.set(0, H, L / 2 + 0.05);
  tub.add(rim);
  const rim2 = rim.clone();
  rim2.position.z = -L / 2 - 0.05;
  tub.add(rim2);
  // mineral
  for (let i = 0; i < 7; i++) {
    const r = 0.16 + (i % 3) * 0.05;
    const ore = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), M.ore);
    ore.position.set(((i * 37) % 5) / 5 - 0.4, H - 0.12 + (i % 2) * 0.08, ((i * 53) % 7) / 7 - 0.45);
    ore.rotation.set(i, i * 2, i * 3);
    tub.add(ore);
  }
  root.add(tub);
  // chasis y ruedas
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.12, L * 0.9), M.steelDark);
  chassis.position.y = 0.36;
  root.add(chassis);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 18), M.steel);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx * 0.46, 0.2, sz * 0.48);
      wheel.castShadow = true;
      root.add(wheel);
      const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 18), M.steelDark);
      flange.rotation.z = Math.PI / 2;
      flange.position.set(sx * 0.4, 0.2, sz * 0.48);
      root.add(flange);
    }
  }
  return root;
}

export function buildBeacon(M = MATERIALS()) {
  const root = new THREE.Group();
  root.name = 'Beacon';
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.22, 8), M.steelDark);
  base.position.y = -0.55;
  base.castShadow = true;
  root.add(base);
  const coreMat = M.red;
  const core = crystal(0.8, 0.22, coreMat);
  core.name = 'BeaconCore';
  core.position.y = -0.02;
  root.add(core);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.1, 6), M.steel);
    rod.position.set(Math.cos(a) * 0.3, 0.0, Math.sin(a) * 0.3);
    rod.rotation.z = Math.cos(a) * 0.12;
    rod.rotation.x = -Math.sin(a) * 0.12;
    root.add(rod);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), coreMat);
    bulb.position.set(Math.cos(a) * 0.36, 0.56, Math.sin(a) * 0.36);
    root.add(bulb);
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.02, 6, 28), coreMat);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.2;
  halo.name = 'BeaconHalo';
  root.add(halo);
  return root;
}

export function buildLantern(M = MATERIALS()) {
  const root = new THREE.Group();
  root.name = 'Lantern';
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.2, 0.16), M.wood);
  post.position.y = 1.6;
  post.castShadow = true;
  root.add(post);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.1), M.wood);
  arm.position.set(0.4, 3.05, 0);
  root.add(arm);
  const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.34, 6, 1, true), M.steelDark);
  cage.position.set(0.78, 2.72, 0);
  root.add(cage);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), M.amber);
  bulb.position.set(0.78, 2.72, 0);
  bulb.name = 'LanternBulb';
  root.add(bulb);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.14, 6), M.steelDark);
  cap.position.set(0.78, 2.95, 0);
  root.add(cap);
  return root;
}

export function buildLever(M = MATERIALS()) {
  const root = new THREE.Group();
  root.name = 'Lever';
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.5), M.steelDark);
  base.position.y = 0.45;
  base.castShadow = true;
  root.add(base);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.02), M.amber);
  panel.position.set(0, 0.62, 0.26);
  panel.name = 'LeverPanel';
  root.add(panel);
  const pivot = new THREE.Group();
  pivot.name = 'Handle';
  pivot.position.set(0, 0.92, 0);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), M.steel);
  stick.position.y = 0.35;
  pivot.add(stick);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), M.red);
  knob.position.y = 0.72;
  knob.name = 'LeverKnob';
  pivot.add(knob);
  pivot.rotation.x = -0.6;
  root.add(pivot);
  return root;
}

export function buildTent(M = MATERIALS()) {
  const root = new THREE.Group();
  root.name = 'Tent';
  const shape = new THREE.Shape();
  shape.moveTo(-1.4, 0);
  shape.lineTo(0, 1.8);
  shape.lineTo(1.4, 0);
  shape.lineTo(-1.4, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.6, bevelEnabled: false });
  geo.translate(0, 0, -1.3);
  const cloth = new THREE.Mesh(geo, M.canvas);
  cloth.castShadow = true;
  cloth.receiveShadow = true;
  root.add(cloth);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.0, 6), M.wood);
  pole.rotation.x = Math.PI / 2;
  pole.position.y = 1.8;
  root.add(pole);
  return root;
}

export const PROP_BUILDERS = {
  SilverCore: buildSilverCore,
  Battery: buildBattery,
  Drone: buildDrone,
  MineCart: buildMineCart,
  Beacon: buildBeacon,
  Lantern: buildLantern,
  Lever: buildLever,
  Tent: buildTent,
};

/** Construye todos los props compartiendo materiales (útil para exportar). */
export function buildAllProps() {
  const M = MATERIALS();
  const scene = new THREE.Scene();
  scene.name = 'VetaAirosaProps';
  let x = 0;
  for (const [name, fn] of Object.entries(PROP_BUILDERS)) {
    const obj = fn(M);
    obj.name = name;
    obj.position.x = x; // separados solo para visualizarlos en un visor glTF
    x += 3;
    scene.add(obj);
  }
  return scene;
}
