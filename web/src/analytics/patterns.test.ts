import { describe, expect, it } from "vitest";
import { analyze, type SeriesPoint } from "./patterns";
import { mannKendall, pettitt, senSlope } from "./stats";

function series(values: number[], startYear = 2020, stepMonths = 6, low?: number, high?: number): SeriesPoint[] {
  return values.map((v, i) => {
    const m = i * stepMonths;
    const y = startYear + Math.floor(m / 12);
    const mo = (m % 12) + 1;
    return { id: `p${i}`, date: `${y}-${String(mo).padStart(2, "0")}-15`, value: v, low, high };
  });
}

describe("stats", () => {
  it("Mann–Kendall detects monotonic increase", () => {
    const r = mannKendall([1, 2, 3, 4, 5, 6].map((v, i) => ({ t: i, v })));
    expect(r.s).toBe(15);
    expect(r.p).toBeLessThan(0.02);
  });
  it("Mann–Kendall finds nothing in flat noise", () => {
    const r = mannKendall([5, 5.1, 4.9, 5.05, 4.95, 5.02].map((v, i) => ({ t: i, v })));
    expect(r.p).toBeGreaterThan(0.1);
  });
  it("Sen slope", () => {
    expect(senSlope([0, 1, 2, 3].map((t) => ({ t, v: 2 * t + 1 })))).toBeCloseTo(2);
  });
  it("Pettitt locates a level shift", () => {
    const r = pettitt([4, 4.1, 3.9, 4.0, 2.6, 2.5, 2.7, 2.6]);
    expect(r.index).toBe(3);
  });
});

describe("analyze", () => {
  it("flags rising trend, velocity and doubling time for log tests", () => {
    const vals = [0.6, 0.66, 0.73, 0.8, 0.88, 0.97, 1.07, 1.18];
    const s = analyze(series(vals), { logScale: true });
    expect(s.patterns.map((p) => p.kind)).toContain("rising");
    expect(s.slopePerYear!).toBeGreaterThan(0.1);
    expect(s.doublingYears!).toBeGreaterThan(3);
    expect(s.doublingYears!).toBeLessThan(4);
  });
  it("flags a step down", () => {
    const s = analyze(series([3.9, 4.0, 3.95, 4.05, 2.6, 2.55, 2.5, 2.62]));
    expect(s.patterns.map((p) => p.kind)).toContain("step_down");
  });
  it("flags a spike without calling it a trend", () => {
    const s = analyze(series([140, 135, 150, 142, 350, 138, 145, 141]));
    const kinds = s.patterns.map((p) => p.kind);
    expect(kinds).toContain("spike");
    expect(kinds).not.toContain("rising");
  });
  it("counts repeated abnormal values and the trailing streak", () => {
    const s = analyze(series([140, 145, 128, 150, 127, 126], 2020, 6, 135, 175));
    expect(s.outOfRange).toBe(3);
    expect(s.streak).toBe(2);
    expect(s.patterns.find((p) => p.kind === "repeat_abnormal")?.severity).toBe("warn");
  });
  it("does not call a smooth linear trend a step", () => {
    const s = analyze(series([1, 2, 3, 4, 5, 6, 7, 8]));
    const kinds = s.patterns.map((p) => p.kind);
    expect(kinds).toContain("rising");
    expect(kinds).not.toContain("step_up");
  });
  it("does not call smooth exponential growth a step", () => {
    const s = analyze(series([0.62, 0.69, 0.7, 0.85, 0.98, 1.1, 1.18, 1.37, 1.56, 1.67, 1.86]), { logScale: true });
    expect(s.patterns.map((p) => p.kind)).not.toContain("step_up");
  });
  it("ignores rounding noise in very stable tests", () => {
    const s = analyze(series([140, 141, 140, 139, 140, 140, 141, 140, 137, 140]));
    expect(s.patterns.map((p) => p.kind)).not.toContain("spike");
  });
  it("is quiet for stable values", () => {
    const s = analyze(series([5.0, 5.1, 4.9, 5.05, 4.95, 5.0], 2020, 6, 4, 6));
    expect(s.patterns).toHaveLength(0);
  });
});
