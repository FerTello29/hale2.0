/**
 * Utilidades compartidas por las funciones serverless de Vercel (carpeta api/).
 *
 * La API key de OpenAI se lee SOLO de process.env.OPENAI_API_KEY (variable de
 * entorno configurada en Vercel). Nunca se envía al navegador ni se guarda en
 * el repositorio.
 *
 * Variables de entorno:
 *   OPENAI_API_KEY           (obligatoria) clave secreta de OpenAI
 *   OPENAI_MODEL             modelo de texto (por defecto gpt-4o-mini)
 *   OPENAI_TRANSCRIBE_MODEL  modelo de voz a texto (por defecto whisper-1)
 *   ALLOWED_ORIGINS          orígenes extra permitidos, separados por comas
 *                            (p. ej. https://fertello29.github.io)
 */

const OPENAI = 'https://api.openai.com/v1';
export const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
export const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

export const hasKey = () => !!process.env.OPENAI_API_KEY;

// ------------------------------------------------------------------ CORS
function allowedOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = url.host === host
    || extra.includes(origin)
    || url.hostname === 'localhost'
    || url.hostname === '127.0.0.1';
  return ok ? origin : null;
}

function corsHeaders(request) {
  const origin = allowedOrigin(request);
  return origin
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : {};
}

export function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(request) },
  });
}

export function preflight(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

/**
 * Rechaza llamadas desde otros sitios web (para que nadie use tu cuota desde
 * su página). Las peticiones sin cabecera Origin (curl) se aceptan pero
 * siguen sujetas al límite de solicitudes.
 */
export function rejectForeign(request) {
  if (request.headers.get('origin') && !allowedOrigin(request)) return json(request, { error: 'origen no permitido' }, 403);
  return null;
}

// ------------------------------------------------------------------ límite de solicitudes
// En memoria por instancia: es una protección básica, no un muro. Configura
// también un límite de gasto en https://platform.openai.com/settings/organization/limits
const buckets = new Map();
export function rateLimit(request, name, perMinute) {
  const ip = (request.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
  const key = `${name}:${ip}`;
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < 60000);
  if (list.length >= perMinute) {
    buckets.set(key, list);
    return json(request, { error: 'demasiadas solicitudes, espera un momento' }, 429);
  }
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > 5000) buckets.clear();
  return null;
}

export async function readJSON(request, maxBytes = 8000) {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('cuerpo demasiado grande');
  return JSON.parse(text || '{}');
}

// ------------------------------------------------------------------ OpenAI
/** Chat con respuesta JSON garantizada. */
export async function chatJSON({ system, user, maxTokens = 250, temperature = 0.2 }) {
  const res = await fetch(`${OPENAI}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{}');
}

/** Voz a texto (español). */
export async function transcribe(bytes, contentType) {
  const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('ogg') ? 'ogg' : contentType.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType }), `voz.${ext}`);
  form.append('model', TRANSCRIBE_MODEL);
  form.append('language', 'es');
  form.append('prompt', 'Órdenes para un robot en un videojuego: avanza, alto, dispara, salta, recarga, granada, gira a la izquierda, ve al objetivo.');
  const res = await fetch(`${OPENAI}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return String(data.text || '').trim();
}
