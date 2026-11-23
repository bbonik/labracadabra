/**
 * Neutral, descriptive pattern flags for one test's history. These describe the numbers; they never
 * interpret them clinically.
 */
import { YEAR_MS, toTime } from "../lib/format";
import { linreg, mad, mannKendall, mannWhitney, median, pettitt, senSlope, type Pt } from "./stats";

export interface SeriesPoint {
  date: string;
  value: number; // in the unit the caller wants statistics in
  low?: number;
  high?: number;
  censored?: boolean;
  censor?: "<" | ">" | "<=" | ">="; // printed as e.g. "<1.1": the true value is at most / at least `value`
  id: string;
}

export type PatternKind = "rising" | "falling" | "step_up" | "step_down" | "spike" | "repeat_abnormal" | "big_change" | "out_of_range";

export interface Pattern {
  kind: PatternKind;
  label: string;
  detail: string;
  severity: "info" | "warn";
  pointIds?: string[];
}

export interface SeriesStats {
  n: number;
  latest?: SeriesPoint;
  previous?: SeriesPoint;
  changeAbs?: number;
  changePct?: number;
  slopePerYear?: number; // Theil–Sen
  linSlopePerYear?: number;
  doublingYears?: number; // for log-type tests with positive growth
  trendP?: number;
  outOfRange: number;
  streak: number; // consecutive out-of-range at the end
  patterns: Pattern[];
}

export interface PatternOptions {
  logScale?: boolean;
  bigChangePct?: number;
  trendP?: number;
  minTrendPoints?: number;
}

const oor = (p: SeriesPoint) => (p.low != null && p.value < p.low) || (p.high != null && p.value > p.high);

export function analyze(points: SeriesPoint[], opts: PatternOptions = {}): SeriesStats {
  const { logScale = false, bigChangePct = 25, trendP = 0.1, minTrendPoints = 4 } = opts;
  const pts = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const n = pts.length;
  const out: SeriesStats = { n, outOfRange: 0, streak: 0, patterns: [] };
  if (!n) return out;
  out.latest = pts[n - 1];
  out.previous = pts[n - 2];

  // out of range / repeats
  const abnormal = pts.filter(oor);
  out.outOfRange = abnormal.length;
  for (let i = n - 1; i >= 0 && oor(pts[i]); i--) out.streak++;
  if (oor(out.latest)) {
    const dir = out.latest.high != null && out.latest.value > out.latest.high ? "above" : "below";
    out.patterns.push({ kind: "out_of_range", label: `Latest ${dir} range`, detail: `Latest result is ${dir} the reference range.`, severity: "warn", pointIds: [out.latest.id] });
  }
  if (abnormal.length >= 2) {
    out.patterns.push({
      kind: "repeat_abnormal",
      label: out.streak >= 2 ? `Out of range ${out.streak}× in a row` : `Out of range ${abnormal.length}×`,
      detail: `${abnormal.length} of ${n} results outside the reference range${out.streak >= 2 ? `, including the last ${out.streak}` : ""}.`,
      severity: out.streak >= 2 ? "warn" : "info",
      pointIds: abnormal.map((p) => p.id),
    });
  }

  // change since previous
  if (out.previous) {
    out.changeAbs = out.latest.value - out.previous.value;
    out.changePct = out.previous.value !== 0 ? (out.changeAbs / Math.abs(out.previous.value)) * 100 : undefined;
    if (out.changePct != null && Math.abs(out.changePct) >= bigChangePct) {
      out.patterns.push({
        kind: "big_change",
        label: `${out.changePct > 0 ? "▲" : "▼"} ${Math.abs(out.changePct).toFixed(0)}% since last`,
        detail: `Changed ${out.changePct.toFixed(0)}% compared with the previous result.`,
        severity: "info",
        pointIds: [out.previous.id, out.latest.id],
      });
    }
  }

  const uncensored = pts.filter((p) => !p.censored);
  const t0 = toTime(pts[0].date);
  const xy: Pt[] = uncensored.map((p) => ({ t: (toTime(p.date) - t0) / YEAR_MS, v: p.value }));
  const span = xy.length ? xy[xy.length - 1].t - xy[0].t : 0;

  if (xy.length >= 2 && span > 0.08) {
    out.slopePerYear = senSlope(xy);
    out.linSlopePerYear = linreg(xy).slope;
    if (logScale && xy.every((p) => p.v > 0)) {
      const lr = linreg(xy.map((p) => ({ t: p.t, v: Math.log(p.v) })));
      if (lr.slope > 0.01) out.doublingYears = Math.LN2 / lr.slope;
    }
  }

  // monotonic trend
  if (xy.length >= minTrendPoints && span >= 0.5) {
    const mk = mannKendall(xy);
    out.trendP = mk.p;
    const m = median(xy.map((p) => Math.abs(p.v))) || 1;
    const relPerYear = Math.abs(out.slopePerYear ?? 0) / m;
    if (mk.p < trendP && relPerYear > 0.01) {
      const up = mk.s > 0;
      out.patterns.push({
        kind: up ? "rising" : "falling",
        label: up ? "↗ Rising trend" : "↘ Falling trend",
        detail: `Consistent ${up ? "upward" : "downward"} direction across ${xy.length} results (Mann–Kendall p=${mk.p.toFixed(3)}).`,
        severity: "info",
      });
    }
  }

  // step change (level shift) — needs enough points on both sides
  if (uncensored.length >= 6) {
    const vals = uncensored.map((p) => p.value);
    const pt = pettitt(vals); // locates the most likely split
    if (pt.index >= 1 && pt.index <= vals.length - 3) {
      const a = vals.slice(0, pt.index + 1);
      const b = vals.slice(pt.index + 1);
      const before = median(a);
      const after = median(b);
      const within = (mad(a) + mad(b)) / 2 || Math.abs(before) * 0.02 || 1;
      // a real step: segments clearly differ AND the jump dwarfs the scatter within each segment
      // …and a two-level model must explain the data much better than a straight line (else it's a trend)
      const pts2 = uncensored.map((p) => ({ t: (toTime(p.date) - t0) / YEAR_MS, v: p.value }));
      const lr = linreg(pts2);
      const sseLin = pts2.reduce((acc, p) => acc + (p.v - (lr.intercept + lr.slope * p.t)) ** 2, 0);
      const meanA = a.reduce((x, y) => x + y, 0) / a.length;
      const meanB = b.reduce((x, y) => x + y, 0) / b.length;
      const sseStep = a.reduce((x, v) => x + (v - meanA) ** 2, 0) + b.reduce((x, v) => x + (v - meanB) ** 2, 0);
      if (mannWhitney(a, b) < 0.05 && Math.abs(after - before) > 3 * within && sseStep < 0.6 * sseLin) {
        const up = after > before;
        out.patterns.push({
          kind: up ? "step_up" : "step_down",
          label: up ? "⤴ Step up" : "⤵ Step down",
          detail: `Level shifted around ${uncensored[pt.index + 1].date} (median ${before.toPrecision(3)} → ${after.toPrecision(3)}).`,
          severity: "info",
          pointIds: [uncensored[pt.index + 1].id],
        });
      }
    }
  }

  // spikes: isolated points far from the rest
  if (uncensored.length >= 5) {
    const vals = uncensored.map((p) => p.value);
    const med = median(vals);
    const s = mad(vals);
    if (s > 0) {
      // must be far in robust-σ terms AND materially different (≥10%) so rounding noise in very stable tests doesn't count
      const thr = Math.max(3.5 * s, 0.1 * Math.abs(med));
      const spikes = uncensored.filter((p) => Math.abs(p.value - med) > thr);
      if (spikes.length && spikes.length <= Math.max(1, Math.floor(uncensored.length / 5))) {
        out.patterns.push({
          kind: "spike",
          label: spikes.length > 1 ? `✶ ${spikes.length} outliers` : "✶ Outlier",
          detail: `${spikes.map((p) => p.date).join(", ")} ${spikes.length > 1 ? "differ" : "differs"} markedly from the usual level — worth checking against the source page.`,
          severity: "info",
          pointIds: spikes.map((p) => p.id),
        });
      }
    }
  }
  return out;
}
