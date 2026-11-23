import { describe, expect, it } from "vitest";
import { buildCsv, cell, parsePrinted, yearsBefore, type ExportInput, type ExportOptions } from "./export";
import type { Result } from "./types";

const base = (o: Partial<Result>): Result => ({
  id: o.id ?? Math.random().toString(36),
  test_id: "glucose_fasting",
  raw_name: "Glucose",
  date: "2025-01-10",
  kind: "numeric",
  value_raw: "5.6",
  doc_id: "d1",
  page: 1,
  confidence: 1,
  status: "ok",
  ...o,
});

/** minimal RFC 4180 parser, to check the file reads back cell for cell */
function parse(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cur = "",
    q = false;
  const s = csv.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") row.push(cur), (cur = "");
    else if (ch === "\r" && s[i + 1] === "\n") {
      row.push(cur), rows.push(row), (row = []), (cur = ""), i++;
    } else cur += ch;
  }
  return rows;
}

function run(results: Result[], o: Partial<ExportOptions> = {}, extra: Partial<ExportInput> = {}) {
  const byTest = new Map<string, Result[]>();
  for (const r of results) byTest.set(r.test_id!, [...(byTest.get(r.test_id!) ?? []), r]);
  const input: ExportInput = {
    byTest,
    documents: [{ id: "d1", filename: "report.pdf", pages: 1, media_type: "application/pdf", uploaded_at: "", labs: [], page_types: {}, status: "done" }],
    corrections: { results: {}, aliases: {} },
    prefs: { units: {}, pinned: [] },
    profile: { name: "Alex", sex: "M", birth_year: 1980 },
    today: "2026-11-22",
    ...extra,
  };
  const opts: ExportOptions = { testIds: [...byTest.keys()], units: "si", sort: "test", original: false, header: false, ...o };
  const out = buildCsv(input, opts);
  const rows = parse(out.csv);
  const head = rows[o.header ? rows.findIndex((r) => r[0] === "Date") : 0];
  const get = (i: number, col: string) => rows[(o.header ? rows.findIndex((r) => r[0] === "Date") : 0) + 1 + i][head.indexOf(col)];
  return { out, rows, head, get };
}

describe("parsePrinted", () => {
  it("reads decimal commas and censored values", () => {
    expect(parsePrinted("5,6")).toBe(5.6);
    expect(parsePrinted("<0.5")).toBe(0.5);
    expect(parsePrinted(" 98 ")).toBe(98);
    expect(parsePrinted("Negative")).toBeNaN();
  });
});

describe("yearsBefore", () => {
  it("goes back whole calendar years", () => {
    expect(yearsBefore("2026-11-22", 1)).toBe("2025-11-22");
    expect(yearsBefore("2026-11-22", 5)).toBe("2021-11-22");
    expect(yearsBefore("2028-02-29", 1)).toBe("2027-02-28");
  });
});

describe("CSV export", () => {
  it("writes SI values and notes the conversion", () => {
    // lab printed 100 mg/dL; stored canonically as 5.55 mmol/L
    const { get } = run([base({ value: 5.550622, unit: "mmol/L", value_raw: "100", unit_raw: "mg/dL", ref_low: 3.9, ref_high: 5.6, ref_source: "lab" })]);
    expect(get(0, "Value")).toBe("5.6");
    expect(get(0, "Unit")).toBe("mmol/L");
    expect(get(0, "Reference range")).toBe("3.9 – 5.6");
    expect(get(0, "Range from")).toBe("Lab");
    expect(get(0, "Flag")).toBe("In range");
    expect(get(0, "Notes")).toContain("converted from 100 mg/dL");
    expect(get(0, "Report")).toBe("report.pdf");
  });

  it("keeps values that were already in SI exactly as printed", () => {
    const { get } = run([base({ value: 5.62, value_raw: "5.62", unit_raw: "mmol/L", ref_high: 5.6, flag: "H" })]);
    expect(get(0, "Value")).toBe("5.62");
    expect(get(0, "Reference range")).toBe("≤ 5.6");
    expect(get(0, "Flag")).toBe("High");
    expect(get(0, "Notes")).toBe("");
  });

  it("can use the units chosen in the app instead", () => {
    const { get } = run([base({ value: 5.550622, value_raw: "100", unit_raw: "mg/dL" })], { units: "display" }, { prefs: { units: { glucose_fasting: "mg/dL" }, pinned: [] } });
    expect(get(0, "Unit")).toBe("mg/dL");
    expect(get(0, "Value")).toBe("100");
    expect(get(0, "Notes")).toBe("");
  });

  it("marks values below the measuring limit, text results and unreviewed values", () => {
    const { get } = run([
      base({ test_id: "crp", raw_name: "CRP", value: 0.5, censor: "<", value_raw: "<0.5", unit_raw: "mg/L" }),
      base({ test_id: "crp", raw_name: "CRP", date: "2025-02-01", kind: "text", value: null, value_raw: "see comment", value_text: "Haemolysed sample", status: "flagged", issues: ["no number"] }),
    ]);
    expect(get(0, "Value")).toBe("<0.5");
    expect(get(0, "Notes")).toContain("below the lab's measuring limit");
    expect(get(1, "Value")).toBe("Haemolysed sample");
    expect(get(1, "Notes")).toBe("not yet reviewed: no number");
  });

  it("notes values edited by the user", () => {
    const r = base({ id: "r1", value: 6.1, value_raw: "61", unit_raw: "mmol/L", status: "user_corrected" });
    const { get } = run([r], {}, { corrections: { results: { r1: { action: "edit", value: 6.1 } }, aliases: {} } });
    expect(get(0, "Value")).toBe("6.1");
    expect(get(0, "Notes")).toBe("value edited by the user (report: 61 mmol/L)");
  });

  it("filters by test and date, and sorts by date when asked", () => {
    const rs = [
      base({ date: "2024-01-01", value: 5, value_raw: "5" }),
      base({ date: "2025-06-01", value: 6, value_raw: "6" }),
      base({ test_id: "hba1c", raw_name: "HbA1c", date: "2025-03-01", value: 5.4, value_raw: "5.4" }),
    ];
    expect(run(rs, { from: "2025-01-01" }).out.rows).toBe(2);
    expect(run(rs, { testIds: ["hba1c"] }).out.rows).toBe(1);
    const byDate = run(rs, { sort: "date" });
    expect([0, 1, 2].map((i) => byDate.get(i, "Date"))).toEqual(["2024-01-01", "2025-03-01", "2025-06-01"]);
  });

  it("adds a description header and the as-printed columns", () => {
    const { rows, head, get } = run([base({ value: 5.550622, value_raw: "100", unit_raw: "mg/dL" })], { header: true, original: true });
    expect(rows[0][0]).toBe("Laboratory results exported from Labracadabra");
    expect(rows[1][0]).toBe("Patient: Alex (male, born 1980)");
    expect(rows.some((r) => r[0].startsWith("Units: standard (SI)"))).toBe(true);
    expect(head).toContain("Value as printed");
    expect(get(0, "Value as printed")).toBe("100");
    expect(get(0, "Unit as printed")).toBe("mg/dL");
  });

  it("is Excel-friendly: BOM, CRLF, quoting, non-Latin text, no formulas", () => {
    const { out, get } = run([base({ raw_name: '=HYPERLINK("x") Γλυκόζη, νηστεία', value: 5.6 })]);
    expect(out.csv.startsWith("﻿")).toBe(true);
    expect(out.csv).toContain("\r\n");
    expect(get(0, "Name on report")).toBe("'=HYPERLINK(\"x\") Γλυκόζη, νηστεία");
    expect(cell("-1.5")).toBe('"-1.5"');
    expect(cell("+cmd")).toBe('"\'+cmd"');
    expect(cell('a "b"')).toBe('"a ""b"""');
  });
});
