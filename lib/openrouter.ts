// Phase 1: implement embed() and chat().
// Phase 3: extend chat() to accept a `tools` array and surface tool_calls.

const OPENROUTER_URL = "https://openrouter.ai/api/v1";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
};

export async function embed(text: string): Promise<number[]> {
  // TODO (Phase 1): POST to `${OPENROUTER_URL}/embeddings` with
  //   { model: "liquid/lfm-2.5-embedding-350m:free", input: text }
  // using Authorization: Bearer process.env.OPENROUTER_API_KEY.
  // Return response.data[0].embedding.
  // Note: this model caps at 512 input tokens — keep chunks under that.
  throw new Error("not implemented");
}

export async function chat(
  messages: ChatMessage[]
  // tools?: ToolDefinition[]  // <- add this param in Phase 3
): Promise<string> {
  // TODO (Phase 1): POST to `${OPENROUTER_URL}/chat/completions` with
  //   { model: "openai/gpt-oss-120b:free", messages }
  // (or "openrouter/free" to let OpenRouter pick a free model for you).
  // Return response.choices[0].message.content.
  throw new Error("not implemented");
}
