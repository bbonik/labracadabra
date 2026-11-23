/**
 * Chart options for one test over time: values in real units, reference range bands that step when labs
 * change, censored values ("<0.5"), trend lines and tooltips.
 */
import type { EChartsOption } from "echarts";
import type { SeriesPoint } from "../analytics/patterns";
import { linreg } from "../analytics/stats";
import { YEAR_MS, esc, fmtDate, fmtNum, toTime } from "../lib/format";
import type { YScale } from "../lib/types";
import { alpha, baseOption, timeAxis, valueAxis, type Tokens } from "./Chart";

export interface TrendOpts {
  name: string;
  unit: string;
  decimals: number;
  showTrend?: boolean;
  logScale?: boolean;
  highlightIds?: string[];
  /** small-multiples mode: no slider, title inside the chart, tighter grid */
  compact?: boolean;
  /** shared time window (ms) so small multiples line up */
  xMin?: number;
  xMax?: number;
  /** draw the reference range band (default true) */
  showRef?: boolean;
  /** y-axis scaling (default "fit": zoom to the values) */
  yScale?: YScale;
  /** vertical zoom slider on the right (single-test detail chart) */
  zoomY?: boolean;
}

interface RefSegment {
  low?: number;
  high?: number;
  x0: number;
  x1: number;
}

/** Consecutive points sharing the same range become one band segment (labs differ ⇒ stepped band). */
function refSegments(pts: SeriesPoint[], xMin: number, xMax: number): RefSegment[] {
  const key = (p: SeriesPoint) => (p.low == null && p.high == null ? null : `${p.low ?? ""}|${p.high ?? ""}`);
  const ts = pts.map((p) => toTime(p.date));
  const segs: RefSegment[] = [];
  for (let i = 0; i < pts.length; ) {
    const k = key(pts[i]);
    if (k == null) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < pts.length && key(pts[j + 1]) === k) j++;
    segs.push({
      low: pts[i].low,
      high: pts[i].high,
      x0: i === 0 ? xMin : (ts[i - 1] + ts[i]) / 2, // boundaries halfway between reports
      x1: j === pts.length - 1 ? xMax : (ts[j] + ts[j + 1]) / 2,
    });
    i = j + 1;
  }
  return segs;
}

export const isOut = (p: SeriesPoint) => (p.low != null && p.value < p.low) || (p.high != null && p.value > p.high);

const CENSOR_TXT: Record<string, string> = { "<": "<", ">": ">", "<=": "≤", ">=": "≥" };

/** "<1.1" / "4.70" — the value as the lab printed it (censored values keep their sign) */
export function valueLabel(p: SeriesPoint, decimals: number): string {
  return (p.censor ? CENSOR_TXT[p.censor] : "") + fmtNum(p.value, decimals);
}

/** "8.64–29.00", "≤ 1.20" (upper limit only), "≥ 60" (lower limit only), or "" */
export function rangeLabel(p: { low?: number; high?: number }, decimals: number): string {
  if (p.low != null && p.high != null) return `${fmtNum(p.low, decimals)}–${fmtNum(p.high, decimals)}`;
  if (p.high != null) return `≤ ${fmtNum(p.high, decimals)} (upper limit only)`;
  if (p.low != null) return `≥ ${fmtNum(p.low, decimals)} (lower limit only)`;
  return "";
}

/** Tooltip body shared by all value-over-time charts: value + unit, date, reference range, status. */
export function pointTooltip(name: string | null, p: SeriesPoint, unit: string, decimals: number, hint = "click for source"): string {
  const r = esc(rangeLabel(p, decimals));
  unit = esc(unit);
  hint = esc(hint);
  const status = isOut(p) ? (p.high != null && p.value > p.high ? "above range" : "below range") : r ? "in range" : "";
  const below = p.censor?.startsWith("<") ? " · below the lab's detection limit" : p.censor?.startsWith(">") ? " · above the measurable limit" : "";
  return (
    (name ? `${esc(name)}<br/>` : "") +
    `<b>${esc(valueLabel(p, decimals))} ${unit}</b>${status ? ` <span style="opacity:.75">· ${status}</span>` : ""}<br/>` +
    `<span style="opacity:.75">${fmtDate(p.date)}${below}</span>` +
    (r ? `<br/><span style="opacity:.75">Reference ${r} ${unit}</span>` : "") +
    (hint ? `<br/><span style="opacity:.55">${hint}</span>` : "")
  );
}

/** ECharts data item for one point: hollow when censored ("<", ">"), amber when out of range. */
export function pointItem(t: Tokens, p: SeriesPoint, color: string, opts: { highlight?: boolean; size?: number } = {}) {
  const out = isOut(p);
  return {
    value: [toTime(p.date), p.value],
    id: p.id,
    pt: p,
    symbol: p.censored ? "emptyCircle" : "circle",
    symbolSize: opts.highlight ? 13 : (opts.size ?? 8),
    itemStyle: {
      color: p.censored ? t.panel : out ? t.amber : color,
      borderColor: opts.highlight ? t.text : out ? t.amber : color,
      borderWidth: opts.highlight ? 2 : p.censored || out ? 2 : 0,
    },
  };
}

/** 1, 2, 2.5 or 5 × 10^n — the step a human would label an axis with */
function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** y-axis bounds for absolute values: padded, rounded to clean steps, never below 0 when every value is ≥ 0 */
export function yBounds(vals: number[], padFrac = 0.15): { min: number; max: number; interval: number } {
  const vmin = Math.min(...vals),
    vmax = Math.max(...vals);
  const pad = (vmax - vmin) * padFrac || Math.abs(vmax) * 0.1 || 1;
  let lo = vmin >= 0 ? Math.max(0, vmin - pad) : vmin - pad;
  let hi = vmax + pad;
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  return { min: vmin >= 0 ? Math.max(0, lo) : lo, max: hi, interval: step };
}

/** Value-over-time chart for ONE test: absolute values, shaded reference band, flagged points, optional trend. */
export function trendOption(t: Tokens, pts: SeriesPoint[], o: TrendOpts): EChartsOption {
  const showRef = o.showRef !== false;
  const times = pts.map((p) => toTime(p.date));
  const span = times.length ? Math.max(...times) - Math.min(...times) : 0;
  const xPad = Math.max(20 * 86400000, span * 0.03);
  const xMin = o.xMin ?? (times.length ? Math.min(...times) - xPad : undefined);
  const xMax = o.xMax ?? (times.length ? Math.max(...times) + xPad : undefined);
  // range segments are needed for the y-axis ("whole range") even when the band itself is hidden
  const allSegs = xMin != null && xMax != null ? refSegments(pts, xMin, xMax) : [];
  const segs = showRef ? allSegs : [];
  const data = pts.map((p) => pointItem(t, p, t.accent, { highlight: o.highlightIds?.includes(p.id), size: o.compact ? 7 : 8 }));

  // y-axis: fit the values (default), include the whole reference range, or start at zero
  const vals = pts.map((p) => p.value);
  const mode = o.yScale ?? "fit";
  if (mode === "range") for (const g of allSegs) vals.push(...[g.low, g.high].filter((v): v is number => v != null));
  if (mode === "zero") vals.push(0);
  const yb = yBounds(vals);
  const clampY = (v: number) => Math.min(yb.max, Math.max(yb.min, v));
  const lastSeg = segs[segs.length - 1];

  const series: EChartsOption["series"] = [
    {
      type: "line",
      name: o.name,
      data,
      smooth: false,
      lineStyle: { color: t.accent, width: 2 },
      areaStyle: o.compact ? undefined : { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: alpha(t.accent, 0.14) }, { offset: 1, color: alpha(t.accent, 0) }] } },
      markArea: segs.length
        ? {
            silent: true,
            itemStyle: { color: alpha(t.green, 0.12) },
            label: { show: false },
            // one band per run of identical ranges; one-sided ranges shade to the axis edge; clipped to the view
            data: segs
              .map((g) => {
                const lo = clampY(g.low ?? yb.min),
                  hi = clampY(g.high ?? yb.max);
                return hi > lo ? [{ xAxis: g.x0, yAxis: lo }, { xAxis: g.x1, yAxis: hi }] : null;
              })
              .filter(Boolean) as never,
          }
        : undefined,
      // dashed limit lines + labels for the most recent range only
      markLine: lastSeg
        ? {
            silent: true,
            symbol: "none",
            lineStyle: { color: alpha(t.green, 0.6), type: "dashed" },
            label: { color: t.muted, fontSize: 10, formatter: (p: { value?: unknown }) => fmtNum(Number(p.value), o.decimals), position: "insideEndTop" },
            data: [lastSeg.low, lastSeg.high]
              .filter((v): v is number => v != null && v >= yb.min && v <= yb.max)
              .map((v) => [{ coord: [segs.length > 1 ? lastSeg.x0 : xMin, v], value: v }, { coord: [xMax, v], value: v }]) as never,
          }
        : undefined,
    },
  ];
  const fitPts = pts.filter((p) => !p.censored);
  if (o.showTrend && fitPts.length >= 3) {
    const t0 = toTime(fitPts[0].date);
    const xy = fitPts.map((p) => ({ t: (toTime(p.date) - t0) / YEAR_MS, v: o.logScale ? Math.log(p.value) : p.value }));
    const lr = linreg(xy);
    const ends = [xy[0].t, xy[xy.length - 1].t].map((x) => {
      const y = lr.intercept + lr.slope * x;
      return [t0 + x * YEAR_MS, o.logScale ? Math.exp(y) : y];
    });
    (series as unknown[]).push({
      type: "line",
      name: "Trend",
      data: o.logScale ? xy.map((p) => [t0 + p.t * YEAR_MS, Math.exp(lr.intercept + lr.slope * p.t)]) : ends,
      symbol: "none",
      smooth: true,
      lineStyle: { color: t.accent2, width: 1.5, type: "dashed" },
      tooltip: { show: false },
    });
  }
  return {
    ...baseOption(t),
    title: o.compact
      ? { text: o.name, subtext: o.unit, left: 4, top: 0, itemGap: 2, textStyle: { color: t.text, fontSize: 12, fontWeight: 600 }, subtextStyle: { color: t.muted, fontSize: 10 } }
      : undefined,
    legend: { show: false },
    grid: o.compact ? { left: 4, right: 14, top: 40, bottom: 4, containLabel: true } : { left: 8, right: o.zoomY ? 36 : 24, top: 16, bottom: 40, containLabel: true },
    tooltip: {
      ...(baseOption(t).tooltip as object),
      trigger: "item",
      formatter: (p: unknown) => {
        const d = (p as { data?: { pt?: SeriesPoint } }).data;
        return d?.pt ? pointTooltip(o.compact ? o.name : null, d.pt, o.unit, o.decimals) : "";
      },
    },
    xAxis: { ...(timeAxis(t) as object), min: xMin, max: xMax } as never,
    yAxis: valueAxis(
      t,
      o.logScale
        ? { type: "log", scale: true }
        : { min: yb.min, max: yb.max, interval: o.zoomY ? undefined : o.compact ? yb.interval * 2 : yb.interval, axisLabel: { color: t.muted, fontSize: o.compact ? 10 : 11, formatter: (v: number) => fmtNum(v, Math.min(o.decimals, 2)) } },
    ) as never,
    dataZoom: o.compact
      ? undefined
      : [
          { type: "inside", xAxisIndex: 0, filterMode: "none" },
          { type: "slider", xAxisIndex: 0, height: 16, bottom: 6, borderColor: t.line, fillerColor: alpha(t.accent, 0.15), textStyle: { color: t.muted, fontSize: 10 }, handleStyle: { color: t.accent } },
          ...(o.zoomY
            ? [{ type: "slider" as const, yAxisIndex: 0, filterMode: "none" as const, width: 14, right: 4, borderColor: t.line, fillerColor: alpha(t.accent, 0.15), showDetail: false, handleStyle: { color: t.accent } }]
            : []),
        ],
    series,
  };
}
