/**
 * WeaponSystem — arsenal de NOVA-7.
 *
 *  1 Rifle de pulsos (automático, impacto instantáneo por raycast)
 *  2 Dispersor (10 perdigones en cono)
 *  3 Lanzaorbes (mantener para cargar; proyectil físico que explota)
 *  4 Rifle de riel (atraviesa enemigos, mira telescópica con clic derecho)
 *  + Recarga (R), cargadores y reserva, granadas (G: fragmentación / singularidad,
 *    T para cambiar), golpe cuerpo a cuerpo (F) y pulso de choque (Q).
 *
 * Los disparos por raycast aplican impulsos reales de Rapier en el punto de
 * impacto (applyImpulseAtPoint) y detectan tiros a la cabeza.
 */
import * as THREE from 'three';
import { PlasmaOrb, Grenade } from '../entities/Projectiles.js';
import { WEAPONS, WEAPON_ORDER, GRENADES, ABILITIES, COLLISION, G, groups } from '../config.js';
import { heightAt } from '../world/TerrainField.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aimOrigin = new THREE.Vector3();
const _perp1 = new THREE.Vector3();
const _perp2 = new THREE.Vector3();
const DYNAMIC_QUERY = groups(0xffff, G.PROP | G.ENEMY | G.DEBRIS);
const TRAJ_POINTS = 64;

export class WeaponSystem {
  constructor(game) {
    this.game = game;
    this.aimPoint = new THREE.Vector3();
    this.#buildTrajectory();
    this.reset({ weapons: ['rifle'] });
  }

  #buildTrajectory() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAJ_POINTS * 3), 3));
    this.trajectory = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0x9ff4ff,
        size: 0.16,
        map: this.game.fx.createGlowSprite(0xffffff, 1).material.map,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.trajectory.frustumCulled = false;
    this.trajectory.visible = false;
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.45, 32),
      new THREE.MeshBasicMaterial({ color: 0x9ff4ff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })
    );
    this.marker.visible = false;
  }

  attach(scene) {
    scene.add(this.trajectory);
    scene.add(this.marker);
  }

  /** Carga inicial del nivel. */
  reset({ weapons = ['rifle'], current, grenades = {}, ammo = {} } = {}) {
    this.owned = new Set(weapons);
    this.ammo = {};
    for (const id of WEAPON_ORDER) {
      const d = WEAPONS[id];
      this.ammo[id] = { mag: d.mag, reserve: d.reserve, ...(ammo[id] || {}) };
    }
    this.current = current && this.owned.has(current) ? current : weapons[0];
    this.grenades = { frag: grenades.frag ?? GRENADES.frag.start, gravity: grenades.gravity ?? GRENADES.gravity.start };
    this.grenadeType = 'frag';
    this.grenadeAiming = false;
    this.cooldown = 0;
    this.reloadT = 0;
    this.switchT = 0;
    this.charge = 0;
    this.charging = false;
    this.bloom = 0;
    this.lastFire = -10;
    this.meleeCd = 0;
    this.pulseCd = 0;
    this.grenadeCd = 0;
    this.aiming = false;
    this.stats = { shots: 0, hits: 0, headshots: 0 };
    this.trajectory.visible = false;
    this.marker.visible = false;
    this.#equipModel();
  }

  get def() {
    return WEAPONS[this.current];
  }

  get state() {
    return this.ammo[this.current];
  }

  get reloading() {
    return this.reloadT > 0;
  }

  get recentlyFired() {
    return this.game.time - this.lastFire < 1.1;
  }

  get scoped() {
    return this.aiming && this.def.scope;
  }

  #equipModel() {
    const player = this.game.player;
    if (!player || !this.game.assets) return;
    player.setWeaponModel(this.current, this.game.assets.cloneProp(this.def.prop));
  }

  unlock(id, equip = false) {
    const wasOwned = this.owned.has(id);
    this.owned.add(id);
    const d = WEAPONS[id];
    const a = this.ammo[id];
    a.mag = d.mag;
    a.reserve = Math.max(a.reserve, d.reserve);
    if (equip || !wasOwned) this.switchTo(id, true);
  }

  addAmmoPack(fraction = 0.4) {
    let added = false;
    for (const id of this.owned) {
      const d = WEAPONS[id];
      const a = this.ammo[id];
      if (a.reserve >= d.maxReserve) continue;
      const amount = Math.max(d.mag, Math.ceil(d.maxReserve * fraction));
      a.reserve = Math.min(d.maxReserve, a.reserve + amount);
      added = true;
    }
    return added;
  }

  addGrenades(frag, gravity) {
    const before = this.grenades.frag + this.grenades.gravity;
    this.grenades.frag = Math.min(GRENADES.frag.max, this.grenades.frag + frag);
    this.grenades.gravity = Math.min(GRENADES.gravity.max, this.grenades.gravity + gravity);
    return this.grenades.frag + this.grenades.gravity > before;
  }

  switchTo(id, force = false) {
    if (!this.owned.has(id) || (id === this.current && !force)) return;
    this.cancelCharge();
    this.reloadT = 0;
    this.current = id;
    this.switchT = 0.35;
    this.bloom = 0;
    this.#equipModel();
    this.game.audio.play('switch');
    this.game.bus.emit('weapon:switched', { id });
  }

  #cycle(step) {
    const list = WEAPON_ORDER.filter((w) => this.owned.has(w));
    const i = list.indexOf(this.current);
    this.switchTo(list[(i + step + list.length) % list.length]);
  }

  cancelCharge() {
    if (this.charging) this.game.audio.stopCharge();
    this.charging = false;
    this.charge = 0;
    this.grenadeAiming = false;
    this.trajectory.visible = false;
    this.marker.visible = false;
  }

  startReload() {
    const a = this.state;
    const d = this.def;
    if (this.reloading || a.mag >= d.mag || a.reserve <= 0) return false;
    this.cancelCharge();
    this.reloadT = d.reload;
    this.game.audio.play('reload');
    this.game.bus.emit('weapon:reload', { id: this.current, duration: d.reload });
    return true;
  }

  // ================================================================ punto de mira
  #updateAimPoint() {
    const { game } = this;
    // cámara en pantalla normal; control derecho dentro del visor VR
    const origin = _aimOrigin;
    const dir = _a;
    game.aimRay(origin, dir);
    const hit = game.physics.raycast(origin, dir, 220, {
      groups: COLLISION.aimQuery,
      excludeCollider: game.player?.collider,
    });
    if (hit && hit.distance > 1.2) this.aimPoint.copy(hit.point);
    else this.aimPoint.copy(origin).addScaledVector(dir, 220);
    this.aimTarget = hit?.entity ?? null;
  }

  // ================================================================ ciclo
  update(dt) {
    const { game } = this;
    const player = game.player;
    this.cooldown -= dt;
    this.switchT -= dt;
    this.meleeCd -= dt;
    this.pulseCd -= dt;
    this.grenadeCd -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.12);
    if (this.pendingMelee !== undefined) {
      this.pendingMelee -= dt;
      if (this.pendingMelee <= 0) {
        this.pendingMelee = undefined;
        this.#resolveMelee();
      }
    }
    this.#updateAimPoint();

    const canAct = player && player.canAct() && game.state === 'playing';
    if (!canAct) {
      this.cancelCharge();
      this.aiming = false;
      return;
    }
    const input = game.input;
    this.aiming = input.down('aim');

    // recarga en curso
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const a = this.state;
        const take = Math.min(this.def.mag - a.mag, a.reserve);
        a.mag += take;
        a.reserve -= take;
        this.game.audio.play('reloadEnd');
      }
    }

    // cambio de arma
    for (const id of WEAPON_ORDER) if (input.pressed(`weapon${WEAPONS[id].slot}`)) this.switchTo(id);
    const wheel = input.consumeWheel();
    if (wheel) this.#cycle(wheel > 0 ? 1 : -1);
    if (input.pressed('nextWeapon')) this.#cycle(1);
    if (input.pressed('reload')) this.startReload();

    // disparo
    const d = this.def;
    const a = this.state;
    const ready = this.cooldown <= 0 && this.switchT <= 0 && this.reloadT <= 0;
    if (d.mode === 'charge') {
      if (input.pressed('fire') && ready) {
        if (a.mag > 0) {
          this.charging = true;
          this.charge = 0;
          game.audio.startCharge();
        } else if (!this.startReload()) game.audio.play('empty');
      }
      if (this.charging) {
        this.charge = Math.min(1, this.charge + dt / d.chargeTime);
        game.audio.updateCharge(this.charge);
        const launch = this.#orbLaunch(this.charge);
        if (game.settings.get('showTrajectory')) this.#drawTrajectory(launch.origin, launch.velocity, 0.55);
        if (input.released('fire') || !input.down('fire')) this.#fireOrb(launch);
      }
    } else {
      const wants = d.mode === 'auto' ? input.down('fire') : input.pressed('fire');
      if (wants && ready) {
        if (a.mag > 0) this.#fireHitscan();
        else if (input.pressed('fire') && !this.startReload()) game.audio.play('empty');
        else if (d.mode === 'auto' && a.reserve > 0) this.startReload();
      }
    }

    // granadas
    if (input.pressed('grenadeSwitch')) {
      const other = this.grenadeType === 'frag' ? 'gravity' : 'frag';
      this.grenadeType = other;
      game.audio.play('switch');
      game.bus.emit('hud:toast', { text: `Granada: ${GRENADES[other].name}`, type: 'gold', icon: other === 'frag' ? 'circle-fill' : 'hurricane' });
    }
    if (input.pressed('grenade') && this.grenadeCd <= 0 && !this.charging) {
      if (this.grenades[this.grenadeType] > 0) this.grenadeAiming = true;
      else {
        game.audio.play('empty');
        game.bus.emit('hud:toast', { text: `Sin granadas de ${GRENADES[this.grenadeType].name.toLowerCase()}`, type: 'danger', icon: 'x-circle' });
      }
    }
    if (this.grenadeAiming) {
      const launch = this.#grenadeLaunch();
      if (game.settings.get('showTrajectory')) this.#drawTrajectory(launch.origin, launch.velocity, 1);
      if (input.released('grenade') || !input.down('grenade')) this.#throwGrenade(launch);
    }

    if (input.pressed('melee') && this.meleeCd <= 0) this.#melee();
    if (input.pressed('pulse')) {
      if (this.pulseCd <= 0) this.#pulse();
      else game.audio.play('denied');
    }
    if (!this.charging && !this.grenadeAiming) {
      this.trajectory.visible = false;
      this.marker.visible = false;
    }
  }

  // ================================================================ armas de impacto instantáneo
  #randomCone(dir, angle, out) {
    _perp1.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.95) _perp1.set(1, 0, 0);
    _perp1.cross(dir).normalize();
    _perp2.copy(dir).cross(_perp1).normalize();
    const r = Math.sqrt(Math.random()) * angle;
    const t = Math.random() * Math.PI * 2;
    return out.copy(dir).addScaledVector(_perp1, Math.cos(t) * r).addScaledVector(_perp2, Math.sin(t) * r).normalize();
  }

  #fireHitscan() {
    const { game } = this;
    const d = this.def;
    const player = game.player;
    this.state.mag -= 1;
    this.cooldown = 1 / d.fireRate;
    this.lastFire = game.time;
    this.stats.shots += 1;
    const muzzle = player.muzzlePosition(_b).clone();
    const base = _c.copy(this.aimPoint).sub(muzzle).normalize();
    // si algo tapa el cañón (pared muy cerca), disparar desde el pecho
    const block = game.physics.raycast(player.chestPosition(new THREE.Vector3()), _a.copy(muzzle).sub(player.chestPosition(new THREE.Vector3())).normalize(), 1.2, { groups: COLLISION.cameraQuery });
    if (block) muzzle.copy(block.point).addScaledVector(base, -0.1);
    const spread = (this.aiming ? d.aimSpread : d.spread) + this.bloom;
    let hitEnemy = false;
    let head = false;
    for (let i = 0; i < d.pellets; i++) {
      const dir = this.#randomCone(base, spread, new THREE.Vector3());
      const res = this.#trace(muzzle, dir, d);
      hitEnemy = hitEnemy || res.enemy;
      head = head || res.head;
      game.fx.tracer(muzzle, res.end, d.tracer, d.id === 'rail' ? 'beam' : d.id === 'shotgun' ? 'pellet' : 'tracer');
    }
    if (hitEnemy) {
      this.stats.hits += 1;
      game.bus.emit('hitmarker', { head });
    }
    this.bloom = Math.min(0.06, this.bloom + (d.id === 'rifle' ? 0.004 : 0.02));
    game.fx.muzzle(muzzle, base, d.tracer, d.id === 'shotgun' || d.id === 'rail' ? 1.5 : 1);
    game.audio.play(d.sound, muzzle);
    game.cameraRig.kick(d.recoil);
    game.bus.emit('noise', { pos: muzzle, radius: d.id === 'rail' ? 45 : 32 });
    if (this.state.mag === 0 && this.state.reserve > 0) {
      const id = this.current;
      game.after(0.18, () => this.current === id && this.startReload());
    }
  }

  #trace(origin, dir, d) {
    const { game } = this;
    const hits = d.pierce
      ? game.physics.raycastPiercing(origin, dir, d.range, { groups: COLLISION.bulletQuery, excludeCollider: game.player.collider, maxHits: d.pierce })
      : [game.physics.raycast(origin, dir, d.range, { groups: COLLISION.bulletQuery, excludeCollider: game.player.collider })].filter(Boolean);
    let end = origin.clone().addScaledVector(dir, d.range);
    let enemy = false;
    let head = false;
    for (const hit of hits) {
      end = hit.point;
      const e = hit.entity;
      const isEnemy = e && e.faction === 'enemy';
      if (e && e.type !== 'world' && e.takeDamage) {
        const isHead = !!e.isHeadshot?.(hit.point);
        const weak = !!e.isWeakPoint?.(hit.point);
        const dmg = d.damage * (isHead ? d.headMult : 1);
        const real = e.takeDamage(dmg, { kind: 'bullet', source: 'player', point: hit.point, dir, headshot: isHead, weak, weapon: d.id, force: d.impulse });
        if (isEnemy && real > 0) {
          enemy = true;
          if (isHead) {
            head = true;
            this.stats.headshots += 1;
          }
        }
      }
      const body = hit.collider?.parent();
      if (body && body.isDynamic()) {
        const j = d.impulse * 8;
        body.applyImpulseAtPoint({ x: dir.x * j, y: dir.y * j, z: dir.z * j }, hit.point, true);
      }
      game.fx.impact(hit.point, hit.normal, isEnemy ? 'enemy' : e?.type === 'world' ? 'world' : 'prop');
    }
    return { end, enemy, head };
  }

  // ================================================================ lanzaorbes
  #orbLaunch(charge) {
    const { game } = this;
    const d = this.def;
    const player = game.player;
    const origin = player.muzzlePosition(new THREE.Vector3());
    const speed = d.speed * (0.6 + 0.4 * charge);
    const dir = this.aimPoint.clone().sub(origin);
    const dist = dir.length();
    dir.normalize();
    const g = game.physics.gravity * 0.55;
    const t = Math.min(dist / speed, 2.4);
    const velocity = dir.multiplyScalar(speed);
    velocity.y += Math.min(0.5 * g * t, speed * 0.6);
    return { origin, velocity, charge };
  }

  #fireOrb(launch) {
    const { game } = this;
    const d = this.def;
    this.charging = false;
    game.audio.stopCharge();
    this.state.mag -= 1;
    this.cooldown = 1 / d.fireRate;
    this.lastFire = game.time;
    this.stats.shots += 1;
    game.addEntity(new PlasmaOrb(game, launch.origin, launch.velocity, { charge: launch.charge, damage: d.damage, radius: d.radius }));
    game.fx.muzzle(launch.origin, launch.velocity.clone().normalize(), 0x7fe8ff, 1.6);
    game.audio.play('orbLaunch', launch.origin, { pitch: 0.9 + launch.charge * 0.3 });
    game.cameraRig.kick(d.recoil);
    this.charge = 0;
    if (this.state.mag === 0) this.startReload();
  }

  // ================================================================ granadas
  #grenadeLaunch() {
    const { game } = this;
    const player = game.player;
    const dir = new THREE.Vector3();
    game.aimRay(new THREE.Vector3(), dir);
    const fwd = game.cameraRig.forward(_a);
    const origin = player.chestPosition(new THREE.Vector3()).addScaledVector(fwd, 0.5);
    origin.y += 0.35;
    const velocity = dir.multiplyScalar(17);
    velocity.y += 3.8;
    return { origin, velocity };
  }

  #throwGrenade(launch) {
    const { game } = this;
    this.grenadeAiming = false;
    this.trajectory.visible = false;
    this.marker.visible = false;
    const type = this.grenadeType;
    if (this.grenades[type] <= 0) return;
    this.grenades[type] -= 1;
    this.grenadeCd = 0.6;
    game.addEntity(new Grenade(game, launch.origin, launch.velocity, type));
    game.player.playAction('throw');
    game.audio.play('throw', launch.origin);
  }

  #drawTrajectory(origin, velocity, gScale) {
    const { game } = this;
    const g = game.physics.gravity * gScale;
    const pos = this.trajectory.geometry.attributes.position;
    const dt = 0.035;
    let last = origin.clone();
    let end = TRAJ_POINTS;
    let landing = null;
    for (let i = 0; i < TRAJ_POINTS; i++) {
      const t = i * dt;
      const p = _a.set(origin.x + velocity.x * t, origin.y + velocity.y * t - 0.5 * g * t * t, origin.z + velocity.z * t);
      if (i > 0 && i % 3 === 0) {
        const seg = p.clone().sub(last);
        const l = seg.length();
        const hit = game.physics.raycast(last, seg.normalize(), l, { groups: COLLISION.aimQuery, excludeCollider: game.player.collider });
        if (hit) {
          landing = hit;
          end = i;
          pos.setXYZ(i, hit.point.x, hit.point.y, hit.point.z);
          break;
        }
        last = p.clone();
      }
      if (p.y < heightAt(p.x, p.z) - 0.2) {
        end = i;
        break;
      }
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    this.trajectory.geometry.setDrawRange(0, Math.max(2, end + (landing ? 1 : 0)));
    this.trajectory.visible = true;
    if (landing) {
      this.marker.visible = true;
      this.marker.position.copy(landing.point).addScaledVector(landing.normal, 0.05);
      this.marker.lookAt(_b.copy(landing.point).add(landing.normal));
    } else this.marker.visible = false;
  }

  // ================================================================ cuerpo a cuerpo y pulso
  #melee() {
    this.meleeCd = ABILITIES.melee.cooldown;
    this.game.player.playAction('melee');
    this.game.audio.play('whoosh');
    this.pendingMelee = 0.16;
  }

  #resolveMelee() {
    const { game } = this;
    const player = game.player;
    if (!player || player.dead) return;
    const fwd = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
    const center = player.currPos.clone().addScaledVector(fwd, 1.1);
    const dir = fwd.clone();
    dir.y = 0.3;
    dir.normalize();
    let hit = false;
    const seen = new Set();
    for (const t of [...game.damageables]) {
      if (!t.alive || t.dead || seen.has(t)) continue;
      const p = t.damagePoint ? t.damagePoint(_a) : t.currPos;
      if (!p || p.distanceTo(center) > ABILITIES.melee.range + (t.hitRadius ?? 0.5)) continue;
      seen.add(t);
      t.takeDamage(ABILITIES.melee.damage, { kind: 'melee', source: 'player', point: center.clone(), dir, force: ABILITIES.melee.deltaV });
      hit = true;
    }
    for (const c of game.physics.overlapSphere(center, 1.0, { groups: DYNAMIC_QUERY })) {
      const e = game.physics.ownerOf(c);
      if (!e || seen.has(e) || e === player) continue;
      seen.add(e);
      e.push?.(dir, ABILITIES.melee.deltaV);
      hit = true;
    }
    if (hit) {
      game.fx.burst('punch', center);
      game.audio.play('punch', center);
      game.cameraRig.shake(0.25);
      game.bus.emit('hitmarker', { head: false });
    }
  }

  #pulse() {
    const { game } = this;
    const player = game.player;
    const P = ABILITIES.pulse;
    this.pulseCd = P.cooldown;
    player.playAction('pulse');
    const center = player.feetPosition.clone();
    center.y += 0.5;
    game.physics.radialImpulse(center, P.radius, P.deltaV, { upBias: 0.55, groups: DYNAMIC_QUERY });
    for (const t of [...game.damageables]) {
      if (!t.alive || t.dead || t.faction !== 'enemy') continue;
      const p = t.damagePoint ? t.damagePoint(_a) : t.currPos;
      if (!p || p.distanceTo(center) > P.radius) continue;
      t.takeDamage(P.damage * (t.type === 'centinela' ? 2 : 1), { kind: 'pulse', source: 'player', point: center.clone(), dir: p.clone().sub(center).normalize(), force: P.deltaV });
      t.stun?.(1.2);
    }
    game.fx.shockwave(center, P.radius, 0x8ff0ff);
    game.fx.burst('pulse', center);
    game.fx.flash(center, 0x8ff0ff, 10, 0.3);
    game.audio.play('pulse', center);
    game.cameraRig.shake(0.35);
  }
}
