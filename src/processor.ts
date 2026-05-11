import type { LanguageModel } from "ai";

import type { Env } from "./env.ts";
import type { RequestLogger } from "./logger.ts";
import {
  getPullRequestTitle,
  patchPullRequestTitle,
  type InstallationClient,
  type PullRefs,
} from "./github.ts";
import {
  composeTitle,
  pickEmojis,
  titleEndsWithEmoji,
  type PickEmojisResult,
} from "./emoji.ts";
import { lockKey, pendingKey } from "./locks.ts";
import { makeModel } from "./model.ts";
import { withRetry } from "./retry.ts";
import type { createApp } from "./github.ts";

type AppType = ReturnType<typeof createApp>;

export async function processPr(
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
  await env.LOCKS.put(lk, String(Date.now()), { expirationTtl: 60 });

  try {
    const installation = await ghApp.getInstallationOctokit(installationId);
    const model = makeModel(env);

    await runOnce(installation, model, refs, log);

    // If a follow-up webhook arrived while we were running, re-process using
    // the now-current title rather than the one we held in memory.
    if (await env.LOCKS.get(pk)) {
      await env.LOCKS.delete(pk);
      log.set({ chained: true });
      await runOnce(installation, model, refs, log);
    }
  } finally {
    await env.LOCKS.delete(lk);
  }
}

async function runOnce(
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
