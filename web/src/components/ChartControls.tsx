/**
 * The one set of chart options used everywhere a test is drawn over time (test page, Explore single test,
 * Explore side by side): trend line, reference range band, y-axis scale. Stored in prefs so every view agrees;
 * y-axis scale is per test.
 */
import { useApp } from "../lib/state";
import type { Prefs, YScale } from "../lib/types";

const Y_OPTIONS: [YScale, string][] = [
  ["fit", "Fit values"],
  ["range", "Whole range"],
  ["zero", "From 0"],
];

export interface ChartOpts {
  showTrend: boolean;
  showRef: boolean;
  yScale: (testId: string) => YScale;
}

export function chartOpts(prefs: Prefs): ChartOpts {
  return {
    showTrend: prefs.showTrend ?? true,
    showRef: prefs.showRef ?? true,
    yScale: (id) => prefs.yScale?.[id] ?? "fit",
  };
}

export function ChartControls({ testIds }: { testIds: string[] }) {
  const { prefs, setPrefs } = useApp();
  const o = chartOpts(prefs);
  const scales = new Set(testIds.map(o.yScale));
  const current = scales.size === 1 ? [...scales][0] : null; // mixed when several tests differ
  const setY = (y: YScale) => setPrefs({ ...prefs, yScale: { ...(prefs.yScale ?? {}), ...Object.fromEntries(testIds.map((id) => [id, y])) } });
  return (
    <div class="flex wrapflex chartctl">
      <label class="inline small">
        <input type="checkbox" checked={o.showTrend} onChange={() => setPrefs({ ...prefs, showTrend: !o.showTrend })} /> trend line
      </label>
      <label class="inline small">
        <input type="checkbox" checked={o.showRef} onChange={() => setPrefs({ ...prefs, showRef: !o.showRef })} /> reference range
      </label>
      <div class="seg small" role="group" aria-label="Y-axis scale">
        {Y_OPTIONS.map(([id, label]) => (
          <button class={current === id ? "active" : ""} onClick={() => setY(id)} title={testIds.length > 1 ? "Y-axis scale for all charts shown" : "Y-axis scale"}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
