/**
 * flowJudge — LLM-as-judge evaluator for end-to-end flow runs.
 *
 * Given a captured run (handoffs, agent summaries, final output), asks
 * a separate model to evaluate whether the flow succeeded structurally
 * AND semantically. Returns a structured verdict the test asserts on.
 *
 * Why a separate file: the judge is independent of the executor; can
 * be unit-tested by stubbing the AI client; can be reused by other
 * eval harnesses later.
 *
 * The judge is intentionally STRICT on contract preservation (did the
 * declared output fields actually carry the right info downstream?)
 * and LENIENT on prose quality (LLMs are non-deterministic — the test
 * shouldn't fail because the model used different wording).
 */

const SYSTEM_PROMPT = `You are evaluating an autonomous multi-agent flow.
Your job is to judge whether each step fulfilled its declared role and
whether the structured handoffs preserved enough information for the
next agent to do its job.

Be STRICT on:
  - Did each agent emit every declared output field?
  - Did the values pass the type/shape stated in the description?
  - Did downstream agents actually use the upstream values, or did they
    fabricate / drop information?

Be LENIENT on:
  - Exact wording (LLMs paraphrase)
  - Stylistic choices

Return ONLY a single JSON object — no surrounding prose.`;

/**
 * Build the judge prompt from a captured run.
 *
 * @param {object} captured
 * @param {string} captured.flowGoal      flow.description
 * @param {string} captured.userInput     the initial user input
 * @param {Array}  captured.agents        [{ name, role, inputs, outputs, summary }]
 * @param {Array}  captured.handoffs      [{ edge, payload }]
 * @param {string} captured.finalOutput   the run's final output text
 * @returns {string} the judge user-prompt
 */
export function buildJudgePrompt(captured) {
  const lines = [];
  lines.push(`FLOW GOAL: ${captured.flowGoal || '(none declared)'}`);
  lines.push('');
  lines.push(`INITIAL INPUT: ${truncate(stringify(captured.userInput), 500)}`);
  lines.push('');
  lines.push('AGENT TIMELINE (in execution order):');
  for (const a of (captured.agents || [])) {
    lines.push(`  ─ ${a.name} (step ${a.position}/${a.totalAgents || '?'})`);
    if (a.role) lines.push(`    Role: ${truncate(a.role, 300)}`);
    if (a.inputs && Object.keys(a.inputs).length > 0) {
      lines.push(`    Received: ${truncate(stringify(a.inputs), 600)}`);
    }
    if (a.outputs && Object.keys(a.outputs).length > 0) {
      lines.push(`    Produced: ${truncate(stringify(a.outputs), 600)}`);
    }
    if (a.summary) lines.push(`    Summary: ${truncate(a.summary, 400)}`);
  }
  lines.push('');
  if ((captured.handoffs || []).length > 0) {
    lines.push('STRUCTURED HANDOFFS (named field across each edge):');
    for (const h of captured.handoffs) {
      lines.push(`  ${h.edge}: ${truncate(stringify(h.payload), 500)}`);
    }
    lines.push('');
  }
  lines.push(`FINAL OUTPUT: ${truncate(stringify(captured.finalOutput), 1500)}`);
  lines.push('');
  lines.push(`Return ONLY this JSON shape (no markdown fences, no prose around it):
{
  "passes":   <bool — overall: did the flow succeed structurally and semantically?>,
  "score":    <integer 1-5>,
  "agents":   [{ "name": "...", "fulfilledRole": <bool>, "note": "..." }],
  "handoffs": [{ "edge": "...", "preservedInfo": <bool>, "note": "..." }],
  "finalOutput": { "meetsGoal": <bool>, "note": "..." },
  "issues":   ["short specific complaint", "..."]
}`);
  return lines.join('\n');
}

/**
 * Run the judge against a captured run.
 *
 * @param {object} captured
 * @param {object} opts
 * @param {string} opts.model              e.g. 'Kimi-K2.6'
 * @param {(prompt: { system, user, model }) => Promise<string>} opts.aiCall
 *   Adapter that takes { system, user, model } and returns the model's
 *   raw response text. Test-injectable so the judge can be unit-tested
 *   without a real model.
 * @returns {Promise<{
 *   passes: boolean, score: number,
 *   agents: Array, handoffs: Array, finalOutput: object, issues: string[],
 *   raw: string,
 * }>}
 */
export async function evaluateFlow(captured, opts) {
  if (!opts || typeof opts.aiCall !== 'function') {
    throw new Error('flowJudge.evaluateFlow requires opts.aiCall');
  }
  const user = buildJudgePrompt(captured);
  const raw = await opts.aiCall({
    system: SYSTEM_PROMPT,
    user,
    model: opts.model,
  });
  const parsed = parseJudgeResponse(raw);
  parsed.raw = raw;
  return parsed;
}

/**
 * Parse the judge's response. Tolerates markdown code fences and
 * leading/trailing prose by extracting the first JSON object found.
 * Defensive: returns a fail-shaped result if parsing fails so the
 * test caller can still get an actionable error.
 */
export function parseJudgeResponse(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return failShape('judge returned empty response');
  }
  // Strip ```json ... ``` fences if present
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  // Find the FIRST balanced JSON object — not a greedy regex (which
  // would chew through multiple concatenated objects from a streamed
  // response and end up with invalid content).
  const json = _extractFirstJsonObject(stripped);
  if (!json) return failShape(`judge response had no JSON object: ${truncate(raw, 200)}`);
  try {
    const obj = JSON.parse(json);
    return {
      passes:    !!obj.passes,
      score:     Number.isFinite(obj.score) ? obj.score : 0,
      agents:    Array.isArray(obj.agents)   ? obj.agents   : [],
      handoffs:  Array.isArray(obj.handoffs) ? obj.handoffs : [],
      finalOutput: obj.finalOutput || { meetsGoal: false, note: 'no finalOutput in verdict' },
      issues:    Array.isArray(obj.issues)   ? obj.issues   : [],
    };
  } catch (e) {
    return failShape(`judge response not valid JSON: ${e.message}`);
  }
}

/**
 * Walk the string and return the substring of the first balanced
 * `{ … }` block, respecting string literals (so braces inside strings
 * don't break the count). Skips any leading prose.
 */
function _extractFirstJsonObject(s) {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inStr = false; }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function failShape(msg) {
  return {
    passes: false, score: 0,
    agents: [], handoffs: [],
    finalOutput: { meetsGoal: false, note: msg },
    issues: [msg],
  };
}

function stringify(v) {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function truncate(s, max) {
  s = String(s ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max) + ` … (truncated, ${s.length - max} more chars)`;
}

export default { buildJudgePrompt, evaluateFlow, parseJudgeResponse };
