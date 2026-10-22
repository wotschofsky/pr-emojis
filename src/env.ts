export interface Env {
  // Secrets (set via `wrangler secret put …`)
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  OPENROUTER_API_KEY: string;

  // Bindings
  LOCKS: KVNamespace;
  ASSETS: Fetcher;
}
