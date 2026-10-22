import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

import { OPENROUTER_SETTINGS } from "../src/model.ts";

export interface BenchModel {
  label: string;
  slug: string;
  /** Mandatory-reasoning models use their lowest supported effort. */
  reasoning?: "minimal";
}

/** Shortlist from the 2026-10-22 bake-off, with production models first. */
export const MODELS: BenchModel[] = [
  { label: "GLM 5.3 Flash", slug: "z-ai/glm-5.3-flash", reasoning: "minimal" },
  { label: "Gemini 3.6 Flash", slug: "google/gemini-3.6-flash", reasoning: "minimal" },
  { label: "Gemini 3.5 Flash-Lite", slug: "google/gemini-3.5-flash-lite", reasoning: "minimal" },
  { label: "GLM 5.3", slug: "z-ai/glm-5.3", reasoning: "minimal" },
  { label: "DeepSeek V4.1 Flash (1017)", slug: "deepseek/deepseek-v4.1-flash-1017" },
  { label: "GPT-6 Luna", slug: "openai/gpt-6-luna" },
  { label: "Mercury 3", slug: "inception/mercury-3" },
  { label: "GPT-4.1 Nano (baseline)", slug: "openai/gpt-4.1-nano" },
];

export function buildModels(apiKey: string): Array<BenchModel & { model: LanguageModel }> {
  const openrouter = createOpenRouter({ apiKey });
  const selected = process.env.BENCH_MODELS?.split(",").map((slug) => slug.trim());
  const candidates = selected
    ? selected.map((slug) => {
        const candidate = MODELS.find((m) => m.slug === slug);
        if (!candidate) throw new Error(`Unknown benchmark model: ${slug}`);
        return candidate;
      })
    : MODELS;

  return candidates.map((m) => ({
    ...m,
    model: openrouter.chat(m.slug, {
      ...OPENROUTER_SETTINGS,
      reasoning: { ...OPENROUTER_SETTINGS.reasoning, effort: m.reasoning ?? "none" },
    }),
  }));
}
