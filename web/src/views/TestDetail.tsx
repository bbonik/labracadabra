/**
 * One test in depth: chart, every value with its source, the ranges each lab printed, velocity and doubling
 * time where meaningful.
 */
import { useState } from "preact/hooks";
import { Chart } from "../components/Chart";
import { ChartControls, chartOpts } from "../components/ChartControls";
import { RangeControl } from "../components/RangeControl";
import { trendOption } from "../components/charts";
import { Disclaimer, Empty, FlagPill, PatternPills, SourceLink, prettyUnit, useValueText } from "../components/bits";
import { TESTS, decimalsFor, displayUnit, panelById, refFor, toDisplay } from "../lib/catalog";
import { fmtDate, fmtNum, fmtSigned } from "../lib/format";
import { href } from "../lib/router";
import { useApp } from "../lib/state";
import type { Result } from "../lib/types";
import { PanelIcon } from "../components/icons";

export function TestDetail({ testId }: { testId: string }) {
  const app = useApp();
  const { byTest, series, stats, prefs, setPrefs, data, openSource, correct, profile } = app;
  const [hl, setHl] = useState<string[] | undefined>();
  const valueText = useValueText();
  const t = TESTS[testId];
  if (!t) return <div class="card col-12"><Empty>Unknown test “{testId}”.</Empty></div>;
  const results = byTest.get(testId) ?? [];
  const unit = displayUnit(testId, prefs);
  const dec = decimalsFor(testId, unit);
  const pts = series(testId);
  const s = stats(testId);
  const panel = panelById[t.panel];
  const docs = new Map((data?.documents ?? []).map((d) => [d.id, d]));
  const pinned = prefs.pinned.includes(testId);
  const latest = results[results.length - 1];
  const uText = unit && unit !== "ratio" ? prettyUnit(unit) : "";

  const co = chartOpts(prefs);
  const { showTrend, showRef } = co;
  const yScale = co.yScale(testId);
  const setUnit = (u: string) => setPrefs({ ...prefs, units: { ...prefs.units, [testId]: u } });
  const togglePin = () =>
    setPrefs({ ...prefs, pinned: pinned ? prefs.pinned.filter((x) => x !== testId) : [...prefs.pinned, testId] });

  const refText = (r: Result) => {
    if (r.kind !== "numeric") return r.ref_text ?? "";
    const ref = refFor(r, profile?.sex);
    const f = (v?: number) => (v == null ? "" : fmtNum(toDisplay(v, testId, unit), dec));
    if (ref.low != null && ref.high != null) return `${f(ref.low)}–${f(ref.high)}`;
    if (ref.high != null) return `≤ ${f(ref.high)}`;
    if (ref.low != null) return `≥ ${f(ref.low)}`;
    return r.ref_text ?? "";
  };

  return (
    <>
      <div class="card col-12 headcard">
        <div class="crumbs">
          <a href={href("group", panel?.group)}>{panelById[panel?.group ?? ""]?.name ?? "Tests"}</a> ›{" "}
          <a href={href("group", panel?.group, { panel: t.panel })}>{panel?.name}</a>
        </div>
        <div class="headrow">
          <h1 class="title">
            <span class="ticon"><PanelIcon id={panel?.id ?? t.panel} size={18} /></span> {t.name}
          </h1>
          <div class="flex wrapflex">
            {Object.keys(t.units).length > 1 && (
              <label class="inline noprint">
                Units{" "}
                <select value={unit} onChange={(e) => setUnit((e.target as HTMLSelectElement).value)} aria-label="Display unit">
                  {Object.keys(t.units).map((u) => (
                    <option value={u}>{prettyUnit(u) || "—"}</option>
                  ))}
                </select>
              </label>
            )}
            <button onClick={togglePin} title="Show on the overview page">{pinned ? "★ Pinned" : "☆ Pin"}</button>
            <a class="btn" href={href("explore", undefined, { type: "compare", tests: testId })}>Compare…</a>
          </div>
        </div>
        {!results.length && <Empty>No results for this test yet.</Empty>}
      </div>

      {results.length > 0 && (
        <>
          <div class="col-12 tiles kpis">
            <div class="tile">
              <div class="tlabel">Latest · {fmtDate(latest.date)}</div>
              <div class="tvalue">{valueText(latest, false)} <small>{latest.kind === "numeric" ? uText : ""}</small></div>
              <div class="tsub"><FlagPill flag={latest.flag} kind={latest.kind} /></div>
            </div>
            {t.kind === "numeric" && (
              <>
                <div class="tile">
                  <div class="tlabel">Change since previous</div>
                  <div class="tvalue">{s.changeAbs != null ? fmtSigned(s.changeAbs, dec) : "—"}</div>
                  <div class="tsub">{s.changePct != null ? `${fmtSigned(s.changePct, 0)}% · ${fmtDate(s.previous?.date)}` : "only one result"}</div>
                </div>
                <div class="tile">
                  <div class="tlabel">Velocity (Theil–Sen)</div>
                  <div class="tvalue">{s.slopePerYear != null ? fmtSigned(s.slopePerYear, dec) : "—"}</div>
                  <div class="tsub">{uText} per year{s.trendP != null ? ` · trend p=${s.trendP.toFixed(2)}` : ""}</div>
                </div>
                {t.log && (
                  <div class="tile">
                    <div class="tlabel">Doubling time</div>
                    <div class="tvalue">{s.doublingYears ? fmtNum(s.doublingYears, 1) : "—"}</div>
                    <div class="tsub">{s.doublingYears ? "years (log-linear fit)" : "not increasing"}</div>
                  </div>
                )}
              </>
            )}
            <div class="tile">
              <div class="tlabel">History</div>
              <div class="tvalue">{results.length}</div>
              <div class="tsub">
                results · {s.outOfRange} out of range · since {fmtDate(results[0].date, true)}
              </div>
            </div>
          </div>

          {t.kind === "numeric" && pts.length > 0 && (
            <div class="card col-8">
              <div class="cardhead">
                <h2>Over time</h2>
                <ChartControls testIds={[testId]} />
              </div>
              <Chart
                height={320}
                deps={[pts, showTrend, showRef, yScale, hl, unit]}
                build={(tk) => trendOption(tk, pts, { name: t.name, unit: uText, decimals: dec, showTrend, showRef, yScale, zoomY: true, logScale: false, highlightIds: hl })}
                onPointClick={(p) => {
                  const id = (p.data as { id?: string })?.id;
                  const r = results.find((x) => x.id === id);
                  if (r) openSource({ doc_id: r.doc_id, page: r.page, title: `${t.name} · ${fmtDate(r.date)}`, source_text: r.source_text, value_raw: r.value_raw, raw_name: r.raw_name });
                }}
              />
              <RangeControl testId={testId} />
              <p class="note">
                Shaded band = reference range (it steps when labs used different ranges). Amber points are outside their
                range; hollow points are “&lt;”/“&gt;” values.<span class="noprint"> Drag the slider on the right to zoom the Y axis. Click any
                point to open the page it came from.</span>
              </p>
            </div>
          )}

          <div class={`card ${t.kind === "numeric" && pts.length ? "col-4" : "col-12"}`}>
            <h2>Patterns</h2>
            {s.patterns.length === 0 && <p class="note">No notable pattern: values are stable{s.n < 4 ? " (or there are too few results to tell)" : ""}.</p>}
            {s.patterns.map((p) => (
              <div class="row pattern" onMouseEnter={() => setHl(p.pointIds)} onMouseLeave={() => setHl(undefined)}>
                <div>
                  <PatternPills patterns={[p]} />
                  <div class="note">{p.detail}</div>
                </div>
              </div>
            ))}
            <p class="note noprint">Hover a pattern to highlight the points involved.</p>
          </div>

          <div class="card col-12">
            <h2>All results</h2>
            <div class="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Value</th>
                    <th>As printed</th>
                    <th>Reference</th>
                    <th>Flag</th>
                    <th>Lab</th>
                    <th>Source</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {[...results].reverse().map((r) => (
                    <tr class={r.status === "flagged" ? "rowflag" : ""}>
                      <td>{fmtDate(r.date)}</td>
                      <td class="num">{valueText(r)}</td>
                      <td class="mono">
                        {r.value_raw} {r.unit_raw}
                      </td>
                      <td class="note">{refText(r)}</td>
                      <td>
                        <FlagPill flag={r.flag} kind={r.kind} />
                      </td>
                      <td class="note">{r.lab ?? ""}</td>
                      <td>
                        <SourceLink r={r} label={docs.get(r.doc_id)?.filename?.slice(0, 18) ?? "doc"} />
                        {r.also_in && r.also_in.length > 0 && <span class="note" title="Same value also printed on other pages"> +{r.also_in.length}</span>}
                      </td>
                      <td>
                        {r.status === "flagged" && <span class="pill warn" title={(r.issues ?? []).join("; ")}>check</span>}
                        {r.status === "user_corrected" && <span class="pill idle">edited</span>}
                        <button class="linkbtn" hidden={!app.canEdit} title="Hide this value (e.g. a transcription error)" onClick={() => correct(r.id, { action: "ignore" })}>
                          hide
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div class="col-12">
            <Disclaimer />
          </div>
        </>
      )}
    </>
  );
}
