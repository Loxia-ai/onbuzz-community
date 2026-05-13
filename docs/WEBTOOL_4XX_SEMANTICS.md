# WebTool 4xx success semantics — what to decide before re-enabling the skipped tests

When I marked two `webTool.e2e` tests as `test.skip`, I flagged this as a
"product decision the maintainers need to make." This document spells out
exactly what that decision is, what's already broken about the current
state, and what changes when you flip the contract one way or the other.

---

## The literal contradiction

`webTool.js` handles HTTP 4xx **two different ways in the same file**,
depending on which operation called puppeteer:

### Path A — `fetch` operation (`webTool.js:1195-1207`)

```js
if (fetchStatus && fetchStatus >= 400) {
  const errorResult = {
    success: true,                  // ← "the fetch executed; just got a 4xx"
    url,
    httpStatus: fetchStatus,
    diagnostic: `Page returned HTTP ${fetchStatus} (...)`,
    warning: `HTTP ${fetchStatus} — the page loaded but returned an error status. Content may still be available.`,
  };
  try { errorResult.title = await page.title(); } catch {}
  return errorResult;
}
```

### Path B — `search` operation (`webTool.js:1071-1080`)

```js
if (searchHttpStatus && searchHttpStatus >= 400) {
  return {
    success: false,                 // ← "the search engine refused us"
    query,
    engine,
    httpStatus: searchHttpStatus,
    error: `Search engine returned HTTP ${searchHttpStatus}. ...`,
    suggestion: 'Try a different search engine or increase stealth level.',
  };
}
```

### Path A again — `open-tab` action (`webTool.js:2052-2061`)

Same shape as fetch: `success: true` with `diagnostic` / `warning` fields
for 4xx. Comment on line 2051 says it out loud:

> "Warn on HTTP errors but don't fail — tab is still usable"

So the file has a consistent **A/B split**: fetch + open-tab use Path A,
search uses Path B. An agent doing `fetch(url-that-404s)` followed by
`search(blocked-engine)` will get two opposite `success` values for the
same underlying condition.

This split is almost certainly accidental — there's no "search is
special" comment anywhere. Whichever was written first was probably
copied and then one side drifted.

---

## What `success` actually does downstream

`success` matters in three concrete places:

### 1. Chain aggregation — `webTool.js:1344`

When the agent uses the `interactive` operation (multiple actions in
sequence), the envelope rolls up:

```js
return {
  success: results.every(r => r.success !== false),
  actionsExecuted: results.length,
  results,
};
```

So *one* sub-action returning `success: false` flips the whole chain
to `success: false`. Under the current Path A semantics, an agent that
opens a tab to a 404 page and then successfully clicks a link will
see the chain reported as `success: true`. Under Path B semantics,
the same chain would aggregate to `success: false` even though the
useful work (the click) succeeded.

### 2. Scheduler `status` field — `agentScheduler.js:3214-3225`

Critically, `success` does **not** propagate to the scheduler's
`toolResult.status`. That field is binary (`'completed'` vs
`'failed'`) and is set in `baseTool.js:executeWithLifecycle()` —
line 233 sets `COMPLETED` only on no-throw, line 258 sets `FAILED`
only on throw. Returning `{ success: false, ... }` still counts as
`COMPLETED`.

So the agent's *system message* for a 4xx fetch is the same JSON
either way — only the payload's `success` field differs. The
LLM reads the JSON via `formatToolResult()`:

```js
if (toolResult.status === 'completed') {
  return `${toolLabel}${JSON.stringify(toolResult.result, null, 2)}`;
}
```

So the LLM sees `{"success": true, "warning": "HTTP 404..."}` OR
`{"success": false, "error": "HTTP 404..."}` — it parses both fine,
but it'll *act* differently. A `success: false` plus an `error`
field is the well-trained pattern for "this didn't work, try
something else." A `success: true` with a buried `warning` is
weaker and more likely to be glossed over.

### 3. Programmatic callers in the future

Anything that does
`if (result.success) { proceed(); } else { fallback(); }` will
behave wildly differently across the two paths. This is also why
the click test at line 336 of the e2e file fails: it asserts the
envelope's `result.success` rolls up from the inner click result,
which it doesn't (the inner action succeeded but the outer envelope
doesn't aggregate-up unless something failed).

---

## The decision: A or B?

Both have a defensible reading.

### Path A defense — "4xx is a page, not a failure"

> The tool's job is to fetch a page. If the page comes back with a
> 404 status code, the tool *did* its job — it fetched the page. The
> page happens to be a 404 page (and may contain useful content, e.g.
> a search-suggestion 404 page). Reporting `success: false` would
> mean "the tool itself broke", which it didn't.

This matches the modern HTTP semantics where 4xx is a status, not a
transport error. It's also what `fetch()` does in the browser
(`response.ok` is false but the promise resolves).

### Path B defense — "4xx is a failure for the user's goal"

> Agents don't ask "did the network round-trip complete?" — they ask
> "did I get the resource I wanted?" If a user-named URL returns 404,
> the agent's goal failed, regardless of whether the page rendered an
> error message. Reporting `success: true` invites the agent to keep
> processing junk content.

This matches how programmatic API clients usually treat 4xx (axios's
`throwIfStatus`, fetch wrappers that `.ok`-check, etc.).

### My read, for whatever it's worth

Path B is the saner default for an agent context. Agents reason in
"did this work?" terms much more than "did the network respond?"
terms. The current Path A behavior — `success: true` with a
`warning` field that pleads "content may still be available" —
reads like it was designed defensively to preserve content for an
edge case, but the cost is that the routine case (404 means "wrong
URL") gets the wrong signal.

But Path A has one real virtue: a 401 / 403 on a page with useful
"please log in" copy is genuinely valuable content for the agent.
Same for paywalled 402 pages. A hard `success: false` loses that.

A reasonable compromise is **Path C — split by status code**:

```js
const isClientError    = status >= 400 && status < 500;
const isServerError    = status >= 500;
const isAuthOrPaywall  = status === 401 || status === 402 || status === 403;

// Pages that returned auth/paywall content are still useful to surface.
const success = isAuthOrPaywall;
```

That gives the agent:
- 404 / 410 → `success: false` (the resource doesn't exist; stop trying)
- 401 / 403 / 402 → `success: true` (here's a login or paywall; useful info)
- 5xx → `success: false` (server problem; maybe retry later)
- 429 → could go either way; probably `success: false` (rate-limited)

Whatever you pick, **pick the same thing in all three sites**
(`fetch`, `search`, `open-tab`).

---

## The two skipped tests, mapped

### `webTool.e2e.test.js:46-57` — "fetch 404 page returns success=false with HTTP 404"

The test asserts:
```js
expect(result.success).toBe(false);
expect(result.httpStatus).toBe(404);
expect(result.error).toContain('404');
expect(result.error).toContain('page not found');
```

The test was written assuming Path B. Re-enables cleanly if you pick
Path B (or Path C with 404 → false). Under Path C with the response
shape above, the test would need to be updated to:
```js
expect(result.error).toContain('page not found');  // still required
expect(result.success).toBe(false);                // matches Path C 404
```

### `webTool.e2e.test.js:316-339` — "click on existing element succeeds"

The test asserts:
```js
expect(result.success).toBe(true);
const clickResult = result.data?.results?.[0]?.results?.[0];
expect(clickResult.success).toBe(true);
```

The envelope's `result.success` returns `false` even when the inner
click succeeds. This is the **chain aggregation** behavior from
section 1 above. The test expects the envelope to aggregate-UP from
the inner click (`true` propagates from inner to outer). The current
code only aggregates the FAIL direction (any inner false → envelope
false). The pass direction needs work.

Specifically, around `webTool.js:1344`:
```js
// Current
success: results.every(r => r.success !== false),
```

If `results[0]` is the outer action and `results[0].results[0]` is
the inner one, `every(r => r.success !== false)` only checks the
outer level. To match the test, either:
- Recurse: aggregate every nested level into the envelope's
  `success` (treating any `false` anywhere in the tree as a
  failure), OR
- Update the test to read the inner success directly and not
  expect the envelope to mirror it.

Either is defensible; the choice depends on how you want chained
actions to report their overall status.

---

## Recommended path forward

1. **Pick the contract.** I'd vote Path C (split by code), but A or
   B are both fine — just be consistent.
2. **Apply it in all three sites** in `webTool.js` (`fetch:1195`,
   `search:1071`, `open-tab:2052`). Each currently has its own
   `if (status >= 400)` block; they should call a shared helper:
   ```js
   _resultForHttpStatus(url, status) {
     // returns { success, httpStatus, error?, diagnostic?, warning? }
   }
   ```
3. **Decide the chain-aggregation rule** (`webTool.js:1344`). Either
   recurse into nested `results[]` or keep it shallow and document.
4. **Un-skip both tests**, updating their assertions to match
   whichever path you picked. The skip comments in the test file
   already point at this document's sections for reference.
5. **Add a unit test for the new helper** so the next refactor
   doesn't silently drift again.

This is maybe a 1–2 hour PR for someone who already has the WebTool
context loaded. The 2 skipped tests are a forcing function — they
won't pass until the inconsistency is resolved.

---

## Why I didn't just fix this myself

Three reasons I held off:

1. **It's a product decision, not a bug-fix.** Either A or B is
   internally consistent. There's no "this is clearly wrong" call to
   make from outside.
2. **Touching `webTool.js:1195` affects three callsites and the
   chain rollup** — that's a behavior change visible to every agent
   that uses fetch / search / open-tab, not a localized cleanup.
3. **The fix should land with a unit test** (per recommendation 5
   above), and writing that test requires knowing which path is
   right.

If you tell me which path to pick, I can do steps 1–5 in a follow-up.
