/**
 * CSV export of results, for sharing with doctors: one row per value, in standard (SI) units by default, with a
 * notes column explaining anything a reader needs (conversions, detection limits, user edits, unreviewed values).
 * Pure functions: the dialog collects the options, this builds the text.
 */
import { noteSummary, notesFor, type Note } from "./notes";
import { TESTS, decimalsFor, displayUnit, panelById, prettyUnit, testName, toDisplay } from "./catalog";
import type { Corrections, Doc, Prefs, Profile, Result } from "./types";

export interface ExportOptions {
  testIds: string[];
  from?: string; // YYYY-MM-DD, inclusive
  to?: string;
  /** "si": the catalog's standard unit for every test · "display": the units chosen in the app */
  units: "si" | "display";
  sort: "test" | "date";
  /** add the value and unit exactly as printed on the report */
  original: boolean;
  /** a few lines at the top saying whose results these are and how to read them */
  header: boolean;
}

export interface ExportInput {
  byTest: Map<string, Result[]>;
  documents: Doc[];
  corrections: Corrections;
  prefs: Prefs;
  profile: Pick<Profile, "name" | "sex" | "birth_year"> | null;
  today: string;
  /** the profile's personal notes; the ones that apply to a result go first in its Notes cell */
  notes?: Note[];
}

const FLAG: Record<string, string> = { H: "High", L: "Low", A: "Abnormal" };
const RANGE_FROM: Record<string, string> = { lab: "Lab", catalog: "Typical range", user: "Custom" };

/** "5,6" → 5.6, "<0.5" → 0.5; NaN when the printed value isn't a plain number */
export function parsePrinted(s: string | undefined): number {
  if (!s) return NaN;
  const t = s.replace(/[<>≤≥=\s]/g, "").replace(/^(\d+),(\d+)$/, "$1.$2");
  return /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(t) ? Number(t) : NaN;
}

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
/** short text for a number in the unit the lab printed (hides float noise from the stored 6-decimal canonical value) */
const plain = (v: number) => String(Number(v.toPrecision(6)));

/** Selected results, in the order they will be written. */
export function selectResults(input: ExportInput, o: ExportOptions): Result[] {
  const order = new Map(Object.keys(TESTS).map((id, i) => [id, i]));
  const ids = [...new Set(o.testIds)].filter((id) => input.byTest.has(id)).sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
  const rows = ids.flatMap((id) => (input.byTest.get(id) ?? []).filter((r) => r.date && (!o.from || r.date >= o.from) && (!o.to || r.date <= o.to)));
  if (o.sort === "date") {
    const pos = new Map(rows.map((r, i) => [r, i]));
    rows.sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : pos.get(a)! - pos.get(b)!));
  }
  return rows;
}

export const COLUMNS = ["Date", "Test", "Panel", "Value", "Unit", "Reference range", "Range from", "Flag", "Notes", "Name on report"];
const ORIGINAL_COLUMNS = ["Value as printed", "Unit as printed"];
const SOURCE_COLUMNS = ["Lab", "Report", "Page"];

/** One CSV row (unescaped cells) for a result. */
export function rowFor(r: Result, input: ExportInput, o: ExportOptions, docs: Map<string, Doc>): string[] {
  const id = r.test_id!;
  const t = TESTS[id];
  const notes: string[] = [];
  const c = input.corrections.results[r.id];
  const edited = c?.action === "edit" && c.value != null;
  let value = "",
    unit = "",
    range = "";

  if (r.kind === "numeric" && r.value != null && t) {
    const u = o.units === "si" ? t.unit : displayUnit(id, input.prefs);
    const v = toDisplay(r.value, id, u);
    const printed = parsePrinted(r.value_raw);
    const converted = !(Number.isFinite(printed) && same(printed, v));
    const d = decimalsFor(id, u);
    const fmt = (x: number) => (converted ? x.toFixed(d) : plain(x));
    value = (r.censor ?? "") + (converted ? fmt(v) : plain(printed));
    unit = u === "ratio" ? "" : prettyUnit(u);
    const lo = r.ref_low != null ? fmt(toDisplay(r.ref_low, id, u)) : null;
    const hi = r.ref_high != null ? fmt(toDisplay(r.ref_high, id, u)) : null;
    // en dash with spaces: "3.5-5.0" would be read as a date by some spreadsheets
    range = lo != null && hi != null ? `${lo} – ${hi}` : lo != null ? `≥ ${lo}` : hi != null ? `≤ ${hi}` : r.ref_text ?? "";
    if (converted && Number.isFinite(printed) && !edited)
      notes.push(`converted from ${r.value_raw.trim()}${r.unit_raw ? " " + r.unit_raw : ""}`);
    if (r.censor?.startsWith("<")) notes.push("below the lab's measuring limit");
    if (r.censor?.startsWith(">")) notes.push("above the lab's measuring limit");
  } else {
    value = r.value_text ?? r.value_raw ?? "";
    unit = r.kind === "numeric" ? r.unit_raw ?? r.unit ?? "" : "";
    range = r.ref_text ?? "";
    if (r.kind === "numeric") notes.push("unit could not be standardised; value as printed");
  }

  for (const n of notesFor(input.notes ?? [], r)) notes.unshift(`note: ${noteSummary(n, r.date ?? undefined)}`);
  if (edited) notes.push(`value edited by the user (report: ${r.value_raw.trim()}${r.unit_raw ? " " + r.unit_raw : ""})`);
  if (r.status === "flagged") notes.push(`not yet reviewed${r.issues?.length ? ": " + r.issues.join("; ") : ""}`);
  if (r.is_historical) notes.push("earlier result printed on a later report");
  const replaced = input.documents.find((x) => x.superseded_by === r.doc_id);
  if (replaced) notes.push("from a corrected re-issue of an earlier report");
  if (r.also_in?.length) notes.push(`same value also in ${r.also_in.length} other report${r.also_in.length > 1 ? "s" : ""}`);

  const cells = [
    r.date!,
    t?.name ?? testName(id),
    t ? panelById[t.panel]?.name ?? "" : "",
    value,
    unit,
    range,
    range ? RANGE_FROM[r.ref_source ?? "lab"] ?? "" : "",
    r.flag ? FLAG[r.flag] : r.kind === "numeric" && range ? "In range" : "",
    notes.join("; "),
    r.raw_name,
  ];
  const doc = docs.get(r.doc_id);
  if (o.original) cells.push(r.value_raw ?? "", r.unit_raw ?? "");
  cells.push(r.lab ?? "", doc?.filename ?? "", r.page ? String(r.page) : "");
  return cells;
}

/** Quote a cell; neutralise text a spreadsheet would run as a formula (= + - @ at the start), but keep numbers. */
export function cell(s: string): string {
  let v = s.replace(/\r\n?/g, "\n");
  if (/^[=+\-@\t\r]/.test(v) && !/^[-+]?\d*\.?\d+$/.test(v)) v = "'" + v;
  return `"${v.replace(/"/g, '""')}"`;
}

export function buildCsv(input: ExportInput, o: ExportOptions): { csv: string; rows: number; tests: number } {
  const docs = new Map(input.documents.map((d) => [d.id, d]));
  const results = selectResults(input, o);
  const lines: string[][] = [];
  if (o.header) {
    const p = input.profile;
    const who = p ? [p.name, p.sex === "M" ? "male" : p.sex === "F" ? "female" : "", p.birth_year ? `born ${p.birth_year}` : ""].filter(Boolean) : [];
    const dates = results.length ? `${results.reduce((m, r) => (r.date! < m ? r.date! : m), "9999")} to ${results.reduce((m, r) => (r.date! > m ? r.date! : m), "")}` : "none";
    lines.push(
      ["Laboratory results exported from Labracadabra"],
      ...(who.length ? [[`Patient: ${who[0]}${who.length > 1 ? ` (${who.slice(1).join(", ")})` : ""}`]] : []),
      [`Exported: ${input.today}. Results from ${dates}. Dates are collection dates (YYYY-MM-DD).`],
      [o.units === "si" ? "Units: standard (SI) units; values the lab reported in other units were converted (see Notes)." : "Units: as chosen in the app; converted values are marked in Notes."],
      ["Transcribed automatically from the patient's own reports. Not a diagnosis; check important values against the original report."],
      [],
    );
  }
  lines.push([...COLUMNS, ...(o.original ? ORIGINAL_COLUMNS : []), ...SOURCE_COLUMNS]);
  for (const r of results) lines.push(rowFor(r, input, o, docs));
  // BOM so Excel reads UTF-8 (Greek, Chinese, µ); CRLF line ends per RFC 4180
  const csv = "﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
  return { csv, rows: results.length, tests: new Set(results.map((r) => r.test_id)).size };
}

/** the same calendar day n years before `today` (YYYY-MM-DD) */
export function yearsBefore(today: string, n: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y - n, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0); // 29 Feb → 28 Feb
  return dt.toISOString().slice(0, 10);
}

export function exportFileName(profileName: string | undefined, today: string): string {
  return `Lab results${profileName ? " - " + profileName : ""} - ${today}.csv`.replace(/[\\/:*?"<>|]+/g, " ");
}

export function downloadText(text: string, filename: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
