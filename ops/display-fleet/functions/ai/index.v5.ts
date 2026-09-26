import { createClient } from 'jsr:@supabase/supabase-js@2';

// AI proxy: the OpenAI key lives HERE (Supabase secret OPENAI_API_KEY),
// never in any shipped bundle. Three auth modes:
//   1. Panels: x-display-id + x-device-key (fleet registry).
//   2. Signed-in users (web demo, mobile): x-user-token = a Growlink
//      bearer token, validated against the Growlink API (prod, then
//      UAT), cached briefly. No Growlink credential is stored here.
//   3. Growlink backends (server-to-server, e.g. Plant Health AI):
//      x-service-key = one of the secrets in AI_SERVICE_KEYS
//      (comma-separated). Never sent from a browser; not in CORS.
// Models and token caps are forced server-side either way. Successful
// panel calls bump the per-display ai_calls counter.
//
// ops (?op=): chat | transcribe | speak

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-display-id, x-device-key, x-user-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CHAT_MODEL = 'gpt-4o-mini';
const STT_MODEL = 'gpt-4o-mini-transcribe';
const TTS_MODEL = 'gpt-4o-mini-tts';
const MAX_TOKENS_CAP = 1024;

// Only Growlink's own API hosts may validate a user token.
const AUTH_HOSTS = [
  'https://glprod-userapi2.azurewebsites.net',
  'https://glprod-userapi2-uat.azurewebsites.net',
];
const TOKEN_CACHE_MS = 5 * 60_000;
const tokenCache = new Map<string, number>(); // token -> validated-until

// Constant-time check against the configured service keys (compares
// SHA-256 digests so key length doesn't leak either).
async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
async function serviceKeyValid(key: string): Promise<boolean> {
  const allowed = (Deno.env.get('AI_SERVICE_KEYS') ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length >= 32);
  const given = await digest(key);
  let ok = false;
  for (const k of allowed) {
    const want = await digest(k);
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff |= want[i] ^ given[i];
    ok = ok || diff === 0;
  }
  return ok;
}

async function userTokenValid(token: string): Promise<boolean> {
  const cached = tokenCache.get(token);
  if (cached && cached > Date.now()) {
    return true;
  }
  for (const host of AUTH_HOSTS) {
    try {
      const res = await fetch(`${host}/api/UserTasks/summary?forUser=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        tokenCache.set(token, Date.now() + TOKEN_CACHE_MS);
        return true;
      }
    } catch {
      // Host unreachable: try the next one.
    }
  }
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    return new Response('POST only', { status: 405, headers: CORS });
  }

  const displayId = req.headers.get('x-display-id') ?? '';
  const deviceKey = req.headers.get('x-device-key') ?? '';
  const userToken = req.headers.get('x-user-token') ?? '';
  const serviceKey = req.headers.get('x-service-key') ?? '';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let authedDisplayId: string | null = null;
  if (displayId && deviceKey) {
    const { data: display } = await supabase
      .from('displays')
      .select('id, device_key')
      .eq('id', displayId)
      .maybeSingle();
    if (!display || display.device_key !== deviceKey) {
      return new Response('unauthorized', { status: 401, headers: CORS });
    }
    authedDisplayId = displayId;
  } else if (userToken) {
    if (!(await userTokenValid(userToken))) {
      return new Response('unauthorized', { status: 401, headers: CORS });
    }
  } else if (serviceKey) {
    if (!(await serviceKeyValid(serviceKey))) {
      return new Response('unauthorized', { status: 401, headers: CORS });
    }
  } else {
    return new Response('unauthorized', { status: 401, headers: CORS });
  }

  const aiKey = Deno.env.get('OPENAI_API_KEY');
  if (!aiKey) {
    return new Response('ai key not configured', { status: 503, headers: CORS });
  }

  const op = new URL(req.url).searchParams.get('op') ?? 'chat';
  const bump = () =>
    authedDisplayId
      ? supabase.rpc('bump_ai_usage', { did: authedDisplayId }).then(() => undefined)
      : Promise.resolve();

  try {
    if (op === 'chat') {
      const body = (await req.json()) as Record<string, unknown>;
      const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: CHAT_MODEL,
          temperature: typeof body.temperature === 'number' ? body.temperature : 0,
          max_tokens: Math.min(Number(body.max_tokens) || MAX_TOKENS_CAP, MAX_TOKENS_CAP),
          response_format: body.response_format,
          messages: body.messages,
        }),
      });
      if (upstream.ok) {
        await bump();
      }
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (op === 'transcribe') {
      const inForm = await req.formData();
      const file = inForm.get('file');
      if (!(file instanceof File)) {
        return new Response('file required', { status: 400, headers: CORS });
      }
      const outForm = new FormData();
      outForm.append('file', file, file.name || 'audio.webm');
      outForm.append('model', STT_MODEL);
      outForm.append('language', String(inForm.get('language') ?? 'en'));
      const prompt = inForm.get('prompt');
      if (typeof prompt === 'string' && prompt) {
        outForm.append('prompt', prompt.slice(0, 500));
      }
      const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${aiKey}` },
        body: outForm,
      });
      if (upstream.ok) {
        await bump();
      }
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (op === 'speak') {
      const body = (await req.json()) as Record<string, unknown>;
      const input = String(body.input ?? '').slice(0, 1500);
      if (!input) {
        return new Response('input required', { status: 400, headers: CORS });
      }
      const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: TTS_MODEL,
          voice: 'nova',
          input,
          response_format: 'mp3',
        }),
      });
      if (!upstream.ok) {
        return new Response(await upstream.text(), { status: upstream.status, headers: CORS });
      }
      await bump();
      return new Response(upstream.body, {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'audio/mpeg' },
      });
    }

    return new Response('unknown op', { status: 400, headers: CORS });
  } catch (e) {
    return new Response(`proxy error: ${String(e).slice(0, 300)}`, {
      status: 502,
      headers: CORS,
    });
  }
});
