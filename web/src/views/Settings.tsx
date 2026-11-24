/**
 * Settings: theme, profiles, and per-test display units and reference-range sources.
 */
import { useState } from "preact/hooks";
import { ExportDialog } from "../components/ExportDialog";
import { RangeControl } from "../components/RangeControl";
import { prettyUnit } from "../components/bits";
import { PANELS, TESTS, displayUnit } from "../lib/catalog";
import { useApp, type Theme } from "../lib/state";
import { PageIcon, PanelIcon } from "../components/icons";

const THEMES: { id: Theme; label: string }[] = [
  { id: "auto", label: "Follow system" },
  { id: "light", label: "Light" },
  { id: "paper", label: "Paper (warm light)" },
  { id: "navy", label: "Navy (dark)" },
  { id: "graphite", label: "Graphite (black)" },
];

export function Settings() {
  const { theme, setTheme, prefs, setPrefs, byTest, profile, profiles, adapter } = useApp();
  const [newName, setNewName] = useState("");
  const allTests = [...byTest.keys()].filter((id) => TESTS[id]).sort((a, b) => TESTS[a].name.localeCompare(TESTS[b].name));
  const [filter, setFilter] = useState("");
  const shown = allTests.filter((id) => !filter || TESTS[id].name.toLowerCase().includes(filter.toLowerCase()));
  // tests left off the dashboards (overview, area pages, imaging, explore); still searchable and exportable
  const hidden = new Set(prefs.hidden ?? []);
  const setHidden = (ids: Iterable<string>) => setPrefs({ ...prefs, hidden: [...new Set(ids)] });
  const singles = allTests.filter((id) => byTest.get(id)!.length === 1 && !hidden.has(id));
  const anyHidden = allTests.some((id) => hidden.has(id));

  const [exporting, setExporting] = useState(false);

  const spaces = adapter.spaces().filter((x) => x.writable);
  const [space, setSpace] = useState<string>("");
  const [err, setErr] = useState("");
  const addProfile = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await adapter.addProfile(name, space || null);
      location.reload();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  };
  const groups = [...new Map(profiles.map((p) => [p.circle ?? "", p.circleName ?? (p.circle ? p.circle : "Private — only you")])).entries()];

  return (
    <>
      <div class="card col-12 headcard">
        <h1 class="title">
          <span class="ticon"><PageIcon name="settings" /></span> Settings
        </h1>
      </div>
      <div class="card col-6">
        <h2>Appearance</h2>
        <label>Theme</label>
        <select value={theme} onChange={(e) => setTheme((e.target as HTMLSelectElement).value as Theme)}>
          {THEMES.map((t) => (
            <option value={t.id}>{t.label}</option>
          ))}
        </select>
        <p class="note">Printing / “Save as PDF” always uses the light theme.</p>
      </div>
      <div class="card col-6">
        <h2>Profiles</h2>
        {groups.map(([c, name]) => {
          const ps = profiles.filter((p) => (p.circle ?? "") === c);
          return (
            <div class="profilegroup">
              {groups.length > 1 && (
                <div class="note profilegroup-head">
                  {c ? "👥 " : "🔒 "}
                  {name}
                  {c && ps[0]?.readOnly ? " · view only" : c ? " · shared" : ""}
                </div>
              )}
              {ps.map((p) => (
                <div class="row">
                  <span>{p.name}</span>
                  <span class="note">{p.id === profile?.id ? "current" : ""}</span>
                </div>
              ))}
            </div>
          );
        })}
        {adapter.mode === "aws" ? (
          <>
            <div class="flex wrapflex" style={{ marginTop: "10px" }}>
              <input placeholder="Add a profile (e.g. Mum, or a child)" value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} />
              {spaces.length > 1 && (
                <select value={space} onChange={(e) => setSpace((e.target as HTMLSelectElement).value)} aria-label="Where to create it">
                  {spaces.map((x) => (
                    <option value={x.circle ?? ""}>{x.circle ? `in ${x.name} (shared)` : x.name}</option>
                  ))}
                </select>
              )}
              <button onClick={addProfile}>Add</button>
            </div>
            {err && <p class="note">{err}</p>}
            <p class="note">
              Profiles in a circle are shared with its members. Circle membership is managed by the administrator
              (infra/scripts/circle.sh).
            </p>
          </>
        ) : (
          <p class="note">Local mode: each folder in ./local-data is a profile.</p>
        )}
      </div>
      <div class="card col-12">
        <div class="cardhead">
          <h2>Tests</h2>
          <input placeholder="Filter tests…" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} aria-label="Filter tests" />
        </div>
        <p class="note">
          Values are stored in standard SI units; pick a display unit per test (e.g. mg/dL for a doctor who prefers it).
          Reference ranges differ between labs: by default each result is judged against the range printed on its own
          report. You can instead use the most recent report's range, the standard catalog range, or your own — this
          changes the bands, High/Low flags, patterns and exports. The test page shows which ranges each lab printed.
          Untick “Dashboards” to leave a test off the overview, area pages and explore lists (e.g. one that appeared once
          in an old report); it keeps its values, and search, its page and exports still show it.
        </p>
        <div class="flex wrapflex" style={{ margin: "8px 0 12px" }}>
          <label class="inline">
            Default for all tests
            <select
              value={prefs.refDefault ?? "lab"}
              onChange={(e) => setPrefs({ ...prefs, refDefault: (e.target as HTMLSelectElement).value as "lab" | "latest" })}
            >
              <option value="lab">Each lab's own range (as printed)</option>
              <option value="latest">Most recent report's range</option>
            </select>
          </label>
          <button onClick={() => setPrefs({ ...prefs, units: {}, refs: {} })}>Reset all units and ranges</button>
          <button disabled={!singles.length} onClick={() => setHidden([...hidden, ...singles])} title={singles.map((id) => TESTS[id].name).join(", ")}>
            Hide tests with one result
          </button>
          <button disabled={!anyHidden} onClick={() => setHidden([])}>Show all on dashboards</button>
        </div>
        <div class="tablewrap">
          <table class="settings-table">
            <colgroup>
              <col class="c-test" />
              <col class="c-unit" />
              <col class="c-src" />
              <col />
              <col class="c-n" />
              <col class="c-dash" />
            </colgroup>
            <thead>
              <tr>
                <th>Test</th>
                <th>Display unit</th>
                <th>Reference range source</th>
                <th>Range in use</th>
                <th>Results</th>
                <th>Dashboards</th>
              </tr>
            </thead>
            <tbody>
              {PANELS.flatMap((g) => (g.children ?? []).map((p) => ({ g, p }))).map(({ g, p }) => {
                const ids = shown.filter((id) => TESTS[id].panel === p.id);
                if (!ids.length) return null;
                return (
                  <>
                    <tr class="grouprow">
                      <th colSpan={6}>
                        <span class="grouptitle">
                          <span>
                            <PanelIcon id={p.id} size={14} /> {g.name} › {p.name}
                          </span>
                          <span class="note">{ids.length} {ids.length === 1 ? "test" : "tests"}</span>
                        </span>
                      </th>
                    </tr>
                    {ids.map((id) => {
                      const units = Object.keys(TESTS[id].units);
                      const numeric = TESTS[id].kind === "numeric";
                      const list = byTest.get(id)!;
                      const off = hidden.has(id);
                      return (
                        <tr class={off ? "off" : ""}>
                          <td>
                            <a href={`#/test/${encodeURIComponent(id)}`}>{TESTS[id].name}</a>
                          </td>
                          <td>
                            {!numeric ? (
                              <span class="note">—</span>
                            ) : units.length > 1 ? (
                              <select
                                class="fill"
                                value={displayUnit(id, prefs)}
                                onChange={(e) => setPrefs({ ...prefs, units: { ...prefs.units, [id]: (e.target as HTMLSelectElement).value } })}
                                aria-label={`Display unit for ${TESTS[id].name}`}
                              >
                                {units.map((u) => (
                                  <option value={u}>
                                    {prettyUnit(u) || "—"}
                                    {u === TESTS[id].unit ? " (standard)" : ""}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span class="note">{prettyUnit(TESTS[id].unit) || "no unit"}</span>
                            )}
                          </td>
                          {numeric ? (
                            <RangeControl testId={id} variant="row" />
                          ) : (
                            <>
                              <td><span class="note">—</span></td>
                              <td><span class="note">—</span></td>
                            </>
                          )}
                          <td class="note">
                            {list.length} · {fmtMonth(list[list.length - 1].date)}
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              class="dashcheck"
                              checked={!off}
                              onChange={() => setHidden(off ? [...hidden].filter((x) => x !== id) : [...hidden, id])}
                              aria-label={`Show ${TESTS[id].name} on the dashboards`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </>
                );
              })}
            </tbody>
          </table>
          {!shown.length && <p class="note">No test matches “{filter}”.</p>}
        </div>
      </div>
      <div class="card col-6">
        <h2>AI extraction budget</h2>
        <p class="note">
          A monthly amount (USD) to compare your extraction spend against on the <a href="#/usage">Usage &amp; cost</a> page.
          It is a reminder only: set a hard monthly spend limit for your API key in the Anthropic Console.
        </p>
        <div class="flex">
          <label class="inline">
            $
            <input
              type="number"
              min="0"
              step="1"
              class="small-input"
              value={prefs.budgetUsd ?? ""}
              placeholder="none"
              onChange={(e) => {
                const v = parseFloat((e.target as HTMLInputElement).value);
                setPrefs({ ...prefs, budgetUsd: Number.isFinite(v) && v > 0 ? v : undefined });
              }}
              aria-label="Monthly budget in USD"
            />
            per month
          </label>
        </div>
      </div>
      <div class="card col-6">
        <h2>Export</h2>
        <p class="note">
          Values as a spreadsheet (CSV) for your doctor: all tests or a selection, standard (SI) units, reference ranges,
          flags, source report and notes. Also available from the CSV button at the top of every page.
        </p>
        <button onClick={() => setExporting(true)} disabled={!byTest.size}>Export CSV…</button>
        {exporting && <ExportDialog pageTests={[]} pageLabel="" onClose={() => setExporting(false)} />}
      </div>
      <div class="card col-6">
        <h2>About</h2>
        <p class="note">
          Labracadabra organises values from your own reports. It does not diagnose, and pattern labels
          (trends, steps, outliers) are statistical descriptions only. Always check surprising values against the source
          page — the extraction is done by an AI model and can make mistakes.
        </p>
      </div>
    </>
  );
}


/** "May 2026" */
function fmtMonth(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}
