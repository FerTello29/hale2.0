/**
 * Environment — cielo del atardecer, sol con sombras, luz hemisférica, niebla
 * y la tormenta de polvo que se intensifica conforme se agota el tiempo.
 */
import * as THREE from 'three';

const SUN_DIR = new THREE.Vector3(-0.72, 0.36, 0.52).normalize();

export class Environment {
  constructor(game) {
    this.game = game;
    this.storm = 0;
    this.time = 0;
    this.calm = {
      fog: new THREE.Color(0xd9a36f),
      density: 0.0075,
      sun: 3.1,
      hemi: 1.05,
    };
    this.stormy = {
      fog: new THREE.Color(0x8a5a36),
      density: 0.03,
      sun: 1.2,
      hemi: 0.7,
    };
  }

  build(scene) {
    this.scene = scene;
    scene.fog = new THREE.FogExp2(this.calm.fog.clone(), this.calm.density);
    scene.background = this.calm.fog.clone();

    // cielo con degradado y disco solar
    this.skyUniforms = {
      uTop: { value: new THREE.Color(0x27325e) },
      uHorizon: { value: new THREE.Color(0xf3a35c) },
      uBottom: { value: new THREE.Color(0x8e5a3a) },
      uSunDir: { value: SUN_DIR.clone() },
      uStorm: { value: 0 },
      uStormColor: { value: this.stormy.fog.clone() },
      uTime: { value: 0 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 32, 16),
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
          uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform vec3 uSunDir;
          uniform float uStorm; uniform vec3 uStormColor; uniform float uTime;
          varying vec3 vDir;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
          void main() {
            float h = vDir.y;
            vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(uHorizon, uBottom, clamp(-h * 3.0, 0.0, 1.0));
            float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
            col += vec3(1.0, 0.72, 0.42) * pow(s, 350.0) * 3.0;
            col += vec3(1.0, 0.55, 0.28) * pow(s, 12.0) * 0.45;
            // nubes altas estiradas
            vec2 uv = vDir.xz / max(0.12, vDir.y + 0.15) * 1.6 + vec2(uTime * 0.01, 0.0);
            float c = noise(uv) * 0.6 + noise(uv * 2.3) * 0.3 + noise(uv * 5.1) * 0.1;
            c = smoothstep(0.55, 0.85, c) * smoothstep(0.0, 0.25, h);
            col = mix(col, vec3(1.0, 0.78, 0.6), c * 0.35);
            col = mix(col, uStormColor, uStorm * (0.55 + 0.45 * (1.0 - clamp(h * 2.0, 0.0, 1.0))));
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

    // luces
    this.hemi = new THREE.HemisphereLight(0xffd2a8, 0x6a4a36, this.calm.hemi);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffc48a, this.calm.sun);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -34;
    cam.right = 34;
    cam.top = 34;
    cam.bottom = -34;
    cam.near = 1;
    cam.far = 220;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.fill = new THREE.DirectionalLight(0x8fb0ff, 0.35);
    this.fill.position.set(40, 30, -30);
    scene.add(this.fill);

    this.#buildDust(scene);
    this.setStorm(0);
  }

  #buildDust(scene) {
    const count = 2200;
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
    this.dustUniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(70, 26, 70) },
      uWind: { value: new THREE.Vector3(5.5, -0.4, -2.5) },
      uSize: { value: 0.35 },
      uOpacity: { value: 0.25 },
      uColor: { value: new THREE.Color(0xf0c690) },
      uPixelRatio: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: this.dustUniforms,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform vec3 uWind;
        uniform float uSize; uniform float uOpacity; uniform float uPixelRatio;
        attribute float aSeed;
        varying float vAlpha;
        void main() {
          vec3 p = position * uBox + uWind * uTime * (0.6 + aSeed * 0.8);
          p += vec3(sin(uTime * 0.7 + aSeed * 20.0), sin(uTime * 1.3 + aSeed * 11.0) * 0.5, cos(uTime * 0.9 + aSeed * 7.0)) * 0.6;
          vec3 origin = uCenter - uBox * 0.5;
          vec3 rel = mod(p - origin, uBox);
          vec3 world = origin + rel;
          vec4 mv = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * (0.5 + aSeed) * uPixelRatio * (260.0 / max(1.0, -mv.z));
          vec3 edge = min(rel, uBox - rel) / (uBox * 0.18);
          vAlpha = uOpacity * clamp(min(min(edge.x, edge.y), edge.z), 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    scene.add(this.dust);
  }

  setStorm(t) {
    this.storm = THREE.MathUtils.clamp(t, 0, 1);
    const s = Math.pow(this.storm, 1.6);
    const fog = this.scene.fog;
    fog.color.copy(this.calm.fog).lerp(this.stormy.fog, s);
    fog.density = THREE.MathUtils.lerp(this.calm.density, this.stormy.density, s);
    this.scene.background.copy(fog.color);
    this.sun.intensity = THREE.MathUtils.lerp(this.calm.sun, this.stormy.sun, s);
    this.hemi.intensity = THREE.MathUtils.lerp(this.calm.hemi, this.stormy.hemi, s);
    this.skyUniforms.uStorm.value = s * 0.9;
    this.dustUniforms.uOpacity.value = 0.18 + s * 0.6;
    this.dustUniforms.uSize.value = 0.3 + s * 0.35;
    this.dustUniforms.uWind.value.set(5.5 + s * 14, -0.4, -2.5 - s * 4);
  }

  setShadows(enabled) {
    this.sun.castShadow = enabled;
  }

  update(dt, focus, camera, pixelRatio) {
    this.time += dt;
    this.skyUniforms.uTime.value = this.time;
    this.sky.position.copy(camera.position);
    this.dustUniforms.uTime.value = this.time;
    this.dustUniforms.uCenter.value.copy(camera.position);
    this.dustUniforms.uPixelRatio.value = pixelRatio;
    // la cámara de sombras sigue al jugador (sombras nítidas donde importa)
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(SUN_DIR, 110);
    // estabilizar a texel para evitar parpadeo al moverse
    const texel = 68 / 2048;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    this.sun.position.x = this.sun.target.position.x + SUN_DIR.x * 110;
    this.sun.position.z = this.sun.target.position.z + SUN_DIR.z * 110;
  }
}
