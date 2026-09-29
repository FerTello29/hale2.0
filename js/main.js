/**
 * main.js — punto de entrada. Crea el juego y maneja errores de arranque.
 *
 * VETA AIROSA · Operación Núcleo de Plata
 * Three.js (CDN + import map) · Rapier 3D · Bootstrap 5
 */
import { Game } from './core/Game.js';

const canvas = document.getElementById('game-canvas');
const game = new Game(canvas);

// Herramienta de depuración opcional: agrega ?debug a la URL
if (new URLSearchParams(location.search).has('debug')) window.game = game;

game.init().catch((err) => {
  if (err?.message === 'file-protocol') return;
  console.error(err);
  const msg = err?.message?.includes('WebGL')
    ? 'Tu navegador o tarjeta gráfica no soporta WebGL 2. Prueba con Chrome, Edge o Firefox actualizados.'
    : `No se pudo iniciar el juego: ${err?.message || err}. Revisa la consola (F12) y tu conexión a Internet (las librerías se cargan desde CDN).`;
  game.screens?.showError(msg);
});
