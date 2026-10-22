import { Hono } from "hono";

import type { Env } from "./env.ts";
import { newRequestLogger } from "./logger.ts";
import { createApp, type PullRefs } from "./github.ts";
import { titleEndsWithEmoji } from "./emoji.ts";
import { runHealthChecks } from "./health.ts";
import { processPr } from "./processor.ts";

interface MinimalPullRequestEvent {
  action: string;
  installation?: { id: number };
  repository: { owner: { login: string }; name: string };
  pull_request: { number: number; title: string };
  sender?: { login: string };
}

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", async (c) => {
  const result = await runHealthChecks(c.env);
  return c.json(result, result.status === "ok" ? 200 : 503);
});

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
  c.executionCtx.waitUntil(
    processPr(c.env, ghApp, installationId, refs, log)
      .catch((error: unknown) => {
        log.set({ outcome: "processing_failed", error: String(error) });
      })
      .finally(() => log.emit({ status: 202 })),
  );
  return c.text("accepted", 202);
});

app.notFound((c) => c.text("not found", 404));

export default app;
