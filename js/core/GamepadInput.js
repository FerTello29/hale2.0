/**
 * GamepadInput — controles con la Gamepad API (Xbox, PlayStation, controles
 * Bluetooth de los visores VR Box…), con el mapeo estándar del navegador.
 *
 *   Stick izq.: mover · Stick der.: cámara · RT: disparar · LT: apuntar
 *   A: saltar · B: golpe · X: recargar · Y: siguiente arma · LB: granada
 *   RB: pulso · L3: correr · R3: interactuar · Cruceta ↑: tipo de granada
 *   Cruceta ←/→: arma anterior / siguiente · Start: pausa · Select: voz
 */
const SOURCE = 'gamepad';
const deadzone = (v, dz = 0.2) => (Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz));

const BUTTONS = {
  0: { tap: 'jump' },
  1: { tap: 'melee' },
  2: { tap: 'reload' },
  3: { tap: 'nextWeapon' },
  4: { hold: 'grenade' },
  5: { tap: 'pulse' },
  6: { hold: 'aim' },
  7: { hold: 'fire' },
  10: { toggle: 'run' },
  11: { call: 'interact' },
  12: { tap: 'grenadeSwitch' },
  14: { wheel: -1 },
  15: { wheel: 1 },
  9: { call: 'pause' },
  8: { call: 'voice' },
};

export class GamepadInput {
  constructor(game) {
    this.game = game;
    this.prev = [];
    this.connected = false;
    window.addEventListener('gamepadconnected', (e) => {
      if (e.gamepad.mapping !== 'standard' && !e.gamepad.buttons.length) return;
      this.connected = true;
      game.bus.emit('hud:toast', { text: `Control conectado: ${e.gamepad.id.split('(')[0].trim().slice(0, 32)}`, type: 'info', icon: 'controller' });
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.connected = [...(navigator.getGamepads?.() ?? [])].some(Boolean);
      game.input.releaseAll(SOURCE);
    });
  }

  poll(dt) {
    if (!this.connected || !navigator.getGamepads) return;
    const { game } = this;
    const input = game.input;
    const pads = [...navigator.getGamepads()].filter(Boolean);
    const gp = pads[0];
    if (!gp) return;
    const prev = this.prev;
    for (const [i, map] of Object.entries(BUTTONS)) {
      const now = !!gp.buttons[i]?.pressed || (gp.buttons[i]?.value ?? 0) > 0.5;
      const was = !!prev[i];
      prev[i] = now;
      const down = now && !was;
      const up = !now && was;
      if (map.call === 'pause' && down) game.state === 'paused' ? game.resume() : game.pause();
      if (map.call === 'voice' && down) game.voice.toggle();
      if (game.state !== 'playing') continue;
      if (map.tap && down) input.tap(map.tap);
      if (map.hold) {
        if (down) {
          input.setHold(SOURCE, map.hold, true);
          input.tap(map.hold);
        } else if (up) {
          input.setHold(SOURCE, map.hold, false);
          input.untap(map.hold);
        }
      }
      if (map.toggle && down) input.setHold(SOURCE, map.toggle, !input.holds.get(SOURCE)?.has(map.toggle));
      if (map.call === 'interact' && down) game.tryInteract();
      if (map.wheel && down) input.wheel += map.wheel;
    }
    if (game.state !== 'playing') return;
    input.setAxis(SOURCE, deadzone(gp.axes[0] ?? 0), -deadzone(gp.axes[1] ?? 0));
    const lx = deadzone(gp.axes[2] ?? 0);
    const ly = deadzone(gp.axes[3] ?? 0);
    if (game.immersive === 'cardboard') game.turnView(-lx * dt * 2.2);
    else if (!game.immersive) {
      input.lookDX += lx * dt * 900;
      input.lookDY += ly * dt * 600;
    }
  }
}
