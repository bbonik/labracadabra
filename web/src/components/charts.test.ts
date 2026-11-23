import { describe, expect, it } from "vitest";
import type { SeriesPoint } from "../analytics/patterns";
import { trendOption } from "./charts";

const T = { bg: "#000", panel: "#111", panel2: "#222", line: "#333", text: "#fff", muted: "#999", accent: "#00f", accent2: "#f0f", green: "#0f0", amber: "#fa0", red: "#f00", series: ["#00f"] };
const pts = (vals: number[], low?: number, high?: number): SeriesPoint[] =>
  vals.map((v, i) => ({ id: `p${i}`, date: `202${i}-01-15`, value: v, low, high }));
const yAxis = (o: ReturnType<typeof trendOption>) => o.yAxis as { min: number; max: number };
const opts = { name: "PSA", unit: "µg/L", decimals: 2 };

describe("y-axis scale modes", () => {
  // PSA-like: values (0.2–0.35) far inside a wide range (0–4)
  const psa = pts([0.34, 0.35, 0.21, 0.24], 0, 4);

  it("fit zooms to the values, whole range includes the reference limits", () => {
    const fit = yAxis(trendOption(T, psa, { ...opts, yScale: "fit" }));
    const range = yAxis(trendOption(T, psa, { ...opts, yScale: "range" }));
    expect(fit.max).toBeLessThan(1);
    expect(range.min).toBe(0);
    expect(range.max).toBeGreaterThanOrEqual(4);
  });

  it("whole range still applies when the band is hidden", () => {
    const range = yAxis(trendOption(T, psa, { ...opts, yScale: "range", showRef: false }));
    expect(range.max).toBeGreaterThanOrEqual(4);
  });

  it("from 0 starts the axis at zero", () => {
    const na = pts([140, 141, 139, 144], 136, 145);
    expect(yAxis(trendOption(T, na, { ...opts, yScale: "zero" })).min).toBe(0);
    expect(yAxis(trendOption(T, na, { ...opts, yScale: "fit" })).min).toBeGreaterThan(100);
  });
});
