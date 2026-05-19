# Providers

> **What this page covers**
>
> - Built-in provider setup for **OpenAI**, **Anthropic**, **Google Gemini**, **xAI**, and **Ollama**.
> - How OnBuzz routes model names to providers, including model-prefix matching and the default-provider fallback.
> - Vendor-specific notes for auth, streaming, tool calling, reasoning output, local Ollama models, and custom **OpenAI-compatible endpoints** such as OpenRouter, Together, Fireworks, Groq, vLLM, LiteLLM, Azure OpenAI, or self-hosted inference servers.
> - How to add a new native provider adapter when an API does not fit the OpenAI-compatible path.
>
> Missing a provider? Open a GitHub issue with the vendor name, API docs link, and any models you want OnBuzz to support.

OnBuzz Community ships with five built-in provider adapters. Each one talks
directly to the vendor's API — your keys are stored locally (encrypted)
and OnBuzz Community has no servers in between.

## How dispatch works

When you send a message to a model, the dispatcher resolves which provider
to use:

1. If the request carries an explicit `provider` field, use that.
2. Otherwise match on the model name prefix:
   - `gpt-*`, `o1-*`, `o3-*`, `o4-*`, `chatgpt-*` → **OpenAI**
   - `claude-*` → **Anthropic**
   - `gemini-*` (or `models/gemini-*`) → **Gemini**
   - `grok-*` → **xAI**
   - `ollama-*` → **Ollama**
3. Otherwise fall back to `defaultProvider` (configured in `config.defaultProvider`).
4. Otherwise throw a clear "no provider matched" error.

You can also register custom OpenAI-compatible endpoints (OpenRouter,
Together, Fireworks, Groq, vLLM, LiteLLM, Azure OpenAI, etc.) — see below.

---

## OpenAI

```bash
export OPENAI_API_KEY=sk-...
```

Or paste in **Settings → Provider API Keys → OpenAI**.

Supports: chat completions, streaming SSE, tool calling, reasoning
(`reasoning_content` deltas + `reasoning_tokens` usage). Models like o3-mini
that don't support vision or temperature are handled automatically.

Default base URL: `https://api.openai.com/v1`.

---

## Anthropic (Claude)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Or paste in **Settings → Provider API Keys → Anthropic**.

Supports: `/v1/messages`, streaming SSE (`message_start` /
`content_block_delta` / etc.), tool calling (input streamed via
`input_json_delta`), thinking content blocks (`thinking_delta`).

The `system` field is hoisted to the top-level Messages API parameter
automatically — you don't need to special-case it in the chat history.

Default base URL: `https://api.anthropic.com`.

---

## Google Gemini

```bash
export GEMINI_API_KEY=AIza...
```

Or paste in **Settings → Provider API Keys → Google Gemini**.

Supports: `/v1beta/models/{model}:streamGenerateContent?alt=sse`, function
calling (translated to Gemini's `functionDeclarations` shape), thinking
parts (`part.thought === true`), `usageMetadata.thoughtsTokenCount` for
reasoning token count.

The `assistant` role is mapped to `model` automatically. System prompts
are hoisted to top-level `systemInstruction.parts[].text`.

Default base URL: `https://generativelanguage.googleapis.com`.

---

## xAI

```bash
export XAI_API_KEY=xai-...
```

Or paste in **Settings → Provider API Keys → xAI**.

xAI's API is OpenAI-compatible, so the adapter extends `OpenAIProvider`
with a different base URL and prefix matcher. All OpenAI features (tools,
streaming, reasoning tokens) work the same way.

Default base URL: `https://api.x.ai/v1`.

---

## Ollama (local)

No key needed. Install [Ollama](https://ollama.com), then `ollama pull` a
model:

```bash
ollama pull llama3.1:8b
ollama pull qwen2.5:14b
ollama pull deepseek-r1:14b
```

Models discovered via `ollama list` appear in OnBuzz with an `ollama-`
prefix (so `llama3.1:8b` becomes `ollama-llama3.1-8b`). Pricing is zero;
context windows are estimated from the model family.

If your daemon runs on a non-default port:

```bash
export OLLAMA_HOST=http://127.0.0.1:11434  # default
```

Tool calling support depends on the underlying model — newer Ollama
builds (≥0.4) surface OpenAI-style tool calls in `message.tool_calls`.

---

## Custom OpenAI-compatible endpoints

For any vendor that exposes an OpenAI-compatible API (OpenRouter,
Together, Fireworks, Groq, vLLM, LiteLLM, Azure OpenAI, self-hosted
inference servers, etc.), add a custom endpoint. The dispatcher will
register it as a separate provider you can target by `provider: '<id>'`
on a request, or by adding the endpoint's models to your model manifest.

Programmatically (e.g. in `config/default.json`):

```json
{
  "customEndpoints": [
    {
      "id":      "openrouter",
      "name":    "OpenRouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey":  "sk-or-..."
    }
  ]
}
```

Then in your model manifest (`~/.onbuzz/models.json`):

```json
{
  "models": [
    {
      "name":         "anthropic/claude-3-5-sonnet",
      "provider":     "openrouter",
      "displayName":  "Claude 3.5 Sonnet (via OpenRouter)",
      "contextWindow": 200000,
      "supportsTools": true
    }
  ]
}
```

---

## Adding a new native provider

If a provider's API doesn't fit the OpenAI-compatible mold, write a
custom adapter:

1. Create `src/services/providers/myprovider.js` extending `BaseProvider`.
2. Implement at minimum: `id`, `matchesModel`, `sendMessage`,
   `sendMessageStream`. Optional: `listModels`, `isAvailable`.
3. Translate the canonical request shape (system + messages + tools) to
   your vendor's API, and translate streaming events back to the
   canonical `{content, reasoning, usage, finishReason, toolCalls}`.
4. Register in `src/services/providers/index.js` (in the `ProviderRegistry`
   constructor).

See `src/services/providers/anthropicProvider.js` for a reference
implementation of a non-OpenAI-compatible provider.
