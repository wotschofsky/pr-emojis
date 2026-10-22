# pr-emojis

A GitHub App that appends two relevant and fun emojis to the title of every pull request. Install once on your account or org → every repo, present and future, is covered.

```
Fix leak on error case   →   Fix leak on error case 💧🪣
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
- [Vercel AI SDK](https://sdk.vercel.ai) with `@openrouter/ai-sdk-provider`
- GLM 5.3 Flash, falling back to Gemini 3.6 Flash; both use minimal reasoning
- [`evlog`](https://www.evlog.dev) for wide-event request logging
- Workers KV for per-PR concurrency locks
- Vitest for focused utility tests

## Project layout

```
src/
  index.ts      — Hono app and /webhook route
  processor.ts  — background PR processing, lock orchestration, staleness logic
  github.ts     — octokit App factory + PR get/patch helpers
  emoji.ts      — bounded model attempts, fallback, prompt + grapheme parser
  locks.ts      — Workers KV key helpers
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

Then generate a private key and download the PEM. **Convert it to PKCS#8** — GitHub hands you PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`), which `universal-github-app-jwt` (used by octokit on Workers) cannot sign with even with `nodejs_compat`:

```sh
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in your-app.private-key.pem \
  -out your-app.pkcs8.pem
```

The output should start with `-----BEGIN PRIVATE KEY-----` (no `RSA`).

### 2. Cloudflare setup

```sh
pnpm install
wrangler kv namespace create LOCKS
# paste the returned id into wrangler.toml
```

Push the secrets — pipe the PEM in from a file so newlines are preserved (pasting often collapses to one line and silently breaks JWT signing):

```sh
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret put GITHUB_APP_PRIVATE_KEY < your-app.pkcs8.pem
wrangler secret put OPENROUTER_API_KEY
```

After deploying, hit `/healthz` — it verifies all four secrets are present, KV is reachable, and a GitHub App JWT can actually be signed with the uploaded key. It does not call OpenRouter or GitHub, so a 200 verifies configuration, not end-to-end processing. A 503 names the failed check.

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

The webhook returns 202 immediately and processes the PR in the background. Each model gets one attempt with a five-second deadline and no nested SDK retries. API errors, timeouts, and invalid emoji output all trigger the fallback model. If both fail, the PR is left untouched. Completion logs include the served model, latency, usage, and each attempt's error; they are emitted after background processing finishes.

Models use explicit IDs, latency-prioritized provider routing, and `data_collection: "deny"`. The old Google API secret is no longer used. OpenRouter is an additional service that receives the PR title.

## Concurrency

Rapid title edits can fire several `edited` webhooks for the same PR. Two layers guard against races:

1. **Per-PR best-effort lock** in Workers KV (60s TTL). If a run is in flight, the new webhook flips a `pending` flag and returns. The in-flight run, on completion, sees the flag and processes the now-current title.
2. **Pre-PATCH staleness check.** We re-fetch the PR right before the PATCH. If the title has changed in the meantime, or already has emojis, we discard our LLM result. The user's edit always wins.

## Bake-off

The bake-off compares candidate models against the same prompt + parser used in production. It is local-only and not part of the deployed Worker.

```sh
OPENROUTER_API_KEY=… pnpm bench
```

Writes `bench/results/report.html` plus machine-readable `results.json`, and opens the report. Rows are commit messages, columns are models; the footer shows latency and token totals. Four requests run concurrently, using the production parser, deadline, and routing defaults. Models that require reasoning use minimal effort. Costs estimate successful responses only and exclude failed requests and fees.

Edit `bench/models.ts` to change candidates. Use `BENCH_MODELS` (comma-separated exact IDs) for a subset and `BENCH_OPEN_REPORT=0` for headless runs. Generated results stay local and are ignored by Git.

## License

MIT.
