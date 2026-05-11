import { generateText, type LanguageModel } from "ai";

export const PROMPT_TEMPLATE = (title: string) =>
  [
    "Given this PR title, reply with exactly two funny, relevant emojis.",
    "The entire response must contain only those two emojis.",
    "No words, labels, punctuation, quotes, markdown, explanation, or extra emojis.",
    "Separate the two emojis with a single space.",
    "",
    `Title: ${title}`,
  ].join("\n");

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
 * Validates the exact model response. Whitespace is allowed as a separator or
 * around the response, but every non-whitespace grapheme must be one of exactly
 * two emoji graphemes.
 */
export function parseExactEmojiResponse(s: string): [string, string] {
  const emojis: string[] = [];

  for (const seg of segmenter.segment(s)) {
    const g = seg.segment;
    if (/^\s+$/.test(g)) continue;
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

/** Composes the new title per the locked decision: `Original 🎉 🚀`. */
export function composeTitle(original: string, emojis: [string, string]): string {
  return `${original.trimEnd()} ${emojis[0]} ${emojis[1]}`;
}

function isEmojiGrapheme(grapheme: string): boolean {
  return (
    /\p{Emoji_Presentation}/u.test(grapheme) ||
    /\p{Emoji}\uFE0F/u.test(grapheme)
  );
}
