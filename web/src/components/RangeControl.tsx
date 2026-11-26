/**
 * Choose where a test's reference range comes from: each lab's printed range (default), the most recent report's,
 * the standard catalog range, or a custom one. Custom limits are typed in the display unit and stored canonically.
 */
import { useEffect, useState } from "preact/hooks";
import { TESTS, catalogRef, decimalsFor, displayUnit, fromDisplay, toDisplay } from "../lib/catalog";
import { fmtDate, fmtNum } from "../lib/format";
import { useApp } from "../lib/state";
import type { RefPref } from "../lib/types";
import { prettyUnit } from "./bits";

const MODES: { id: RefPref["mode"]; label: string }[] = [
  { id: "lab", label: "Each lab's own range" },
  { id: "latest", label: "Most recent report's range" },
  { id: "catalog", label: "Standard range (catalog)" },
  { id: "custom", label: "Custom range…" },
];

/** variant "row" renders two table cells (source select · range in use) for the Settings table */
export function RangeControl({ testId, showLabs = true, variant = "full" }: { testId: string; showLabs?: boolean; variant?: "full" | "row" }) {
  const { prefs, setPrefs, refPref, labRanges, profile } = useApp();
  const t = TESTS[testId];
  const u = displayUnit(testId, prefs);
  const dec = decimalsFor(testId, u);
  const pref = refPref(testId);
  const toD = (v?: number) => (v == null ? "" : String(+toDisplay(v, testId, u).toFixed(Math.max(dec, 2))));
  const [lo, setLo] = useState(toD(pref.low));
  const [hi, setHi] = useState(toD(pref.high));
  useEffect(() => {
    setLo(toD(pref.low));
    setHi(toD(pref.high));
  }, [testId, u, pref.mode, pref.low, pref.high]);
  if (!t || t.kind !== "numeric") return null;

  const save = (p: RefPref | null) => {
    const refs = { ...(prefs.refs ?? {}) };
    if (p) refs[testId] = p;
    else delete refs[testId];
    setPrefs({ ...prefs, refs });
  };
  const fmt = (v?: number) => (v == null ? "" : fmtNum(toDisplay(v, testId, u), dec));
  const rangeTxt = (low?: number, high?: number) =>
    low != null && high != null ? `${fmt(low)}–${fmt(high)}` : high != null ? `≤ ${fmt(high)}` : low != null ? `≥ ${fmt(low)}` : "none";
  const parse = (s: string) => {
    const v = parseFloat(s.replace(",", "."));
    return Number.isFinite(v) ? fromDisplay(v, testId, u) : undefined;
  };
  const commitCustom = (l = lo, h = hi) => save({ mode: "custom", low: parse(l), high: parse(h) });
  const ranges = labRanges(testId);
  const cat = catalogRef(testId, profile?.sex);
  const unitTxt = prettyUnit(u);

  const onMode = (m: RefPref["mode"]) => {
    if (m === "custom") {
      const seed = pref.low != null || pref.high != null ? pref : ranges[0] ?? cat;
      save({ mode: "custom", low: seed.low, high: seed.high });
    } else save(m === (prefs.refDefault ?? "lab") ? null : { mode: m });
  };
  const customInputs = (
    <span class="flex">
      <input class="tiny-input" inputMode="decimal" placeholder="low" value={lo} aria-label="Lower limit"
        onInput={(e) => setLo((e.target as HTMLInputElement).value)} onChange={() => commitCustom()} />
      –
      <input class="tiny-input" inputMode="decimal" placeholder="high" value={hi} aria-label="Upper limit"
        onInput={(e) => setHi((e.target as HTMLInputElement).value)} onChange={() => commitCustom()} />
      <span class="note">{unitTxt}</span>
    </span>
  );

  if (variant === "row") {
    let inUse: preact.JSX.Element;
    if (pref.mode === "custom") inUse = customInputs;
    else if (pref.mode === "catalog") inUse = <span>{rangeTxt(cat.low, cat.high)} <span class="note">{unitTxt}</span></span>;
    else if (!ranges.length)
      // no usable lab range (none printed, or a risk-tier test like lipids): the standard range applies
      inUse =
        cat.low != null || cat.high != null ? (
          <span title="No lab reference interval for this test, so the standard range is used">
            {rangeTxt(cat.low, cat.high)} <span class="note">{unitTxt} · standard</span>
          </span>
        ) : (
          <span class="note">no reference range</span>
        );
    else if (pref.mode === "latest" || ranges.length === 1)
      inUse = <span>{rangeTxt(ranges[0].low, ranges[0].high)} <span class="note">{unitTxt}</span></span>;
    else
      inUse = (
        <span title={ranges.map((r) => `${rangeTxt(r.low, r.high)} (${r.labs.join(", ")})`).join("\n")}>
          <span class="pill idle">varies by lab</span> <span class="note">{ranges.map((r) => rangeTxt(r.low, r.high)).join(" · ")} {unitTxt}</span>
        </span>
      );
    return (
      <>
        <td>
          <select class={`fill quietsel ${prefs.refs?.[testId] ? "changed" : ""}`} value={pref.mode} onChange={(e) => onMode((e.target as HTMLSelectElement).value as RefPref["mode"])} aria-label={`Reference range source for ${t.name}`}>
            {MODES.map((m) => (
              <option value={m.id}>{m.label}</option>
            ))}
          </select>
        </td>
        <td>{inUse}</td>
      </>
    );
  }

  return (
    <div class="rangectl">
      <label class="inline">
        Reference range
        <select
          value={pref.mode}
          onChange={(e) => {
            const m = (e.target as HTMLSelectElement).value as RefPref["mode"];
            if (m === "custom") {
              const seed = pref.low != null || pref.high != null ? pref : ranges[0] ?? cat;
              save({ mode: "custom", low: seed.low, high: seed.high });
            } else save(m === (prefs.refDefault ?? "lab") ? null : { mode: m });
          }}
          aria-label="Reference range source"
        >
          {MODES.map((m) => (
            <option value={m.id}>{m.label}</option>
          ))}
        </select>
      </label>
      {pref.mode === "custom" && (
        <span class="flex">
          <input class="tiny-input" inputMode="decimal" placeholder="low" value={lo} aria-label="Lower limit"
            onInput={(e) => setLo((e.target as HTMLInputElement).value)} onChange={() => commitCustom()} />
          –
          <input class="tiny-input" inputMode="decimal" placeholder="high" value={hi} aria-label="Upper limit"
            onInput={(e) => setHi((e.target as HTMLInputElement).value)} onChange={() => commitCustom()} />
          <span class="note">{unitTxt}</span>
        </span>
      )}
      {pref.mode === "catalog" && <span class="note">{rangeTxt(cat.low, cat.high)} {unitTxt}</span>}
      {showLabs && ranges.length > 0 && (
        <div class="note labranges">
          Printed by the labs:{" "}
          {ranges.map((r, i) => (
            <span class="labrange">
              {i > 0 && " · "}
              <b>{rangeTxt(r.low, r.high)}</b> {unitTxt} ({r.labs.join(", ") || "lab"}, {r.n}×, last {fmtDate(r.last, true)})
              {pref.mode === "custom" && (
                <button class="linkbtn" onClick={() => save({ mode: "custom", low: r.low, high: r.high })} title="Use this range">
                  use
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
