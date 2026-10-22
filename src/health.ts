import type { Env } from "./env.ts";
import { createApp } from "./github.ts";

export type CheckStatus = "ok" | "fail";

export interface HealthResult {
  status: "ok" | "unhealthy";
  checks: Record<string, CheckStatus>;
  failed: string[];
}

const REQUIRED_SECRETS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "OPENROUTER_API_KEY",
] as const satisfies readonly (keyof Env)[];

/**
 * Checks configuration, KV access, and local JWT signing.
 *
 * We deliberately skip a live call to the OpenRouter API — it's billable and
 * adds latency. Presence of the key is enough; a real failure will surface
 * via webhook logs/alerting.
 */
export async function runHealthChecks(env: Env): Promise<HealthResult> {
  const checks: Record<string, CheckStatus> = {};

  let secretsOk = true;
  for (const name of REQUIRED_SECRETS) {
    const value = env[name];
    const present = typeof value === "string" && value.length > 0;
    checks[`secret:${name}`] = present ? "ok" : "fail";
    if (!present) secretsOk = false;
  }

  checks["kv:LOCKS"] = await checkKv(env);

  // Skip JWT signing if the private key is missing/empty — the secret check
  // already reports that and we'd just be re-reporting the same root cause.
  checks["github:jwt"] = secretsOk ? await checkGithubJwt(env) : "fail";

  const failed = Object.entries(checks)
    .filter(([, v]) => v === "fail")
    .map(([k]) => k);

  return {
    status: failed.length === 0 ? "ok" : "unhealthy",
    checks,
    failed,
  };
}

async function checkKv(env: Env): Promise<CheckStatus> {
  try {
    if (!env.LOCKS) return "fail";
    // `get` on a missing key returns null (not an error), so this round-trips
    // through KV without depending on any pre-existing data.
    await env.LOCKS.get("healthz");
    return "ok";
  } catch {
    return "fail";
  }
}

async function checkGithubJwt(env: Env): Promise<CheckStatus> {
  try {
    const app = createApp(env);
    // Signs an app-level JWT locally — exercises private key parsing without
    // any GitHub API call.
    await app.octokit.auth({ type: "app" });
    return "ok";
  } catch {
    return "fail";
  }
}
