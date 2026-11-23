/**
 * ECharts wrapper: theme tokens read from CSS variables, shared axis and tooltip defaults, and a <Chart>
 * component that resizes and re-themes with the page.
 */
import * as echarts from "echarts";
import { useEffect, useRef } from "preact/hooks";
import { useApp } from "../lib/state";

export interface Tokens {
  bg: string;
  panel: string;
  panel2: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  green: string;
  amber: string;
  red: string;
  series: string[];
}

export function tokens(): Tokens {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: v("--bg"),
    panel: v("--panel"),
    panel2: v("--panel2"),
    line: v("--line"),
    text: v("--text"),
    muted: v("--muted"),
    accent: v("--accent"),
    accent2: v("--accent2"),
    green: v("--green"),
    amber: v("--amber"),
    red: v("--red"),
    series: ["--accent", "--accent2", "--pink", "--orange", "--s5", "--s6", "--s7", "--s8"].map(v),
  };
}

/** Translucent version of a CSS colour (works for hex and rgb). */
export function alpha(color: string, a: number): string {
  if (color.startsWith("#")) {
    const h = color.length === 4 ? color.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3") : color;
    const n = parseInt(h.slice(1, 7), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return color.replace(/rgba?\(([^)]+)\)/, (_, inner) => `rgba(${inner.split(",").slice(0, 3).join(",")},${a})`);
}

export function baseOption(t: Tokens): echarts.EChartsOption {
  return {
    backgroundColor: "transparent",
    animationDuration: 300,
    textStyle: { fontFamily: '"Inter Variable",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif', color: t.text },
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.panel,
      borderColor: t.line,
      textStyle: { color: t.text, fontSize: 12 },
      extraCssText: "border-radius:8px;box-shadow:none;",
    },
    legend: { textStyle: { color: t.muted, fontSize: 11 }, icon: "circle", itemWidth: 8, itemHeight: 8, top: 0 },
  };
}

export const timeAxis = (t: Tokens): echarts.EChartsOption["xAxis"] => ({
  type: "time",
  axisLine: { lineStyle: { color: t.line } },
  axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true },
  splitLine: { show: false },
});

export const valueAxis = (t: Tokens, extra: Record<string, unknown> = {}) => ({
  type: "value" as const,
  scale: true,
  axisLabel: { color: t.muted, fontSize: 11 },
  nameTextStyle: { color: t.muted, fontSize: 11 },
  splitLine: { lineStyle: { color: t.line, type: "dashed" as const } },
  ...extra,
});

interface Props {
  build: (t: Tokens) => echarts.EChartsOption;
  height?: number | string;
  onPointClick?: (params: { data: unknown; seriesName?: string; dataIndex: number }) => void;
  deps?: unknown[];
  className?: string;
}

export function Chart({ build, height = 280, onPointClick, deps = [], className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const { resolvedTheme, printing } = useApp();
  const clickRef = useRef(onPointClick);
  clickRef.current = onPointClick;

  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: "svg" });
    inst.current = c;
    c.on("click", (p) => clickRef.current?.(p as never));
    // give the SVG a viewBox so it scales to the printed page width instead of overflowing it
    const fitSvg = () => {
      const svg = ref.current?.querySelector("svg");
      if (!svg) return;
      svg.setAttribute("viewBox", `0 0 ${c.getWidth()} ${c.getHeight()}`);
      svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
    };
    c.on("finished", fitSvg);
    const ro = new ResizeObserver(() => {
      c.resize();
      fitSvg();
    });
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    const c = inst.current;
    if (!c) return;
    const opt = build(tokens());
    if (printing) {
      opt.dataZoom = undefined; // sliders mean nothing on paper
      opt.animation = false;
    }
    c.setOption(opt, { notMerge: true });
    c.resize();
  }, [resolvedTheme, printing, ...deps]);

  // Preact 11 no longer appends "px" to numeric style values
  return <div ref={ref} class={`echart ${className ?? ""}`} style={{ width: "100%", height: typeof height === "number" ? `${height}px` : height }} />;
}
