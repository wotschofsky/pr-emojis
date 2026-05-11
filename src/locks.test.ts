import { describe, expect, it } from "vitest";

import { lockKey, pendingKey } from "./locks.ts";
import type { PullRefs } from "./github.ts";

const refs: PullRefs = {
  owner: "octo-org",
  repo: "widgets",
  pullNumber: 42,
};

describe("lock keys", () => {
  it("builds a stable per-installation PR lock key", () => {
    expect(lockKey(123, refs)).toBe("lock:123:octo-org/widgets:42");
  });

  it("builds a stable per-installation PR pending key", () => {
    expect(pendingKey(123, refs)).toBe("pending:123:octo-org/widgets:42");
  });
});
