import { initWorkersLogger, createWorkersLogger } from "evlog/workers";

let initialized = false;

export function initLogger(): void {
  if (initialized) return;
  initWorkersLogger({ env: { service: "pr-emojis" } });
  initialized = true;
}

export function newRequestLogger(request: Request, ctx: ExecutionContext) {
  initLogger();
  return createWorkersLogger(request, {
    headers: ["x-github-event", "x-github-delivery"],
    executionCtx: ctx,
  });
}

export type RequestLogger = ReturnType<typeof newRequestLogger>;
