import { describe, expect, it } from "vitest";

import { composeTitle, extractEmojis, titleEndsWithEmoji } from "./emoji.ts";

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
    expect(composeTitle("Fix leak   ", ["💧", "🪣"])).toBe("Fix leak 💧 🪣");
  });
});
