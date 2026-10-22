import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "./env.ts";

const { processPr, log } = vi.hoisted(() => ({
  processPr: vi.fn(),
  log: { set: vi.fn(), emit: vi.fn() },
}));

vi.mock("./processor.ts", () => ({ processPr }));
vi.mock("./logger.ts", () => ({ newRequestLogger: () => log }));
vi.mock("./github.ts", () => ({
  createApp: () => ({ webhooks: { verify: async () => true } }),
}));

import app from "./index.ts";

async function sendWebhook() {
  const background: Promise<unknown>[] = [];
  const response = await app.fetch(
    new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": "verified-by-mock",
        "x-github-event": "pull_request",
      },
      body: JSON.stringify({
        action: "opened",
        installation: { id: 1 },
        repository: { owner: { login: "owner" }, name: "repo" },
        pull_request: { number: 1, title: "Fix memory leak" },
      }),
    }),
    {} as Env,
    {
      waitUntil: (promise: Promise<unknown>) => { background.push(promise); },
      passThroughOnException() {},
      props: {},
    },
  );
  return { response, background };
}

describe("webhook background logging", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts immediately and emits only after processing records its outcome", async () => {
    let finish!: () => void;
    processPr.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
      log.set({ outcome: "llm_failed_after_retries", error: "provider rejected request" });
    });

    const { response, background } = await sendWebhook();
    expect(response.status).toBe(202);
    expect(log.emit).not.toHaveBeenCalled();

    finish();
    await Promise.all(background);
    expect(log.emit).toHaveBeenCalledExactlyOnceWith({ status: 202 });
    expect(log.set.mock.invocationCallOrder.at(-1)).toBeLessThan(log.emit.mock.invocationCallOrder[0]!);
  });

  it("records and emits an unexpected background failure", async () => {
    processPr.mockRejectedValueOnce(new Error("GitHub unavailable"));
    const { response, background } = await sendWebhook();
    expect(response.status).toBe(202);
    await Promise.all(background);
    expect(log.set).toHaveBeenCalledWith({ outcome: "processing_failed", error: "Error: GitHub unavailable" });
    expect(log.emit).toHaveBeenCalledExactlyOnceWith({ status: 202 });
  });
});
