/**
 * TerrainField — registro de la función de altura del nivel activo.
 *
 * Cada nivel define su propia función heightAt(x, z). Los sistemas que
 * necesitan conocer el suelo (IA, cámara, generación de objetos, minimapa)
 * importan heightAt desde aquí sin saber qué nivel está cargado.
 */
import * as THREE from 'three';

let current = () => 0;
let voids = () => false;

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const mix = (a, b, t) => a + (b - a) * t;

/** Ruido de valor 2D barato y determinista (para colinas y variación). */
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm2(x, z, octaves = 4) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq) * amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum;
}

/** Paredes de cañón alrededor del área jugable (rectángulo redondeado). */
export function canyonWalls(x, z, half = 56, height = 34) {
  const ex = Math.max(Math.abs(x) - half, 0);
  const ez = Math.max(Math.abs(z) - half, 0);
  const d = Math.hypot(ex, ez);
  if (d <= 0) return 0;
  return height * (1 - Math.exp(-d * 0.13)) + (Math.sin(x * 0.35 + z * 0.2) + Math.cos(z * 0.31 - x * 0.17)) * Math.min(d, 6) * 0.5;
}

export function setHeightFunction(fn, isVoid = () => false) {
  current = fn;
  voids = isVoid;
}

export function heightAt(x, z) {
  return current(x, z);
}

/** ¿El punto está sobre un abismo o una zona sin suelo seguro? */
export function isVoid(x, z) {
  return voids(x, z);
}

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 0.5;
  const hx = current(x + e, z) - current(x - e, z);
  const hz = current(x, z + e) - current(x, z - e);
  return out.set(-hx, 2 * e, -hz).normalize();
}
