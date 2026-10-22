import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { Env } from "./env.ts";
import { runHealthChecks } from "./health.ts";

// Real keypair so the JWT path actually exercises WebCrypto signing —
// `universal-github-app-jwt` requires PKCS#8 PEM.
const PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
}).privateKey;

interface FakeKvOptions {
  failGet?: boolean;
}

function fakeKv(opts: FakeKvOptions = {}): KVNamespace {
  return {
    async get() {
      if (opts.failGet) throw new Error("kv unavailable");
      return null;
    },
  } as unknown as KVNamespace;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GITHUB_APP_ID: "12345",
    GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    OPENROUTER_API_KEY: "ai-key",
    LOCKS: fakeKv(),
    ASSETS: {} as Fetcher,
    ...overrides,
  };
}

describe("runHealthChecks", () => {
  it("reports ok when secrets, KV, and JWT signing all work", async () => {
    const result = await runHealthChecks(makeEnv());

    expect(result.status).toBe("ok");
    expect(result.failed).toEqual([]);
    expect(result.checks["kv:LOCKS"]).toBe("ok");
    expect(result.checks["github:jwt"]).toBe("ok");
  });

  it("flags each missing secret by name and skips JWT signing", async () => {
    const env = makeEnv({
      GITHUB_APP_PRIVATE_KEY: "",
      OPENROUTER_API_KEY: "",
    });

    const result = await runHealthChecks(env);

    expect(result.status).toBe("unhealthy");
    expect(result.failed).toContain("secret:GITHUB_APP_PRIVATE_KEY");
    expect(result.failed).toContain("secret:OPENROUTER_API_KEY");
    expect(result.failed).toContain("github:jwt");
    expect(result.checks["secret:GITHUB_APP_ID"]).toBe("ok");
  });

  it("flags a malformed GitHub private key", async () => {
    const env = makeEnv({ GITHUB_APP_PRIVATE_KEY: "not actually a PEM" });

    const result = await runHealthChecks(env);

    expect(result.status).toBe("unhealthy");
    expect(result.failed).toEqual(["github:jwt"]);
  });

  it("flags a KV binding that throws", async () => {
    const env = makeEnv({ LOCKS: fakeKv({ failGet: true }) });

    const result = await runHealthChecks(env);

    expect(result.status).toBe("unhealthy");
    expect(result.failed).toEqual(["kv:LOCKS"]);
  });

  it("flags a missing KV binding", async () => {
    const env = makeEnv({ LOCKS: undefined as unknown as KVNamespace });

    const result = await runHealthChecks(env);

    expect(result.status).toBe("unhealthy");
    expect(result.failed).toEqual(["kv:LOCKS"]);
  });
});
