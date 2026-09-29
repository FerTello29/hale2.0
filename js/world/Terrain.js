/**
 * Terrain — cañón minero generado por una función de altura analítica.
 *
 * La misma función alimenta:
 *   - la malla visual (PlaneGeometry desplazada),
 *   - el collider trimesh de Rapier (coincidencia exacta con lo que se ve),
 *   - consultas rápidas heightAt(x, z) para IA, spawns y minimapa.
 *
 * Zonas: campamento (sur), patio de maniobras (centro), cantera (oeste),
 * meseta con rampas (este), grieta profunda con puentes y zona norte con el
 * malacate de extracción.
 */
import * as THREE from 'three';
import { COLLISION } from '../config.js';

export const TERRAIN_SIZE = 200;
export const TERRAIN_SEGMENTS = 160;
export const PLAY_HALF = 52; // borde interior del área jugable
export const MESA_HEIGHT = 5.2;
export const CREVASSE_DEPTH = -18;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

/** Centro de la grieta en función de x. */
export const crevasseZ = (x) => -10 + 2 * Math.sin(x * 0.08);
export const CREVASSE_END_X = 32;

export function heightAt(x, z) {
  // 1) ondulación suave del suelo
  let h = Math.sin(x * 0.071) * Math.cos(z * 0.063) * 0.45 + Math.sin(x * 0.19 + z * 0.11) * 0.15
    + Math.cos(z * 0.23 - x * 0.05) * 0.1;

  // 2) cantera (oeste): pendiente hacia la pared para que rueden las rocas
  const quarryZ = smooth(15, 11, Math.abs(z - 19));
  h += 3.4 * smooth(-40, -51, x) * quarryZ;

  // 3) paredes del cañón
  const ex = Math.max(Math.abs(x) - PLAY_HALF, 0);
  const ez = Math.max(Math.abs(z) - PLAY_HALF, 0);
  const d = Math.hypot(ex, ez);
  if (d > 0) {
    h += 30 * (1 - Math.exp(-d * 0.12));
    h += (Math.sin(x * 0.35 + z * 0.2) + Math.cos(z * 0.31 - x * 0.17)) * Math.min(d, 6) * 0.45;
  }

  // 4) meseta (este) con rampa oeste y rampa norte
  const mx = Math.max(31 - x, 0);
  const mzN = Math.max(-34 - z, 0);
  const mzS = Math.max(z - 14, 0);
  const sd = Math.hypot(mx, Math.max(mzN, mzS));
  const mesa = smooth(2.2, 0.0, sd);
  let mesaH = MESA_HEIGHT * mesa + Math.sin(x * 0.5) * Math.cos(z * 0.4) * 0.12 * mesa;
  // rampa oeste (sube de x=17 a x=31 en la franja z 5..12)
  const rampW = smooth(3.9, 3.0, Math.abs(z - 8.5)) * smooth(15.5, 17.5, x) * smooth(32, 30.5, x);
  mesaH = Math.max(mesaH, MESA_HEIGHT * clamp01((x - 17) / 14) * rampW);
  // rampa norte (baja de z=-34 a z=-48 en la franja x 37..43)
  const rampN = smooth(3.4, 2.6, Math.abs(x - 40)) * smooth(-49.5, -47.5, z) * smooth(-32.5, -34.5, z);
  mesaH = Math.max(mesaH, MESA_HEIGHT * clamp01((z + 48) / 14) * rampN);
  h = Math.max(h, mesaH);

  // 5) grieta profunda (este-oeste) que separa el norte del sur
  const dz = Math.abs(z - crevasseZ(x));
  const tip = Math.max(x - (CREVASSE_END_X - 3), 0);
  const dc = Math.hypot(dz, tip);
  const f = smooth(3.9, 2.7, dc);
  h = mix(h, CREVASSE_DEPTH, f);

  return h;
}

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 0.5;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-hx, 2 * e, -hz).normalize();
}

/** ¿El punto está sobre la grieta (o su borde peligroso)? */
export function inCrevasse(x, z, margin = 0) {
  const dz = Math.abs(z - crevasseZ(x));
  const tip = Math.max(x - (CREVASSE_END_X - 3), 0);
  return Math.hypot(dz, tip) < 4.2 + margin;
}

export class Terrain {
  constructor(game) {
    this.game = game;
    this.mesh = null;
    this.collider = null;
  }

  build(parent) {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.mesh = new THREE.Mesh(geo, this.#createMaterial());
    this.mesh.receiveShadow = true;
    this.mesh.name = 'Terrain';
    parent.add(this.mesh);

    // collider trimesh con exactamente los mismos triángulos
    const R = this.game.physics.R;
    const vertices = new Float32Array(pos.array);
    const indices = new Uint32Array(geo.index.array);
    const desc = R.ColliderDesc.trimesh(vertices, indices)
      .setFriction(0.9)
      .setCollisionGroups(COLLISION.world);
    this.collider = this.game.physics.createStatic(desc);
    return this.mesh;
  }

  #createMaterial() {
    const { textures } = this.game.assets;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    mat.name = 'TerrainBlend';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.groundMap = { value: textures.groundAlbedo };
      shader.uniforms.rockMap = { value: textures.rockAlbedo };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D groundMap;\nuniform sampler2D rockMap;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;'
        )
        .replace(
          '#include <map_fragment>',
          `
          vec3 tn = normalize(vWNormal);
          float flatness = smoothstep(0.66, 0.86, tn.y);
          vec3 g = texture2D(groundMap, vWPos.xz * 0.11).rgb;
          vec3 g2 = texture2D(groundMap, vWPos.xz * 0.023 + 0.37).rgb;
          g = mix(g, g * g2 * 1.6, 0.35);
          vec3 bw = pow(abs(tn), vec3(4.0));
          bw /= (bw.x + bw.y + bw.z);
          vec3 rx = texture2D(rockMap, vWPos.zy * vec2(0.06, 0.09)).rgb;
          vec3 ry = texture2D(rockMap, vWPos.xz * 0.06).rgb;
          vec3 rz = texture2D(rockMap, vWPos.xy * vec2(0.06, 0.09)).rgb;
          vec3 r = rx * bw.x + ry * bw.y + rz * bw.z;
          vec3 terr = mix(r, g, flatness);
          float depth = clamp(-vWPos.y / 12.0, 0.0, 1.0);
          terr *= mix(1.0, 0.12, depth);
          float heightTint = smoothstep(3.0, 6.0, vWPos.y) * flatness;
          terr = mix(terr, terr * vec3(1.08, 1.02, 0.94), heightTint);
          diffuseColor.rgb *= terr;
          `
        );
    };
    return mat;
  }
}
