/**
 * GET /api/health — el juego comprueba si hay servidor de IA y si tiene API key.
 * Nunca devuelve la clave, solo si existe.
 */
import { json, preflight, hasKey, MODEL } from '../server/ai.js';

export function GET(request) {
  return json(request, { ok: true, ai: hasKey(), model: hasKey() ? MODEL : null });
}

export function OPTIONS(request) {
  return preflight(request);
}
