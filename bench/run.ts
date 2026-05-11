import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";

import { pickEmojis, composeTitle } from "../src/emoji.ts";
import { buildModels } from "./models.ts";

interface CorpusEntry {
  repo: string;
  title: string;
}

interface Cell {
  ok: boolean;
  emojis?: string;
  composed?: string;
  raw?: string;
  error?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY is required");
    process.exit(1);
  }

  const corpusPath = resolve(__dirname, "corpus.json");
  const corpus: CorpusEntry[] = JSON.parse(await readFile(corpusPath, "utf8"));
  const models = buildModels(apiKey);

  console.log(
    `Running ${corpus.length} titles × ${models.length} models = ${corpus.length * models.length} cells…`,
  );

  // results[titleIdx][modelIdx]
  const results: Cell[][] = corpus.map(() => []);

  for (let m = 0; m < models.length; m++) {
    const { label, model } = models[m]!;
    console.log(`\n→ ${label}`);
    for (let i = 0; i < corpus.length; i++) {
      const { title } = corpus[i]!;
      const cell = await runCell(model, title);
      results[i]![m] = cell;
      const status = cell.ok ? `${cell.emojis}` : `ERR: ${cell.error}`;
      console.log(`   [${i + 1}/${corpus.length}] ${cell.latencyMs}ms  ${status}`);
    }
  }

  const reportPath = resolve(__dirname, "results", "report.html");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, renderHtml(corpus, models, results));
  console.log(`\nReport written to ${reportPath}`);
  await open(reportPath);
}

async function runCell(
  model: ReturnType<typeof buildModels>[number]["model"],
  title: string,
): Promise<Cell> {
  const start = Date.now();
  try {
    const r = await pickEmojis({ model, title });
    return {
      ok: true,
      emojis: r.emojis.join(" "),
      composed: composeTitle(title, r.emojis),
      raw: r.raw,
      latencyMs: Date.now() - start,
      inputTokens: r.usage?.inputTokens,
      outputTokens: r.usage?.outputTokens,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

function renderHtml(
  corpus: CorpusEntry[],
  models: ReturnType<typeof buildModels>,
  results: Cell[][],
): string {
  const totals = models.map((_, m) => {
    let okCount = 0;
    let totalMs = 0;
    let totalInput = 0;
    let totalOutput = 0;
    for (let i = 0; i < corpus.length; i++) {
      const c = results[i]![m]!;
      totalMs += c.latencyMs;
      if (c.ok) okCount++;
      totalInput += c.inputTokens ?? 0;
      totalOutput += c.outputTokens ?? 0;
    }
    return {
      okCount,
      avgMs: Math.round(totalMs / corpus.length),
      totalInput,
      totalOutput,
    };
  });

  const rows = corpus
    .map((entry, i) => {
      const cells = models
        .map((_, m) => {
          const c = results[i]![m]!;
          if (!c.ok) {
            return `<td class="err"><div class="msg">${escapeHtml(c.error ?? "")}</div><div class="meta">${c.latencyMs}ms</div></td>`;
          }
          return `<td>
              <div class="emojis">${escapeHtml(c.emojis ?? "")}</div>
              <div class="composed">${escapeHtml(c.composed ?? "")}</div>
              <div class="meta">${c.latencyMs}ms${c.outputTokens != null ? ` · ${c.outputTokens} tok` : ""}</div>
            </td>`;
        })
        .join("");
      return `<tr>
          <th scope="row">
            <div class="repo">${escapeHtml(entry.repo)}</div>
            <div class="title">${escapeHtml(entry.title)}</div>
          </th>
          ${cells}
        </tr>`;
    })
    .join("\n");

  const headers = models
    .map((m) => `<th scope="col">${escapeHtml(m.label)}<div class="slug">${escapeHtml(m.slug)}</div></th>`)
    .join("");

  const footer = totals
    .map(
      (t) =>
        `<td><div class="ok">${t.okCount}/${corpus.length} ok</div><div class="meta">avg ${t.avgMs}ms · in ${t.totalInput} · out ${t.totalOutput}</div></td>`,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>pr-emojis bench</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 8px; vertical-align: top; text-align: left; }
  thead th { position: sticky; top: 0; background: #f6f6f6; }
  thead th .slug { font-weight: 400; color: #666; font-size: 11px; margin-top: 2px; }
  tbody th { background: #fafafa; max-width: 240px; }
  tbody th .repo { color: #666; font-size: 11px; }
  tbody th .title { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-word; }
  td { min-width: 200px; max-width: 280px; }
  .emojis { font-size: 22px; }
  .composed { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #333; margin-top: 4px; word-break: break-word; }
  .meta { color: #777; font-size: 11px; margin-top: 4px; }
  .err { background: rgba(255, 0, 0, 0.06); }
  .err .msg { color: #b00; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; word-break: break-word; }
  tfoot th, tfoot td { background: #f0f0f0; }
  @media (prefers-color-scheme: dark) {
    body { background: #111; color: #eee; }
    th, td { border-color: #333; }
    thead th { background: #1a1a1a; }
    thead th .slug, .meta { color: #999; }
    tbody th { background: #161616; }
    tbody th .repo { color: #999; }
    .composed { color: #ccc; }
    .err { background: rgba(255, 80, 80, 0.08); }
    .err .msg { color: #ff8a8a; }
    tfoot th, tfoot td { background: #1a1a1a; }
  }
</style>
</head>
<body>
  <h1>pr-emojis bench · ${new Date().toISOString()}</h1>
  <table>
    <thead><tr><th>commit message</th>${headers}</tr></thead>
    <tbody>
${rows}
    </tbody>
    <tfoot><tr><th>totals</th>${footer}</tr></tfoot>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
