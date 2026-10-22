import { afterEach, expect, it, vi } from "vitest";

import { pickEmojisWithFallback } from "./emoji.ts";
import { makeModels } from "./model.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function completion(text = "💧🪣", model = "selected-provider-model") {
  return Response.json({
    id: "generation-test",
    model,
    created: 1,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  });
}

function models() {
  return makeModels("test-key");
}

it("uses OpenRouter and records the served model without calling the fallback on success", async () => {
  const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => completion());
  vi.stubGlobal("fetch", fetch);
  const log = { set: vi.fn() };
  const result = await pickEmojisWithFallback(models(), "Fix memory leak", log);

  expect(result.emojis).toEqual(["💧", "🪣"]);
  expect(result.model).toBe("selected-provider-model");
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
  const body = JSON.parse(init?.body as string);
  expect(body.reasoning).toEqual({ effort: "minimal", exclude: true });
  expect(body.provider).toMatchObject({ sort: "latency", data_collection: "deny" });
  expect(body.max_tokens).toBe(1024);
  expect(body).not.toHaveProperty("thinkingConfig");
  expect(log.set).toHaveBeenLastCalledWith({
    llmAttempts: [expect.objectContaining({ model: result.model, outcome: "ok" })],
  });
});

it.each([400, 429, 503])("tries the other model after an HTTP %i, without nested retries", async (status) => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json(
      { error: { message: "provider failed", code: status } },
      { status },
    ))
    .mockResolvedValueOnce(completion());
  vi.stubGlobal("fetch", fetch);

  await expect(
    pickEmojisWithFallback(models(), "Fix leak", { set: vi.fn() }),
  ).resolves.toMatchObject({ emojis: ["💧", "🪣"] });
  expect(fetch).toHaveBeenCalledTimes(2);
  const requested = fetch.mock.calls.map((call) => JSON.parse(call[1].body).model);
  expect(requested).toEqual(["z-ai/glm-5.3-flash", "google/gemini-3.6-flash"]);
  expect(JSON.parse(fetch.mock.calls[1]?.[1].body).reasoning).toEqual({
    effort: "minimal",
    exclude: true,
  });
});

it("falls back on invalid emoji output", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(completion("Here you go: 💧🪣"))
    .mockResolvedValueOnce(completion());
  vi.stubGlobal("fetch", fetch);
  const log = { set: vi.fn() };
  await expect(pickEmojisWithFallback(models(), "Fix leak", log))
    .resolves.toMatchObject({ emojis: ["💧", "🪣"] });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(log.set).toHaveBeenLastCalledWith({
    llmAttempts: [
      expect.objectContaining({ error: expect.stringContaining("parse_failed") }),
      expect.objectContaining({ outcome: "ok" }),
    ],
  });
});

it("aborts a slow primary after five seconds and still attempts the fallback", async () => {
  vi.useFakeTimers();
  // Node's native AbortSignal.timeout does not use Vitest's fake timers.
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  });
  const fetch = vi.fn()
    .mockImplementationOnce((_url: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    )
    .mockResolvedValueOnce(completion());
  vi.stubGlobal("fetch", fetch);
  const result = pickEmojisWithFallback(models(), "Fix leak", { set: vi.fn() });
  await vi.advanceTimersByTimeAsync(5_001);
  await expect(result).resolves.toMatchObject({ emojis: ["💧", "🪣"] });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("stops after both models fail and retains their errors", async () => {
  const fetch = vi.fn().mockImplementation(async () => completion("not emojis"));
  vi.stubGlobal("fetch", fetch);
  const log = { set: vi.fn() };
  await expect(pickEmojisWithFallback(models(), "Fix leak", log))
    .rejects.toThrow("parse_failed");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(log.set.mock.calls.at(-1)?.[0].llmAttempts).toHaveLength(2);
});
