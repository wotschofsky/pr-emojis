import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

import type { Env } from "./env.ts";

/**
 * Production model is fixed. If we ever need to swap providers, do it here
 * rather than via env — the choice is a code-level design decision.
 */
export function makeModel(env: Env): LanguageModel {
  const google = createGoogleGenerativeAI({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  return google("gemma-4");
}
