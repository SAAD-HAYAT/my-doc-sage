// Phase 1: implement embed() and chat().
// Phase 3: extend chat() to accept a `tools` array and surface tool_calls.

const OPENROUTER_URL = "https://openrouter.ai/api/v1";

const EMBEDDING_MODEL = "liquid/lfm-2.5-embedding-350m:free";

// AGENTS.md specifies "openai/gpt-oss-120b:free" (dead, 404s on every
// request) or, failing that, the bare "openrouter/free" router. We stopped
// using the bare router: it load-balances across OpenRouter's ENTIRE free
// pool, which includes non-conversational models — confirmed live via
// temporary response logging that it can land on
// "nvidia/nemotron-3.5-content-safety:free", a 4B moderation classifier
// whose entire output is a verdict like "User Safety: safe" instead of an
// answer. There's no way to exclude specific models from the bare router,
// so instead we maintain our own ordered list of known-general-purpose
// instruct models and try them in order, falling back on any failure.
//
// Pulled from OpenRouter's live /api/v1/models free-tier list (these
// rotate — none of the previously-assumed Llama/Qwen/Mistral free slugs
// were even present at the time of writing). Of the 19 free models, 18
// support the `tools` param -- only nemotron-3.5-content-safety doesn't
// (unsurprising: it's the moderation model above, already excluded for an
// unrelated reason). From that pool of 18, this chain sticks to
// general-purpose instruct models across three providers and skips the
// finance/health/coding-agent-specialized ones (ling-3.0-flash-fin/sante,
// nex-agi, poolside, cohere/north-mini-code) and the two without
// tool_choice support (thinkingmachines/inkling*). dots-studio's model was
// also passed over after it introduced itself as "Claude" in one earlier
// smoke test -- not worth the risk as a primary/fallback model here.
//
// nemotron-3-ultra-550b is new: it's OpenRouter's largest general model in
// this pool and is explicitly positioned for "reasoning and orchestration"
// (i.e. multi-step/tool-using workflows) -- tried first specifically to
// see whether a bigger, orchestration-tuned model is less prone to the
// hallucinated-tool-call-as-text failure seen from nemotron-3-super-120b
// on a follow-up turn where no further tool was available to it (see git
// history). nemotron-3-super-120b is kept, lower in the chain, since it
// got every *first-round* tool selection right in live testing -- the
// hallucination only showed up on a tool-less follow-up call.
const CHAT_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "liquid/lfm-2.5-2.6b:free",
];

// Narrow guard against the exact failure mode above: a response that is
// ENTIRELY a bare safety/moderation verdict, nothing else. Deliberately
// anchored (^...$) so it can never match a real answer that merely
// mentions "safe" in passing.
const SAFETY_VERDICT_ONLY =
  /^(?:(?:user|content)\s+safety\s*[:\-]\s*)?(?:safe|unsafe)\.?$/i;

function isSafetyVerdictOnly(content: string): boolean {
  return SAFETY_VERDICT_ONLY.test(content.trim());
}

// Confirmed live (twice, reproducibly, via the frontend): on a follow-up
// call with no `tools` param, a model that still wants another tool call
// can emit a fake pseudo-XML tool-call as plain text instead of either
// using the real tool_calls field (unavailable here) or just answering
// with what it has -- e.g.
//   <tool_call> <function=search_notes> <parameter=k> 5
//   <parameter=query> ... </tool_call>
// "<tool_call" / "<function=" are not something a real answer about the
// user's notes would ever legitimately contain, so this is safe to match
// anywhere in the content (unlike the fully-anchored safety-verdict check
// above, which guards against common words).
const HALLUCINATED_TOOL_CALL_MARKERS = /<\s*tool_call\b|<\s*function\s*=/i;

function looksLikeHallucinatedToolCall(content: string): boolean {
  return HALLUCINATED_TOOL_CALL_MARKERS.test(content);
}

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
};

// Phase 3: OpenRouter's tools param is OpenAI-compatible function-calling.
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type AssistantToolCallMessage = {
  role: "assistant";
  content: string | null;
  tool_calls: ToolCall[];
};

// Optional second key (OPENROUTER_API_KEY_2): OpenRouter's free-tier daily
// request quota is per-key, so a second key from a different account
// effectively doubles daily capacity. Read lazily (not at module load) so
// tests can set/unset process.env before calling in, and re-filtered on
// every read so a key added after the process started (unlikely, but
// cheap to support) is picked up too.
function configuredKeys(): string[] {
  return [process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_API_KEY_2].filter(
    (k): k is string => typeof k === "string" && k.length > 0,
  );
}

// Sticky across calls for the lifetime of the process: once the primary
// key is seen to be exhausted (a 429), stop trying it first on every
// subsequent request -- go straight to the next key instead of wasting a
// request re-discovering the same 429.
let activeKeyIndex = 0;

function currentKey(): string {
  const keys = configuredKeys();
  if (keys.length === 0) {
    throw new Error(
      "Missing OPENROUTER_API_KEY — copy .env.example to .env and fill it in.",
    );
  }
  // Clamp in case OPENROUTER_API_KEY_2 was removed after we'd switched to it.
  if (activeKeyIndex >= keys.length) activeKeyIndex = keys.length - 1;
  return keys[activeKeyIndex];
}

// Switches to the next configured key, if any. Returns false (and leaves
// activeKeyIndex unchanged) once there's no further key to fall back to.
function switchToNextKey(): boolean {
  const keys = configuredKeys();
  if (activeKeyIndex + 1 >= keys.length) return false;
  activeKeyIndex += 1;
  console.warn(
    `[openrouter] key #${activeKeyIndex} returned 429; switching to fallback key #${activeKeyIndex + 1}.`,
  );
  return true;
}

function headers(key: string): HeadersInit {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function errorFrom(res: Response, label: string): Promise<Error> {
  const body = await res.text().catch(() => "");
  return new Error(`OpenRouter ${label} failed (${res.status} ${res.statusText}): ${body}`);
}

// Runs `doFetch` with the current key; on a 429 (rate limit / daily quota
// exhausted), switches to the next configured key and retries the exact
// same request, repeating until either a non-429 response comes back or
// there are no more keys to try.
async function fetchWithKeyFallback(
  doFetch: (key: string) => Promise<Response>,
): Promise<Response> {
  let res = await doFetch(currentKey());
  while (res.status === 429 && switchToNextKey()) {
    res = await doFetch(currentKey());
  }
  return res;
}

export async function embed(text: string): Promise<number[]> {
  const res = await fetchWithKeyFallback((key) =>
    fetch(`${OPENROUTER_URL}/embeddings`, {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    }),
  );

  if (!res.ok) throw await errorFrom(res, "embeddings");

  const json = (await res.json()) as { data?: { embedding?: number[] }[] };
  const embedding = json.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error(
      `OpenRouter embeddings returned no vector: ${JSON.stringify(json).slice(0, 500)}`,
    );
  }
  return embedding;
}

// Backward-compatible overloads: existing callers that don't pass `tools`
// keep getting a plain string back, unchanged. Callers that do pass
// `tools` get either the final string answer OR the assistant's
// tool_calls message, and must handle both.
export async function chat(messages: ChatMessage[]): Promise<string>;
export async function chat(
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<string | AssistantToolCallMessage>;
export async function chat(
  messages: ChatMessage[],
  tools?: ToolDefinition[],
): Promise<string | AssistantToolCallMessage> {
  const call = (model: string) =>
    fetchWithKeyFallback((key) =>
      fetch(`${OPENROUTER_URL}/chat/completions`, {
        method: "POST",
        headers: headers(key),
        body: JSON.stringify(tools ? { model, messages, tools } : { model, messages }),
      }),
    );

  let lastError: Error = new Error("No chat models were tried");

  for (const model of CHAT_MODELS) {
    let res: Response;
    try {
      res = await call(model);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }

    if (!res.ok) {
      lastError = await errorFrom(res, `chat (${model})`);
      console.warn(`[chat] ${model} failed (${res.status}); trying the next fallback model.`);
      continue;
    }

    const json = (await res.json()) as {
      choices?: {
        message?: { content?: string | null; tool_calls?: ToolCall[] };
      }[];
    };
    const message = json.choices?.[0]?.message;

    // A tool_calls response is a legitimate success, not a failure to
    // retry — the model is asking for data, not refusing to answer. Its
    // content is commonly null/empty in this case; that's expected here,
    // unlike the plain-answer path below.
    if (message?.tool_calls && message.tool_calls.length > 0) {
      return {
        role: "assistant",
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      };
    }

    const content = message?.content;

    if (typeof content !== "string" || content.trim() === "") {
      lastError = new Error(
        `OpenRouter chat (${model}) returned no content: ${JSON.stringify(json).slice(0, 500)}`,
      );
      continue;
    }

    if (isSafetyVerdictOnly(content)) {
      console.warn(
        `[chat] ${model} returned a bare safety-verdict response ("${content.trim()}") instead of an answer; trying the next fallback model.`,
      );
      lastError = new Error(
        `OpenRouter chat (${model}) returned a non-conversational verdict: "${content.trim()}"`,
      );
      continue;
    }

    if (looksLikeHallucinatedToolCall(content)) {
      console.warn(
        `[chat] ${model} returned a hallucinated tool-call fragment instead of an answer ("${content.trim().slice(0, 160)}"); trying the next fallback model.`,
      );
      lastError = new Error(
        `OpenRouter chat (${model}) returned a hallucinated tool-call fragment instead of a real answer.`,
      );
      continue;
    }

    return content;
  }

  throw lastError;
}
