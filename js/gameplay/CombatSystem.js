/**
 * CombatSystem — mecánicas de ataque de CHISPA:
 *
 *  1. Orbe de energía (clic izquierdo): mantener para cargar, soltar para lanzar.
 *     Trayectoria balística real (gravedad configurable) con vista previa.
 *  2. Golpe (F): impulso en cono frente al robot.
 *  3. Onda sísmica (Q): impulso radial que derriba drones y empuja todo.
 *  + Explosiones (barriles, drones) con impulso radial, daño y reacción en cadena.
 */
import * as THREE from 'three';
import { EnergyOrb } from '../entities/Projectiles.js';
import { COLLISION, COMBAT, G, groups } from '../config.js';
import { heightAt } from '../world/Terrain.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const DYNAMIC_QUERY = groups(0xffff, G.PROP | G.DRONE | G.DEBRIS);
const TRAJ_POINTS = 64;

export class CombatSystem {
  constructor(game) {
    this.game = game;
    this.charging = false;
    this.charge = 0;
    this.punchCooldown = 0;
    this.pulseCooldown = 0;
    this.pendingPunch = -1;
    this.stats = { orbs: 0 };

    // vista previa de trayectoria
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAJ_POINTS * 3), 3));
    const alpha = new Float32Array(TRAJ_POINTS);
    for (let i = 0; i < TRAJ_POINTS; i++) alpha[i] = 1 - i / TRAJ_POINTS;
    geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0x8ff0ff) }, uTime: { value: 0 } },
      vertexShader: 'attribute float alpha; varying float vA; varying float vI; void main(){ vA = alpha; vI = (1.0 - alpha) * 64.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} ',
      fragmentShader: 'uniform vec3 uColor; uniform float uTime; varying float vA; varying float vI; void main(){ float dash = step(0.5, fract(vI*0.5 - uTime*3.0)); gl_FragColor = vec4(uColor, vA * (0.35 + dash*0.65)); }',
    });
    this.trajectory = new THREE.Line(geo, mat);
    this.trajectory.frustumCulled = false;
    this.trajectory.visible = false;
    // puntos brillantes sobre la misma geometría (más legibles que una línea de 1 px)
    this.trajectoryDots = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0x9ff4ff,
        size: 0.16,
        map: game.fx.createGlowSprite(0xffffff, 1).material.map,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.trajectoryDots.frustumCulled = false;
    this.trajectory.add(this.trajectoryDots);
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 0.4, 32),
      new THREE.MeshBasicMaterial({ color: 0x8ff0ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })
    );
    this.marker.visible = false;
  }

  attach(scene) {
    scene.add(this.trajectory);
    scene.add(this.marker);
  }

  reset() {
    this.charging = false;
    this.charge = 0;
    this.punchCooldown = 0;
    this.pulseCooldown = 0;
    this.pendingPunch = -1;
    this.stats = { orbs: 0 };
    this.trajectory.visible = false;
    this.marker.visible = false;
  }

  get player() {
    return this.game.player;
  }

  update(dt) {
    const { game } = this;
    const player = this.player;
    this.punchCooldown -= dt;
    this.pulseCooldown -= dt;
    this.trajectory.material.uniforms.uTime.value += dt;

    if (this.pendingPunch >= 0) {
      this.pendingPunch -= dt;
      if (this.pendingPunch < 0) this.#resolvePunch();
    }

    const canAct = player && player.canAct() && game.state === 'playing';
    if (!canAct) {
      if (this.charging) this.cancelCharge();
      return;
    }
    const input = game.input;

    // --- orbe de energía
    if (input.pressed('throw') && !this.charging) {
      if (player.energy >= COMBAT.orbCost) {
        this.charging = true;
        this.charge = 0;
        game.audio.startCharge();
      } else {
        game.bus.emit('hud:toast', { text: 'Energía insuficiente', type: 'warn', icon: 'lightning' });
        game.audio.play('denied');
      }
    }
    if (this.charging) {
      this.charge = Math.min(1, this.charge + dt / COMBAT.chargeTime);
      game.audio.updateCharge(this.charge);
      const launch = this.computeLaunch(this.charge);
      if (game.settings.get('showTrajectory')) this.#updateTrajectory(launch);
      if (input.released('throw') || !input.down('throw')) this.#throw(launch);
    }

    // --- golpe
    if (input.pressed('punch') && this.punchCooldown <= 0) this.punch();

    // --- onda sísmica
    if (input.pressed('pulse')) {
      if (this.pulseCooldown > 0) {
        game.audio.play('denied');
      } else if (player.energy < COMBAT.pulseCost) {
        game.bus.emit('hud:toast', { text: 'Energía insuficiente para la onda', type: 'warn', icon: 'lightning' });
        game.audio.play('denied');
      } else {
        this.pulse();
      }
    }
  }

  cancelCharge() {
    if (this.charging) this.game.audio.stopCharge();
    this.charging = false;
    this.charge = 0;
    this.trajectory.visible = false;
    this.marker.visible = false;
  }

  /** Punto de salida y velocidad inicial del orbe según la mira central. */
  computeLaunch(charge) {
    const { game } = this;
    const player = this.player;
    const cam = game.camera;
    const camDir = cam.getWorldDirection(_a).clone();
    // destino: lo que haya bajo la mira (ignorando al propio jugador)
    const hit = game.physics.raycast(cam.position, camDir, 140, {
      groups: COLLISION.aimQuery,
      excludeCollider: player.collider,
    });
    const target = hit ? hit.point : cam.position.clone().addScaledVector(camDir, 140);

    const fwd = game.cameraRig.forward(_b);
    const right = game.cameraRig.right(_c);
    const chest = player.chestPosition(new THREE.Vector3());
    const origin = chest.clone().addScaledVector(fwd, 0.62).addScaledVector(right, 0.3);
    origin.y += 0.2;
    // evitar que el orbe nazca dentro de una pared
    const toOrigin = origin.clone().sub(chest);
    const len = toOrigin.length();
    const wall = game.physics.raycast(chest, toOrigin.normalize(), len, { groups: COLLISION.cameraQuery });
    if (wall) origin.copy(chest).addScaledVector(toOrigin, Math.max(0, wall.distance - 0.25));

    const speed = game.settings.get('throwPower') * (COMBAT.orbMinSpeedFactor + (1 - COMBAT.orbMinSpeedFactor) * charge);
    const dir = target.clone().sub(origin);
    const dist = dir.length();
    dir.normalize();
    // compensación balística: apuntar un poco más arriba según la gravedad
    const g = game.physics.gravity;
    const t = Math.min(dist / speed, 2.2);
    const lift = Math.min(0.5 * g * t, speed * 0.6);
    const velocity = dir.multiplyScalar(speed);
    velocity.y += lift;
    return { origin, velocity, speed, charge };
  }

  #updateTrajectory({ origin, velocity }) {
    const g = this.game.physics.gravity;
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
        const hit = this.game.physics.raycast(last, seg.normalize(), l, {
          groups: COLLISION.aimQuery,
          excludeCollider: this.player.collider,
        });
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
    } else {
      this.marker.visible = false;
    }
  }

  #throw(launch) {
    const { game } = this;
    const player = this.player;
    this.charging = false;
    this.trajectory.visible = false;
    this.marker.visible = false;
    game.audio.stopCharge();
    player.energy -= COMBAT.orbCost;
    const orb = new EnergyOrb(game, launch.origin, launch.velocity, launch.charge);
    game.addEntity(orb);
    player.playAttack('throw');
    game.audio.play('throw', launch.origin, { pitch: 0.9 + launch.charge * 0.3 });
    this.stats.orbs++;
    this.charge = 0;
  }

  /** Impacto del orbe: ráfaga radial + reacción específica del objetivo. */
  orbImpact(orb, other, point, dir, speed) {
    const { game } = this;
    const power = THREE.MathUtils.clamp(speed / 20, 0.35, 1.4) * (1 + orb.charge * 0.5);
    const touched = game.physics.radialImpulse(point, COMBAT.orbBurstRadius, COMBAT.orbBurstDeltaV * power, {
      upBias: 0.25,
      groups: DYNAMIC_QUERY,
      exclude: orb.body,
    });
    const info = { kind: 'orb', point, dir, strength: power };
    if (other && other !== orb && other.hit) other.hit(info);
    for (const e of touched) if (e !== other && e !== orb && e.type === 'supply' && power > 0.8) e.hit(info);
    // drones cercanos (cinemáticos: no reciben impulsos de Rapier)
    for (const d of game.squad?.drones ?? []) {
      if (d !== other && d.isActive && d.currPos.distanceTo(point) < 1.6) d.hit(info);
    }
    game.fx.burst('orbImpact', point);
    game.fx.flash(point, 0x7fe8ff, 6 * power, 0.25);
    game.audio.play('impact', point, { gain: Math.min(1, power) });
    if (other && other.type !== 'world') game.mission?.registerHit();
  }

  punch() {
    const player = this.player;
    this.punchCooldown = COMBAT.punchCooldown;
    player.playAttack('punch');
    this.game.audio.play('whoosh', player.currPos);
    this.pendingPunch = 0.2;
  }

  #resolvePunch() {
    const { game } = this;
    const player = this.player;
    if (!player || player.dead) return;
    const fwd = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
    const center = player.currPos.clone().addScaledVector(fwd, COMBAT.punchRange * 0.7);
    center.y += 0.1;
    const dir = fwd.clone();
    dir.y = 0.35;
    dir.normalize();
    const seen = new Set();
    let hitSomething = false;
    for (const c of game.physics.overlapSphere(center, COMBAT.punchRadius, { groups: DYNAMIC_QUERY })) {
      const e = game.physics.ownerOf(c);
      if (!e || seen.has(e) || e === player) continue;
      seen.add(e);
      hitSomething = true;
      e.push?.(dir, COMBAT.punchDeltaV);
      e.hit?.({ kind: 'punch', point: center.clone(), dir });
    }
    for (const d of game.squad?.drones ?? []) {
      if (!seen.has(d) && d.isActive && d.currPos.distanceTo(center) < 2.2) {
        d.hit({ kind: 'punch', point: center.clone(), dir });
        hitSomething = true;
      }
    }
    if (hitSomething) {
      game.fx.burst('punch', center);
      game.audio.play('punch', center);
      game.cameraRig.shake(0.25);
    }
  }

  pulse() {
    const { game } = this;
    const player = this.player;
    player.energy -= COMBAT.pulseCost;
    this.pulseCooldown = COMBAT.pulseCooldown;
    player.playAttack('pulse');
    const center = player.feetPosition.clone();
    center.y += 0.4;
    const touched = game.physics.radialImpulse(center, COMBAT.pulseRadius, COMBAT.pulseDeltaV, {
      upBias: 0.55,
      groups: DYNAMIC_QUERY,
    });
    for (const e of touched) e.hit?.({ kind: 'pulse', point: center.clone() });
    for (const d of game.squad?.drones ?? []) {
      if (d.isActive && d.currPos.distanceTo(center) < COMBAT.pulseRadius) {
        d.hit({ kind: 'pulse', point: center.clone(), dir: d.currPos.clone().sub(center).normalize() });
      }
    }
    game.fx.shockwave(center, COMBAT.pulseRadius, 0x8ff0ff);
    game.fx.burst('pulse', center);
    game.fx.flash(center, 0x8ff0ff, 8, 0.3);
    game.audio.play('pulse', center);
    game.cameraRig.shake(0.35);
  }

  /** Explosión genérica (barriles, drones) con daño y reacción en cadena. */
  explode(center, { radius = 6, deltaV = 14, playerDamage = 30, source = null, small = false } = {}) {
    const { game } = this;
    const touched = game.physics.radialImpulse(center, radius, deltaV, {
      upBias: 0.55,
      groups: DYNAMIC_QUERY,
      exclude: source?.body,
    });
    const info = { kind: 'explosion', point: center, strength: 1 };
    for (const e of touched) if (e !== source) e.hit?.({ ...info, dir: e.currPos ? e.currPos.clone().sub(center).normalize() : undefined });
    for (const d of game.squad?.drones ?? []) {
      if (d !== source && d.isActive && d.currPos.distanceTo(center) < radius * 0.8) {
        d.hit({ ...info, dir: d.currPos.clone().sub(center).normalize() });
      }
    }
    const player = game.player;
    if (player && !player.dead) {
      const d = player.currPos.distanceTo(center);
      const r = radius * 0.8;
      if (d < r) {
        player.damage(playerDamage * (1 - d / r) + 4, 'explosion');
        // empujón al jugador (el KCC no es dinámico: se simula con velocidad)
        const away = player.currPos.clone().sub(center).setY(0).normalize();
        player.hVel.addScaledVector(away, 7 * (1 - d / r));
        player.vy = Math.max(player.vy, 5 * (1 - d / r));
      }
    }
    game.fx.burst(small ? 'smallExplosion' : 'explosion', center);
    game.fx.shockwave(center, radius * 0.9, 0xffa040);
    game.fx.flash(center, 0xff9a40, small ? 12 : 30, small ? 0.35 : 0.6);
    game.audio.play(small ? 'smallExplosion' : 'explosion', center);
    game.cameraRig.shakeFrom(center, small ? 0.6 : 1.3);
  }
}
