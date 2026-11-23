/**
 * Dashboard card for one test: latest value, flag, sparkline with reference band and detected patterns.
 */
import { TESTS, decimalsFor, displayUnit } from "../lib/catalog";
import { fmtDate, fmtSigned } from "../lib/format";
import { href } from "../lib/router";
import { useApp } from "../lib/state";
import { FlagPill, PatternPills, Sparkline, prettyUnit, useValueText } from "./bits";

export function TestCard({ testId }: { testId: string }) {
  const { byTest, series, stats, prefs } = useApp();
  const t = TESTS[testId];
  const results = byTest.get(testId) ?? [];
  const latest = results[results.length - 1];
  const valueText = useValueText();
  if (!t || !latest) return null;
  const pts = series(testId);
  const s = stats(testId);
  const unit = displayUnit(testId, prefs);
  const dec = decimalsFor(testId, unit);
  const trendPatterns = s.patterns.filter((p) => p.kind !== "out_of_range");
  return (
    <a class="tcard" href={href("test", testId)}>
      <div class="tcard-head">
        <span class="tcard-name">{t.name}</span>
        <FlagPill flag={latest.flag} kind={latest.kind} />
      </div>
      <div class="tcard-body">
        <div>
          <div class="tcard-value">
            {valueText(latest, false)}
            {latest.kind === "numeric" && unit && unit !== "ratio" && <small> {prettyUnit(unit)}</small>}
          </div>
          <div class="note">
            {fmtDate(latest.date)}
            {s.changeAbs != null && t.kind === "numeric" && (
              <span class={`delta ${s.changeAbs > 0 ? "up" : s.changeAbs < 0 ? "down" : ""}`}> · {fmtSigned(s.changeAbs, dec)}</span>
            )}
            {results.length > 1 && <span> · {results.length} results</span>}
          </div>
        </div>
        {t.kind === "numeric" && <Sparkline pts={pts} />}
      </div>
      {(trendPatterns.length > 0 || s.slopePerYear != null) && (
        <div class="tcard-foot">
          <PatternPills patterns={trendPatterns} max={2} />
          {s.slopePerYear != null && trendPatterns.some((p) => p.kind === "rising" || p.kind === "falling") && (
            <span class="note">{fmtSigned(s.slopePerYear, dec)}/yr</span>
          )}
        </div>
      )}
    </a>
  );
}
