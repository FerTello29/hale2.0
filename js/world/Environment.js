/**
 * Environment — noche alienígena: cielo con estrellas, dos lunas y auroras
 * (shader propio), luz lunar con sombras, luz hemisférica, niebla densa,
 * esporas bioluminiscentes y mapa de entorno para los metales.
 * Cada nivel aporta su propia paleta.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const DEFAULT_PALETTE = {
  skyTop: 0x050a18,
  skyHorizon: 0x123a44,
  fog: 0x0b2227,
  fogDensity: 0.02,
  moonDir: [0.35, 0.62, -0.7],
  moonColor: 0xa9c8ff,
  moonIntensity: 1.35,
  hemiSky: 0x3d6a8a,
  hemiGround: 0x0c1a14,
  hemiIntensity: 0.75,
  auroraA: 0x38ffb0,
  auroraB: 0x8a4dff,
  aurora: 0.9,
  spores: 0x7dffd6,
  sporeOpacity: 0.55,
  envIntensity: 0.35,
  exposure: 1.15,
};

export class Environment {
  constructor(game) {
    this.game = game;
    this.time = 0;
    this.palette = { ...DEFAULT_PALETTE };
    this.intensity = 0; // tensión (0..1) para tintes de combate / colapso
  }

  build(scene) {
    this.scene = scene;
    scene.fog = new THREE.FogExp2(0x0b2227, 0.02);
    scene.background = new THREE.Color(0x0b2227);

    // mapa de entorno para que los metales tengan reflejos
    const pmrem = new THREE.PMREMGenerator(this.game.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = this.envMap;
    pmrem.dispose();

    this.skyUniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3() },
      uMoon2Dir: { value: new THREE.Vector3(-0.6, 0.35, 0.55).normalize() },
      uAuroraA: { value: new THREE.Color() },
      uAuroraB: { value: new THREE.Color() },
      uAurora: { value: 1 },
      uTime: { value: 0 },
      uTension: { value: 0 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(420, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.skyUniforms,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uMoonDir; uniform vec3 uMoon2Dir;
          uniform vec3 uAuroraA; uniform vec3 uAuroraB; uniform float uAurora; uniform float uTime; uniform float uTension;
          varying vec3 vDir;
          float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
          float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
            return mix(mix(hash2(i), hash2(i+vec2(1,0)), f.x), mix(hash2(i+vec2(0,1)), hash2(i+vec2(1,1)), f.x), f.y); }
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.45));
            if (h < 0.0) col = mix(uHorizon, uHorizon * 0.4, clamp(-h * 4.0, 0.0, 1.0));
            // estrellas
            vec3 sp = floor(d * 260.0);
            float st = hash(sp);
            float star = step(0.9965, st) * smoothstep(0.0, 0.25, h);
            star *= 0.6 + 0.4 * sin(uTime * (2.0 + st * 5.0) + st * 40.0);
            col += vec3(0.85, 0.9, 1.0) * star * 1.4;
            // auroras
            float band = 0.0;
            if (h > 0.05) {
              vec2 uv = d.xz / (h + 0.35);
              float wave = sin(uv.x * 2.2 + uTime * 0.12 + noise(uv * 1.3 + uTime * 0.05) * 3.0);
              float curtain = smoothstep(0.55, 0.0, abs(uv.y * 0.9 + wave * 0.35 - 0.2));
              float rays = noise(vec2(uv.x * 9.0 + uTime * 0.25, uv.y * 0.6));
              band = curtain * (0.35 + 0.65 * rays) * smoothstep(0.05, 0.35, h) * smoothstep(0.95, 0.5, h);
              vec3 ac = mix(uAuroraA, uAuroraB, clamp(uv.y * 0.6 + 0.5 + sin(uTime * 0.07) * 0.2, 0.0, 1.0));
              col += ac * band * uAurora * 0.55;
            }
            // lunas
            float m1 = dot(d, normalize(uMoonDir));
            col += vec3(0.8, 0.88, 1.0) * smoothstep(0.9993, 0.9996, m1) * 1.6;
            col += vec3(0.35, 0.5, 0.8) * pow(max(m1, 0.0), 180.0) * 0.8;
            float crater = noise(d.xy * 380.0) * smoothstep(0.9993, 0.9996, m1);
            col -= vec3(0.25) * crater;
            float m2 = dot(d, normalize(uMoon2Dir));
            col += vec3(1.0, 0.55, 0.45) * smoothstep(0.99975, 0.99985, m2) * 1.3;
            col += vec3(0.6, 0.25, 0.3) * pow(max(m2, 0.0), 260.0) * 0.6;
            // tensión (colapso / jefe): tinte magenta
            col = mix(col, col * vec3(1.3, 0.6, 1.1) + vec3(0.08, 0.0, 0.05), uTension * 0.6);
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      })
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);
    this.sky = sky;

    this.hemi = new THREE.HemisphereLight(0x3d6a8a, 0x0c1a14, 0.75);
    scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0xa9c8ff, 1.35);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    const cam = this.moon.shadow.camera;
    cam.left = -32;
    cam.right = 32;
    cam.top = 32;
    cam.bottom = -32;
    cam.near = 1;
    cam.far = 240;
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.04;
    scene.add(this.moon);
    scene.add(this.moon.target);
    this.rim = new THREE.DirectionalLight(0x5affc8, 0.25);
    this.rim.position.set(-40, 20, 40);
    scene.add(this.rim);

    this.#buildSpores(scene);
    this.applyPalette(DEFAULT_PALETTE);
  }

  #buildSpores(scene) {
    const count = 1800;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random();
      pos[i * 3 + 1] = Math.random();
      pos[i * 3 + 2] = Math.random();
      seed[i] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.sporeUniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(60, 18, 60) },
      uWind: { value: new THREE.Vector3(0.4, 0.35, -0.2) },
      uSize: { value: 0.22 },
      uOpacity: { value: 0.55 },
      uColor: { value: new THREE.Color(0x7dffd6) },
      uPixelRatio: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: this.sporeUniforms,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform vec3 uWind;
        uniform float uSize; uniform float uOpacity; uniform float uPixelRatio;
        attribute float aSeed;
        varying float vAlpha;
        void main() {
          vec3 p = position * uBox + uWind * uTime * (0.4 + aSeed);
          p += vec3(sin(uTime * 0.6 + aSeed * 20.0), sin(uTime * 0.9 + aSeed * 11.0) * 0.6, cos(uTime * 0.5 + aSeed * 7.0)) * 0.8;
          vec3 origin = uCenter - uBox * 0.5;
          vec3 rel = mod(p - origin, uBox);
          vec3 world = origin + rel;
          vec4 mv = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * (0.5 + aSeed) * uPixelRatio * (260.0 / max(1.0, -mv.z));
          vec3 edge = min(rel, uBox - rel) / (uBox * 0.18);
          float twinkle = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 30.0);
          vAlpha = uOpacity * twinkle * clamp(min(min(edge.x, edge.y), edge.z), 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.spores = new THREE.Points(geo, mat);
    this.spores.frustumCulled = false;
    scene.add(this.spores);
  }

  applyPalette(p) {
    this.palette = { ...DEFAULT_PALETTE, ...p };
    const P = this.palette;
    this.baseFog = new THREE.Color(P.fog);
    this.scene.fog.color.copy(this.baseFog);
    this.scene.fog.density = P.fogDensity;
    this.scene.background.copy(this.baseFog);
    this.skyUniforms.uTop.value.set(P.skyTop);
    this.skyUniforms.uHorizon.value.set(P.skyHorizon);
    this.skyUniforms.uAuroraA.value.set(P.auroraA);
    this.skyUniforms.uAuroraB.value.set(P.auroraB);
    this.skyUniforms.uAurora.value = P.aurora;
    this.moonDir = new THREE.Vector3(...P.moonDir).normalize();
    this.skyUniforms.uMoonDir.value.copy(this.moonDir);
    this.moon.color.set(P.moonColor);
    this.moon.intensity = P.moonIntensity;
    this.hemi.color.set(P.hemiSky);
    this.hemi.groundColor.set(P.hemiGround);
    this.hemi.intensity = P.hemiIntensity;
    this.sporeUniforms.uColor.value.set(P.spores);
    this.sporeUniforms.uOpacity.value = P.sporeOpacity;
    this.scene.environmentIntensity = P.envIntensity;
    this.game.renderer.toneMappingExposure = P.exposure;
    this.setTension(0);
  }

  /** Tensión 0..1: tiñe cielo y niebla (jefes, colapso final). */
  setTension(t) {
    this.intensity = THREE.MathUtils.clamp(t, 0, 1);
    this.skyUniforms.uTension.value = this.intensity;
    const f = this.scene.fog.color.copy(this.baseFog);
    f.lerp(new THREE.Color(0x3a0c2e), this.intensity * 0.5);
    this.scene.background.copy(f);
  }

  setShadows(enabled) {
    this.moon.castShadow = enabled;
  }

  update(dt, focus, camera, pixelRatio) {
    this.time += dt;
    this.skyUniforms.uTime.value = this.time;
    this.sky.position.copy(camera.position);
    this.sporeUniforms.uTime.value = this.time;
    this.sporeUniforms.uCenter.value.copy(camera.position);
    this.sporeUniforms.uPixelRatio.value = pixelRatio;
    const texel = 64 / 2048;
    const tx = Math.round(focus.x / texel) * texel;
    const tz = Math.round(focus.z / texel) * texel;
    this.moon.target.position.set(tx, focus.y, tz);
    this.moon.position.set(tx + this.moonDir.x * 120, focus.y + this.moonDir.y * 120, tz + this.moonDir.z * 120);
  }
}
