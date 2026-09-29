/**
 * Terrain — malla + collider trimesh generados desde la función de altura del
 * nivel (TerrainField). El shader mezcla suelo y roca según la pendiente, usa
 * proyección triplanar en paredes, oscurece los abismos y hace brillar las
 * vetas de energía de la roca alienígena.
 */
import * as THREE from 'three';
import { COLLISION } from '../config.js';
import { heightAt } from './TerrainField.js';

export const TERRAIN_SIZE = 200;
export const TERRAIN_SEGMENTS = 160;

export class Terrain {
  constructor(game, palette = {}) {
    this.game = game;
    this.palette = {
      groundTint: new THREE.Color(0xffffff),
      rockTint: new THREE.Color(0xffffff),
      veinColor: new THREE.Color(0x35e8ff),
      veinIntensity: 1.6,
      groundScale: 0.13,
      rockScale: 0.07,
      voidY: -6,
      ...palette,
    };
    this.mesh = null;
    this.collider = null;
    this.uniforms = { uTime: { value: 0 } };
  }

  build(parent) {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.mesh = new THREE.Mesh(geo, this.#createMaterial());
    this.mesh.receiveShadow = true;
    this.mesh.name = 'Terrain';
    parent.add(this.mesh);

    const R = this.game.physics.R;
    const desc = R.ColliderDesc.trimesh(new Float32Array(pos.array), new Uint32Array(geo.index.array))
      .setFriction(0.9)
      .setCollisionGroups(COLLISION.world);
    this.collider = this.game.physics.createStatic(desc);
    return this.mesh;
  }

  update(dt) {
    this.uniforms.uTime.value += dt;
  }

  #createMaterial() {
    const t = this.game.assets.textures;
    const P = this.palette;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    mat.name = 'TerrainBlend';
    const uniforms = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        groundMap: { value: t.groundAlbedo },
        groundNormalMap: { value: t.groundNormal },
        rockMap: { value: t.rockAlbedo },
        veinMap: { value: t.rockVeins },
        uGroundTint: { value: P.groundTint },
        uRockTint: { value: P.rockTint },
        uVeinColor: { value: P.veinColor },
        uVeinIntensity: { value: P.veinIntensity },
        uGroundScale: { value: P.groundScale },
        uRockScale: { value: P.rockScale },
        uVoidY: { value: P.voidY },
        uTime: uniforms.uTime,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D groundMap; uniform sampler2D groundNormalMap; uniform sampler2D rockMap; uniform sampler2D veinMap;
          uniform vec3 uGroundTint; uniform vec3 uRockTint; uniform vec3 uVeinColor; uniform float uVeinIntensity;
          uniform float uGroundScale; uniform float uRockScale; uniform float uVoidY; uniform float uTime;
          varying vec3 vWPos; varying vec3 vWNormal;
          float gFlat; vec3 gBW;`
        )
        .replace(
          '#include <map_fragment>',
          `
          vec3 tn = normalize(vWNormal);
          gFlat = smoothstep(0.62, 0.84, tn.y);
          vec3 g = texture2D(groundMap, vWPos.xz * uGroundScale).rgb;
          vec3 g2 = texture2D(groundMap, vWPos.xz * uGroundScale * 0.21 + 0.37).rgb;
          g = mix(g, g * g2 * 1.8, 0.4) * uGroundTint;
          gBW = pow(abs(tn), vec3(4.0));
          gBW /= (gBW.x + gBW.y + gBW.z);
          vec3 rx = texture2D(rockMap, vWPos.zy * vec2(uRockScale, uRockScale * 1.4)).rgb;
          vec3 ry = texture2D(rockMap, vWPos.xz * uRockScale).rgb;
          vec3 rz = texture2D(rockMap, vWPos.xy * vec2(uRockScale, uRockScale * 1.4)).rgb;
          vec3 r = (rx * gBW.x + ry * gBW.y + rz * gBW.z) * uRockTint;
          vec3 terr = mix(r, g, gFlat);
          float depth = clamp((uVoidY - vWPos.y) / 14.0, 0.0, 1.0);
          terr *= mix(1.0, 0.08, depth);
          diffuseColor.rgb *= terr;
          `
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            vec3 gn = texture2D(groundNormalMap, vWPos.xz * uGroundScale).xyz * 2.0 - 1.0;
            vec3 wn = normalize(vWNormal);
            vec3 T = normalize(vec3(1.0, 0.0, 0.0) - wn * wn.x);
            vec3 B = normalize(cross(T, wn));
            vec3 pn = normalize(T * gn.x + B * gn.y + wn * gn.z);
            normal = normalize((viewMatrix * vec4(normalize(mix(wn, pn, gFlat * 0.85)), 0.0)).xyz);
          }`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            float vx = texture2D(veinMap, vWPos.zy * vec2(uRockScale, uRockScale * 1.4)).r;
            float vy = texture2D(veinMap, vWPos.xz * uRockScale).r;
            float vz = texture2D(veinMap, vWPos.xy * vec2(uRockScale, uRockScale * 1.4)).r;
            float vein = (vx * gBW.x + vy * gBW.y + vz * gBW.z) * (1.0 - gFlat * 0.96);
            float pulse = 0.65 + 0.35 * sin(uTime * 1.6 + vWPos.y * 0.35 + vWPos.x * 0.05);
            totalEmissiveRadiance += uVeinColor * vein * uVeinIntensity * pulse;
          }`
        );
    };
    return mat;
  }
}
