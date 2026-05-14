# OmniRoute context usage and context-window retrieval

## Executive summary

The most reliable way to obtain **total context available** and **current used context** in OmniRoute is to combine two different official surfaces: **model metadata** from the OpenAI-compatible models list and **request usage counters** from the completion response. In practice, that means calling the user-facing **`/v1/models`** endpoint to read `context_length` when OmniRoute knows it, then calling **`/v1/chat/completions`** and reading `usage.prompt_tokens`, `usage.completion_tokens`, and `usage.total_tokens` from the response. OmniRoute does **not** document a single endpoint that directly returns “percent of context used,” so percent used is a client-side calculation. OmniRoute also exposes **`/v1/messages/count_tokens`** for preflight counting, but the bundled OpenAPI spec currently documents the endpoint without publishing an exact response schema. citeturn62view0turn68view0turn63view0turn69view0

There are two important documentation inconsistencies to know before you automate this. First, the **user-facing docs** consistently show the compatibility API under **`/v1/...`** and say the API base is `http://localhost:20128/v1`, while the bundled OpenAPI spec and Next.js route source enumerate **`/api/v1/...`** paths. Second, the User Guide example for **`/api/usage/budget`** shows one request shape, while the current source route expects a different body and query parameter. In other words, **for client code, prefer `/v1/...` first, and verify management endpoints against your running build if a guide example does not match the live route behavior**. citeturn72view4turn53view3turn67view0turn46view0

I did **not** find an official OmniRoute-specific JavaScript or Python client SDK method dedicated to “context percent used.” The official docs emphasize **OpenAI-compatible HTTP endpoints**, dashboard pages, and CLI/server startup surfaces. In practice, the most robust “SDK” approach is to point the standard OpenAI SDKs at OmniRoute’s base URL and read the extra JSON fields that OmniRoute injects into model catalog responses when available. citeturn13view2turn57view2turn68view0turn66view2

```mermaid
flowchart TD
    A[Fetch model metadata] --> B{context_length present?}
    B -- Yes --> C[Use context_length as total context]
    B -- No --> D{max_input_tokens present?}
    D -- Yes --> E[Use max_input_tokens]
    D -- No --> F[Use fallback registry or mark unknown]
    C --> G[Send request or preflight count]
    E --> G
    F --> G
    G --> H{Non-streaming response?}
    H -- Yes --> I[Read usage.total_tokens]
    H -- No --> J[Estimate live tokens locally during stream]
    I --> K[percent_used = used / total * 100]
    J --> K
    K --> L[Optionally reconcile with dashboard or /api/usage/* logs]
```

## Where OmniRoute exposes context and usage

For **model context-window size**, the primary official surface is the OpenAI-compatible **models list**. The public API Reference documents **`GET /v1/models`**, and the bundled OpenAPI spec documents the corresponding route as **`/api/v1/models`**. The live catalog implementation does more than the minimal OpenAPI schema suggests: it can return `context_length` from combo config, synced model metadata, canonical metadata, or a provider-level default fallback, and it can also enrich records with `max_input_tokens` and `max_output_tokens` when canonical metadata exists. The important implication is that a typed SDK may show only the minimal schema, while the live JSON body can contain more fields. citeturn53view3turn62view0turn23view0turn25view1turn66view2turn68view0

For **current token usage on an actual request**, the canonical source is the **completion response itself**. OmniRoute’s OpenAPI schema defines a `usage` object on chat completion responses with `prompt_tokens`, `completion_tokens`, and `total_tokens`. That gives you exact post-request token counts for non-streaming completions. For **preflight** counting, OmniRoute also documents **`POST /v1/messages/count_tokens`** in the API Reference and in OpenAPI; however, the OpenAPI currently describes the `200` response only as “Token count” and does not publish a concrete schema for the returned JSON. citeturn68view0turn64view2turn63view0

For **historical usage, audits, and operational monitoring**, OmniRoute documents a family of management endpoints: **`/api/usage/analytics`**, **`/api/usage/call-logs`**, **`/api/usage/{connectionId}`**, **`/api/usage/history`**, **`/api/usage/logs`**, **`/api/usage/proxy-logs`**, **`/api/usage/request-logs`**, **`/api/usage/budget`**, plus **`/api/rate-limits`** and **`/api/sessions`**. The OpenAPI file clearly lists these endpoints, but most of them are described only at a summary level rather than with detailed response schemas. That makes them useful for monitoring and auditing, but less suitable than `/v1/models` plus response `usage.*` for a portable “context percent used” calculation. citeturn69view0turn69view2turn69view3turn69view4

For the **dashboard**, the official docs explicitly document **Dashboard → Endpoints** for API key creation, **Dashboard → Costs** for budgets and pricing, **Dashboard → Usage** for per-provider/model/API-key breakdowns, and **Dashboard → Health** for uptime, memory usage, rate limits, active lockouts, cache stats, and latency. The README also shows dedicated dashboard areas for **Analytics**, **Usage Logs**, and **Endpoints**. I did **not** find official documentation of a dashboard page whose primary purpose is to show each model’s `context_length`; for model-window size, the documented API surfaces remain the more reliable source. citeturn72view4turn72view0turn72view5turn72view2turn72view3

OmniRoute’s own CLI documentation does **not** document a native command that directly returns current token/context usage or model context-window size. The README advertises general CLI options such as `omniroute setup`, `omniroute doctor`, and provider-listing helpers, while the current published CLI help in `bin/omniroute.mjs` explicitly documents startup, port selection, browser suppression, MCP mode, reset-encrypted-columns, help, and version. For context and usage inspection, the practical CLI path is therefore **shelling out with `curl`** or using a generic SDK pointed at OmniRoute. citeturn55view0turn57view2

## Exact requests, responses, and code

The formulas are straightforward once you have the two ingredients:

```text
total_context_available = model.context_length
                       or model.max_input_tokens
                       or fallback_value
                       or null

current_used_context = completion.usage.total_tokens
                    or preflight_token_count
                    or streaming_estimate

percent_used = (current_used_context / total_context_available) * 100
```

A second useful metric is **prompt-only occupancy**, which is often safer operationally because it leaves explicit generation headroom:

```text
prompt_percent_used = usage.prompt_tokens / total_context_available * 100
```

A third, more conservative UI metric for long generations is:

```text
reserved_percent_used =
  (usage.prompt_tokens + reserved_output_tokens) / total_context_available * 100
```

The official surfaces behind those formulas are `/v1/models` for the denominator and completion `usage.*` for the numerator. OmniRoute’s live catalog implementation also adds `max_input_tokens` and `max_output_tokens` when canonical metadata is present, even though the minimal OpenAPI `Model` schema only guarantees `id`, `object`, and `owned_by`. citeturn62view0turn68view0turn66view2

**HTTP example for model-window lookup**

Use the **user-facing** compatibility base first:

```http
GET http://localhost:20128/v1/models
Authorization: Bearer YOUR_OMNIROUTE_API_KEY
```

A representative live response for a chat model can look like this when OmniRoute knows the model metadata:

```json
{
  "object": "list",
  "data": [
    {
      "id": "openai/gpt-4o",
      "object": "model",
      "created": 1715683200,
      "owned_by": "openai",
      "permission": [],
      "root": "gpt-4o",
      "parent": null,
      "context_length": 128000,
      "max_input_tokens": 128000,
      "max_output_tokens": 16384
    }
  ]
}
```

That sample is representative of the live catalog implementation, which builds OpenAI-style model objects and then enriches them with `context_length`, `max_input_tokens`, and `max_output_tokens` when metadata exists. The minimal OpenAPI schema is narrower, so libraries with strict typing may require raw JSON access to see the extra fields. citeturn23view0turn25view0turn25view1turn66view2turn68view0

**HTTP example for exact post-request token usage**

```http
POST http://localhost:20128/v1/chat/completions
Authorization: Bearer YOUR_OMNIROUTE_API_KEY
Content-Type: application/json

{
  "model": "openai/gpt-4o",
  "messages": [
    { "role": "user", "content": "Say hello in one sentence." }
  ],
  "stream": false
}
```

Representative response body:

```json
{
  "id": "chatcmpl_abc123",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! Nice to meet you."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 8,
    "total_tokens": 20
  }
}
```

The `usage` object shape above is defined in OmniRoute’s bundled OpenAPI schema. Once you also know the model’s `context_length`, your exact final-turn percent is simply `20 / context_length * 100`. citeturn68view0turn64view2

**HTTP example for preflight counting**

Official docs expose the endpoint, but the exact response schema is **unspecified** in the bundled OpenAPI:

```http
POST http://localhost:20128/v1/messages/count_tokens
Authorization: Bearer YOUR_OMNIROUTE_API_KEY
Content-Type: application/json

{
  "model": "cc/claude-opus-4-6",
  "messages": [
    { "role": "user", "content": "Summarize this repository in 3 bullets." }
  ],
  "max_tokens": 256
}
```

Because the OpenAPI describes only “Token count” for the `200` response, treat the returned JSON shape as **version-sensitive** and write tolerant parsing logic. In other words, this endpoint is useful, but OmniRoute’s official docs do not currently make it a stable, schema-rich contract the way chat completion `usage.*` is. citeturn63view0turn67view0

**HTTP example for management/operations surfaces**

The official source for the current **budget** route shows that **`GET /api/usage/budget` requires an `apiKeyId` query parameter**, and **`POST /api/usage/budget`** currently expects `apiKeyId`, `dailyLimitUsd`, `monthlyLimitUsd`, and `warningThreshold`. The route returns a concise success object on POST. This is noteworthy because the User Guide currently shows a different body shape. citeturn46view0turn72view0

```http
GET http://localhost:20128/api/usage/budget?apiKeyId=key-123
```

If the query parameter is missing, the current route returns:

```json
{ "error": "apiKeyId query param is required" }
```

Current-source POST example:

```http
POST http://localhost:20128/api/usage/budget
Content-Type: application/json

{
  "apiKeyId": "key-123",
  "dailyLimitUsd": 5,
  "monthlyLimitUsd": 50,
  "warningThreshold": 0.8
}
```

Representative current-source success response:

```json
{
  "success": true,
  "apiKeyId": "key-123",
  "dailyLimitUsd": 5
}
```

For **rate-limit monitoring**, the current source for **`GET /api/rate-limits`** returns a top-level object with `connections`, `overview`, `lockouts`, and `cacheStats`, and each connection record includes at least `connectionId`, `provider`, `name`, and `rateLimitProtection`, plus additional current status fields supplied by the rate-limit manager. citeturn47view1

```json
{
  "connections": [
    {
      "connectionId": "conn_123",
      "provider": "openai",
      "name": "My OpenAI Account",
      "rateLimitProtection": true
    }
  ],
  "overview": {},
  "lockouts": {},
  "cacheStats": {}
}
```

Because OmniRoute’s official docs do not publish full schemas for most `/api/usage/*` endpoints, the most portable **exact** percent-used workflow remains: **`/v1/models` + completion `usage.*`**, with log/analytics endpoints used as secondary observability surfaces. citeturn69view0turn69view4turn47view1

**JavaScript example using the standard OpenAI SDK against OmniRoute**

OmniRoute does not document a first-party JavaScript context-usage SDK, so this example uses the standard OpenAI SDK pointed at OmniRoute’s compatibility base. The important implementation detail is to read model records as raw objects because OmniRoute can add dynamic fields such as `context_length`, `max_input_tokens`, and `max_output_tokens`. citeturn13view2turn68view0turn66view2

```javascript
import OpenAI from "openai";

const BASE_URL = process.env.OMNIROUTE_BASE_URL ?? "http://localhost:20128/v1";
const API_KEY = process.env.OMNIROUTE_API_KEY ?? "your-key";

const client = new OpenAI({
  apiKey: API_KEY,
  baseURL: BASE_URL,
});

function firstNumber(...values) {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

function percentUsed(used, total) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return (used / total) * 100;
}

async function getModelMetadata(modelId) {
  const models = await client.models.list();

  // Some SDK typings only know the minimal OpenAPI schema.
  // OmniRoute may still return extra JSON fields dynamically.
  for (const model of models.data) {
    if (model.id === modelId) {
      const raw = typeof model.toJSON === "function" ? model.toJSON() : { ...model };
      const totalContextAvailable = firstNumber(
        raw.context_length,
        raw.max_input_tokens
      );

      return {
        raw,
        totalContextAvailable,
      };
    }
  }

  return { raw: null, totalContextAvailable: null };
}

async function createCompletionAndMeasure(modelId, messages) {
  const { raw: modelMeta, totalContextAvailable } = await getModelMetadata(modelId);

  const completion = await client.chat.completions.create({
    model: modelId,
    messages,
    stream: false,
  });

  const promptTokens = completion.usage?.prompt_tokens ?? null;
  const completionTokens = completion.usage?.completion_tokens ?? null;
  const currentUsedContext = completion.usage?.total_tokens ?? null;

  return {
    model: modelId,
    modelMeta,
    totalContextAvailable,
    promptTokens,
    completionTokens,
    currentUsedContext,
    percentUsed: percentUsed(currentUsedContext, totalContextAvailable),
    promptPercentUsed: percentUsed(promptTokens, totalContextAvailable),
  };
}

// Optional preflight for Anthropic-style messages/count_tokens.
// OmniRoute documents the endpoint, but the exact response schema is unspecified,
// so parse defensively.
async function preflightCountTokens(payload) {
  const url = `${BASE_URL.replace(/\/v1$/, "")}/v1/messages/count_tokens`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`count_tokens failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json();

  const currentUsedContext = firstNumber(
    body.total_tokens,
    body.input_tokens,
    body.count,
    body.tokens
  );

  return {
    raw: body,
    currentUsedContext,
  };
}

(async () => {
  const result = await createCompletionAndMeasure("openai/gpt-4o", [
    { role: "user", content: "Say hello in one sentence." }
  ]);

  console.log(JSON.stringify(result, null, 2));
})();
```

**Python example using the standard OpenAI SDK against OmniRoute**

As with JavaScript, OmniRoute does not currently document a first-party Python SDK method for context percent retrieval, so the portable approach is the standard OpenAI client for completions and models plus direct HTTP for endpoints like `messages/count_tokens`. citeturn13view2turn68view0turn66view2

```python
from __future__ import annotations

import os
from typing import Any, Optional

import httpx
from openai import OpenAI

BASE_URL = os.getenv("OMNIROUTE_BASE_URL", "http://localhost:20128/v1")
API_KEY = os.getenv("OMNIROUTE_API_KEY", "your-key")

client = OpenAI(api_key=API_KEY, base_url=BASE_URL)


def first_number(*values: Any) -> Optional[float]:
    for value in values:
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
    return None


def percent_used(used: Optional[float], total: Optional[float]) -> Optional[float]:
    if used is None or total is None or total <= 0:
        return None
    return (used / total) * 100.0


def get_model_metadata(model_id: str) -> dict[str, Any]:
    models = client.models.list()

    for model in models.data:
        if model.id == model_id:
            raw = model.model_dump() if hasattr(model, "model_dump") else dict(model)
            total_context_available = first_number(
                raw.get("context_length"),
                raw.get("max_input_tokens"),
            )
            return {
                "raw": raw,
                "total_context_available": total_context_available,
            }

    return {
        "raw": None,
        "total_context_available": None,
    }


def create_completion_and_measure(model_id: str, messages: list[dict[str, str]]) -> dict[str, Any]:
    model_meta = get_model_metadata(model_id)

    completion = client.chat.completions.create(
        model=model_id,
        messages=messages,
        stream=False,
    )

    usage = completion.usage
    prompt_tokens = getattr(usage, "prompt_tokens", None) if usage else None
    completion_tokens = getattr(usage, "completion_tokens", None) if usage else None
    current_used_context = getattr(usage, "total_tokens", None) if usage else None
    total_context_available = model_meta["total_context_available"]

    return {
        "model": model_id,
        "model_meta": model_meta["raw"],
        "total_context_available": total_context_available,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "current_used_context": current_used_context,
        "percent_used": percent_used(current_used_context, total_context_available),
        "prompt_percent_used": percent_used(prompt_tokens, total_context_available),
    }


def preflight_count_tokens(payload: dict[str, Any]) -> dict[str, Any]:
    # OmniRoute documents this endpoint, but not a precise response schema.
    url = BASE_URL.removesuffix("/v1") + "/v1/messages/count_tokens"

    with httpx.Client(timeout=30.0) as http:
        response = http.post(
            url,
            headers={
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()
        body = response.json()

    current_used_context = first_number(
        body.get("total_tokens"),
        body.get("input_tokens"),
        body.get("count"),
        body.get("tokens"),
    )

    return {
        "raw": body,
        "current_used_context": current_used_context,
    }


if __name__ == "__main__":
    result = create_completion_and_measure(
        "openai/gpt-4o",
        [{"role": "user", "content": "Say hello in one sentence."}],
    )
    print(result)
```

## Model families and fallback logic

OmniRoute’s catalog implementation supports **several different ways** a context window can appear in the live model list. For **combos**, the catalog includes `combo.context_length` when it exists. For **synced provider models**, it maps `sm.inputTokenLimit` into `context_length`. For **custom models**, it can propagate `inputTokenLimit` or a `contextLength` field. Then, after those steps, OmniRoute’s metadata layer can enrich a model entry with canonical `context_length`, `max_input_tokens`, and `max_output_tokens` if canonical metadata exists. Finally, if `context_length` is still missing, OmniRoute can apply a **provider-level `defaultContextLength` fallback** for chat models only. citeturn25view0turn26view1turn66view2turn25view1

That last point matters a great deal: if OmniRoute had to fall back to **provider default context length**, the returned value may be a **reasonable denominator** for percent-used calculations, but it is not necessarily a **model-version-specific** maximum. If your workflow depends on exact limits for a rapidly changing model family, the safest pattern is to trust a model-specific `context_length` or `max_input_tokens` when OmniRoute returns one, and otherwise mark the value as **fallback/approximate** in your UI. OmniRoute’s official docs do not publish a complete model-by-model context-window matrix, so the live `/v1/models` output is the canonical source to inspect at runtime. citeturn25view1turn66view2turn62view0

For **non-chat** model classes, OmniRoute’s fallback logic is explicitly narrower. The catalog code skips the provider-default fallback when `model.type` exists and is not `"chat"`. The same catalog also enumerates other types such as `audio`, `rerank`, `moderation`, `video`, and more. In practical terms, you should expect **percent-of-context-used** to be most meaningful for **chat/reasoning/conversation** models, somewhat meaningful for any model that exposes `max_input_tokens`, and often **not documented** or **not applicable** for image, audio, rerank, moderation, music, and similar non-chat surfaces. citeturn25view1turn24view5turn26view1

A concise way to handle unspecified cases is this:

| Case | What OmniRoute may give you | Recommended handling |
|---|---|---|
| Chat model with model metadata | `context_length`, often `max_input_tokens` and `max_output_tokens` | Use it directly as the denominator |
| Chat model with only provider fallback | `context_length` derived from provider default | Use it, but label it as a fallback estimate |
| Combo | `context_length` only if configured on the combo | Use when present; otherwise treat as unknown |
| Synced provider model | `context_length` from `inputTokenLimit` | Use it directly |
| Custom model | `context_length` from `inputTokenLimit` or `contextLength` only if supplied | Populate limits yourself when adding the model if you want stable percent metrics |
| Non-chat model | Often no meaningful fallback context window | Display `N/A` or a model-specific metric instead |

That table is a synthesis of the current catalog and metadata source logic. citeturn26view1turn25view1turn66view2

## Streaming, sessions, storage, and rate limits

For **streaming**, OmniRoute’s public docs clearly support SSE streaming and progress headers, but they do **not** document a stable “streamed usage” frame comparable to non-streaming `usage.total_tokens`. The API Reference documents `X-OmniRoute-Progress` and the OpenAPI describes the streaming response simply as `text/event-stream`. Because of that, the conservative implementation is: compute a **preflight prompt estimate**, add a **local estimate of generated output** while streaming, label the number as **estimated**, and then replace it with exact `usage.*` only when you actually receive a final non-streaming usage object or reconcile against a post-hoc observability surface in your own build. citeturn71view0turn64view2

For **multi-turn sessions**, OmniRoute supports an external sticky-session key via **`X-Session-Id`** or `x_session_id`, and it returns the effective session key in **`X-OmniRoute-Session-Id`**. It also documents **`/api/sessions`** as an active-session list endpoint, but the bundled OpenAPI does not publish a detailed session schema. That means OmniRoute can help you keep related traffic routed consistently, but the official docs do not define a built-in per-session “context percent” meter. The best practice is therefore to keep your **own token ledger keyed by session ID** and recompute occupancy from the full active prompt on every turn. citeturn71view0turn69view3

For **long-term storage**, the README states that OmniRoute stores domain state in SQLite/JSON layers and includes memory and skills systems, but persistent storage does **not** change the upstream model’s actual context-window limit. In other words, stored history is useful operationally, but it does not magically expand a model’s active prompt budget. If you keep long conversations, you still need pruning, summarization, or OmniRoute’s compression features before the request is sent upstream. OmniRoute documents prompt-compression and RTK/Caveman preview endpoints such as **`/api/compression/preview`** and **`/api/context/rtk/*`**, which are directly relevant if you want your “real-time context percent” to reflect **post-compression** occupancy rather than only the raw client prompt. citeturn71view3turn13view2turn67view0

For **rate limits and retry edge cases**, OmniRoute exposes **`/api/rate-limits`** and the Health dashboard shows active connection cooldowns, active lockouts, signature cache stats, and latency. OmniRoute also documents idempotency and cache headers: `Idempotency-Key`, `X-Request-Id`, `X-OmniRoute-Idempotent`, and `X-OmniRoute-Cache`. If you are tracking percent used in real time, you should tie each request to a stable request/session key so that retries and deduplicated responses do not get counted twice in your UI. If you need a one-to-one measurement of a fresh upstream call, the docs explicitly support bypassing cache with **`X-OmniRoute-No-Cache: true`**. citeturn47view1turn72view5turn71view0

## Best practices, comparison, and troubleshooting

A robust real-time implementation usually works best as a **three-phase meter**. First, fetch and cache a **runtime model map** from `/v1/models`, and keep both `context_length` and `max_input_tokens` if present. Second, before sending a request, compute a **preflight estimate** with `messages/count_tokens` or your own tokenizer and optionally a **post-compression estimate** if you use OmniRoute compression. Third, after the request finishes, replace the estimate with the exact **`usage.prompt_tokens` / `usage.total_tokens`** values from the final response wherever available. If a model limit is missing, show **unknown** rather than a fake percentage. If compression is enabled, consider displaying both **raw client estimate** and **actual provider-side usage** because OmniRoute can substantially reduce upstream token load. citeturn62view0turn68view0turn67view0turn13view2

A second best practice is to reserve explicit **output headroom**. Percent-used dashboards become much more operationally useful when they show not only “tokens currently consumed” but also “whether the request still has room to complete safely.” In practice, that means using `prompt_tokens / context_length` for a raw occupancy view and `(prompt_tokens + reserved_output_budget) / context_length` for a safety view. OmniRoute’s metadata layer may expose `max_output_tokens`, which gives you a better ceiling for that reserve when available. citeturn66view2

A third best practice is to treat **dashboard pages and `/api/usage/*`** endpoints as observability surfaces, not as your sole real-time denominator/numerator pair. The current docs make dashboard Usage, Costs, Analytics, and Health very useful for operators, but the APIs with the most stable context-related primitives are still the user-facing model catalog and response usage fields. citeturn72view0turn72view2turn72view3turn72view5turn69view0

The short comparison below is the practical summary of those trade-offs. Permissions come from the OpenAPI intro plus the dashboard/API-key docs: proxy endpoints require a Bearer API key, while management surfaces are protected when management login is enabled. citeturn67view0turn72view4

| Method | Returns total context available | Returns current used context | Strengths | Weaknesses | Required permission |
|---|---|---|---|---|---|
| Direct API via `/v1/models` + `/v1/chat/completions` | Yes, when OmniRoute knows `context_length` or `max_input_tokens` | Yes, via `usage.*` | Most automatable and the most exact post-request method | No built-in percent field; streaming exact usage is not documented | Bearer API key |
| Direct API via `/v1/messages/count_tokens` | Indirectly, only when paired with `/v1/models` | Preflight estimate | Useful before sending a request | Response schema is unspecified in current OpenAPI | Bearer API key |
| Generic JS/Python OpenAI SDK pointed at OmniRoute | Yes, through `models.list()` raw JSON | Yes, through completion `usage.*` | Reuses familiar SDKs | No official OmniRoute-specific context method; typed models may hide extra fields | Bearer API key |
| Dashboard → Usage / Costs / Analytics / Health | Not explicitly documented as a per-model context window surface | Yes, for operational/token/cost views | Excellent for operators and human inspection | Not the cleanest source for exact real-time percent on a single in-flight request | Dashboard session |
| `/api/usage/*`, `/api/rate-limits`, `/api/sessions` | Usually no direct context-window denominator | Yes, for logs/history/ops depending on endpoint | Good for auditing, budgets, lockouts, sessions | Many schemas are summary-only in official docs | Local management access; protected when login is enabled |

A concise troubleshooting checklist:

- If **`/v1/...`** returns 404 but the bundled OpenAPI shows **`/api/v1/...`**, you are running into the official path-surface mismatch between user-facing docs and internal route/OpenAPI notation; prefer `/v1/...` for client integrations, but verify the surface exposed by your deployment. citeturn72view4turn67view0
- If `context_length` is missing from `models.list()`, inspect the raw model JSON for `max_input_tokens`; if both are absent, OmniRoute either lacks model-specific metadata or the model type is not eligible for the chat-only fallback. citeturn66view2turn25view1turn68view0
- If your **budget** request fails while following the User Guide example, note that the current guide shows `{keyId, limit, period}` while the current route source expects `apiKeyId`, `dailyLimitUsd`, `monthlyLimitUsd`, and `warningThreshold`, and GET requires `?apiKeyId=...`. citeturn72view0turn46view0
- If your SDK type definitions do not show `context_length`, that is expected: the minimal OpenAPI `Model` schema is sparse, while the live catalog implementation dynamically enriches responses. Read the raw JSON/dict representation. citeturn68view0turn66view2
- If you need exact real-time numbers during **streaming**, assume the in-flight value is an estimate unless your running build empirically emits final usage; the current official docs do not specify a formal stream-usage contract. citeturn71view0turn64view2
- If retry storms or duplicate renders make your percent-used graph jump unexpectedly, send `Idempotency-Key` or `X-Request-Id`, keep the returned effective session/request identifiers, and decide whether cache hits should count toward your UI the same way as fresh upstream calls. citeturn71view0turn47view1