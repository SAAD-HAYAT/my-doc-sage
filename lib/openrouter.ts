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
// were even present at the time of writing). Picked for explicit
// "instruction-tuned" / general-purpose positioning, spread across three
// providers, and each verified live to answer real questions correctly
// (see the investigation notes in git history for this change):
const CHAT_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
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

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
};

function headers(): HeadersInit {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "Missing OPENROUTER_API_KEY — copy .env.example to .env and fill it in.",
    );
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function errorFrom(res: Response, label: string): Promise<Error> {
  const body = await res.text().catch(() => "");
  return new Error(`OpenRouter ${label} failed (${res.status} ${res.statusText}): ${body}`);
}

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${OPENROUTER_URL}/embeddings`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });

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

export async function chat(messages: ChatMessage[]): Promise<string> {
  const call = (model: string) =>
    fetch(`${OPENROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model, messages }),
    });

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
      continue;
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;

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

    return content;
  }

  throw lastError;
}
