import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

/**
 * Single-provider bake-off: every candidate is reached through OpenRouter so
 * we only juggle one API key. Production runs the chosen model directly via
 * its first-party provider (currently Google for Gemma).
 */
export interface BenchModel {
  /** Display label used in the report. */
  label: string;
  /** OpenRouter model slug. */
  slug: string;
}

export const MODELS: BenchModel[] = [
  { label: "Gemma 4 31B (Google)", slug: "google/gemma-4-31b-it" },
  { label: "Gemma 4 26B A4B (Google)", slug: "google/gemma-4-26b-a4b-it" },
  { label: "Gemini 2.5 Flash", slug: "google/gemini-2.5-flash" },
  { label: "Gemini 2.5 Flash Lite", slug: "google/gemini-2.5-flash-lite" },
  { label: "Claude Haiku 4.5", slug: "anthropic/claude-haiku-4.5" },
  { label: "GPT-4o-mini", slug: "openai/gpt-4o-mini" },
  { label: "GPT-4.1-nano", slug: "openai/gpt-4.1-nano" },
  { label: "GPT-5 Nano", slug: "openai/gpt-5-nano" },
  { label: "Llama 3.3 70B", slug: "meta-llama/llama-3.3-70b-instruct" },
  { label: "Ministral 14B (2512)", slug: "mistralai/ministral-14b-2512" },
  { label: "Ministral 8B (2512)", slug: "mistralai/ministral-8b-2512" },
  { label: "Ministral 3B (2512)", slug: "mistralai/ministral-3b-2512" },
  { label: "DeepSeek Chat", slug: "deepseek/deepseek-chat" },
  { label: "Qwen3 8B", slug: "qwen/qwen3-8b" },
];

export function buildModels(apiKey: string): Array<BenchModel & { model: LanguageModel }> {
  const openrouter = createOpenRouter({ apiKey });
  return MODELS.map((m) => ({ ...m, model: openrouter.chat(m.slug) }));
}
