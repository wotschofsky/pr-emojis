import { App } from "octokit";
import type { Env } from "./env.ts";

/**
 * Builds an `octokit` App client from env. The App handles JWT signing,
 * installation token exchange, and webhook signature verification.
 *
 * Constructed per-request because Workers isolates are short-lived and there's
 * no meaningful cache hit rate; the App itself is cheap to build.
 */
export function createApp(env: Env): App {
  const privateKey = env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  return new App({
    appId: env.GITHUB_APP_ID,
    privateKey,
    webhooks: { secret: env.GITHUB_WEBHOOK_SECRET },
  });
}

/** Installation-scoped Octokit, fully enriched with the REST endpoint plugin. */
export type InstallationClient = App["octokit"];

export interface PullRefs {
  owner: string;
  repo: string;
  pullNumber: number;
}

/** Fetches the current PR title (used for the pre-PATCH staleness check). */
export async function getPullRequestTitle(
  octokit: InstallationClient,
  { owner, repo, pullNumber }: PullRefs,
): Promise<string> {
  const { data } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });
  return data.title;
}

/** PATCHes a PR title. */
export async function patchPullRequestTitle(
  octokit: InstallationClient,
  refs: PullRefs,
  title: string,
): Promise<void> {
  await octokit.rest.pulls.update({
    owner: refs.owner,
    repo: refs.repo,
    pull_number: refs.pullNumber,
    title,
  });
}
