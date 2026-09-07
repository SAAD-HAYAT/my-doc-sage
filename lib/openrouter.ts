// Phase 1: implement embed() and chat().
// Phase 3: extend chat() to accept a `tools` array and surface tool_calls.

const OPENROUTER_URL = "https://openrouter.ai/api/v1";

const EMBEDDING_MODEL = "liquid/lfm-2.5-embedding-350m:free";
const CHAT_MODEL = "openai/gpt-oss-120b:free";
// If the primary free model is unavailable (404/429/5xx), let OpenRouter
// pick any free model instead.
const CHAT_MODEL_FALLBACK = "openrouter/free";

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

  let res = await call(CHAT_MODEL);
  if (!res.ok && (res.status === 404 || res.status === 429 || res.status >= 500)) {
    res = await call(CHAT_MODEL_FALLBACK);
  }

  if (!res.ok) throw await errorFrom(res, "chat");

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(
      `OpenRouter chat returned no content: ${JSON.stringify(json).slice(0, 500)}`,
    );
  }
  return content;
}
