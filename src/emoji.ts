import { generateText, type LanguageModel } from "ai";

export const PROMPT_TEMPLATE = (title: string) =>
  `Given this PR title, reply with exactly two emojis that are funny and relevant. Reply with only the emojis, no text.\n\nTitle: ${title}`;

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
 * Picks emoji-shaped grapheme clusters out of a free-form string. We treat
 * "anything non-ASCII and non-whitespace" as a candidate emoji — sufficient
 * for filtering out stray punctuation or labels the model may include.
 */
export function extractEmojis(s: string): string[] {
  const out: string[] = [];
  for (const seg of segmenter.segment(s)) {
    const g = seg.segment;
    if (/^\s+$/.test(g)) continue;
    if (/^[\x00-\x7F]+$/.test(g)) continue;
    out.push(g);
  }
  return out;
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
  const emojis = extractEmojis(text);
  if (emojis.length < 2) {
    throw new Error(
      `parse_failed: expected ≥2 emojis, got ${emojis.length} in ${JSON.stringify(text)}`,
    );
  }
  return {
    emojis: [emojis[0]!, emojis[1]!],
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
 * grapheme? Returns true if the last non-whitespace grapheme is non-ASCII.
 */
export function titleEndsWithEmoji(title: string): boolean {
  const trimmed = title.trimEnd();
  if (!trimmed) return false;
  let last: string | undefined;
  for (const seg of segmenter.segment(trimmed)) last = seg.segment;
  if (!last) return false;
  if (/^\s+$/.test(last)) return false;
  return !/^[\x00-\x7F]+$/.test(last);
}

/** Composes the new title per the locked decision: `Original 🎉 🚀`. */
export function composeTitle(original: string, emojis: [string, string]): string {
  return `${original.trimEnd()} ${emojis[0]} ${emojis[1]}`;
}
