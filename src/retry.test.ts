import { describe, expect, it } from "vitest";

import { isRetryable, withRetry, type RetryLogger } from "./retry.ts";

class MemoryLog implements RetryLogger {
  fields: Array<Record<string, unknown>> = [];

  set(fields: Record<string, unknown>): void {
    this.fields.push(fields);
  }
}

describe("isRetryable", () => {
  it("retries parser failures, network-shaped errors, and 5xx responses", () => {
    expect(isRetryable(new Error("parse_failed: nope"))).toBe(true);
    expect(isRetryable(new Error("network unavailable"))).toBe(true);
    expect(isRetryable({ statusCode: 503 })).toBe(true);
  });

  it("does not retry 4xx responses", () => {
    expect(isRetryable({ statusCode: 400 })).toBe(false);
    expect(isRetryable({ status: 429 })).toBe(false);
  });
});

describe("withRetry", () => {
  it("retries retryable errors until the function succeeds", async () => {
    const log = new MemoryLog();
    let calls = 0;

    await expect(
      withRetry(
        async () => {
          calls++;
          if (calls < 3) throw new Error("parse_failed: one emoji");
          return "ok";
        },
        log,
        { baseDelayMs: 0 },
      ),
    ).resolves.toBe("ok");

    expect(calls).toBe(3);
    expect(log.fields).toHaveLength(2);
  });

  it("stops immediately for non-retryable errors", async () => {
    const log = new MemoryLog();
    let calls = 0;

    await expect(
      withRetry(
        async () => {
          calls++;
          throw { statusCode: 400 };
        },
        log,
        { baseDelayMs: 0 },
      ),
    ).rejects.toEqual({ statusCode: 400 });

    expect(calls).toBe(1);
    expect(log.fields).toHaveLength(1);
  });
});
