/**
 * Small shared UI pieces: flag and pattern pills, sparklines, empty states, the disclaimer and links to a
 * value's source page.
 */
import type { ComponentChildren } from "preact";
import type { Pattern, SeriesPoint } from "../analytics/patterns";
import { TESTS, decimalsFor, displayUnit, prettyUnit, toDisplay } from "../lib/catalog";
import { fmtNum } from "../lib/format";
import { useApp } from "../lib/state";
import type { Flag, Result } from "../lib/types";
import { DocIcon } from "./icons";

/** The one page-header pattern: icon + title, optional meta/actions on the right, optional one-line description. */
export function PageHeader(props: { icon: ComponentChildren; title: ComponentChildren; meta?: ComponentChildren; actions?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="card col-12 headcard">
      <div class="headrow">
        <h1 class="title">
          <span class="ticon">{props.icon}</span> {props.title}
        </h1>
        {(props.meta || props.actions) && (
          <div class="headactions">
            {props.meta && <span class="note">{props.meta}</span>}
            {props.actions}
          </div>
        )}
      </div>
      {props.children && <div class="headdesc">{props.children}</div>}
    </div>
  );
}

export function FlagPill({ flag, kind }: { flag?: Flag | null; kind?: string }) {
  if (flag === "H") return <span class="pill warn">High</span>;
  if (flag === "L") return <span class="pill warn">Low</span>;
  if (flag === "A") return <span class="pill warn">Abnormal</span>;
  // in range: no pill, so the few real flags stand out
  void kind;
  return null;
}

export function PatternPills({ patterns, max = 3 }: { patterns: Pattern[]; max?: number }) {
  return (
    <>
      {patterns.slice(0, max).map((p) => (
        <span class={`pill ${p.severity === "warn" ? "warn" : "info"}`} title={p.method ? `${p.detail}\n${p.method}` : p.detail} key={p.kind}>
          {p.label}
        </span>
      ))}
    </>
  );
}

/** Value of one result in the user's display unit, e.g. "2.59 mmol/L" or "<1.7 µg/L" or "Negative". */
export function useValueText() {
  const { prefs } = useApp();
  return (r: Result, withUnit = true): string => {
    if (!r.test_id || r.value == null || r.kind !== "numeric" || !TESTS[r.test_id]) {
      return r.value_text ?? `${r.value_raw}${r.unit_raw && withUnit ? " " + r.unit_raw : ""}`;
    }
    const u = displayUnit(r.test_id, prefs);
    const v = toDisplay(r.value, r.test_id, u);
    const s = (r.censor ? r.censor.replace("<=", "≤").replace(">=", "≥") : "") + fmtNum(v, decimalsFor(r.test_id, u));
    return withUnit && u && u !== "ratio" ? `${s} ${prettyUnit(u)}` : s;
  };
}

export { prettyUnit } from "../lib/catalog";

export function Sparkline({ pts, width = 120, height = 36 }: { pts: SeriesPoint[]; width?: number; height?: number }) {
  if (pts.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const xs = pts.map((p) => Date.parse(p.date));
  const vals = pts.map((p) => p.value);
  const lo = pts.find((p) => p.low != null)?.low;
  const hi = pts.find((p) => p.high != null)?.high;
  let min = Math.min(...vals),
    max = Math.max(...vals);
  if (lo != null) min = Math.min(min, lo);
  if (hi != null) max = Math.max(max, hi);
  const pad = (max - min) * 0.12 || Math.abs(max) * 0.1 || 1;
  min -= pad;
  max += pad;
  const x0 = xs[0],
    x1 = xs[xs.length - 1] || x0 + 1;
  const X = (x: number) => 3 + ((x - x0) / (x1 - x0 || 1)) * (width - 6);
  const Y = (v: number) => height - 3 - ((v - min) / (max - min)) * (height - 6);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(xs[i]).toFixed(1)},${Y(p.value).toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  const out = (p: SeriesPoint) => (p.low != null && p.value < p.low) || (p.high != null && p.value > p.high);
  const bandTop = hi != null ? Y(hi) : 0;
  const bandBottom = lo != null ? Y(lo) : height;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" class="spark">
      {(lo != null || hi != null) && <rect x="0" width={width} y={bandTop} height={Math.max(0, bandBottom - bandTop)} class="spark-band" />}
      <path d={d} class="spark-line" />
      {pts.map((p, i) => (out(p) ? <circle cx={X(xs[i])} cy={Y(p.value)} r="2.2" class="spark-out" /> : null))}
      <circle cx={X(xs[xs.length - 1])} cy={Y(last.value)} r="3" class={out(last) ? "spark-out" : "spark-last"} />
    </svg>
  );
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <div class="empty">{children}</div>;
}

export function Disclaimer() {
  return (
    <p class="disclaimer">
      Organises the numbers in your own reports — it does not diagnose or give medical advice. Patterns are statistical
      descriptions; discuss anything that concerns you with a doctor.
    </p>
  );
}

export function SourceLink({ r, label = "source" }: { r: { doc_id: string; page: number; source_text?: string; value_raw?: string; raw_name?: string }; label?: string }) {
  const { openSource } = useApp();
  return (
    <button
      class="linkbtn srclink"
      title="Open the original report page"
      onClick={(e) => {
        e.stopPropagation();
        openSource({ ...r, title: r.raw_name ?? "Source" });
      }}
    >
      <DocIcon size={12} strokeWidth={2} class="ico" aria-hidden /> {label} · p.{r.page}
    </button>
  );
}
