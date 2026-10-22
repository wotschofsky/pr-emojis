import { createOpenRouter, type OpenRouterChatSettings } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

/**
 * Shared routing defaults for production and the benchmark. Model choices are
 * explicit code decisions rather than moving `latest` aliases.
 */
export const OPENROUTER_SETTINGS = {
  reasoning: { effort: "none", exclude: true },
  provider: { sort: "latency", data_collection: "deny" },
} satisfies OpenRouterChatSettings;

export function makeModels(apiKey: string): LanguageModel[] {
  const openrouter = createOpenRouter({ apiKey });
  // Both endpoints require reasoning; use their lowest supported effort.
  const settings = {
    ...OPENROUTER_SETTINGS,
    reasoning: { effort: "minimal", exclude: true },
  } satisfies OpenRouterChatSettings;
  return ["z-ai/glm-5.3-flash", "google/gemini-3.6-flash"]
    .map((id) => openrouter.chat(id, settings));
}
