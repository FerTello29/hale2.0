/**
 * Game — orquestador principal: render, bucle, estados, campaña y ciclo de
 * vida de los niveles.
 *
 * Estados: loading → menu → briefing → playing ⇄ paused →
 *          levelComplete → (siguiente nivel) … → victory | defeat
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { DIFFICULTIES, WEAPONS } from '../config.js';
import { EventBus } from './EventBus.js';
import { Settings, Progress } from './Settings.js';
import { Input } from './Input.js';
import { AssetLibrary } from './AssetLibrary.js';
import { PhysicsWorld, initRapier, WORLD_ENTITY } from '../physics/PhysicsWorld.js';
import { Environment } from '../world/Environment.js';
import { Player } from '../entities/Player.js';
import { PlasmaOrb, EnemyBolt, Lob, HomingOrb, Grenade } from '../entities/Projectiles.js';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js';
import { WeaponSystem } from '../weapons/WeaponSystem.js';
import { DamageSystem } from '../gameplay/Damage.js';
import { Spawner } from '../gameplay/Spawner.js';
import { EnemyDirector } from '../gameplay/EnemyDirector.js';
import { Radio } from '../gameplay/Radio.js';
import { LEVELS } from '../gameplay/Story.js';
import { Espectro } from '../enemies/Espectro.js';
import { Acechador } from '../enemies/Acechador.js';
import { Centinela } from '../enemies/Centinela.js';
import { Bastion } from '../enemies/Bastion.js';
import { Level1 } from '../levels/Level1.js';
import { Level2 } from '../levels/Level2.js';
import { Level3 } from '../levels/Level3.js';
import { Effects } from '../fx/Effects.js';
import { AudioManager } from '../fx/AudioManager.js';
import { HUD } from '../ui/HUD.js';
import { Minimap } from '../ui/Minimap.js';
import { Screens } from '../ui/Screens.js';
import { TouchControls } from '../ui/TouchControls.js';

const LEVEL_CLASSES = [Level1, Level2, Level3];

/** Equipo inicial de cada nivel (el resto se encuentra jugando). */
const LOADOUTS = {
  1: { weapons: ['rifle'], grenades: { frag: 2, gravity: 1 } },
  2: { weapons: ['rifle', 'shotgun', 'orb'], grenades: { frag: 3, gravity: 1 } },
  3: { weapons: ['rifle', 'shotgun', 'orb', 'rail'], current: 'rifle', grenades: { frag: 3, gravity: 2 } },
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'loading';
    this.entities = new Set();
    this.removals = [];
    this.enemies = new Set();
    this.damageables = new Set();
    this.drones = new Set();
    this.clock = new THREE.Clock();
    this.time = 0;
    this.level = null;
    this.player = null;
    this.boss = null;
    this.frame = 0;
    this.levelIndex = 1;
    this.campaign = { scores: {} };
    this.checkpointData = null;
    this.musicT = 0;
    this.loopErrors = new Set();
    this.music = { setIntensity: (v) => this.audio?.music?.setFloor(v) };
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
      this.assets.load((p, label) => this.screens.setLoading(p * 0.85, `Cargando ${label}…`)),
      initRapier(),
    ]);
    this.screens.setLoading(0.9, 'Sincronizando con la estación Vigía…');

    this.physics = new PhysicsWorld();
    this.fx = new Effects(this);
    this.fx.attach(this.scene);
    this.env = new Environment(this);
    this.env.build(this.scene);
    this.env.setShadows(this.settings.get('shadows'));
    this.cameraRig = new ThirdPersonCamera(this, this.camera);
    this.damage = new DamageSystem(this);
    this.radio = new Radio(this);
    this.weapons = new WeaponSystem(this);
    this.weapons.attach(this.scene);
    this.hud = new HUD(this);
    this.minimap = new Minimap(this, document.getElementById('minimap'));
    this.touch = new TouchControls(this);

    this.#bindEvents();
    this.#buildWorld(1, { menu: true });
    this.state = 'menu';
    this.screens.setLoading(1, 'Listo');
    this.screens.showMenu();
    if (assets.warnings.length) console.warn(assets.warnings);

    // precompilar shaders (enemigos y efectos que aparecen después) para evitar tirones
    this.#warmUpShaders();
    this.renderer.setAnimationLoop(() => {
      try {
        this.#loop();
      } catch (err) {
        // un error en un cuadro no debe congelar el juego: se informa una vez y se sigue
        const key = String(err?.message);
        if (!this.loopErrors.has(key)) {
          this.loopErrors.add(key);
          console.error('[Game] error en el bucle', err);
        }
        this.input.endFrame();
      }
    });
  }

  #warmUpShaders() {
    const far = new THREE.Vector3(0, -80, 0);
    const temp = [
      new PlasmaOrb(this, far, new THREE.Vector3()),
      new EnemyBolt(this, far.clone().setX(3), new THREE.Vector3(), 0),
      new Lob(this, far.clone().setX(6), new THREE.Vector3(), 'plasma'),
      new Lob(this, far.clone().setX(9), new THREE.Vector3(), 'acid'),
      new Lob(this, far.clone().setX(12), new THREE.Vector3(), 'shard'),
      new HomingOrb(this, far.clone().setX(15)),
      new Grenade(this, far.clone().setX(18), new THREE.Vector3(), 'frag'),
      new Grenade(this, far.clone().setX(21), new THREE.Vector3(), 'gravity'),
      new Espectro(this, far.clone().setZ(4)),
      new Acechador(this, far.clone().setZ(8)),
      new Centinela(this, far.clone().setZ(12)),
      new Bastion(this, far.clone().setZ(16)),
    ];
    for (const e of temp) e.object3d.position.copy(far);
    this.fx.shockwave(far, 1, 0xffffff);
    this.fx.warning(far, 1, 0.01);
    this.fx.burst('explosion', far);
    this.fx.tracer(far, far.clone().setX(1), 0xffffff);
    this.weapons.trajectory.visible = true;
    try {
      this.renderer.compile(this.scene, this.camera);
    } catch (err) {
      console.warn('No se pudieron precompilar los shaders', err);
    }
    this.weapons.trajectory.visible = false;
    for (const e of temp) e.dispose();
    this.enemies.clear();
    this.damageables.clear();
    this.drones.clear();
    this.fx.reset();
  }

  #createRenderer() {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = this.settings.get('shadows');
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.get('fov'), window.innerWidth / window.innerHeight, 0.1, 900);
    this.camera.position.set(0, 6, 50);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.55, 0.45, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  #bindEvents() {
    window.addEventListener('resize', () => this.#onResize());
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.touch.enabled) this.pause();
    };
    this.input.onLockError = () => {
      if (this.state === 'playing') this.bus.emit('hud:toast', { text: 'Haz clic en la escena para controlar la cámara', type: 'warn', icon: 'mouse' });
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
      else if (key === 'music') this.audio.setMusicVolume(value);
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
    // sonidos de interfaz ligados a eventos
    this.bus.on('hitmarker', ({ head }) => this.audio.play(head ? 'headshot' : 'hitmarker'));
    this.bus.on('hud:kill', () => this.audio.play('kill'));
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

  get difficultyId() {
    return DIFFICULTIES[this.settings.get('difficulty')] ? this.settings.get('difficulty') : 'veterano';
  }

  // ================================================================ mundo
  #disposeWorld() {
    for (const e of this.entities) e.dispose();
    this.entities.clear();
    this.removals = [];
    this.director?.dispose();
    this.level?.dispose();
    this.level = null;
    this.player = null;
    this.boss = null;
    this.enemies.clear();
    this.damageables.clear();
    this.drones.clear();
  }

  #buildWorld(index, opts = {}) {
    this.state = 'loading';
    this.#disposeWorld();
    this.physics.create(this.settings.get('gravity'));
    this.fx.reset();
    this.radio.clear();
    this.difficulty = DIFFICULTIES[this.difficultyId];
    this.levelIndex = index;
    this.director = new EnemyDirector(this);
    this.spawner = new Spawner(this);

    const LevelClass = LEVEL_CLASSES[index - 1];
    this.level = new LevelClass(this, opts);
    this.level.build();
    const sp = this.level.spawn;
    this.player = new Player(this, sp.pos, sp.yaw);
    this.addEntity(this.player);
    const loadout = opts.loadout ?? LOADOUTS[index];
    this.weapons.reset(loadout);
    // asentar la física antes de mostrar nada (también actualiza las consultas espaciales)
    for (let i = 0; i < 30; i++) this.physics.step(1 / 60, (h) => this.#fixed(h), (a, b, s, c1, c2) => this.#onCollision(a, b, s, c1, c2));
    this.#processRemovals();
    this.physics.refreshQueries();
    this.cameraRig.reset(this.player.chestPosition(), sp.yaw - Math.PI);
    this.env.setTension(0);
    this.audio.setTension(0);
    this.minimap.rebuild(this.level);
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
    for (const e of this.entities) {
      if (!e.alive) continue;
      try {
        e.fixedUpdate(h);
      } catch (err) {
        this.#entityError(e, err);
      }
    }
  }

  /** Un fallo en una entidad no debe detener al resto del mundo. */
  #entityError(e, err) {
    const key = `${e.type}:${err?.message}`;
    if (!this.loopErrors?.has(key)) {
      this.loopErrors?.add(key);
      console.error(`[Game] error en la entidad "${e.type}"`, err);
    }
    e.errors = (e.errors ?? 0) + 1;
    if (e.errors > 30 && e !== this.player) e.destroy();
  }

  // ================================================================ campaña
  showBriefing(index) {
    this.audio.unlock();
    this.levelIndex = index;
    this.hud.hide();
    this.touch.show(false);
    this.input.exitLock();
    this.state = 'briefing';
    this.screens.showBriefing(LEVELS[index - 1], DIFFICULTIES[this.difficultyId]);
  }

  startLevel(index, opts = {}) {
    this.audio.unlock();
    this.screens.show('loading');
    this.screens.setLoading(0.5, `Desplegando en ${LEVELS[index - 1].place}…`);
    // dejar que se pinte la pantalla de carga antes de construir
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        this.#buildWorld(index, opts);
        this.state = 'playing';
        if (!opts.stage || opts.stage === 'start') this.checkpointData = null;
        this.screens.hideAll();
        this.hud.reset();
        this.hud.show();
        this.touch.show(true);
        this.input.clear();
        if (!this.touch.enabled) this.input.requestLock();
        this.clock.getDelta();
        this.level.begin();
        const info = LEVELS[index - 1];
        this.hud.banner(`${info.code} · ${info.title}`, `${info.place} · ${this.difficulty.label}`, 'info');
        this.bus.emit('game:start', { level: index, difficulty: this.difficulty });
        resolve();
      }));
    });
  }

  /** Guarda el punto de control (equipo y puntaje) para reintentar al jefe. */
  saveCheckpoint() {
    const w = this.weapons;
    this.checkpointData = {
      level: this.levelIndex,
      stage: this.level.checkpoint?.stage,
      loadout: {
        weapons: [...w.owned],
        current: w.current,
        grenades: { ...w.grenades },
        ammo: JSON.parse(JSON.stringify(w.ammo)),
      },
      score: this.level.score,
      stats: { ...this.level.stats },
    };
    this.bus.emit('hud:toast', { text: 'Punto de control guardado', type: 'info', icon: 'bookmark-check-fill' });
  }

  retryCheckpoint() {
    const cp = this.checkpointData;
    if (!cp) return this.restartLevel();
    const loadout = cp.loadout;
    // al reintentar se repone parte de la munición y granadas
    for (const id of loadout.weapons) {
      loadout.ammo[id].reserve = Math.max(loadout.ammo[id].reserve, Math.ceil(WEAPONS[id].maxReserve * 0.6));
      loadout.ammo[id].mag = WEAPONS[id].mag;
    }
    loadout.grenades.frag = Math.max(loadout.grenades.frag, 2);
    loadout.grenades.gravity = Math.max(loadout.grenades.gravity, 1);
    return this.startLevel(cp.level, { stage: cp.stage, loadout, score: cp.score, stats: cp.stats });
  }

  restartLevel() {
    this.checkpointData = null;
    return this.startLevel(this.levelIndex);
  }

  nextLevel() {
    const next = this.levelIndex + 1;
    if (next > LEVELS.length) return this.quitToMenu();
    this.showBriefing(next);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.weapons.cancelCharge();
    this.input.exitLock();
    this.input.clear();
    this.screens.showPause();
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
    this.input.exitLock();
    this.hud.hide();
    this.touch.show(false);
    this.audio.resume();
    this.music.setIntensity(0);
    this.#buildWorld(1, { menu: true });
    this.state = 'menu';
    this.screens.showMenu();
  }

  onLevelComplete(result) {
    if (this.state !== 'playing') return;
    this.state = 'levelComplete';
    this.input.exitLock();
    this.touch.show(false);
    this.weapons.cancelCharge();
    this.player.celebrate();
    this.music.setIntensity(0);
    this.campaign.scores[result.level] = result.score;
    result.record = Progress.submit(result.level, this.difficultyId, result.score);
    Progress.unlock(result.level + 1);
    this.checkpointData = null;
    this.audio.play(result.final ? 'victory' : 'levelComplete');
    this.bus.emit('game:levelComplete', result);
    setTimeout(() => {
      if (this.state !== 'levelComplete') return;
      this.hud.hide();
      if (result.final) {
        Progress.markCompleted();
        this.state = 'victory';
        const total = Object.values(this.campaign.scores).reduce((a, b) => a + b, 0);
        this.screens.showVictory({ ...result, campaignTotal: total, levelsPlayed: Object.keys(this.campaign.scores).length });
      } else {
        this.screens.showLevelComplete(result);
      }
    }, 1600);
  }

  onDefeat(result) {
    if (this.state !== 'playing') return;
    this.state = 'defeat';
    this.input.exitLock();
    this.touch.show(false);
    if (this.player && !this.player.dead) {
      this.player.dead = true;
      this.player.sad = 1;
      this.player.anim.once('Death');
    }
    this.weapons.cancelCharge();
    this.music.setIntensity(0);
    this.audio.play('defeat');
    this.bus.emit('game:defeat', result);
    const canCheckpoint = !!(this.checkpointData && this.checkpointData.level === this.levelIndex);
    setTimeout(() => {
      if (this.state !== 'defeat') return;
      this.hud.hide();
      this.screens.showDefeat({ ...result, canCheckpoint });
    }, 2200);
  }

  tryInteract() {
    if (!this.player?.canAct()) return;
    this.level?.interact();
  }

  // ================================================================ bucle
  #autoMusic(dt) {
    this.musicT -= dt;
    if (this.musicT > 0 || !this.audio.music) return;
    this.musicT = 0.5;
    let lvl = 0;
    if (this.state === 'playing' && this.player) {
      if (this.boss) lvl = 3;
      else {
        let n = 0;
        for (const e of this.enemies) if (e.alerted && !e.dead && e.currPos.distanceTo(this.player.currPos) < 38) n++;
        lvl = n >= 4 ? 2 : n >= 1 ? 1 : 0;
      }
    }
    this.audio.music.update(lvl);
    this.audio.setTension(this.env.intensity);
  }

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

    const simulate = state !== 'paused' && state !== 'loading';
    let alpha = 1;
    if (simulate && this.level) {
      alpha = this.physics.step(dt, (h) => this.#fixed(h), (a, b, s, c1, c2) => this.#onCollision(a, b, s, c1, c2));
      this.#processRemovals();
      if (state === 'playing') {
        this.weapons.update(dt);
        this.director.update(dt);
        this.radio.update(dt);
      }
      for (const e of this.entities) {
        if (!e.alive) continue;
        try {
          e.update(dt, alpha);
        } catch (err) {
          this.#entityError(e, err);
        }
      }
      for (const e of this.physics.bodiesToSync) e.syncVisual(alpha);
      this.level.update(dt);
      this.#processRemovals();
    }

    // cámara
    const player = this.player;
    if (player) {
      if (state === 'menu' || state === 'briefing') {
        this.cameraRig.updateMenu(dt, player.object3d.position);
        if (Math.random() < dt * 0.1) player.wave();
      } else if (state !== 'paused' && state !== 'loading') {
        const running = player.running && Math.hypot(player.velocity.x, player.velocity.z) > 4;
        const aiming = state === 'playing' && (this.weapons.aiming || this.weapons.charging);
        const scoped = state === 'playing' && this.weapons.scoped && !this.weapons.reloading;
        this.cameraRig.update(dt, player.chestPosition(), { aiming, running, scoped });
        // con la mira telescópica, la cámara está en la cabeza: ocultar el modelo
        player.object3d.visible = this.cameraRig.currentDistance > 0.9;
        player.weaponView.root.visible = player.object3d.visible && player.weaponView.root.visible;
      }
      this.env.update(dt, player.object3d.position, this.camera, this.renderer.getPixelRatio());
    }
    this.fx.update(state === 'paused' ? 0 : dt, this.renderer.getPixelRatio());
    if (state === 'playing' || state === 'levelComplete' || state === 'victory' || state === 'defeat') {
      this.hud.update(dt);
      this.minimap.update(dt);
    }
    this.#autoMusic(dt);

    if (this.settings.get('bloom')) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    input.endFrame();
  }
}

