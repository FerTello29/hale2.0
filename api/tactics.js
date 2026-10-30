/**
 * POST /api/tactics — el director táctico con IA decide cómo ajustar la
 * partida según el estado del jugador.
 *
 * Entrada:  { snapshot: { health, shield, recentDamage, enemiesNear, boss, ... } }
 * Salida:   { enemyDamage, enemyAccuracy, supplies, reinforcements, supplyDrop, hint }
 *
 * El cliente acota todos los valores (TacticalAI.sanitize): la IA solo puede
 * hacer el juego más fácil o dejarlo igual, nunca más difícil que el preset.
 */
import { json, preflight, rejectForeign, rateLimit, readJSON, chatJSON, hasKey } from '../server/ai.js';

const SYSTEM = `Eres el director táctico de un videojuego de acción (el robot NOVA-7 contra criaturas de cristal en la luna Orión IV).
Tu meta: que la partida sea divertida y desafiante pero NUNCA frustrante. Recibes el estado del jugador cada ~20 s y decides.
Responde SOLO con JSON:
{"enemyDamage":0.55-1, "enemyAccuracy":0.65-1, "supplies":1-1.8, "reinforcements":0.65-1,
 "supplyDrop":"none|health|ammo|grenade", "hint":"consejo táctico de la Cmdte. Ruiz en español (máx. 20 palabras) o null"}
Reglas: 1 = sin ayuda. Si recibe mucho daño, tiene poca salud o lo rodean, baja enemyDamage, enemyAccuracy y reinforcements y sube supplies.
Si domina (mucha salud, muchas bajas), vuelve poco a poco hacia 1. supplyDrop solo si lo necesita de verdad (salud < 35 % o sin munición).
Da "hint" solo si es útil (jefe, peligro, munición). Puntos débiles: Matriarca = que choque con un pilar de roca y dispara al saco de la espalda;
Coloso = destruye los nodos de cristal del escudo y salta la onda expansiva; Eco = rompe las anclas, cúbrete del rayo tras un pilar y salta el anillo.`;

export async function POST(request) {
  const foreign = rejectForeign(request);
  if (foreign) return foreign;
  const limited = rateLimit(request, 'tactics', 8);
  if (limited) return limited;
  if (!hasKey()) return json(request, { error: 'OPENAI_API_KEY no configurada' }, 503);
  let body;
  try {
    body = await readJSON(request);
  } catch {
    return json(request, { error: 'JSON inválido' }, 400);
  }
  const snapshot = JSON.stringify(body.snapshot ?? {}).slice(0, 1500);
  try {
    const out = await chatJSON({ system: SYSTEM, user: `Estado: ${snapshot}`, maxTokens: 160, temperature: 0.4 });
    return json(request, out);
  } catch (err) {
    console.error(err);
    return json(request, { error: 'la IA no respondió' }, 502);
  }
}

export function OPTIONS(request) {
  return preflight(request);
}
