/**
 * What the AI extraction has cost: per extraction run, per month, against an optional monthly budget.
 * Source: the append-only spend log (results.json → spend), which also keeps failed runs and documents that were
 * later removed. Costs are token counts × the price table in pmt/llm.py — estimates; the Anthropic Console is the bill.
 */
import { Chart, baseOption, valueAxis } from "../components/Chart";
import { Empty } from "../components/bits";
import { esc, fmtDate } from "../lib/format";
import { href } from "../lib/router";
import { useApp } from "../lib/state";
import type { SpendEntry } from "../lib/types";
import { PageIcon } from "../components/icons";

const usd = (v: number | null | undefined, d = 2) => (v == null ? "—" : `$${v.toFixed(v > 0 && v < 0.01 ? 3 : d)}`);
const ktok = (n?: number) => (n ? (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${(n / 1e3).toFixed(1)}k`) : "—");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

export function Usage() {
  const { data, prefs, openSource } = useApp();
  if (!data) return null;
  const docIds = new Set(data.documents.map((d) => d.id));
  // older results.json files (and the demo) have no spend log: fall back to the per-document costs
  const runs: SpendEntry[] =
    data.spend ??
    data.documents
      .filter((d) => d.cost_usd != null)
      .map((d) => ({ at: d.uploaded_at, doc_id: d.id, filename: d.filename, pages: d.pages, model: d.model ?? "", status: d.status, usage: d.usage ?? {}, cost_usd: d.cost_usd ?? null }));
  const total = runs.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const okRuns = runs.filter((r) => r.status === "done");
  const okCost = okRuns.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const okPages = okRuns.reduce((s, r) => s + r.pages, 0);
  const wasted = total - okCost;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthSpend = runs.filter((r) => r.at.slice(0, 7) === thisMonth).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const budget = prefs.budgetUsd ?? 0;

  // continuous month range from the first run to this month, so empty months show as gaps
  const byMonth = new Map<string, number>();
  for (const r of runs) byMonth.set(r.at.slice(0, 7), (byMonth.get(r.at.slice(0, 7)) ?? 0) + (r.cost_usd ?? 0));
  const months: string[] = [];
  if (runs.length) {
    let [y, m] = runs.map((r) => r.at.slice(0, 7)).sort()[0].split("-").map(Number);
    for (let guard = 0; guard < 120; guard++) {
      const ym = `${y}-${String(m).padStart(2, "0")}`;
      months.push(ym);
      if (ym >= thisMonth) break;
      m = m === 12 ? 1 : m + 1;
      if (m === 1) y++;
    }
  }
  const models = [...new Set(runs.map((r) => r.model).filter(Boolean))];
  const rows = [...runs].sort((a, b) => (b.at > a.at ? 1 : -1));

  return (
    <>
      <div class="card col-12 headcard">
        <div class="headrow">
          <h1 class="title">
            <span class="ticon"><PageIcon name="usage" /></span> Usage & cost
          </h1>
          <span class="note">AI extraction (Claude API){models.length ? ` · model: ${models.join(", ")}` : ""}</span>
        </div>
        <p class="note">
          Estimated from the token counts the API returned for each extraction. The Anthropic Console shows the exact bill.
          AWS hosting is separate (usually $0–2/month).
          {data.demo && " Demo profile: costs are made up."}
        </p>
      </div>

      <div class="card col-3 kpi">
        <h2>Total spent</h2>
        <div class="stat">{usd(total)}</div>
        <div class="note">
          {runs.length} extraction runs{wasted > 0.005 ? ` · ${usd(wasted)} on failed or duplicate runs` : ""}
        </div>
      </div>
      <div class="card col-3 kpi">
        <h2>This month</h2>
        <div class="stat">{usd(monthSpend)}</div>
        {budget > 0 ? (
          <>
            <div class={`meter ${monthSpend > budget ? "over" : ""}`}>
              <span style={{ width: `${Math.min(100, (monthSpend / budget) * 100)}%` }} />
            </div>
            <div class="note">
              {Math.round((monthSpend / budget) * 100)}% of your ${budget} monthly budget{monthSpend > budget ? " — over budget" : ""}
            </div>
          </>
        ) : (
          <div class="note">
            No budget set · <a href={href("settings")}>set one in Settings</a>
          </div>
        )}
      </div>
      <div class="card col-3 kpi">
        <h2>Average per page</h2>
        <div class="stat">{okPages ? usd(okCost / okPages, 3) : "—"}</div>
        <div class="note">a 50-page screening bundle ≈ {okPages ? usd((okCost / okPages) * 50) : "—"}</div>
      </div>
      <div class="card col-3 kpi">
        <h2>Average per document</h2>
        <div class="stat">{okRuns.length ? usd(okCost / okRuns.length) : "—"}</div>
        <div class="note">re-uploading the same report is detected and free</div>
      </div>

      {months.length > 0 && (
        <div class="card col-12">
          <h2>Spend per month</h2>
          <Chart
            height={200}
            deps={[months.join(), [...byMonth.values()].join(), budget]}
            build={(t) => ({
              ...baseOption(t),
              legend: { show: false },
              grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
              tooltip: { ...(baseOption(t).tooltip as object), trigger: "item", formatter: (p: unknown) => {
                const q = p as { name: string; value: number };
                return `${esc(q.name)}<br/><b>$${q.value.toFixed(2)}</b>`;
              } },
              xAxis: { type: "category", data: months.map(monthLabel), axisLabel: { color: t.muted, fontSize: 11 }, axisLine: { lineStyle: { color: t.line } } },
              yAxis: valueAxis(t, { min: 0, axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => `$${v}` } }) as never,
              series: [
                {
                  type: "bar",
                  barMaxWidth: 36,
                  itemStyle: { color: t.accent, borderRadius: [4, 4, 0, 0] },
                  data: months.map((m) => +(byMonth.get(m) ?? 0).toFixed(4)),
                  markLine: budget > 0 ? { silent: true, symbol: "none", lineStyle: { color: t.amber, type: "dashed" }, label: { color: t.muted, formatter: "budget" }, data: [{ yAxis: budget }] } : undefined,
                },
              ],
            })}
          />
        </div>
      )}

      <div class="card col-12">
        <h2>Per extraction run</h2>
        {!rows.length && <Empty>Nothing extracted yet.</Empty>}
        {rows.length > 0 && (
          <div class="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Document</th>
                  <th class="right">Pages</th>
                  <th>Model</th>
                  <th class="right">Input tokens</th>
                  <th class="right">Cached</th>
                  <th class="right">Output tokens</th>
                  <th class="right">Cost</th>
                  <th class="right">Per page</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr>
                    <td class="note">{fmtDate(r.at.slice(0, 10))}</td>
                    <td>
                      {docIds.has(r.doc_id) ? (
                        <button class="linkbtn" onClick={() => openSource({ doc_id: r.doc_id, page: 1, title: r.filename })}>
                          {r.filename}
                        </button>
                      ) : (
                        <span class="note">{r.filename}</span>
                      )}{" "}
                      {r.status !== "done" && <span class={`pill ${r.status === "failed" ? "err" : "idle"}`}>{r.status}</span>}
                    </td>
                    <td class="right">{r.pages}</td>
                    <td class="note">{r.model || "—"}</td>
                    <td class="right note">{ktok(r.usage?.input_tokens)}</td>
                    <td class="right note">{ktok((r.usage?.cache_read_input_tokens ?? 0) + (r.usage?.cache_creation_input_tokens ?? 0))}</td>
                    <td class="right note">{ktok(r.usage?.output_tokens)}</td>
                    <td class="num right">{usd(r.cost_usd)}</td>
                    <td class="right note">{r.cost_usd != null && r.pages ? usd(r.cost_usd / r.pages, 3) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={2}>Total</th>
                  <th class="right">{runs.reduce((s, r) => s + r.pages, 0)}</th>
                  <th colSpan={4} />
                  <th class="right">{usd(total)}</th>
                  <th />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p class="note">
          “Cached” is the instruction and catalog part of each request, reused across pages and billed at a fraction of the
          input price; the cost column includes it. Failed runs are listed because a partly processed document is still billed.
        </p>
      </div>
    </>
  );
}
