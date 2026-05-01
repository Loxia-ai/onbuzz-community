/**
 * Probe every chat-tagged model in the catalog with a tiny chat request.
 * Uses ?chat=true so non-chat surfaces (TTS, embeddings, image, etc.)
 * are filtered out at the server. Per-provider sequential pacing keeps
 * Gemini's free-tier rate limits from blowing up.
 *
 * For each candidate it sends a minimal POST /api/llm/chat and records
 * latency, response shape, and (if it failed) an error category.
 *
 * Usage:  node scripts/probe-all-models.mjs
 */

const BASE = process.env.BASE || 'http://localhost:8080';
const PROMPT = 'Reply with one word: ok';
const MAX_TOKENS = 1024; // gpt-5 family eats 50–500 reasoning tokens before output; need headroom

function classifyError(err, status) {
  const m = (err || '').toLowerCase();
  if (status === 401 || /unauthor|invalid api key|invalid_api_key|authentication failed/.test(m)) return 'auth';
  if (status === 404 || /not found|does not exist|not_found/.test(m)) return 'not_found';
  if (status === 429 || /rate limit|quota/.test(m)) return 'rate_limit';
  if (status === 400 && /unsupported|deprecated|invalid_request/.test(m)) return 'param_unsupported';
  if (/temperature/.test(m)) return 'param_temperature';
  if (/max[_ ]?tokens|max_completion_tokens/.test(m)) return 'param_max_tokens';
  if (/abort|timeout/.test(m)) return 'timeout';
  if (/circuit breaker/.test(m)) return 'circuit_breaker';
  if (/no provider matched/.test(m)) return 'no_provider';
  if (/no stream|generator/.test(m)) return 'no_stream';
  if (/this model is not supported|not supported/.test(m)) return 'model_not_supported';
  if (status === 400) return 'bad_request_other';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

async function probe(model) {
  const t0 = Date.now();
  // Per-request 20s ceiling — enough for cold-start models, short
  // enough that rate-limited Gemini calls don't pin the whole run.
  const ctrl = new AbortController();
  const tHard = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`${BASE}/api/llm/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: PROMPT }],
        options: { temperature: 0.7, maxTokens: MAX_TOKENS, max_tokens: MAX_TOKENS },
      }),
      signal: ctrl.signal,
    });
    const latency = Date.now() - t0;
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) {
      return {
        model,
        ok:       false,
        latency,
        status:   r.status,
        category: classifyError(data.error || JSON.stringify(data), r.status),
        error:    (data.error || JSON.stringify(data)).slice(0, 220),
      };
    }
    return {
      model,
      ok:           true,
      latency,
      status:       r.status,
      content:      (data.content || '').slice(0, 80),
      finishReason: data.finishReason,
      usage:        data.usage,
    };
  } catch (e) {
    return {
      model,
      ok:       false,
      latency:  Date.now() - t0,
      status:   0,
      category: classifyError(e.message, 0),
      error:    e.message,
    };
  } finally {
    clearTimeout(tHard);
  }
}

async function main() {
  console.log('Fetching chat-tagged catalog…');
  const cat = await fetch(`${BASE}/api/llm/models?chat=true`).then(r => r.json());
  const models = (cat.models || [])
    .map(m => ({ name: m.name, provider: m.provider }))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));

  console.log(`Probing ${models.length} chat-capable models, sequential per provider…\n`);

  const byProvider = new Map();
  for (const m of models) {
    if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
    byProvider.get(m.provider).push(m.name);
  }

  const results = [];
  // Run providers in parallel, but each provider's models sequentially
  // (free-tier rate limits punish concurrency).
  await Promise.all(Array.from(byProvider.entries()).map(async ([provider, names]) => {
    for (const name of names) {
      const res = await probe(name);
      results.push({ provider, ...res });
      process.stdout.write(`  [${provider}] ${name.padEnd(45)} ${res.ok ? 'OK ' : 'FAIL'}  ${String(res.latency).padStart(6)}ms${res.ok ? '' : '  '+res.category}\n`);
    }
  }));

  // Summary
  console.log('\n=== SUMMARY ===');
  const byProv = new Map();
  for (const r of results) {
    if (!byProv.has(r.provider)) byProv.set(r.provider, { total: 0, ok: 0, fail: {} });
    const p = byProv.get(r.provider);
    p.total++;
    if (r.ok) p.ok++;
    else p.fail[r.category] = (p.fail[r.category] || 0) + 1;
  }
  for (const [prov, stats] of byProv) {
    console.log(`\n${prov}: ${stats.ok}/${stats.total} OK`);
    for (const [cat, count] of Object.entries(stats.fail).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${cat.padEnd(25)} ${count}`);
    }
  }

  console.log('\n=== FAILURE DETAILS (one example per category per provider) ===');
  const seen = new Set();
  for (const r of results) {
    if (r.ok) continue;
    const key = `${r.provider}/${r.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`\n[${r.provider}] ${r.category} (e.g. ${r.model}, status ${r.status})`);
    console.log(`   ${r.error}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
