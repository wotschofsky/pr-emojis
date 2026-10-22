import { afterEach, expect, it, vi } from "vitest";

import type { Env } from "./env.ts";
import { pickEmojis } from "./emoji.ts";
import { makeModel } from "./model.ts";

afterEach(() => vi.unstubAllGlobals());

it("sends supported minimal thinking settings through the Google SDK", async () => {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    // Gemini 3 Flash-Lite accepts thinking levels, not a zero-token budget.
    if (body.generationConfig?.thinkingConfig?.thinkingBudget === 0) {
      return Response.json({ error: { code: 400, message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT" } }, { status: 400 });
    }
    return Response.json({
      candidates: [{ content: { role: "model", parts: [{ text: "💧🪣" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
    });
  });
  vi.stubGlobal("fetch", fetch);

  const model = makeModel({ GOOGLE_GENERATIVE_AI_API_KEY: "test-key" } as Env);
  const result = await pickEmojis({ model, title: "Fix memory leak" });

  expect(result.emojis).toEqual(["💧", "🪣"]);
  expect(fetch.mock.calls[0]?.[0]).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
  const body = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string);
  expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal", includeThoughts: false });
});
