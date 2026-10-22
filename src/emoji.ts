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

export interface PickEmojisResult {
  emojis: [string, string];
  raw: string;
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
 * Single attempt at picking two emojis. Throws on parse failure so the caller
 * can apply its retry policy. The caller also handles network / 5xx failures
 * thrown by the underlying provider.
 */
export async function pickEmojis({
  model,
  title,
}: PickEmojisInput): Promise<PickEmojisResult> {
  const { text, usage } = await generateText({
    model,
    prompt: PROMPT_TEMPLATE(title),
    // Gemini 3 uses thinking levels rather than the Gemini 2.5 zero-token
    // budget. Keep reasoning minimal for this small, latency-sensitive task.
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: "minimal", includeThoughts: false },
      },
    },
  });
  const emojis = parseExactEmojiResponse(text);
  return {
    emojis,
    raw: text,
    usage: {
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
    },
  };
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
