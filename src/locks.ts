import type { PullRefs } from "./github.ts";

export function lockKey(installationId: number, refs: PullRefs): string {
  return `lock:${installationId}:${refs.owner}/${refs.repo}:${refs.pullNumber}`;
}

export function pendingKey(installationId: number, refs: PullRefs): string {
  return `pending:${installationId}:${refs.owner}/${refs.repo}:${refs.pullNumber}`;
}
