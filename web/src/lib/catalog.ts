/**
 * The test catalog in the browser (generated from catalog/tests.yaml): panels, names, aliases, display
 * units and unit conversion for display.
 */
import raw from "../data/catalog.json";
import type { CatalogTest, Panel, Prefs, Range, Result } from "./types";

export const PANELS = raw.panels as Panel[];
export const TESTS: Record<string, CatalogTest> = Object.fromEntries(
  (raw.tests as unknown as CatalogTest[]).map((t) => [t.id, t]),
);

/** top-level group id (blood, urine, vitals, …) for a panel id like "blood.lipids" */
export const groupOf = (panelId: string) => panelId.split(".")[0];

export const panelById: Record<string, Panel & { group: string }> = {};
for (const g of PANELS) {
  panelById[g.id] = { ...g, group: g.id };
  for (const c of g.children ?? []) panelById[c.id] = { ...c, group: g.id };
}

export function testName(id: string | null | undefined, fallback = "Unmapped"): string {
  return (id && TESTS[id]?.name) || fallback;
}

/** Normalised key used for alias corrections — mirrors pmt.catalog.norm_name. */
export function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[µμ]/g, "u")
    .replace(/[^\p{L}\p{N}_]+/gu, "");
}

export function displayUnit(testId: string, prefs: Prefs): string {
  const t = TESTS[testId];
  if (!t) return "";
  const u = prefs.units[testId];
  return u && u in t.units ? u : t.unit;
}

/** canonical → display */
export function toDisplay(value: number, testId: string, unit: string): number {
  const t = TESTS[testId];
  const tr = t?.units[unit];
  if (!tr) return value;
  const [a, b] = tr;
  return (value - b) / a;
}

/** display → canonical */
export function fromDisplay(value: number, testId: string, unit: string): number {
  const tr = TESTS[testId]?.units[unit];
  if (!tr) return value;
  return tr[0] * value + tr[1];
}

export function decimalsFor(testId: string, unit: string): number {
  const t = TESTS[testId];
  if (!t) return 2;
  const base = t.decimals ?? 2;
  if (unit === t.unit) return base;
  // pick precision so the display keeps roughly the same number of significant digits
  const k = t.units[unit]?.[0] ?? 1;
  return Math.max(0, Math.min(4, Math.round(base + Math.log10(k))));
}

export function catalogRef(testId: string, sex?: "M" | "F"): Range {
  const t = TESTS[testId];
  if (!t) return {};
  return (sex === "M" ? t.ref_m : sex === "F" ? t.ref_f : undefined) ?? t.ref ?? t.ref_m ?? {};
}

/** Reference range for a result in canonical units (lab range first, catalog default second). */
export function refFor(r: Result, sex?: "M" | "F"): Range {
  if (r.ref_low != null || r.ref_high != null) return { low: r.ref_low ?? undefined, high: r.ref_high ?? undefined };
  return r.test_id ? catalogRef(r.test_id, sex) : {};
}

/** "umol/L" → "µmol/L", "10^9/L" → "10⁹/L" */
export const prettyUnit = (u: string) =>
  u.replace(/^u(?=[gmM]|mol|IU|kat)/, "µ").replace(/\/u(?=L)/, "/µ").replace("10^9", "10⁹").replace("10^12", "10¹²").replace("m2", "m²");
