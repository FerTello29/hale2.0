/**
 * Effects — partículas (GPU points con shader propio), destellos de luz de un
 * pool fijo (sin recompilar shaders), ondas expansivas, avisos de derrumbe y
 * sprites de brillo reutilizables.
 */
import * as THREE from 'three';

let glowTexture = null;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

/** Sistema de partículas en CPU con render en un único THREE.Points. */
class ParticlePool {
  constructor(capacity, blending) {
    this.capacity = capacity;
    this.cursor = 0;
    this.alive = 0;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uPixelRatio: { value: 1 }, uMap: { value: getGlowTexture() } };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uPixelRatio;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPixelRatio * (300.0 / max(0.5, -mv.z));
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  emit(p, v, color, { life = 1, size0 = 0.3, size1 = 0.1, gravity = 0, drag = 0, alpha = 1 }) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.alpha0[i] = alpha;
  }

  update(dt) {
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      alive++;
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      const k = i * 3;
      this.vel[k] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d - this.gravity[i] * dt;
      this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.alpha[i] = this.alpha0[i] * (1 - t) * Math.min(1, t * 12 + 0.2);
    }
    this.alive = alive;
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
    a.aColor.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
  }
}

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function randDir(out, spread = 1, up = 0) {
  out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
  if (out.lengthSq() < 1e-4) out.set(0, 1, 0);
  out.normalize().multiplyScalar(spread);
  out.y += up;
  return out;
}

const PRESETS = {
  explosion: [
    { pool: 'add', n: 90, color: [0xffd27a, 0xff6a1a], speed: [4, 13], up: 0.5, life: [0.4, 0.9], size: [2.2, 0.3], gravity: 4, drag: 2.5 },
    { pool: 'add', n: 8, color: [0xfff6d8, 0xffc070], speed: [0.2, 1.2], up: 0.3, life: [0.2, 0.35], size: [5.5, 1.5], gravity: 0, drag: 1 },
    { pool: 'add', n: 40, color: [0xfff1b0, 0xffb040], speed: [8, 20], up: 0.6, life: [0.5, 1.2], size: [0.18, 0.05], gravity: 14, drag: 0.8 },
    { pool: 'smoke', n: 22, color: [0x3b2c22, 0x6a584a], speed: [1, 4.5], up: 0.9, life: [1.4, 2.6], size: [1.2, 4.2], gravity: -1.2, drag: 1.4, alpha: 0.75 },
  ],
  smallExplosion: [
    { pool: 'add', n: 36, color: [0xffd27a, 0xff5a1a], speed: [3, 9], up: 0.4, life: [0.3, 0.6], size: [0.9, 0.2], gravity: 4, drag: 2.5 },
    { pool: 'smoke', n: 10, color: [0x2d2622, 0x5b4d42], speed: [0.8, 3], up: 0.8, life: [1, 1.8], size: [0.8, 2.6], gravity: -1, drag: 1.3, alpha: 0.7 },
  ],
  orbImpact: [
    { pool: 'add', n: 26, color: [0xbff6ff, 0x39c8ff], speed: [2, 8], up: 0.4, life: [0.25, 0.55], size: [0.35, 0.05], gravity: 6, drag: 2 },
    { pool: 'add', n: 6, color: [0xffffff, 0xaef2ff], speed: [0.2, 1], up: 0, life: [0.15, 0.25], size: [1.6, 0.4], gravity: 0, drag: 0 },
  ],
  collect: [
    { pool: 'add', n: 40, color: [0xe8f6ff, 0x7fdcff], speed: [1, 4], up: 1.4, life: [0.6, 1.2], size: [0.3, 0.05], gravity: -1, drag: 2 },
  ],
  gold: [
    { pool: 'add', n: 50, color: [0xfff0b0, 0xffb030], speed: [1, 5], up: 1.4, life: [0.6, 1.3], size: [0.35, 0.05], gravity: -1, drag: 2 },
  ],
  battery: [
    { pool: 'add', n: 30, color: [0xc8ffe0, 0x2cff8a], speed: [1, 3.5], up: 1.4, life: [0.5, 1], size: [0.28, 0.05], gravity: -1, drag: 2 },
  ],
  sparks: [
    { pool: 'add', n: 30, color: [0xffe6a0, 0xff7a2a], speed: [3, 9], up: 0.3, life: [0.3, 0.7], size: [0.16, 0.04], gravity: 12, drag: 0.6 },
  ],
  boltHit: [
    { pool: 'add', n: 16, color: [0xffc8f6, 0xff2bd6], speed: [2, 6], up: 0.3, life: [0.2, 0.45], size: [0.25, 0.04], gravity: 6, drag: 1.5 },
  ],
  heal: [
    { pool: 'add', n: 36, color: [0xd0fff0, 0x3dffb0], speed: [0.8, 3], up: 1.6, life: [0.6, 1.2], size: [0.3, 0.05], gravity: -1.5, drag: 2 },
  ],
  ammo: [
    { pool: 'add', n: 26, color: [0xfff0c0, 0xffb040], speed: [1, 3.5], up: 1.4, life: [0.4, 0.9], size: [0.25, 0.05], gravity: -1, drag: 2 },
  ],
  shards: [
    { pool: 'add', n: 34, color: [0xffd0f4, 0xa040ff], speed: [3, 9], up: 0.6, life: [0.4, 0.9], size: [0.3, 0.05], gravity: 12, drag: 0.8 },
    { pool: 'add', n: 6, color: [0xffffff, 0xff9ae8], speed: [0.2, 1], up: 0.2, life: [0.12, 0.25], size: [2.2, 0.4], gravity: 0, drag: 0 },
  ],
  crystalBlast: [
    { pool: 'add', n: 120, color: [0xffe0fa, 0xff38c8], speed: [5, 16], up: 0.5, life: [0.5, 1.2], size: [0.5, 0.05], gravity: 5, drag: 1.2 },
    { pool: 'add', n: 10, color: [0xffffff, 0xffb0f0], speed: [0.2, 2], up: 0.4, life: [0.25, 0.5], size: [7, 1.5], gravity: 0, drag: 1 },
    { pool: 'smoke', n: 16, color: [0x3a1030, 0x6a2a5a], speed: [1, 4], up: 0.8, life: [1.4, 2.4], size: [1.5, 5], gravity: -1, drag: 1.4, alpha: 0.55 },
  ],
  portal: [
    { pool: 'add', n: 60, color: [0xffd0f4, 0xff2bd6], speed: [1, 4], up: 2.2, life: [0.5, 1.1], size: [0.4, 0.05], gravity: -2, drag: 1.5 },
    { pool: 'add', n: 4, color: [0xffffff, 0xff8fe6], speed: [0.1, 0.4], up: 0.5, life: [0.3, 0.5], size: [4.5, 1], gravity: 0, drag: 0 },
  ],
  acid: [
    { pool: 'add', n: 40, color: [0xd8ffe8, 0x2cff9a], speed: [2, 7], up: 0.7, life: [0.35, 0.8], size: [0.45, 0.06], gravity: 10, drag: 1.2 },
    { pool: 'smoke', n: 12, color: [0x1c5a3a, 0x3a8a5a], speed: [0.5, 2], up: 0.6, life: [1, 1.8], size: [0.8, 2.8], gravity: -0.8, drag: 1.5, alpha: 0.55 },
  ],
  impactWorld: [
    { pool: 'add', n: 6, color: [0xfff0d0, 0xffb060], speed: [1.5, 4], up: 0.4, life: [0.12, 0.3], size: [0.14, 0.03], gravity: 9, drag: 1 },
    { pool: 'smoke', n: 2, color: [0x5a5048, 0x8a7a6a], speed: [0.3, 1], up: 0.5, life: [0.4, 0.8], size: [0.25, 0.8], gravity: -0.5, drag: 2, alpha: 0.5 },
  ],
  impactEnemy: [
    { pool: 'add', n: 9, color: [0xffd0f4, 0xff38c8], speed: [1.5, 5], up: 0.3, life: [0.15, 0.35], size: [0.2, 0.03], gravity: 8, drag: 1.2 },
  ],
  impactProp: [
    { pool: 'add', n: 7, color: [0xffffff, 0xffc060], speed: [2, 5], up: 0.3, life: [0.1, 0.25], size: [0.14, 0.03], gravity: 10, drag: 1 },
  ],
  impactShield: [
    { pool: 'add', n: 10, color: [0xd0f8ff, 0x4fd8ff], speed: [2, 6], up: 0.1, life: [0.15, 0.35], size: [0.25, 0.04], gravity: 0, drag: 3 },
    { pool: 'add', n: 1, color: [0xffffff, 0x9ff4ff], speed: [0, 0.1], up: 0, life: [0.12, 0.18], size: [1.4, 0.4], gravity: 0, drag: 0 },
  ],
  muzzleSparks: [
    { pool: 'add', n: 5, color: [0xffffff, 0xffe0a0], speed: [2, 6], up: 0.1, life: [0.05, 0.12], size: [0.12, 0.02], gravity: 0, drag: 3 },
  ],
  punch: [
    { pool: 'add', n: 14, color: [0xfff0d0, 0xffb060], speed: [1.5, 5], up: 0.2, life: [0.15, 0.35], size: [0.3, 0.05], gravity: 2, drag: 3 },
  ],
  pulse: [
    { pool: 'add', n: 60, color: [0xcff8ff, 0x3fb8ff], speed: [6, 12], up: 0.05, life: [0.3, 0.6], size: [0.4, 0.05], gravity: 0, drag: 3, flat: true },
    { pool: 'smoke', n: 16, color: [0x5a7a8a, 0x8ab0c0], speed: [3, 7], up: 0.1, life: [0.8, 1.4], size: [0.8, 2.4], gravity: 0, drag: 2.5, alpha: 0.45, flat: true },
  ],
  dust: [
    { pool: 'smoke', n: 18, color: [0x4a524c, 0x7a847c], speed: [1, 4], up: 0.3, life: [0.9, 1.8], size: [0.8, 2.8], gravity: -0.3, drag: 2, alpha: 0.6, flat: true },
  ],
  wood: [
    { pool: 'smoke', n: 10, color: [0x9c7a4c, 0xc9a877], speed: [1, 3], up: 0.6, life: [0.6, 1.2], size: [0.5, 1.6], gravity: -0.2, drag: 2, alpha: 0.6 },
    { pool: 'add', n: 12, color: [0xfff2c0, 0x6dffa8], speed: [1, 4], up: 1, life: [0.3, 0.7], size: [0.25, 0.05], gravity: 3, drag: 2 },
  ],
  towerDown: [
    { pool: 'add', n: 90, color: [0xffb0a0, 0xff2a1a], speed: [3, 12], up: 0.8, life: [0.5, 1.2], size: [0.4, 0.05], gravity: 5, drag: 1.2 },
    { pool: 'add', n: 30, color: [0xffffff, 0xff8080], speed: [0.5, 2], up: 1.5, life: [0.8, 1.6], size: [0.9, 0.1], gravity: -2, drag: 1 },
  ],
};

export class Effects {
  constructor(game) {
    this.game = game;
    this.add = new ParticlePool(4000, THREE.AdditiveBlending);
    this.smokePool = new ParticlePool(1200, THREE.NormalBlending);
    this.group = new THREE.Group();
    this.group.name = 'FX';
    this.group.add(this.smokePool.points);
    this.group.add(this.add.points);

    // pool fijo de luces (el número de luces nunca cambia → sin recompilaciones)
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 22, 2);
      l.userData = { t: 0, dur: 1, peak: 0 };
      this.group.add(l);
      this.lights.push(l);
    }
    this.waves = [];
    this.warnings = [];
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 64);
    this.discGeo = new THREE.CircleGeometry(1, 48);
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);

    // trazadoras (pool fijo de mallas: sin crear geometría en cada disparo)
    this.tracers = [];
    this.tracerCursor = 0;
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.tracers.push({ mesh, life: 0, max: 1 });
    }
    // fogonazos
    this.muzzles = [];
    this.muzzleCursor = 0;
    for (let i = 0; i < 10; i++) {
      const sprite = this.createGlowSprite(0xffe0a0, 1);
      sprite.visible = false;
      this.group.add(sprite);
      this.muzzles.push({ sprite, life: 0 });
    }
  }

  attach(scene) {
    scene.add(this.group);
  }

  reset() {
    this.add.clear();
    this.smokePool.clear();
    for (const w of this.waves) this.group.remove(w.mesh);
    for (const w of this.warnings) this.group.remove(w.mesh);
    this.waves = [];
    this.warnings = [];
    for (const l of this.lights) l.intensity = 0;
    for (const t of this.tracers) {
      t.life = 0;
      t.mesh.visible = false;
    }
    for (const m of this.muzzles) {
      m.life = 0;
      m.sprite.visible = false;
    }
  }

  createGlowSprite(color, size) {
    const mat = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(size);
    return s;
  }

  burst(name, pos) {
    const preset = PRESETS[name];
    if (!preset) return;
    for (const layer of preset) {
      const pool = layer.pool === 'smoke' ? this.smokePool : this.add;
      const c0 = new THREE.Color(layer.color[0]);
      const c1 = new THREE.Color(layer.color[1]);
      for (let i = 0; i < layer.n; i++) {
        const speed = layer.speed[0] + Math.random() * (layer.speed[1] - layer.speed[0]);
        randDir(_v, 1, layer.up);
        if (layer.flat) _v.y *= 0.15;
        _v.normalize().multiplyScalar(speed);
        _c.copy(c0).lerp(c1, Math.random());
        _p.copy(pos).add(randDir(new THREE.Vector3(), 0.15));
        pool.emit(_p, _v, _c, {
          life: layer.life[0] + Math.random() * (layer.life[1] - layer.life[0]),
          size0: layer.size[0] * (0.7 + Math.random() * 0.6),
          size1: layer.size[1],
          gravity: layer.gravity,
          drag: layer.drag,
          alpha: layer.alpha ?? 1,
        });
      }
    }
  }

  trail(pos, color = 0x8ff0ff) {
    _v.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4);
    _c.setHex(Math.random() < 0.5 ? color : 0xe0fbff);
    this.add.emit(pos, _v, _c, { life: 0.35, size0: 0.35, size1: 0.02, gravity: 0, drag: 1 });
  }

  /** Humo oscuro que sube (restos en llamas). */
  smoke(pos) {
    _v.set((Math.random() - 0.5) * 0.4, 1 + Math.random(), (Math.random() - 0.5) * 0.4);
    _c.setHex(Math.random() < 0.5 ? 0x1e1a1c : 0x3a3032);
    this.smokePool.emit(pos, _v, _c, { life: 2.5 + Math.random(), size0: 0.8, size1: 3.5, gravity: -0.3, drag: 0.6, alpha: 0.55 });
    if (Math.random() < 0.3) {
      _c.setHex(0xff8a3a);
      this.add.emit(pos, _v.set((Math.random() - 0.5), 1.5, (Math.random() - 0.5)), _c, { life: 0.5, size0: 0.5, size1: 0.1, gravity: -1, drag: 1 });
    }
  }

  /** Partículas que giran hacia un centro (granada de singularidad). */
  vortex(center, radius) {
    for (let i = 0; i < 3; i++) {
      randDir(_p, radius * (0.6 + Math.random() * 0.4));
      const pos = _p.add(center);
      _v.subVectors(center, pos).multiplyScalar(1.6);
      _v.add(new THREE.Vector3(-_v.z, 0, _v.x).multiplyScalar(0.6));
      _c.setHex(Math.random() < 0.5 ? 0xb070ff : 0xe0c8ff);
      this.add.emit(pos, _v, _c, { life: 0.55, size0: 0.08, size1: 0.35, gravity: 0, drag: 0 });
    }
  }

  // ------------------------------------------------ disparos
  tracer(from, to, color = 0xffffff, style = 'tracer') {
    const t = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length;
    const len = from.distanceTo(to);
    if (len < 0.05) return;
    const w = style === 'beam' ? 0.07 : style === 'pellet' ? 0.018 : 0.03;
    t.mesh.position.copy(from).lerp(to, 0.5);
    _v.subVectors(to, from).normalize();
    t.mesh.quaternion.setFromUnitVectors(UP, _v);
    t.mesh.scale.set(w, len, w);
    t.mesh.material.color.setHex(color);
    t.mesh.visible = true;
    t.life = style === 'beam' ? 0.35 : 0.07;
    t.max = t.life;
    if (style === 'beam') {
      // espiral de partículas a lo largo del rayo de riel
      const n = Math.min(60, Math.floor(len * 1.5));
      _c.setHex(color);
      for (let i = 0; i < n; i++) {
        _p.copy(from).lerp(to, i / n);
        this.add.emit(_p, randDir(_v, 0.4), _c, { life: 0.4 + Math.random() * 0.3, size0: 0.18, size1: 0.02, gravity: 0, drag: 2 });
      }
    }
  }

  muzzle(pos, dir, color = 0xffe0a0, scale = 1) {
    const m = this.muzzles[this.muzzleCursor];
    this.muzzleCursor = (this.muzzleCursor + 1) % this.muzzles.length;
    m.sprite.position.copy(pos);
    m.sprite.material.color.setHex(color);
    m.sprite.scale.setScalar(0.9 * scale);
    m.sprite.visible = true;
    m.life = 0.05;
    this.burst('muzzleSparks', pos);
    if (scale >= 1.4 || Math.random() < 0.35) this.flash(pos, color, 3 * scale, 0.06);
  }

  impact(point, normal, kind = 'world') {
    const name = kind === 'enemy' ? 'impactEnemy' : kind === 'shield' ? 'impactShield' : kind === 'prop' ? 'impactProp' : 'impactWorld';
    _p.copy(point);
    if (normal) _p.addScaledVector(normal, 0.05);
    this.burst(name, _p);
  }

  /** Rayo de energía entre dos puntos (nodos, anclas, láser). */
  createBeam(color, width = 0.15) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(this.beamGeo, mat);
    mesh.frustumCulled = false;
    const glow = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.add(glow);
    glow.scale.set(3, 1, 3);
    this.group.add(mesh);
    const base = 0.85;
    const self = this;
    return {
      mesh,
      set(a, b) {
        const len = a.distanceTo(b);
        mesh.position.copy(a).lerp(b, 0.5);
        _v.subVectors(b, a).normalize();
        mesh.quaternion.setFromUnitVectors(UP, _v);
        const flicker = 0.85 + Math.random() * 0.3;
        mesh.scale.set(width * flicker, Math.max(0.01, len), width * flicker);
      },
      setOpacity(o) {
        mat.opacity = base * o;
        glow.material.opacity = 0.25 * o;
      },
      get visible() {
        return mesh.visible;
      },
      set visible(v) {
        mesh.visible = v;
      },
      dispose() {
        self.group.remove(mesh);
        mat.dispose();
        glow.material.dispose();
      },
    };
  }

  flash(pos, color, intensity = 10, duration = 0.3) {
    let light = this.lights.find((l) => l.intensity <= 0.01);
    if (!light) light = this.lights.reduce((a, b) => (a.userData.t > b.userData.t ? a : b));
    light.position.copy(pos);
    light.position.y += 0.5;
    light.color.setHex(color);
    light.userData = { t: 0, dur: duration, peak: intensity };
    light.intensity = intensity;
  }

  shockwave(pos, radius, color) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(pos);
    mesh.position.y += 0.15;
    this.group.add(mesh);
    this.waves.push({ mesh, t: 0, dur: 0.55, radius });
  }

  /** Aviso rojo en el suelo antes de un derrumbe. */
  warning(pos, radius, duration, color = 0xff3a2a) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Group();
    const ring = new THREE.Mesh(this.ringGeo, mat);
    const disc = new THREE.Mesh(this.discGeo, mat.clone());
    disc.material.opacity = 0.18;
    mesh.add(ring, disc);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(pos);
    mesh.position.y += 0.08;
    mesh.scale.setScalar(radius);
    this.group.add(mesh);
    this.warnings.push({ mesh, t: 0, dur: duration, ring, disc });
  }

  update(dt, pixelRatio) {
    this.add.uniforms.uPixelRatio.value = pixelRatio;
    this.smokePool.uniforms.uPixelRatio.value = pixelRatio;
    this.add.update(dt);
    this.smokePool.update(dt);
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
      else t.mesh.material.opacity = t.life / t.max;
    }
    for (const m of this.muzzles) {
      if (m.life <= 0) continue;
      m.life -= dt;
      if (m.life <= 0) m.sprite.visible = false;
    }
    for (const l of this.lights) {
      if (l.intensity <= 0) continue;
      l.userData.t += dt;
      const k = 1 - l.userData.t / l.userData.dur;
      l.intensity = k > 0 ? l.userData.peak * k * k : 0;
    }
    for (const w of this.waves) {
      w.t += dt;
      const k = Math.min(1, w.t / w.dur);
      const s = 0.3 + (w.radius - 0.3) * (1 - Math.pow(1 - k, 3));
      w.mesh.scale.setScalar(s);
      w.mesh.material.opacity = 0.9 * (1 - k);
    }
    this.waves = this.waves.filter((w) => {
      if (w.t >= w.dur) {
        this.group.remove(w.mesh);
        w.mesh.material.dispose();
        return false;
      }
      return true;
    });
    for (const w of this.warnings) {
      w.t += dt;
      const pulse = 0.5 + 0.5 * Math.sin(w.t * 18);
      w.ring.material.opacity = 0.35 + pulse * 0.5;
      w.disc.material.opacity = 0.1 + (w.t / w.dur) * 0.3;
    }
    this.warnings = this.warnings.filter((w) => {
      if (w.t >= w.dur + 0.3) {
        this.group.remove(w.mesh);
        w.ring.material.dispose();
        w.disc.material.dispose();
        return false;
      }
      return true;
    });
  }
}
