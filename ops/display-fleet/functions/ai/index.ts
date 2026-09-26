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
// Every call is metered into ai_usage (tokens, images, cost from
// ai_prices) and checked against the org's ai_budgets row first. The org
// comes from the display registry for panels, and from x-usage-org /
// x-usage-org-name for service callers. Optional x-usage-feature and
// x-usage-ref tag the call (e.g. 'daily_review', 'camera:<id>'). The
// recorded cost comes back in x-ai-cost-usd.
//
// ops (?op=): chat | transcribe | speak

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'content-type, x-display-id, x-device-key, x-user-token, x-usage-feature, x-usage-ref',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-ai-cost-usd, x-ai-usage-id',
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

// ------------------------------------------------------------------ metering

type Price = { input_per_mtok: number | null; output_per_mtok: number | null; per_1k_chars: number | null };
const PRICE_CACHE_MS = 10 * 60_000;
let priceCache: { at: number; rows: Array<Price & { model: string; op: string; effective_from: string }> } | null = null;

// deno-lint-ignore no-explicit-any
async function priceFor(supabase: any, model: string, op: string): Promise<Price | null> {
  if (!priceCache || Date.now() - priceCache.at > PRICE_CACHE_MS) {
    const { data } = await supabase.from('ai_prices').select('model, op, input_per_mtok, output_per_mtok, per_1k_chars, effective_from');
    priceCache = { at: Date.now(), rows: data ?? [] };
  }
  const now = Date.now();
  return (
    priceCache.rows
      .filter((r) => r.model === model && r.op === op && Date.parse(r.effective_from) <= now)
      .sort((a, b) => Date.parse(b.effective_from) - Date.parse(a.effective_from))[0] ?? null
  );
}

function costOf(p: Price | null, u: { input_tokens?: number | null; output_tokens?: number | null; input_chars?: number | null }): number | null {
  if (!p) return null;
  let c = 0;
  if (p.input_per_mtok != null && u.input_tokens != null) c += (u.input_tokens / 1e6) * Number(p.input_per_mtok);
  if (p.output_per_mtok != null && u.output_tokens != null) c += (u.output_tokens / 1e6) * Number(p.output_per_mtok);
  if (p.per_1k_chars != null && u.input_chars != null) c += (u.input_chars / 1000) * Number(p.per_1k_chars);
  return Math.round(c * 1e6) / 1e6;
}

function countImages(messages: unknown): number {
  let n = 0;
  if (!Array.isArray(messages)) return 0;
  for (const m of messages) {
    const content = (m as { content?: unknown })?.content;
    if (Array.isArray(content)) {
      for (const part of content) if ((part as { type?: string })?.type === 'image_url') n++;
    }
  }
  return n;
}

const clip = (v: string | null, n: number) => (v ? v.slice(0, n) : null);
// Header values are URL-encoded by callers so any org name survives transport.
const decoded = (v: string | null) => {
  if (!v) return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

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
  let caller: 'display' | 'user' | 'service';
  let orgId: string | null = null;
  let orgName: string | null = null;
  if (displayId && deviceKey) {
    const { data: display } = await supabase
      .from('displays')
      .select('id, device_key, org_id, org_name')
      .eq('id', displayId)
      .maybeSingle();
    if (!display || display.device_key !== deviceKey) {
      return new Response('unauthorized', { status: 401, headers: CORS });
    }
    authedDisplayId = displayId;
    caller = 'display';
    orgId = display.org_id ? String(display.org_id).toLowerCase() : null;
    orgName = display.org_name ?? null;
  } else if (userToken) {
    if (!(await userTokenValid(userToken))) {
      return new Response('unauthorized', { status: 401, headers: CORS });
    }
    caller = 'user';
  } else if (serviceKey) {
    if (!(await serviceKeyValid(serviceKey))) {
      return new Response('unauthorized', { status: 401, headers: CORS });
    }
    caller = 'service';
    // Trusted: only holders of a service key reach this branch.
    orgId = clip(req.headers.get('x-usage-org'), 64)?.toLowerCase() ?? null;
    orgName = clip(decoded(req.headers.get('x-usage-org-name')), 120);
  } else {
    return new Response('unauthorized', { status: 401, headers: CORS });
  }

  const op = new URL(req.url).searchParams.get('op') ?? 'chat';
  const product = caller === 'service' ? clip(req.headers.get('x-usage-product'), 40) ?? 'service' : 'display';
  const feature = clip(req.headers.get('x-usage-feature'), 40);
  const ref = clip(req.headers.get('x-usage-ref'), 200);
  const started = Date.now();

  // Records one ledger row; never lets metering break the call itself.
  const record = async (row: Record<string, unknown>): Promise<number | null> => {
    try {
      const { data } = await supabase
        .from('ai_usage')
        .insert({
          product,
          caller,
          display_id: authedDisplayId,
          org_id: orgId,
          org_name: orgName,
          feature,
          ref,
          op,
          latency_ms: Date.now() - started,
          ...row,
        })
        .select('id')
        .single();
      return data?.id ?? null;
    } catch {
      return null;
    }
  };

  // Per-org switch and monthly budget, before spending anything.
  if (orgId) {
    const { data: budget } = await supabase
      .from('ai_budgets')
      .select('enabled, monthly_usd_limit')
      .eq('org_id', orgId)
      .maybeSingle();
    let blocked: string | null = null;
    if (budget && !budget.enabled) {
      blocked = 'disabled';
    } else if (budget?.monthly_usd_limit != null) {
      const { data: spent } = await supabase.rpc('ai_month_spend', { p_org: orgId });
      if (Number(spent ?? 0) >= Number(budget.monthly_usd_limit)) blocked = 'budget';
    }
    if (blocked) {
      await record({ ok: false, http_status: 402, blocked, cost_usd: 0 });
      const message =
        blocked === 'disabled'
          ? 'Nova is turned off for this organization.'
          : "Nova's monthly limit for this organization has been reached.";
      return new Response(JSON.stringify({ error: message, blocked }), {
        status: 402,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  }

  const aiKey = Deno.env.get('OPENAI_API_KEY');
  if (!aiKey) {
    return new Response('ai key not configured', { status: 503, headers: CORS });
  }

  const bump = () =>
    authedDisplayId
      ? supabase.rpc('bump_ai_usage', { did: authedDisplayId }).then(() => undefined)
      : Promise.resolve();

  const meteredHeaders = (id: number | null, cost: number | null) => ({
    ...(id != null ? { 'x-ai-usage-id': String(id) } : {}),
    ...(cost != null ? { 'x-ai-cost-usd': cost.toFixed(6) } : {}),
  });

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
      const text = await upstream.text();
      let usage: { prompt_tokens?: number; completion_tokens?: number } = {};
      try {
        usage = JSON.parse(text)?.usage ?? {};
      } catch {
        // Non-JSON error body: record the call without token counts.
      }
      const u = { input_tokens: usage.prompt_tokens ?? null, output_tokens: usage.completion_tokens ?? null };
      const cost = upstream.ok ? costOf(await priceFor(supabase, CHAT_MODEL, 'chat'), u) : 0;
      const id = await record({
        model: CHAT_MODEL,
        ...u,
        image_count: countImages(body.messages),
        cost_usd: cost,
        ok: upstream.ok,
        http_status: upstream.status,
      });
      if (upstream.ok) {
        await bump();
      }
      return new Response(text, {
        status: upstream.status,
        headers: { ...CORS, 'Content-Type': 'application/json', ...meteredHeaders(id, cost) },
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
      const text = await upstream.text();
      let usage: { input_tokens?: number; output_tokens?: number } = {};
      try {
        usage = JSON.parse(text)?.usage ?? {};
      } catch {
        // ignore
      }
      const u = { input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null };
      const cost = upstream.ok ? costOf(await priceFor(supabase, STT_MODEL, 'transcribe'), u) : 0;
      const id = await record({ model: STT_MODEL, ...u, cost_usd: cost, ok: upstream.ok, http_status: upstream.status });
      if (upstream.ok) {
        await bump();
      }
      return new Response(text, {
        status: upstream.status,
        headers: { ...CORS, 'Content-Type': 'application/json', ...meteredHeaders(id, cost) },
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
      const u = { input_chars: input.length };
      const cost = upstream.ok ? costOf(await priceFor(supabase, TTS_MODEL, 'speak'), u) : 0;
      const id = await record({ model: TTS_MODEL, ...u, cost_usd: cost, ok: upstream.ok, http_status: upstream.status });
      if (!upstream.ok) {
        return new Response(await upstream.text(), { status: upstream.status, headers: CORS });
      }
      await bump();
      return new Response(upstream.body, {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'audio/mpeg', ...meteredHeaders(id, cost) },
      });
    }

    return new Response('unknown op', { status: 400, headers: CORS });
  } catch (e) {
    await record({ ok: false, http_status: 502 });
    return new Response(`proxy error: ${String(e).slice(0, 300)}`, {
      status: 502,
      headers: CORS,
    });
  }
});
