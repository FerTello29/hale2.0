/**
 * AssetLibrary — carga de modelos GLB (GLTFLoader), texturas y creación de
 * materiales compartidos. Informa el progreso a la pantalla de carga.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PATHS } from '../config.js';
import { PROP_BUILDERS } from '../world/PropFactory.js';

const TEXTURES = {
  groundAlbedo: 'jungle_ground_albedo.jpg',
  groundNormal: 'jungle_ground_normal.jpg',
  rockAlbedo: 'alien_rock_albedo.jpg',
  rockNormal: 'alien_rock_normal.jpg',
  rockVeins: 'alien_rock_veins.png',
  ruinAlbedo: 'ruin_stone_albedo.jpg',
  ruinNormal: 'ruin_stone_normal.jpg',
  ruinGlyphs: 'ruin_glyphs.png',
  barkAlbedo: 'bark_albedo.jpg',
  barkNormal: 'bark_normal.jpg',
  metalAlbedo: 'metal_panel_albedo.jpg',
  metalNormal: 'metal_panel_normal.jpg',
  crateAlbedo: 'crate_military_albedo.jpg',
  crateNormal: 'crate_military_normal.jpg',
  canisterAlbedo: 'canister_albedo.jpg',
  fern: 'fern.png',
  grass: 'grass.png',
};

/** Factor de brillo por material emisivo del GLB. */
const GLOW_SCALE = { GlowCyan: 0.6, GlowTeal: 0.65, GlowMagenta: 0.7, GlowViolet: 0.7, GlowAmber: 0.65, GlowRed: 0.7, ArmorGlow: 0.7 };

export class AssetLibrary {
  constructor(renderer) {
    this.renderer = renderer;
    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();
    this.textures = {};
    this.materials = {};
    this.robot = null; // { scene, animations }
    this.props = {}; // nombre -> THREE.Object3D plantilla
    this.propsSource = 'glb';
    this.warnings = [];
  }

  async load(onProgress = () => {}) {
    const jobs = [];
    let done = 0;
    const total = Object.keys(TEXTURES).length + 2;
    const tick = (label) => {
      done += 1;
      onProgress(done / total, label);
    };

    for (const [key, file] of Object.entries(TEXTURES)) {
      jobs.push(
        this.textureLoader
          .loadAsync(PATHS.textures + file)
          .then((tex) => {
            this.textures[key] = tex;
          })
          .catch(() => {
            this.warnings.push(`Textura no encontrada: ${file}`);
            this.textures[key] = this.#fallbackTexture();
          })
          .finally(() => tick(file))
      );
    }

    jobs.push(this.#loadRobot().finally(() => tick('Unidad NOVA-7')));
    jobs.push(this.#loadProps().finally(() => tick('Arsenal y criaturas')));

    await Promise.all(jobs);
    this.#configureTextures();
    this.#createMaterials();
    return this;
  }

  async #loadRobot() {
    try {
      this.robot = await this.gltfLoader.loadAsync(PATHS.robot);
    } catch (err) {
      console.warn('Modelo local no disponible, usando respaldo remoto', err);
      this.warnings.push('Se usó la copia remota del modelo del robot.');
      this.robot = await this.gltfLoader.loadAsync(PATHS.robotFallback);
    }
  }

  async #loadProps() {
    try {
      const gltf = await this.gltfLoader.loadAsync(PATHS.props);
      for (const name of Object.keys(PROP_BUILDERS)) {
        const node = gltf.scene.getObjectByName(name);
        if (!node) throw new Error(`Falta el nodo ${name} en props.glb`);
        node.position.set(0, 0, 0);
        this.props[name] = node;
      }
    } catch (err) {
      console.warn('props.glb no disponible, generando utilería por código', err);
      this.propsSource = 'procedural';
      for (const [name, build] of Object.entries(PROP_BUILDERS)) this.props[name] = build();
    }
    // sombras en todos los props
    for (const obj of Object.values(this.props)) {
      obj.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
    }
  }

  /** Devuelve una copia lista para agregar a la escena (materiales opcionalmente clonados). */
  cloneProp(name, { cloneMaterials = false } = {}) {
    const src = this.props[name];
    const copy = src.clone(true);
    if (cloneMaterials) {
      copy.traverse((o) => {
        if (o.isMesh) o.material = o.material.clone();
      });
    }
    return copy;
  }

  #fallbackTexture() {
    const data = new Uint8Array([200, 160, 120, 255]);
    const tex = new THREE.DataTexture(data, 1, 1);
    tex.needsUpdate = true;
    return tex;
  }

  #configureTextures() {
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    for (const [key, tex] of Object.entries(this.textures)) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = aniso;
      tex.colorSpace = key.includes('Normal') || key === 'rockVeins' || key === 'ruinGlyphs' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    }
  }

  #createMaterials() {
    const t = this.textures;
    const std = (params) => new THREE.MeshStandardMaterial(params);
    this.materials = {
      crate: std({ map: t.crateAlbedo, normalMap: t.crateNormal, roughness: 0.6, metalness: 0.35 }),
      canister: std({ map: t.canisterAlbedo, roughness: 0.35, metalness: 0.45 }),
      canisterCap: std({ color: 0x2a2e34, roughness: 0.4, metalness: 0.8 }),
      hull: std({ map: t.metalAlbedo, normalMap: t.metalNormal, roughness: 0.45, metalness: 0.6 }),
      hullDark: std({ map: t.metalAlbedo, normalMap: t.metalNormal, color: 0x5a6068, roughness: 0.5, metalness: 0.65 }),
      ruin: std({
        map: t.ruinAlbedo, normalMap: t.ruinNormal, roughness: 0.85,
        emissive: 0x9a5cff, emissiveMap: t.ruinGlyphs, emissiveIntensity: 1.4,
      }),
      ruinPlain: std({ map: t.ruinAlbedo, normalMap: t.ruinNormal, roughness: 0.88 }),
      rock: std({ map: t.rockAlbedo, normalMap: t.rockNormal, roughness: 0.9, emissive: 0x35e8ff, emissiveMap: t.rockVeins, emissiveIntensity: 0.9 }),
      boulder: std({ map: t.rockAlbedo, normalMap: t.rockNormal, roughness: 0.85, color: 0xb8c0d0 }),
      bark: std({ map: t.barkAlbedo, normalMap: t.barkNormal, roughness: 0.9 }),
      fern: std({ map: t.fern, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, emissive: 0x0c3a2c, emissiveIntensity: 0.6 }),
      grass: std({ map: t.grass, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 }),
      debris: std({ map: t.metalAlbedo, roughness: 0.5, metalness: 0.6 }),
      stone: std({ map: t.ruinAlbedo, normalMap: t.ruinNormal, roughness: 0.85 }),
    };
    // superficies del GLB con textura en tiempo de ejecución
    const swap = { RuinStone: this.materials.ruin, HullPanel: this.materials.hull, HullDark: this.materials.hullDark };
    for (const obj of Object.values(this.props)) {
      obj.traverse((o) => {
        if (o.isMesh && swap[o.material?.name]) o.material = swap[o.material.name];
        // brillos más contenidos para que el bloom no tape la mira
        if (o.isMesh && GLOW_SCALE[o.material?.name] && !o.material.userData.scaled) {
          o.material.emissiveIntensity *= GLOW_SCALE[o.material.name];
          o.material.userData.scaled = true;
        }
        // placas de armadura: satinadas (el mapa de entorno no las convierte en espejos)
        if (o.isMesh && (o.material?.name === 'ArmorMain' || o.material?.name === 'ArmorDark')) {
          o.material.metalness = 0.45;
          o.material.roughness = 0.5;
        }
        // cristales tipo espejo: menos reflejo del mapa de entorno (evita manchas blancas con bloom)
        if (o.isMesh && (o.material?.name === 'ArmorVisor' || o.material?.name === 'CockpitGlass')) {
          o.material.metalness = 0.55;
          o.material.roughness = 0.32;
          o.material.envMapIntensity = 0.35;
        }
      });
    }
  }
}

/**
 * Reescala las UV de un BoxGeometry según sus dimensiones para que la textura
 * mantenga una densidad constante (metros por repetición) en muros y vigas.
 */
export function boxWithWorldUV(w, h, d, metersPerTile = 2) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  // orden de caras en BoxGeometry: +x, -x, +y, -y, +z, -z (4 vértices cada una)
  const dims = [
    [d, h], [d, h],
    [w, d], [w, d],
    [w, h], [w, h],
  ];
  for (let face = 0; face < 6; face++) {
    const [du, dv] = dims[face];
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, uv.getX(idx) * (du / metersPerTile), uv.getY(idx) * (dv / metersPerTile));
    }
  }
  uv.needsUpdate = true;
  return geo;
}
