/**
 * CSV export dialog for sharing with a doctor: choose tests, period, units and columns. The file itself is
 * built in the browser by lib/export.ts.
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import { PANELS, TESTS } from "../lib/catalog";
import { buildCsv, downloadText, exportFileName, selectResults, yearsBefore, type ExportOptions } from "../lib/export";
import { fmtDate } from "../lib/format";
import { useApp } from "../lib/state";
import { Download, X } from "lucide-preact";

type Scope = "page" | "all" | "pick";
type Period = "all" | "1" | "2" | "5" | "custom";
const PERIODS: { id: Period; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "1", label: "Last year" },
  { id: "2", label: "Last 2 years" },
  { id: "5", label: "Last 5 years" },
  { id: "custom", label: "Custom…" },
];


/**
 * Download results as CSV. `pageTests` are the tests on the current page (one test, an area, the Explore selection);
 * when empty the "This page" choice is hidden.
 */
export function ExportDialog({ pageTests, pageLabel, onClose }: { pageTests: string[]; pageLabel: string; onClose: () => void }) {
  const { byTest, data, corrections, prefs, profile } = useApp();
  const order = useMemo(() => Object.keys(TESTS), []);
  const withData = useMemo(() => order.filter((id) => byTest.has(id)), [byTest, order]);
  const onPage = pageTests.filter((id) => byTest.has(id));
  const [scope, setScope] = useState<Scope>(onPage.length ? "page" : "all");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(onPage));
  const [period, setPeriod] = useState<Period>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [units, setUnits] = useState<ExportOptions["units"]>("si");
  const [sort, setSort] = useState<ExportOptions["sort"]>("test");
  const [original, setOriginal] = useState(false);
  const [header, setHeader] = useState(true);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const testIds = scope === "page" ? onPage : scope === "all" ? withData : withData.filter((id) => picked.has(id));
  const today = new Date().toISOString().slice(0, 10);
  const input = { byTest, documents: data?.documents ?? [], corrections, prefs, profile, today };
  const range = period === "all" ? {} : period === "custom" ? { from: from || undefined, to: to || undefined } : { from: yearsBefore(today, Number(period)) };
  const opts: ExportOptions = { testIds, ...range, units, sort, original, header };
  const deps = [byTest, data, corrections, prefs, profile, scope, picked, period, from, to, units, sort, original, header];
  const preview = useMemo(() => buildCsv(input, opts), deps);
  // dates actually covered by the chosen tests and period
  const span = useMemo(() => {
    const ds = selectResults(input, opts).map((r) => r.date!).sort();
    return ds.length ? [ds[0], ds[ds.length - 1]] : null;
  }, deps);
  const choosePeriod = (p: Period) => {
    if (p === "custom" && !from && !to) {
      // start from what is there, so only the ends need adjusting
      const all = selectResults(input, { ...opts, from: undefined, to: undefined }).map((r) => r.date!).sort();
      setFrom(all[0] ?? "");
      setTo(all[all.length - 1] ?? today);
    }
    setPeriod(p);
  };
  const unmapped = (data?.results ?? []).filter((r) => !r.test_id && r.status !== "ignored" && r.status !== "duplicate" && r.status !== "superseded").length;

  const download = () => {
    downloadText(preview.csv, exportFileName(profile?.name, today));
    onClose();
  };

  // tests with data, grouped by area → panel, for the picker
  const groups = PANELS.map((g) => ({
    g,
    panels: [...(g.children ?? []), g].map((p) => ({ p, ids: withData.filter((id) => TESTS[id].panel === p.id) })).filter((x) => x.ids.length),
  })).filter((x) => x.panels.length);
  const toggle = (ids: string[], on: boolean) => {
    const s = new Set(picked);
    for (const id of ids) on ? s.add(id) : s.delete(id);
    setPicked(s);
  };

  return (
    <div class="modal-back" onClick={onClose}>
      <div class="modal export" role="dialog" aria-label="Export results as CSV" onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <div>
            <div class="modal-title">Export results (CSV)</div>
            <div class="note">A spreadsheet file for your doctor or anyone you choose. Opens in Excel, Numbers or Google Sheets.</div>
          </div>
          <button class="iconbtn" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={1.9} /></button>
        </div>
        <div class="modal-body export-body">
          <section>
            <div class="tlabel">Tests</div>
            <div class="seg">
              {onPage.length > 0 && (
                <button class={scope === "page" ? "active" : ""} onClick={() => setScope("page")}>
                  {pageLabel} ({onPage.length})
                </button>
              )}
              <button class={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>All tests ({withData.length})</button>
              <button class={scope === "pick" ? "active" : ""} onClick={() => setScope("pick")}>Choose…</button>
            </div>
            {scope === "pick" && (
              <div class="export-pick">
                <div class="ex-row">
                  <button class="small" onClick={() => setPicked(new Set(withData))}>Select all</button>
                  <button class="small" onClick={() => setPicked(new Set())}>Clear</button>
                  <span class="note">{testIds.length} selected</span>
                </div>
                {groups.map(({ g, panels }) => (
                  <details open={panels.some((x) => x.ids.some((id) => picked.has(id)))}>
                    <summary>
                      {g.name} <span class="note">({panels.reduce((n, x) => n + x.ids.filter((id) => picked.has(id)).length, 0)}/{panels.reduce((n, x) => n + x.ids.length, 0)})</span>
                    </summary>
                    {panels.map(({ p, ids }) => (
                      <div class="export-panel">
                        <label class="inline strong">
                          <input type="checkbox" checked={ids.every((id) => picked.has(id))} indeterminate={ids.some((id) => picked.has(id)) && !ids.every((id) => picked.has(id))} onChange={(e) => toggle(ids, (e.target as HTMLInputElement).checked)} />
                          {p.name}
                        </label>
                        <div class="export-tests">
                          {ids.map((id) => (
                            <label class="inline">
                              <input type="checkbox" checked={picked.has(id)} onChange={(e) => toggle([id], (e.target as HTMLInputElement).checked)} />
                              {TESTS[id].name} <span class="note">({byTest.get(id)!.length})</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </details>
                ))}
              </div>
            )}
          </section>

          <section>
            <div class="tlabel">Period</div>
            <div class="seg">
              {PERIODS.map((p) => (
                <button class={period === p.id ? "active" : ""} onClick={() => choosePeriod(p.id)}>
                  {p.label}
                </button>
              ))}
            </div>
            {period === "custom" && (
              <div class="ex-row">
                <label class="inline">From <input type="date" value={from} max={to || today} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} /></label>
                <label class="inline">to <input type="date" value={to} min={from || undefined} max={today} onInput={(e) => setTo((e.target as HTMLInputElement).value)} /></label>
              </div>
            )}
            <div class="note">
              {span ? (span[0] === span[1] ? `Results from ${fmtDate(span[0])}.` : `Results from ${fmtDate(span[0])} to ${fmtDate(span[1])}.`) : "No results in this period for the chosen tests."}
            </div>
          </section>

          <section class="export-grid">
            <div>
              <div class="tlabel">Units</div>
              <div class="seg small">
                <button class={units === "si" ? "active" : ""} onClick={() => setUnits("si")}>Standard (SI)</button>
                <button class={units === "display" ? "active" : ""} onClick={() => setUnits("display")}>As shown in the app</button>
              </div>
            </div>
            <div>
              <div class="tlabel">Order</div>
              <div class="seg small">
                <button class={sort === "test" ? "active" : ""} onClick={() => setSort("test")}>By test</button>
                <button class={sort === "date" ? "active" : ""} onClick={() => setSort("date")}>By date</button>
              </div>
            </div>
            <div>
              <div class="tlabel">Include</div>
              <label class="inline"><input type="checkbox" checked={header} onChange={(e) => setHeader((e.target as HTMLInputElement).checked)} /> Short description at the top (name, date, units)</label>
              <label class="inline"><input type="checkbox" checked={original} onChange={(e) => setOriginal((e.target as HTMLInputElement).checked)} /> Value and unit exactly as printed on the report</label>
            </div>
          </section>

          <div class="export-foot">
            <div class="export-summary">
              <b>{preview.rows} value{preview.rows === 1 ? "" : "s"}</b> from {preview.tests} test{preview.tests === 1 ? "" : "s"}.
              {unmapped > 0 && <span class="note"> {unmapped} unrecognised value{unmapped === 1 ? " is" : "s are"} waiting in the review inbox and not included.</span>}
              <div class="note">The file contains medical information. Share it only with people you trust.</div>
            </div>
            <div class="export-actions">
              <button onClick={onClose}>Cancel</button>
              <button class="primary" disabled={!preview.rows} onClick={download}>
                <Download size={15} strokeWidth={1.9} class="ico" /> Download CSV
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
