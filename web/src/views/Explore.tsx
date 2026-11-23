/**
 * Explore: free-form analysis across tests: over time, side by side, X vs Y with correlation, velocity,
 * % change and a panel heatmap.
 */
import type { EChartsOption } from "echarts";
import type { SeriesPoint } from "../analytics/patterns";
import { linreg, pearson } from "../analytics/stats";
import { Chart, alpha, baseOption, timeAxis, valueAxis, type Tokens } from "../components/Chart";
import { isOut, pointItem, pointTooltip, trendOption, yBounds } from "../components/charts";
import { Disclaimer, Empty, prettyUnit } from "../components/bits";
import { TestSearch } from "../components/TestSearch";
import { ChartControls, chartOpts } from "../components/ChartControls";
import { PANELS, TESTS, decimalsFor, displayUnit, panelById } from "../lib/catalog";
import { YEAR_MS, esc, fmtDate, fmtNum, toTime } from "../lib/format";
import { go, href, type Route } from "../lib/router";
import { useApp } from "../lib/state";
import { PageIcon, PanelIcon } from "../components/icons";

const TYPES = [
  { id: "time", label: "Over time", hint: "Actual values over time. One test shows its reference range as a shaded band; several tests share one chart (two different units get two axes) and out-of-range points are outlined in amber." },
  { id: "multi", label: "Side by side", hint: "One small chart per test on a shared time axis, each with its own reference range band — the clearest way to look at a whole panel." },
  { id: "scatter", label: "X vs Y", hint: "Pairs results taken within 14 days of each other, with correlation. The first two selected tests are X and Y." },
  { id: "velocity", label: "Velocity", hint: "Change per year between consecutive results (negative = falling). One test at a time." },
  { id: "change", label: "% change", hint: "Percent change between consecutive results (negative = falling)." },
  { id: "heatmap", label: "Heatmap", hint: "In range (green) vs below / above range (amber) across visits." },
] as const;

const RANGES = [
  { id: "1y", label: "1 year", years: 1 },
  { id: "3y", label: "3 years", years: 3 },
  { id: "5y", label: "5 years", years: 5 },
  { id: "all", label: "All", years: 100 },
];

/** CSS variables behind Tokens.series, so chips can show the same colour as their line */
const SERIES_VARS = ["--accent", "--accent2", "--pink", "--orange", "--s5", "--s6", "--s7", "--s8"];

const csv = (s: string | null) => (s || "").split(",").filter(Boolean);

export function Explore({ route }: { route: Route }) {
  const { byTest, series, prefs, openSource } = useApp();
  const rawType = route.params.get("type");
  const type = rawType === "compare" ? "time" : rawType === "range" ? "multi" : rawType || "time";
  const range = route.params.get("range") || "all";
  const co = chartOpts(prefs);
  const { showTrend, showRef } = co;
  const available = [...byTest.keys()].filter((id) => TESTS[id]?.kind === "numeric");
  const tests = csv(route.params.get("tests")).filter((id) => TESTS[id] && byTest.has(id));
  // panels whose tests are offered as on/off chips: those explicitly kept + those of every selected test
  const panels = [...new Set([...csv(route.params.get("panels")), ...tests.map((id) => TESTS[id].panel)])].filter((p) => panelById[p]);
  const set = (p: Record<string, string | string[]>) =>
    go(href("explore", undefined, { type, range, tests, panels, ...p }));

  const lastDate = Math.max(0, ...available.flatMap((id) => (byTest.get(id) ?? []).map((r) => toTime(r.date!))));
  const years = RANGES.find((r) => r.id === range)?.years ?? 100;
  const since = lastDate - years * YEAR_MS - 86400000;
  const ser = (id: string, unit?: string) => series(id, unit).filter((p) => toTime(p.date) >= since);
  const info = TYPES.find((x) => x.id === type) ?? TYPES[0];
  const single = type === "velocity";
  const pair = type === "scatter";

  const toggle = (id: string) => {
    if (tests.includes(id)) return set({ tests: tests.filter((x) => x !== id) });
    if (single) return set({ tests: [id] });
    if (pair && tests.length >= 2) return set({ tests: [tests[0], id] }); // replace Y
    set({ tests: [...tests, id] });
  };
  const addFromSelect = (v: string) => {
    if (!v) return;
    if (v.startsWith("panel:")) {
      const p = v.slice(6);
      const ids = available.filter((id) => TESTS[id].panel === p);
      return set({ panels: [...panels, p], tests: single ? ids.slice(0, 1) : [...new Set([...tests, ...ids])] });
    }
    toggle(v);
  };
  const panelTests = (p: string) => available.filter((id) => TESTS[id].panel === p);
  const hidePanel = (p: string) => set({ panels: panels.filter((x) => x !== p), tests: tests.filter((id) => TESTS[id].panel !== p) });
  const setPanelAll = (p: string, on: boolean) => {
    const ids = panelTests(p);
    set({ tests: on ? (single ? ids.slice(0, 1) : [...new Set([...tests, ...ids])]) : tests.filter((id) => !ids.includes(id)) });
  };

  const onPoint = (p: { data: unknown }) => {
    const d = p.data as { id?: string } | undefined;
    if (!d?.id) return;
    for (const id of tests) {
      const r = byTest.get(id)?.find((x) => x.id === d.id);
      if (r) return openSource({ doc_id: r.doc_id, page: r.page, title: `${TESTS[id].name} · ${fmtDate(r.date)}`, source_text: r.source_text, value_raw: r.value_raw, raw_name: r.raw_name });
    }
  };

  const units = [...new Set(tests.map((id) => displayUnit(id, prefs)))];
  const showMulti = type === "multi" || (type === "time" && units.length > 2);
  let body: preact.JSX.Element;
  if (!tests.length) body = <Empty>Pick one or more tests above to draw a chart.</Empty>;
  else if (pair && tests.length < 2) body = <Empty>Pick a second test for the Y axis.</Empty>;
  else if (showMulti) {
    body = (
      <>
        {type === "time" && <p class="note">These tests use more than two different units, so they are shown side by side.</p>}
        <SmallMultiples ids={tests} ser={ser} onPoint={onPoint} />
      </>
    );
  } else {
    const build = (t: Tokens): EChartsOption => {
      switch (type) {
        case "scatter":
          return scatterChart(t, tests[0], tests[1], ser(tests[0]), ser(tests[1]), prefs.units);
        case "velocity":
          return velocityChart(t, tests[0], ser(tests[0]), displayUnit(tests[0], prefs));
        case "change":
          return changeChart(t, tests.map((id) => ({ id, pts: ser(id) })));
        case "heatmap":
          return heatmapChart(t, tests.map((id) => ({ id, pts: ser(id) })));
        default:
          if (tests.length === 1) {
            const u = displayUnit(tests[0], prefs);
            return trendOption(t, ser(tests[0]), { name: TESTS[tests[0]].name, unit: prettyUnit(u), decimals: decimalsFor(tests[0], u), showTrend, showRef, yScale: co.yScale(tests[0]), zoomY: true });
          }
          return timeChart(t, tests.map((id) => ({ id, unit: displayUnit(id, prefs), pts: ser(id) })));
      }
    };
    const h = type === "heatmap" ? Math.max(220, 60 + tests.length * 34) : 420;
    body = <Chart height={h} build={build} deps={[type, range, tests.join(","), prefs.units, showTrend, showRef, co.yScale(tests[0] ?? "")]} onPointClick={onPoint} />;
  }

  // chip colour = line colour on charts that overlay several series
  const coloured = type === "time" || type === "change";
  const chipLabel = (id: string) => {
    const i = tests.indexOf(id);
    if (pair && i === 0) return "X: ";
    if (pair && i === 1) return "Y: ";
    return "";
  };

  return (
    <>
      <div class="card col-12 headcard noprint-controls">
        <div class="headrow">
          <h1 class="title">
            <span class="ticon"><PageIcon name="explore" /></span> Explore
          </h1>
          <div class="seg" role="tablist">
            {RANGES.map((r) => (
              <button class={range === r.id ? "active" : ""} onClick={() => set({ range: r.id })}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div class="seg types" role="tablist">
          {TYPES.map((x) => (
            <button class={type === x.id ? "active" : ""} onClick={() => set({ type: x.id, tests: x.id === "velocity" ? tests.slice(0, 1) : tests })}>
              {x.label}
            </button>
          ))}
        </div>
        <p class="note">{info.hint}</p>

        {panels.map((p) => {
          const ids = panelTests(p);
          const on = ids.filter((id) => tests.includes(id)).length;
          return (
            <div class="panelchips">
              <div class="panelchips-head">
                <span class="note">
                  <PanelIcon id={p} size={14} /> {panelById[p].name} · {on}/{ids.length} shown
                </span>
                {!single && on < ids.length && (
                  <button class="linkbtn" onClick={() => setPanelAll(p, true)}>
                    all
                  </button>
                )}
                {on > 0 && (
                  <button class="linkbtn" onClick={() => setPanelAll(p, false)}>
                    none
                  </button>
                )}
                <button class="linkbtn" title="Remove this panel from the picker" onClick={() => hidePanel(p)}>
                  hide panel
                </button>
              </div>
              <div class="chips tight">
                {ids.map((id) => {
                  const i = tests.indexOf(id);
                  const active = i >= 0;
                  return (
                    <button class={`chip toggle ${active ? "active" : "off"}`} aria-pressed={active} onClick={() => toggle(id)} title={active ? "Click to hide" : "Click to show"}>
                      {coloured && active && <span class="dot" style={{ background: `var(${SERIES_VARS[i % SERIES_VARS.length]})` }} />}
                      {active && chipLabel(id)}
                      {TESTS[id].name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div class="picker">
          <TestSearch
            placeholder="Search a test to add (any language)…"
            panels={!single}
            onlyWithData
            filter={(id) => available.includes(id)}
            exclude={tests}
            onPick={addFromSelect}
            className="grow"
          />
          <select value="" onChange={(e) => addFromSelect((e.target as HTMLSelectElement).value)} aria-label="Add test or panel">
            <option value="">Browse by panel…</option>
            {PANELS.flatMap((g) => g.children ?? []).map((p) => {
              const ids = available.filter((id) => TESTS[id].panel === p.id);
              if (!ids.length) return null;
              return (
                <optgroup label={p.name}>
                  {!single && ids.length > 1 && <option value={`panel:${p.id}`}>▸ Whole panel: {p.name} ({ids.length})</option>}
                  {ids.map((id) => (
                    <option value={id} disabled={tests.includes(id)}>
                      {TESTS[id].name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          {tests.length > 0 && (
            <button class="linkbtn" onClick={() => set({ tests: [] })}>
              clear selection
            </button>
          )}
        </div>
      </div>
      <div class="card col-12">
        {tests.length > 0 && (showMulti || (type === "time" && tests.length === 1)) && (
          <div style={{ marginBottom: "8px" }}>
            <ChartControls testIds={tests} />
          </div>
        )}
        {body}
      </div>
      <div class="col-12">
        <Disclaimer />
      </div>
    </>
  );
}

// ───────────────────────── small multiples ─────────────────────────

function SmallMultiples({ ids, ser, onPoint }: { ids: string[]; ser: (id: string) => SeriesPoint[]; onPoint: (p: { data: unknown }) => void }) {
  const { prefs } = useApp();
  const co = chartOpts(prefs);
  const all = ids.map((id) => ({ id, pts: ser(id) }));
  const times = all.flatMap((a) => a.pts.map((p) => toTime(p.date)));
  if (!times.length) return <Empty>No results in this time range.</Empty>;
  const pad = Math.max(20 * 86400000, (Math.max(...times) - Math.min(...times)) * 0.03);
  const xMin = Math.min(...times) - pad,
    xMax = Math.max(...times) + pad;
  return (
    <div class="multigrid">
      {all.map(({ id, pts }) => {
        const u = displayUnit(id, prefs);
        return (
          <div class="multicell">
            {pts.length ? (
              <Chart
                height={190}
                deps={[pts, u, xMin, xMax, co.showTrend, co.showRef, co.yScale(id)]}
                onPointClick={onPoint}
                build={(t) => trendOption(t, pts, { name: TESTS[id].name, unit: prettyUnit(u), decimals: decimalsFor(id, u), compact: true, xMin, xMax, showTrend: co.showTrend, showRef: co.showRef, yScale: co.yScale(id) })}
              />
            ) : (
              <Empty>{TESTS[id].name}: no results in this time range</Empty>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────── chart builders ─────────────────────────

function timeChart(t: Tokens, items: { id: string; unit: string; pts: SeriesPoint[] }[]): EChartsOption {
  const units = [...new Set(items.map((i) => i.unit))];
  const twoAxes = units.length === 2;
  const meta = new Map<string, { name: string; unit: string; dec: number }>();
  items.forEach((it) => meta.set(it.id, { name: TESTS[it.id].name, unit: prettyUnit(it.unit), dec: decimalsFor(it.id, it.unit) }));
  return {
    ...baseOption(t),
    grid: { left: 8, right: 8, top: 52, bottom: 40, containLabel: true },
    legend: { ...(baseOption(t).legend as object), top: 0, type: "scroll" },
    tooltip: {
      ...(baseOption(t).tooltip as object),
      trigger: "item",
      formatter: (p: unknown) => {
        const d = (p as { data?: { pt?: SeriesPoint; tid?: string } }).data;
        const m = d?.tid ? meta.get(d.tid) : undefined;
        return d?.pt && m ? pointTooltip(m.name, d.pt, m.unit, m.dec) : "";
      },
    },
    xAxis: timeAxis(t),
    yAxis: units.map((u, i) => {
      const yb = yBounds(items.filter((it) => it.unit === u).flatMap((it) => it.pts.map((p) => p.value)));
      return valueAxis(t, {
        name: prettyUnit(u) || "ratio",
        position: i ? "right" : "left",
        min: yb.min,
        max: yb.max,
        interval: yb.interval,
        nameTextStyle: { color: t.muted, fontSize: 11, align: i ? "right" : "left" },
        splitLine: { show: i === 0, lineStyle: { color: t.line, type: "dashed" } },
      });
    }) as never,
    dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 6, borderColor: t.line, textStyle: { color: t.muted, fontSize: 10 } }],
    series: items.map((it, i) => {
      const color = t.series[i % t.series.length];
      return {
        type: "line",
        name: `${TESTS[it.id].name}${twoAxes ? ` (${prettyUnit(it.unit)})` : ""}`,
        yAxisIndex: twoAxes ? units.indexOf(it.unit) : 0,
        data: it.pts.map((p) => ({ ...pointItem(t, p, color, { size: 7 }), tid: it.id })),
        lineStyle: { width: 2, color },
        itemStyle: { color },
      };
    }),
  };
}

function scatterChart(t: Tokens, xId: string, yId: string, xs: SeriesPoint[], ys: SeriesPoint[], units: Record<string, string>): EChartsOption {
  const pairs: { x: number; y: number; date: string; id: string }[] = [];
  for (const a of xs) {
    let best: SeriesPoint | null = null;
    let bestDt = 14 * 86400000;
    for (const b of ys) {
      const dt = Math.abs(toTime(a.date) - toTime(b.date));
      if (dt <= bestDt) {
        bestDt = dt;
        best = b;
      }
    }
    if (best) pairs.push({ x: a.value, y: best.value, date: a.date, id: a.id });
  }
  const r = pearson(pairs.map((p) => p.x), pairs.map((p) => p.y));
  const lr = linreg(pairs.map((p) => ({ t: p.x, v: p.y })));
  const xmin = Math.min(...pairs.map((p) => p.x)),
    xmax = Math.max(...pairs.map((p) => p.x));
  const ux = prettyUnit(units[xId] ?? TESTS[xId].unit),
    uy = prettyUnit(units[yId] ?? TESTS[yId].unit);
  const xb = yBounds(pairs.map((p) => p.x), 0.1),
    yb = yBounds(pairs.map((p) => p.y), 0.1);
  return {
    ...baseOption(t),
    title: {
      text: pairs.length >= 3 ? `r = ${r.toFixed(2)} · n = ${pairs.length}` : `n = ${pairs.length} paired results`,
      textStyle: { color: t.muted, fontSize: 12, fontWeight: "normal" },
      right: 10,
      top: 0,
    },
    grid: { left: 56, right: 24, top: 40, bottom: 52, containLabel: true },
    tooltip: {
      ...(baseOption(t).tooltip as object),
      trigger: "item",
      formatter: (p: unknown) => {
        const d = (p as { data?: { value: [number, number]; date?: string } }).data;
        return d?.date ? `${fmtDate(d.date)}<br/>${esc(TESTS[xId].name)}: ${fmtNum(d.value[0], 2)} ${esc(ux)}<br/>${esc(TESTS[yId].name)}: ${fmtNum(d.value[1], 2)} ${esc(uy)}` : "";
      },
    },
    legend: { show: false },
    xAxis: valueAxis(t, {
      name: `X: ${TESTS[xId].name}${ux ? ` (${ux})` : ""}`,
      nameLocation: "middle",
      nameGap: 32,
      nameTextStyle: { color: t.text, fontSize: 12, fontWeight: 600 },
      min: xb.min,
      max: xb.max,
      interval: xb.interval,
    }) as never,
    yAxis: valueAxis(t, {
      name: `Y: ${TESTS[yId].name}${uy ? ` (${uy})` : ""}`,
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: 48,
      nameTextStyle: { color: t.text, fontSize: 12, fontWeight: 600 },
      min: yb.min,
      max: yb.max,
      interval: yb.interval,
    }) as never,
    series: [
      {
        type: "scatter",
        symbolSize: 11,
        itemStyle: { color: t.accent, opacity: 0.85 },
        data: pairs.map((p) => ({ value: [p.x, p.y], date: p.date, id: p.id })),
      },
      ...(pairs.length >= 3
        ? [{ type: "line" as const, symbol: "none", lineStyle: { color: t.accent2, type: "dashed" as const }, data: [[xmin, lr.intercept + lr.slope * xmin], [xmax, lr.intercept + lr.slope * xmax]], tooltip: { show: false } }]
        : []),
    ],
  };
}

function velocityChart(t: Tokens, id: string, pts: SeriesPoint[], unit: string): EChartsOption {
  const bars = pts.slice(1).map((p, i) => {
    const a = pts[i];
    const dtY = (toTime(p.date) - toTime(a.date)) / YEAR_MS;
    const v = dtY > 0.02 ? (p.value - a.value) / dtY : 0;
    return { value: [toTime(p.date), v], from: a.date, to: p.date, id: p.id, itemStyle: { color: v >= 0 ? t.accent : t.accent2 } };
  });
  return {
    ...baseOption(t),
    legend: { show: false },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: {
      ...(baseOption(t).tooltip as object),
      trigger: "item",
      formatter: (p: unknown) => {
        const d = (p as { data?: { value: [number, number]; from: string; to: string } }).data;
        return d ? `${fmtDate(d.from)} → ${fmtDate(d.to)}<br/><b>${fmtNum(d.value[1], 3)} ${esc(prettyUnit(unit))}/yr</b>` : "";
      },
    },
    xAxis: timeAxis(t),
    yAxis: valueAxis(t, { name: `${TESTS[id].name} · ${prettyUnit(unit)} per year`, scale: false, nameTextStyle: { color: t.muted, fontSize: 11, align: "left" } }) as never,
    series: [{ type: "bar", barMaxWidth: 26, data: bars, itemStyle: { borderRadius: [4, 4, 0, 0] } }],
  };
}

function changeChart(t: Tokens, items: { id: string; pts: SeriesPoint[] }[]): EChartsOption {
  return {
    ...baseOption(t),
    grid: { left: 8, right: 16, top: 52, bottom: 8, containLabel: true },
    legend: { ...(baseOption(t).legend as object), top: 0, type: "scroll" },
    tooltip: { ...(baseOption(t).tooltip as object), valueFormatter: (v: unknown) => `${fmtNum(Number(v), 1)}%` },
    xAxis: timeAxis(t),
    yAxis: valueAxis(t, { name: "% change vs previous", scale: false, nameTextStyle: { color: t.muted, fontSize: 11, align: "left" } }) as never,
    series: items.map((it, i) => ({
      type: "bar",
      name: TESTS[it.id].name,
      barMaxWidth: 18,
      itemStyle: { color: t.series[i % t.series.length], borderRadius: [3, 3, 0, 0] },
      data: it.pts.slice(1).map((p, j) => ({ value: [toTime(p.date), it.pts[j].value ? ((p.value - it.pts[j].value) / Math.abs(it.pts[j].value)) * 100 : 0], id: p.id })),
    })),
  };
}

function heatmapChart(t: Tokens, items: { id: string; pts: SeriesPoint[] }[]): EChartsOption {
  const dates = [...new Set(items.flatMap((i) => i.pts.map((p) => p.date)))].sort();
  const names = items.map((i) => TESTS[i.id].name);
  const data: { value: [number, number, number]; v: number; id: string }[] = [];
  items.forEach((it, yi) =>
    it.pts.forEach((p) => {
      const status = !isOut(p) ? 0 : p.low != null && p.value < p.low ? -1 : 1;
      data.push({ value: [dates.indexOf(p.date), yi, status], v: p.value, id: p.id });
    }),
  );
  return {
    ...baseOption(t),
    legend: { show: false },
    grid: { left: 8, right: 16, top: 10, bottom: 50, containLabel: true },
    tooltip: {
      ...(baseOption(t).tooltip as object),
      trigger: "item",
      formatter: (p: unknown) => {
        const d = (p as { data?: { value: [number, number, number]; v: number } }).data;
        return d ? `${esc(names[d.value[1]])}<br/>${fmtDate(dates[d.value[0]])}: <b>${fmtNum(d.v, 2)}</b>` : "";
      },
    },
    xAxis: { type: "category", data: dates.map((d) => fmtDate(d, true)), axisLabel: { color: t.muted, fontSize: 10, rotate: 45 }, axisLine: { lineStyle: { color: t.line } }, splitArea: { show: false } },
    yAxis: { type: "category", data: names, axisLabel: { color: t.text, fontSize: 11 }, axisLine: { show: false }, inverse: true },
    visualMap: {
      type: "piecewise",
      show: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      dimension: 2,
      textStyle: { color: t.muted, fontSize: 11 },
      pieces: [
        { value: -1, label: "below range", color: alpha(t.amber, 0.3) },
        { value: 0, label: "in range", color: alpha(t.green, 0.45) },
        { value: 1, label: "above range", color: t.amber },
      ],
    },
    series: [{ type: "heatmap", data, itemStyle: { borderColor: t.panel, borderWidth: 2, borderRadius: 4 } }],
  };
}
