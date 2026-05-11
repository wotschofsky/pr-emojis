import { describe, expect, it } from "vitest";

import {
  PROMPT_TEMPLATE,
  composeTitle,
  extractEmojis,
  parseExactEmojiResponse,
  titleEndsWithEmoji,
} from "./emoji.ts";

describe("extractEmojis", () => {
  it("extracts emoji grapheme clusters and ignores ASCII text", () => {
    expect(extractEmojis("Use 🧪 and 🚀 please")).toEqual(["🧪", "🚀"]);
  });

  it("keeps multi-codepoint emoji together", () => {
    expect(extractEmojis("Ship it 👍🏽 ✅")).toEqual(["👍🏽", "✅"]);
  });

  it("ignores non-ASCII text that is not emoji", () => {
    expect(extractEmojis("Fix café and 字")).toEqual([]);
  });
});

describe("parseExactEmojiResponse", () => {
  it("removes whitespace before parsing exactly two emojis", () => {
    expect(parseExactEmojiResponse("💧 🪣")).toEqual(["💧", "🪣"]);
    expect(parseExactEmojiResponse("\n👍🏽 ✅\n")).toEqual(["👍🏽", "✅"]);
  });

  it("accepts two adjacent emojis", () => {
    expect(parseExactEmojiResponse("🧪🚀")).toEqual(["🧪", "🚀"]);
  });

  it("rejects prose around otherwise valid emojis", () => {
    expect(() => parseExactEmojiResponse("Here you go: 🧪 🚀")).toThrow(
      "parse_failed",
    );
    expect(() => parseExactEmojiResponse("🧪 🚀!")).toThrow("parse_failed");
  });

  it("rejects too few or too many emojis", () => {
    expect(() => parseExactEmojiResponse("🧪")).toThrow("parse_failed");
    expect(() => parseExactEmojiResponse("🧪 🚀 ✅")).toThrow("parse_failed");
  });

  it("rejects duplicate emojis", () => {
    expect(() => parseExactEmojiResponse("🧪🧪")).toThrow(
      "expected 2 different emojis",
    );
  });

  it("rejects non-emoji Unicode content", () => {
    expect(() => parseExactEmojiResponse("café 🧪 🚀")).toThrow("parse_failed");
    expect(() => parseExactEmojiResponse("字 🧪 🚀")).toThrow("parse_failed");
  });
});

describe("titleEndsWithEmoji", () => {
  it("returns true when the last non-whitespace grapheme is an emoji", () => {
    expect(titleEndsWithEmoji("Fix leak 🪣  ")).toBe(true);
  });

  it("returns false when an emoji appears before trailing ASCII text", () => {
    expect(titleEndsWithEmoji("Fix leak 🪣 bucket")).toBe(false);
  });

  it("returns false for non-ASCII trailing text that is not emoji", () => {
    expect(titleEndsWithEmoji("Fix café")).toBe(false);
    expect(titleEndsWithEmoji("Use CJK 字")).toBe(false);
  });
});

describe("composeTitle", () => {
  it("trims trailing whitespace and appends two emojis", () => {
    expect(composeTitle("Fix leak   ", ["💧", "🪣"])).toBe("Fix leak 💧🪣");
  });

  it("removes whitespace from the generated emoji suffix", () => {
    expect(composeTitle("Fix leak", ["💧 ", "\n🪣"])).toBe("Fix leak 💧🪣");
  });
});

describe("PROMPT_TEMPLATE", () => {
  it("asks for exactly two emojis and no other content", () => {
    const prompt = PROMPT_TEMPLATE("Fix leak");

    expect(prompt).toContain("exactly two");
    expect(prompt).toContain("only those two emojis");
    expect(prompt).toContain("must be different");
    expect(prompt).toContain("No words");
    expect(prompt).toContain("extra emojis");
    expect(prompt).toContain("no spaces or separators");
    expect(prompt).toContain("Output: 🏁🏊");
  });
});
