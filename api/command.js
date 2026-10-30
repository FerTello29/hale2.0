/**
 * POST /api/command — interpreta una orden de voz en lenguaje natural.
 *
 * Entrada:  { text: string, context: { weapons, current, objective, ... } }
 * Salida:   { actions: [ { do: 'move', dir: 'forward', seconds: 2 }, ... ], reply }
 *
 * El cliente vuelve a validar las acciones (VoiceCommands.sanitizeActions).
 */
import { json, preflight, rejectForeign, rateLimit, readJSON, chatJSON, hasKey } from '../server/ai.js';

const SYSTEM = `Eres el sistema de control por voz de NOVA-7, un robot de combate en un videojuego de acción en tercera persona.
Convierte la orden del jugador (en español, puede tener errores de transcripción) en acciones del juego.
Responde SOLO con JSON: {"actions":[...], "reply":"confirmación breve en español (máx. 8 palabras)"}.
Acciones permitidas (máximo 4, en orden):
- {"do":"move","dir":"forward|back|left|right","seconds":N opcional (sin seconds = hasta que diga alto)}
- {"do":"stop"} detenerse y dejar de disparar · {"do":"stopFire"}
- {"do":"run","on":true|false} · {"do":"aim","on":true|false}
- {"do":"fire","seconds":N (0.5 a 8, por defecto 1.5)}
- {"do":"jump"} {"do":"reload"} {"do":"melee"} {"do":"pulse"} {"do":"interact"}
- {"do":"grenade","type":"frag|gravity" opcional}
- {"do":"weapon","id":"rifle|shotgun|orb|rail|next"} (solo armas que tenga)
- {"do":"turn","degrees":N} positivo = izquierda, negativo = derecha
- {"do":"look","dir":"up|down|center"}
- {"do":"goto"} caminar solo hacia el objetivo marcado
- {"do":"pause"} {"do":"resume"} {"do":"help"} {"do":"exitVR"}
Interpreta la intención táctica: "cúbrete" = run + move back; "flanquea por la derecha" = move right 2 s y luego forward;
"acaba con él" = fire 3; "huye" = run + move back. Si la orden no tiene relación con el juego, devuelve "actions": [] y explícalo en reply.`;

export async function POST(request) {
  const foreign = rejectForeign(request);
  if (foreign) return foreign;
  const limited = rateLimit(request, 'command', 30);
  if (limited) return limited;
  if (!hasKey()) return json(request, { error: 'OPENAI_API_KEY no configurada' }, 503);
  let body;
  try {
    body = await readJSON(request);
  } catch {
    return json(request, { error: 'JSON inválido' }, 400);
  }
  const text = String(body.text || '').slice(0, 200).trim();
  if (!text) return json(request, { actions: [], reply: '' });
  const ctx = body.context && typeof body.context === 'object' ? body.context : {};
  const context = JSON.stringify({
    weapons: Array.isArray(ctx.weapons) ? ctx.weapons.slice(0, 4) : [],
    current: typeof ctx.current === 'string' ? ctx.current.slice(0, 12) : null,
    objective: typeof ctx.objective === 'string' ? ctx.objective.slice(0, 120) : null,
    canInteract: typeof ctx.canInteract === 'string' ? ctx.canInteract.slice(0, 80) : null,
    boss: typeof ctx.boss === 'string' ? ctx.boss.slice(0, 40) : null,
    health: Number(ctx.health) || null,
  });
  try {
    const out = await chatJSON({ system: SYSTEM, user: `Contexto: ${context}\nOrden del jugador: ${JSON.stringify(text)}`, maxTokens: 220 });
    return json(request, { actions: Array.isArray(out.actions) ? out.actions.slice(0, 6) : [], reply: String(out.reply || '').slice(0, 120) });
  } catch (err) {
    console.error(err);
    return json(request, { error: 'la IA no respondió' }, 502);
  }
}

export function OPTIONS(request) {
  return preflight(request);
}
