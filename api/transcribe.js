/**
 * POST /api/transcribe — voz a texto para navegadores sin reconocimiento de
 * voz propio (Meta Quest Browser, Firefox). Cuerpo: audio (webm/ogg/mp4).
 * Salida: { text }
 */
import { json, preflight, rejectForeign, rateLimit, transcribe, hasKey } from '../server/ai.js';

const MAX_BYTES = 1_000_000; // ~1 min de voz en opus; las órdenes duran 1-4 s

export async function POST(request) {
  const foreign = rejectForeign(request);
  if (foreign) return foreign;
  const limited = rateLimit(request, 'transcribe', 20);
  if (limited) return limited;
  if (!hasKey()) return json(request, { error: 'OPENAI_API_KEY no configurada' }, 503);
  const type = (request.headers.get('content-type') || 'audio/webm').split(';')[0];
  if (!type.startsWith('audio/')) return json(request, { error: 'se esperaba audio' }, 415);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return json(request, { error: 'audio vacío o demasiado largo' }, 413);
  try {
    const text = await transcribe(bytes, type);
    return json(request, { text });
  } catch (err) {
    console.error(err);
    return json(request, { error: 'la transcripción falló' }, 502);
  }
}

export function OPTIONS(request) {
  return preflight(request);
}
