import { Hono } from "hono";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

import type { Env } from "./env.ts";
import { newRequestLogger, type RequestLogger } from "./logger.ts";
import {
  createApp,
  getPullRequestTitle,
  patchPullRequestTitle,
  type InstallationClient,
  type PullRefs,
} from "./github.ts";
import {
  pickEmojis,
  composeTitle,
  titleEndsWithEmoji,
  type PickEmojisResult,
} from "./emoji.ts";

type AppType = ReturnType<typeof createApp>;

interface MinimalPullRequestEvent {
  action: string;
  installation?: { id: number };
  repository: { owner: { login: string }; name: string };
  pull_request: { number: number; title: string };
  sender?: { login: string };
}

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.text("ok"));

app.post("/webhook", async (c) => {
  const log = newRequestLogger(c.req.raw, c.executionCtx);
  log.set({ route: "webhook" });

  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");
  const eventName = c.req.header("x-github-event");
  const deliveryId = c.req.header("x-github-delivery");
  log.set({ github: { event: eventName, delivery: deliveryId } });

  const ghApp = createApp(c.env);

  if (!signature || !(await ghApp.webhooks.verify(rawBody, signature))) {
    log.emit({ status: 401, reason: "bad_signature" });
    return c.text("bad signature", 401);
  }

  if (eventName !== "pull_request") {
    log.emit({ status: 200, skip: "wrong_event" });
    return c.text("ignored", 200);
  }

  let payload: MinimalPullRequestEvent;
  try {
    payload = JSON.parse(rawBody) as MinimalPullRequestEvent;
  } catch {
    log.emit({ status: 400, reason: "invalid_json" });
    return c.text("invalid json", 400);
  }

  if (payload.action !== "opened" && payload.action !== "edited") {
    log.emit({ status: 200, skip: "wrong_action", action: payload.action });
    return c.text("ignored", 200);
  }

  const installationId = payload.installation?.id;
  if (!installationId) {
    log.emit({ status: 400, reason: "no_installation" });
    return c.text("missing installation", 400);
  }

  const refs: PullRefs = {
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    pullNumber: payload.pull_request.number,
  };
  log.set({
    pr: { ...refs, sender: payload.sender?.login },
    installation: installationId,
  });

  if (titleEndsWithEmoji(payload.pull_request.title)) {
    log.emit({ status: 200, skip: "already_emojied" });
    return c.text("already emojied", 200);
  }

  // Fast 200 — work runs in background so we don't risk GitHub's 10s webhook
  // timeout. The lock + staleness check below still guarantee correctness even
  // if multiple webhooks fire in quick succession.
  c.executionCtx.waitUntil(processPr(c.env, ghApp, installationId, refs, log));
  log.emit({ status: 202 });
  return c.text("accepted", 202);
});

app.notFound((c) => c.text("not found", 404));

export default app;

function lockKey(installationId: number, refs: PullRefs): string {
  return `lock:${installationId}:${refs.owner}/${refs.repo}:${refs.pullNumber}`;
}
function pendingKey(installationId: number, refs: PullRefs): string {
  return `pending:${installationId}:${refs.owner}/${refs.repo}:${refs.pullNumber}`;
}

async function processPr(
  env: Env,
  ghApp: AppType,
  installationId: number,
  refs: PullRefs,
  log: RequestLogger,
): Promise<void> {
  const lk = lockKey(installationId, refs);
  const pk = pendingKey(installationId, refs);

  // Per-PR best-effort lock. KV is eventually consistent so this can double-fire
  // in rare cases; the pre-PATCH staleness check below is the real guarantee.
  if (await env.LOCKS.get(lk)) {
    await env.LOCKS.put(pk, "1", { expirationTtl: 60 });
    log.set({ deferred: true });
    return;
  }
  await env.LOCKS.put(lk, String(Date.now()), { expirationTtl: 30 });

  try {
    const installation = await ghApp.getInstallationOctokit(installationId);
    const model = makeModel(env);

    await runOnce(env, installation, model, refs, log);

    // If a follow-up webhook arrived while we were running, re-process using
    // the now-current title rather than the one we held in memory.
    if (await env.LOCKS.get(pk)) {
      await env.LOCKS.delete(pk);
      log.set({ chained: true });
      await runOnce(env, installation, model, refs, log);
    }
  } finally {
    await env.LOCKS.delete(lk);
  }
}

async function runOnce(
  env: Env,
  installation: InstallationClient,
  model: LanguageModel,
  refs: PullRefs,
  log: RequestLogger,
): Promise<void> {
  const baseTitle = await getPullRequestTitle(installation, refs);
  if (titleEndsWithEmoji(baseTitle)) {
    log.set({ outcome: "skipped_already_emojied" });
    return;
  }

  let result: PickEmojisResult;
  try {
    result = await withRetry(() => pickEmojis({ model, title: baseTitle }), log);
  } catch (err) {
    log.set({ outcome: "llm_failed_after_retries", error: String(err) });
    return;
  }

  // Staleness check: the user may have edited the title while we were calling
  // the LLM. If so, drop our result — the user's edit wins, and the `edited`
  // webhook they generated will trigger a fresh run.
  const currentTitle = await getPullRequestTitle(installation, refs);
  if (currentTitle !== baseTitle) {
    log.set({ outcome: "stale_title_changed" });
    return;
  }
  if (titleEndsWithEmoji(currentTitle)) {
    log.set({ outcome: "stale_already_emojied" });
    return;
  }

  const newTitle = composeTitle(baseTitle, result.emojis);
  await patchPullRequestTitle(installation, refs, newTitle);
  log.set({
    outcome: "patched",
    emojis: result.emojis.join(""),
    usage: result.usage,
  });
}

async function withRetry<T>(
  fn: () => Promise<T>,
  log: RequestLogger,
): Promise<T> {
  const maxAttempts = 4; // 1 initial + 3 retries, per plan
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      log.set({ [`attempt_${attempt}_error`]: String(err) });
      if (!isRetryable(err) || attempt === maxAttempts) break;
      await sleep(200 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function isRetryable(err: unknown): boolean {
  const msg = String(err);
  if (msg.startsWith("parse_failed")) return true;
  // AI SDK throws APICallError with `.statusCode`; treat 5xx and undefined as retryable.
  const status = (err as { statusCode?: number; status?: number })?.statusCode
    ?? (err as { status?: number })?.status;
  if (status === undefined) return true;
  return status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Production model is fixed: Gemma 4 on Google's free tier. If we ever need to
 * swap providers, do it here rather than via env — the choice is a code-level
 * design decision, not a per-environment knob.
 */
function makeModel(env: Env): LanguageModel {
  const google = createGoogleGenerativeAI({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  return google("gemma-4");
}
