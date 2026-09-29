/**
 * AssetLibrary — carga de modelos GLB (GLTFLoader), texturas y creación de
 * materiales compartidos. Informa el progreso a la pantalla de carga.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PATHS } from '../config.js';
import { PROP_BUILDERS } from '../world/PropFactory.js';

const TEXTURES = {
  groundAlbedo: 'ground_albedo.jpg',
  groundNormal: 'ground_normal.jpg',
  rockAlbedo: 'rock_albedo.jpg',
  rockNormal: 'rock_normal.jpg',
  stoneAlbedo: 'stone_albedo.jpg',
  stoneNormal: 'stone_normal.jpg',
  wallAlbedo: 'stonewall_albedo.jpg',
  wallNormal: 'stonewall_normal.jpg',
  woodAlbedo: 'wood_albedo.jpg',
  woodNormal: 'wood_normal.jpg',
  crateAlbedo: 'crate_albedo.jpg',
  crateNormal: 'crate_normal.jpg',
  supplyAlbedo: 'supply_albedo.jpg',
  barrelAlbedo: 'barrel_albedo.jpg',
  metalAlbedo: 'metal_albedo.jpg',
  metalNormal: 'metal_normal.jpg',
  signDanger: 'sign_danger.jpg',
  signHoist: 'sign_hoist.jpg',
  signCamp: 'sign_camp.jpg',
};

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

    jobs.push(this.#loadRobot().finally(() => tick('Robot CHISPA')));
    jobs.push(this.#loadProps().finally(() => tick('Utilería 3D')));

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
      tex.colorSpace = key.includes('Normal') ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    }
  }

  #createMaterials() {
    const t = this.textures;
    const std = (params) => new THREE.MeshStandardMaterial(params);
    this.materials = {
      stone: std({ map: t.stoneAlbedo, normalMap: t.stoneNormal, roughness: 0.85 }),
      wall: std({ map: t.wallAlbedo, normalMap: t.wallNormal, roughness: 0.9 }),
      wood: std({ map: t.woodAlbedo, normalMap: t.woodNormal, roughness: 0.8 }),
      crate: std({ map: t.crateAlbedo, normalMap: t.crateNormal, roughness: 0.75 }),
      supply: std({ map: t.supplyAlbedo, roughness: 0.55, metalness: 0.35, emissive: 0x0b2a18, emissiveIntensity: 0.4 }),
      barrel: std({ map: t.barrelAlbedo, roughness: 0.5, metalness: 0.45 }),
      barrelCap: std({ color: 0x5a1712, roughness: 0.5, metalness: 0.6 }),
      metal: std({ map: t.metalAlbedo, normalMap: t.metalNormal, roughness: 0.55, metalness: 0.7 }),
      rail: std({ color: 0x8b8f96, roughness: 0.35, metalness: 0.9 }),
      rock: std({ map: t.rockAlbedo, normalMap: t.rockNormal, roughness: 0.95 }),
      boulder: std({ map: t.rockAlbedo, normalMap: t.rockNormal, roughness: 0.9, color: 0xd8c0a8 }),
      rope: std({ color: 0x9c7a4c, roughness: 1 }),
      signDanger: std({ map: t.signDanger, roughness: 0.6 }),
      signHoist: std({ map: t.signHoist, roughness: 0.6 }),
      signCamp: std({ map: t.signCamp, roughness: 0.7 }),
      debris: std({ map: t.woodAlbedo, roughness: 0.85 }),
    };
    // metal de las vagonetas: aplica textura oxidada al material del GLB
    const cart = this.props.MineCart;
    cart?.traverse((o) => {
      if (o.isMesh && o.material?.name === 'RustMetal' && !o.material.map) {
        o.material.map = t.metalAlbedo;
        o.material.color.set(0xd6b8a0);
        o.material.needsUpdate = true;
      }
    });
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
