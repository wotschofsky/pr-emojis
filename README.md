# pr-emojis

A GitHub App that prepends two relevant, funny emojis to the title of every pull request. Install once on your account or org → every repo, present and future, is covered.

```
Fix leak on error case   →   Fix leak on error case 💧 🪣
```

## What it does

- Triggers on `pull_request` `opened` and `edited` events (drafts included).
- Picks two emojis with an LLM and appends them to the title.
- Skips PRs whose title already ends with an emoji.
- Never creates a failing check, comment, or anything else visible.

## Permissions

The minimum GitHub allows:

- `pull_requests: write` — read and patch PR titles.
- `metadata: read` — auto-granted, mandatory.

No `contents` permission, so the app has no access to your code. Webhook subscriptions: `pull_request` only.

## Privacy

GitHub's `pull_request` webhook payload includes the PR title **and body**. This service only uses the title and persists neither, but both pass through the worker. If a team puts secrets in PR bodies, that is data crossing third-party infrastructure. Decide accordingly.

## Tech

- Cloudflare Workers + Hono + TypeScript
- [`octokit`](https://github.com/octokit/octokit.js) — App auth, webhook verification, REST
- [Vercel AI SDK](https://sdk.vercel.ai) with `@ai-sdk/google` (Gemma 4, free tier)
- [`evlog`](https://www.evlog.dev) for wide-event request logging
- Workers KV for per-PR concurrency locks
- Vitest for focused utility tests

## Project layout

```
src/
  index.ts      — Hono app and /webhook route
  processor.ts  — background PR processing, lock orchestration, staleness logic
  github.ts     — octokit App factory + PR get/patch helpers
  emoji.ts      — pickEmojis() + prompt + grapheme parser
  locks.ts      — Workers KV key helpers
  retry.ts      — retry policy
  model.ts      — production model construction
  logger.ts     — evlog wide-event setup
  env.ts        — typed bindings + secrets
public/
  index.html  — landing page with the install button
bench/
  run.ts      — local-only model bake-off (writes results/report.html)
  models.ts   — OpenRouter model list
  corpus.json — 20 real commit messages
```

## Setup

### 1. Register the GitHub App

Create a new GitHub App with these settings:

- **Webhook URL:** `https://pr-emojis.com/webhook` (or your deployed URL).
- **Webhook secret:** a long random string. Save it.
- **Permissions:** Pull requests → Read & write.
- **Subscribe to events:** Pull request.
- **Where can this be installed?** Any account.

Then generate a private key and download the PEM.

### 2. Cloudflare setup

```sh
pnpm install
wrangler kv namespace create LOCKS
# paste the returned id into wrangler.toml
```

Push the secrets:

```sh
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret put GITHUB_APP_PRIVATE_KEY      # paste the PEM
wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY
```

### 3. Local dev

Copy `.dev.vars.example` to `.dev.vars` and fill it in. Then:

```sh
pnpm dev
```

Use `gh webhook forward` or smee.io to relay GitHub deliveries to localhost.

### 4. Test

```sh
pnpm typecheck
pnpm test
```

### 5. Deploy

```sh
pnpm deploy
```

Point `pr-emojis.com` at the Worker, install the App on your account, watch new PRs get emojified.

## Failure mode

Every step is best-effort. On parse/network/5xx errors the LLM call is retried up to 3 times (4 attempts total). If all attempts fail we log it and silently return 200 — the PR is never blocked.

## Concurrency

Rapid title edits can fire several `edited` webhooks for the same PR. Two layers guard against races:

1. **Per-PR best-effort lock** in Workers KV (30s TTL). If a run is in flight, the new webhook flips a `pending` flag and returns. The in-flight run, on completion, sees the flag and processes the now-current title.
2. **Pre-PATCH staleness check.** We re-fetch the PR right before the PATCH. If the title has changed in the meantime, or already has emojis, we discard our LLM result. The user's edit always wins.

## Bake-off

The bake-off compares candidate models against the same prompt + parser used in production. It is local-only and not part of the deployed Worker.

```sh
OPENROUTER_API_KEY=… pnpm bench
```

Writes `bench/results/report.html` and opens it. Rows are commit messages, columns are models; the footer shows latency and token totals. Edit `bench/models.ts` to add or remove candidates.

## License

MIT.
