import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// embed()/chat() hit the real network directly (no supabase/retrieval
// dependency), so the only thing to fake here is global.fetch -- these
// tests cost zero API calls and never touch OPENROUTER_URL for real.

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("embed() — API key fallback", () => {
  it("uses the primary key when it works, never touches the second key", async () => {
    process.env.OPENROUTER_API_KEY = "key-1";
    process.env.OPENROUTER_API_KEY_2 = "key-2";
    const { embed } = await import("@/lib/openrouter");

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { data: [{ embedding: [0.1, 0.2] }] }));

    const result = await embed("hello");

    expect(result).toEqual([0.1, 0.2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer key-1");
  });

  it("falls back to the second key on a 429 from the primary key, and retries the same request", async () => {
    process.env.OPENROUTER_API_KEY = "key-1";
    process.env.OPENROUTER_API_KEY_2 = "key-2";
    const { embed } = await import("@/lib/openrouter");

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(429, { error: "daily quota exceeded" }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ embedding: [0.5] }] }));

    const result = await embed("hello");

    expect(result).toEqual([0.5]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(firstHeaders.Authorization).toBe("Bearer key-1");
    expect(secondHeaders.Authorization).toBe("Bearer key-2");
  });

  it("stays on the second key for a later call once the primary is known to be exhausted (sticky)", async () => {
    process.env.OPENROUTER_API_KEY = "key-1";
    process.env.OPENROUTER_API_KEY_2 = "key-2";
    const { embed } = await import("@/lib/openrouter");

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(429, { error: "quota" })) // call 1: key-1 exhausted
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ embedding: [1] }] })) // call 1: key-2 succeeds
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ embedding: [2] }] })); // call 2: goes straight to key-2

    await embed("first");
    await embed("second");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const secondCallHeaders = fetchMock.mock.calls[2][1]?.headers as Record<string, string>;
    expect(secondCallHeaders.Authorization).toBe("Bearer key-2");
  });

  it("propagates the 429 once every configured key is exhausted", async () => {
    process.env.OPENROUTER_API_KEY = "key-1";
    process.env.OPENROUTER_API_KEY_2 = "key-2";
    const { embed } = await import("@/lib/openrouter");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(429, { error: "quota" }));

    await expect(embed("hello")).rejects.toThrow(/429/);
  });

  it("behaves exactly as before when only the primary key is configured", async () => {
    process.env.OPENROUTER_API_KEY = "key-1";
    delete process.env.OPENROUTER_API_KEY_2;
    const { embed } = await import("@/lib/openrouter");

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { data: [{ embedding: [0.9] }] }));

    await embed("hello");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer key-1");
  });

  it("throws a clear error when no key is configured at all", async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY_2;
    const { embed } = await import("@/lib/openrouter");

    vi.spyOn(globalThis, "fetch");

    await expect(embed("hello")).rejects.toThrow(/Missing OPENROUTER_API_KEY/);
  });
});
