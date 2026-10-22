import { generateText, type LanguageModel } from "ai";
import dedent from "dedent";

export const PROMPT_TEMPLATE = (title: string) => dedent`
  You are picking emojis to append to a software-engineering pull request title — small visual jokes that brighten an engineer's day when they scan their PR list.

  Reply with exactly two funny, relevant emojis.
  The entire response must contain only those two emojis.
  The two emojis must be different from each other.
  No words, labels, punctuation, quotes, markdown, explanation, or extra emojis.
  Put the two emojis directly next to each other with no spaces or separators.

  What makes a great pick:
  - Lateral over literal. A bug fix doesn't need 🐛, a perf change doesn't need 🚀. Riff on a noun or verb in the title and find a sideways visual joke.
  - The two emojis should land as a pair — a tiny scene or punchline together, not two unrelated decorations.
  - The whole Unicode emoji range is fair game; reach for less common ones when they nail the joke.
  - Tease the code, not the author.

  Examples:

  Title: fix: prevent race condition in thread pool
  Output: 🏁🏊

  Title: Remove deprecated Python 2 support
  Output: 🐍⚰️

  Title: perf: reduce Docker image bloat
  Output: 🐳🎈

  Title: Untangle spaghetti dependencies in checkout flow
  Output: 🍝🪢

  Title: feat: lazy-load above-the-fold images
  Output: 🖼️🛋️

  Title: Optimize hot path in renderer
  Output: 🔥🚶

  Title: Sunset v1 API endpoints
  Output: 1️⃣🌅

  Title: Kill zombie processes on shutdown
  Output: 🧟🔫

  Title: ${title}
  Output:
`;

export interface PickEmojisInput {
  model: LanguageModel;
  title: string;
}

interface EmojiLogger {
  set(fields: Record<string, unknown>): void;
}

export interface PickEmojisResult {
  emojis: [string, string];
  raw: string;
  model: string;
  latencyMs: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * Picks emoji-shaped grapheme clusters out of a free-form string.
 */
export function extractEmojis(s: string): string[] {
  const out: string[] = [];
  for (const seg of segmenter.segment(s)) {
    const g = seg.segment;
    if (isEmojiGrapheme(g)) out.push(g);
  }
  return out;
}

/**
 * Parses the exact model response after removing whitespace. Every remaining
 * grapheme must be one of exactly two emoji graphemes.
 */
export function parseExactEmojiResponse(s: string): [string, string] {
  const compact = s.replace(/\s+/gu, "");
  const emojis: string[] = [];

  for (const seg of segmenter.segment(compact)) {
    const g = seg.segment;
    if (!isEmojiGrapheme(g)) {
      throw new Error(
        `parse_failed: response contains non-emoji content ${JSON.stringify(g)} in ${JSON.stringify(s)}`,
      );
    }
    emojis.push(g);
  }

  if (emojis.length !== 2) {
    throw new Error(
      `parse_failed: expected exactly 2 emojis, got ${emojis.length} in ${JSON.stringify(s)}`,
    );
  }
  if (emojis[0] === emojis[1]) {
    throw new Error(
      `parse_failed: expected 2 different emojis, got duplicate ${JSON.stringify(emojis[0])} in ${JSON.stringify(s)}`,
    );
  }

  return [emojis[0]!, emojis[1]!];
}

/**
 * One bounded attempt at picking two emojis. Throws on invalid output or
 * provider failure so the caller can try the fallback model.
 */
export async function pickEmojis({
  model,
  title,
}: PickEmojisInput): Promise<PickEmojisResult> {
  const started = Date.now();
  const { text, usage, response } = await generateText({
    model,
    prompt: PROMPT_TEMPLATE(title),
    maxRetries: 0,
    maxOutputTokens: 1024,
    abortSignal: AbortSignal.timeout(5_000),
  });
  const emojis = parseExactEmojiResponse(text);
  return {
    emojis,
    raw: text,
    model: response.modelId,
    latencyMs: Date.now() - started,
    usage: {
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
    },
  };
}

/** One bounded attempt per model, including fallback on invalid emoji output. */
export async function pickEmojisWithFallback(
  models: LanguageModel[],
  title: string,
  log: EmojiLogger,
): Promise<PickEmojisResult> {
  const attempts: Record<string, unknown>[] = [];
  let lastError: unknown = new Error("No emoji models configured");
  for (const model of models) {
    const started = Date.now();
    const modelId = typeof model === "string" ? model : model.modelId;
    try {
      const result = await pickEmojis({ model, title });
      attempts.push({ model: result.model, latencyMs: result.latencyMs, outcome: "ok" });
      log.set({ llmAttempts: attempts });
      return result;
    } catch (error) {
      lastError = error;
      attempts.push({ model: modelId, latencyMs: Date.now() - started, error: String(error) });
      log.set({ llmAttempts: attempts });
    }
  }
  throw lastError;
}

/**
 * Idempotency gate: does the title already end with at least one emoji
 * grapheme?
 */
export function titleEndsWithEmoji(title: string): boolean {
  const trimmed = title.trimEnd();
  if (!trimmed) return false;
  let last: string | undefined;
  for (const seg of segmenter.segment(trimmed)) last = seg.segment;
  if (!last) return false;
  return isEmojiGrapheme(last);
}

/** Composes the new title per the locked decision: `Original 🎉🚀`. */
export function composeTitle(original: string, emojis: [string, string]): string {
  const suffix = emojis.join("").replace(/\s+/gu, "");
  return `${original.trimEnd()} ${suffix}`;
}

function isEmojiGrapheme(grapheme: string): boolean {
  return (
    /\p{Emoji_Presentation}/u.test(grapheme) ||
    /\p{Emoji}\uFE0F/u.test(grapheme)
  );
}
