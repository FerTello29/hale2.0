/**
 * Game — orquestador principal: render, bucle, estados y ciclo de vida.
 *
 * Estados: loading → menu → playing ⇄ paused → victory | defeat → (reinicio)
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { DIFFICULTIES } from '../config.js';
import { EventBus } from './EventBus.js';
import { Settings } from './Settings.js';
import { Input } from './Input.js';
import { AssetLibrary } from './AssetLibrary.js';
import { PhysicsWorld, initRapier, WORLD_ENTITY } from '../physics/PhysicsWorld.js';
import { Environment } from '../world/Environment.js';
import { Level, SPAWN_POINT } from '../world/Level.js';
import { heightAt } from '../world/Terrain.js';
import { Player } from '../entities/Player.js';
import { DroneSquad } from '../entities/Drone.js';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js';
import { CombatSystem } from '../gameplay/CombatSystem.js';
import { Spawner } from '../gameplay/Spawner.js';
import { Mission } from '../gameplay/Mission.js';
import { Effects } from '../fx/Effects.js';
import { AudioManager } from '../fx/AudioManager.js';
import { HUD } from '../ui/HUD.js';
import { Minimap } from '../ui/Minimap.js';
import { Screens } from '../ui/Screens.js';
import { TouchControls } from '../ui/TouchControls.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'loading';
    this.entities = new Set();
    this.removals = [];
    this.clock = new THREE.Clock();
    this.time = 0;
    this.level = null;
    this.player = null;
    this.mission = null;
    this.spawner = null;
    this.squad = null;
    this.frame = 0;
  }

  // ================================================================ init
  async init() {
    this.bus = new EventBus();
    this.settings = new Settings();
    this.#createRenderer();
    this.input = new Input(this.canvas);
    this.audio = new AudioManager(this);
    this.screens = new Screens(this);
    this.screens.show('loading');

    if (location.protocol === 'file:') {
      this.screens.show('file');
      throw new Error('file-protocol');
    }

    this.assets = new AssetLibrary(this.renderer);
    const [assets] = await Promise.all([
      this.assets.load((p, label) => this.screens.setLoading(p * 0.9, `Cargando ${label}…`)),
      initRapier(),
    ]);
    this.screens.setLoading(0.95, 'Levantando el cañón…');

    this.physics = new PhysicsWorld();
    this.fx = new Effects(this);
    this.fx.attach(this.scene);
    this.env = new Environment(this);
    this.env.build(this.scene);
    this.env.setShadows(this.settings.get('shadows'));
    this.cameraRig = new ThirdPersonCamera(this, this.camera);
    this.combat = new CombatSystem(this);
    this.combat.attach(this.scene);
    this.hud = new HUD(this);
    this.minimap = new Minimap(this, document.getElementById('minimap'));
    this.touch = new TouchControls(this);

    this.#bindEvents();
    this.#buildWorld(DIFFICULTIES[this.settings.get('difficulty')] || DIFFICULTIES.minero);
    this.state = 'menu';
    this.screens.setLoading(1, 'Listo');
    this.screens.show('menu');
    if (assets.warnings.length) console.warn(assets.warnings);

    // precompilar shaders para evitar tirones en el primer cuadro
    this.renderer.compile(this.scene, this.camera);
    this.renderer.setAnimationLoop(() => this.#loop());
  }

  #createRenderer() {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = this.settings.get('shadows');
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.get('fov'), window.innerWidth / window.innerHeight, 0.1, 900);
    this.camera.position.set(0, 6, 50);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.55, 0.45, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  #bindEvents() {
    window.addEventListener('resize', () => this.#onResize());
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.touch.enabled) this.pause();
    };
    this.canvas.addEventListener('mousedown', () => {
      if (this.state === 'playing' && !this.input.locked && !this.touch.enabled) this.input.requestLock();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    this.settings.onChange((key, value) => {
      if (key === 'gravity') this.physics.setGravity(value);
      else if (key === 'volume') this.audio.setVolume(value);
      else if (key === 'shadows') {
        this.renderer.shadowMap.enabled = value;
        this.env.setShadows(value);
        this.scene.traverse((o) => {
          if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; });
        });
      } else if (key === 'fov') {
        this.camera.fov = value;
        this.camera.updateProjectionMatrix();
      }
    });
  }

  #onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ================================================================ mundo
  #disposeWorld() {
    for (const e of this.entities) e.dispose();
    this.entities.clear();
    this.removals = [];
    this.level?.dispose();
    this.level = null;
    this.player = null;
    this.mission = null;
    this.spawner = null;
    this.squad = null;
  }

  #buildWorld(difficulty) {
    this.state = 'loading';
    this.#disposeWorld();
    this.physics.create(this.settings.get('gravity'));
    this.fx.reset();
    this.combat.reset();
    this.difficulty = difficulty;

    this.level = new Level(this);
    this.level.build(difficulty);
    const spawn = new THREE.Vector3(SPAWN_POINT.x, heightAt(SPAWN_POINT.x, SPAWN_POINT.z), SPAWN_POINT.z);
    this.player = new Player(this, spawn);
    this.addEntity(this.player);
    this.player.facing = Math.PI; // mirando al norte

    this.squad = new DroneSquad(this, this.level.droneHomes, difficulty);
    this.squad.spawnAll();
    this.spawner = new Spawner(this, this.level, difficulty);
    this.mission = new Mission(this, difficulty, { coresTotal: difficulty.cores, towersTotal: this.level.towers.length });
    this.spawner.spawnCores(difficulty.cores);
    this.spawner.spawnBatteries(2);
    this.cameraRig.reset(this.player.chestPosition(), 0);
    this.env.setStorm(0);
    // asentar la física antes de mostrar nada
    for (let i = 0; i < 30; i++) this.physics.step(1 / 60, (h) => this.#fixed(h), (a, b, s, c1, c2) => this.#onCollision(a, b, s, c1, c2));
    this.#processRemovals();
  }

  addEntity(e) {
    this.entities.add(e);
    return e;
  }

  queueRemoval(e) {
    this.removals.push(e);
  }

  #processRemovals() {
    if (!this.removals.length) return;
    const list = this.removals;
    this.removals = [];
    for (const e of list) {
      this.entities.delete(e);
      e.dispose();
    }
  }

  #onCollision(a, b, started, c1, c2) {
    const A = a ?? WORLD_ENTITY;
    const B = b ?? WORLD_ENTITY;
    if (a && a.alive !== false && a.onCollide) a.onCollide(B, started, c1, c2);
    if (b && b.alive !== false && b.onCollide) b.onCollide(A, started, c2, c1);
  }

  #fixed(h) {
    for (const e of this.entities) if (e.alive) e.fixedUpdate(h);
  }

  // ================================================================ estados
  startGame() {
    const difficulty = DIFFICULTIES[this.settings.get('difficulty')] || DIFFICULTIES.minero;
    this.audio.unlock();
    this.screens.setLoading(0.5, 'Preparando misión…');
    this.#buildWorld(difficulty);
    this.state = 'playing';
    this.screens.hideAll();
    this.hud.reset(this.mission);
    this.hud.show();
    this.touch.show(true);
    this.input.clear();
    if (!this.touch.enabled) this.input.requestLock();
    this.clock.getDelta();
    this.hud.banner('Operación Núcleo de Plata', `${difficulty.label} · recupera ${difficulty.cores} núcleos y derriba 3 torres`, 'info');
    this.bus.emit('game:start', { difficulty });
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.combat.cancelCharge();
    this.input.exitLock();
    this.input.clear();
    this.screens.show('pause');
    this.touch.show(false);
    this.audio.suspend();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.screens.hideAll();
    this.touch.show(true);
    this.input.clear();
    this.audio.resume();
    if (!this.touch.enabled) this.input.requestLock();
    this.clock.getDelta();
  }

  quitToMenu() {
    this.state = 'menu';
    this.input.exitLock();
    this.hud.hide();
    this.touch.show(false);
    this.audio.resume();
    this.#buildWorld(DIFFICULTIES[this.settings.get('difficulty')] || DIFFICULTIES.minero);
    this.screens.show('menu');
  }

  onVictory(result) {
    this.state = 'victory';
    this.input.exitLock();
    this.touch.show(false);
    this.combat.cancelCharge();
    this.player.celebrate();
    this.audio.play('victory');
    this.bus.emit('game:victory', result);
    setTimeout(() => {
      if (this.state !== 'victory') return;
      this.hud.hide();
      this.screens.showVictory(result);
    }, 1800);
  }

  onDefeat(result) {
    this.state = 'defeat';
    this.input.exitLock();
    this.touch.show(false);
    if (this.player && !this.player.dead) {
      this.player.dead = true;
      this.player.sad = 1;
      this.player.anim.once('Death', { hold: true });
    }
    this.combat.cancelCharge();
    this.audio.play('defeat');
    this.bus.emit('game:defeat', result);
    setTimeout(() => {
      if (this.state !== 'defeat') return;
      this.hud.hide();
      this.screens.showDefeat(result);
    }, 2000);
  }

  tryInteract() {
    const ex = this.level.extraction;
    const p = this.player;
    if (!ex || !p || !p.canAct() || !ex.canInteract(p.currPos)) return;
    if (ex.activate()) {
      p.attachTo(ex);
      p.wave();
      this.bus.emit('hud:banner', { title: '¡Extracción en curso!', subtitle: 'El malacate sube a CHISPA a la superficie', type: 'success' });
    } else {
      const m = this.mission;
      const missing = [];
      if (m.coresCollected < m.coresTotal) missing.push(`${m.coresTotal - m.coresCollected} núcleo(s)`);
      if (m.towersDown < m.towersTotal) missing.push(`${m.towersTotal - m.towersDown} torre(s)`);
      this.bus.emit('hud:toast', { text: `Faltan: ${missing.join(' y ')}`, type: 'danger', icon: 'lock-fill' });
    }
  }

  // ================================================================ bucle
  #loop() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    this.frame++;
    const state = this.state;
    const input = this.input;

    if (state === 'playing') {
      this.cameraRig.handleInput(input, this.settings);
      if (input.pressed('pause')) this.pause();
      if (input.pressed('help')) this.hud.toggleHelp();
      if (input.pressed('interact')) this.tryInteract();
    }

    const simulate = state === 'playing' || state === 'menu' || state === 'victory' || state === 'defeat';
    let alpha = 1;
    if (simulate) {
      alpha = this.physics.step(dt, (h) => this.#fixed(h), (a, b, s, c1, c2) => this.#onCollision(a, b, s, c1, c2));
      this.#processRemovals();
      if (state === 'playing') this.combat.update(dt);
      for (const e of this.entities) if (e.alive) e.update(dt, alpha);
      for (const e of this.physics.bodiesToSync) e.syncVisual(alpha);
      for (const t of this.level.towers) t.update(dt);
      if (state === 'playing') {
        this.mission.update(dt);
        this.squad.update(dt);
        this.spawner.update(dt);
        this.env.setStorm(this.mission.storm);
        this.audio.setStorm(this.mission.storm);
      }
      this.#processRemovals();
    }

    // cámara
    const player = this.player;
    if (state === 'menu') {
      this.cameraRig.updateMenu(dt, player.object3d.position);
      if (Math.random() < dt * 0.12) player.wave();
    } else if (state !== 'paused') {
      const running = player.running && Math.hypot(player.velocity.x, player.velocity.z) > 4;
      const aiming = state === 'playing' && (input.down('aim') || this.combat.charging);
      this.cameraRig.update(dt, player.chestPosition(), { aiming, running });
    }

    this.env.update(dt, player.object3d.position, this.camera, this.renderer.getPixelRatio());
    this.fx.update(state === 'paused' ? 0 : dt, this.renderer.getPixelRatio());
    if (state === 'playing' || state === 'victory' || state === 'defeat') {
      this.hud.update(dt);
      this.minimap.update(dt);
    }

    if (this.settings.get('bloom')) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    input.endFrame();
  }
}
