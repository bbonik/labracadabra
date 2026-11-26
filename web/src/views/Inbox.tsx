/**
 * Review inbox: values the pipeline was unsure about (unknown names, odd units, implausible or conflicting
 * values), each with its source page, to confirm, fix, ignore or map to a catalog test.
 */
import { useState } from "preact/hooks";
import { PageHeader, prettyUnit } from "../components/bits";
import { CircleCheck, FileSearch } from "lucide-preact";
import { PANELS, TESTS, testName } from "../lib/catalog";
import { fmtDate } from "../lib/format";
import { useApp } from "../lib/state";
import type { Result, Suggestion } from "../lib/types";
import { PageIcon } from "../components/icons";

function TestSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)} aria-label="Map to test">
      <option value="">— choose test —</option>
      {PANELS.flatMap((g) => g.children ?? []).map((p) => (
        <optgroup label={p.name}>
          {Object.values(TESTS)
            .filter((t) => t.panel === p.id)
            .map((t) => (
              <option value={t.id}>{t.name}</option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/** why a value is here, in words */
function reason(issue: string): string {
  if (issue.startsWith("low confidence")) return "The AI wasn't sure it read this value correctly";
  if (issue === "not in catalog") return "Test name not recognised";
  if (issue.includes("ambiguous")) return "The name could mean more than one test";
  if (issue.startsWith("unit ")) return `The unit can't be converted (${issue.replace(/^unit /, "")})`;
  if (issue.startsWith("implausible")) return `The number looks implausible for this test: ${issue.replace(/^implausible value /, "")}`;
  if (issue.includes("different values")) return "Two different values for the same day";
  if (issue === "expected a number") return "A number was expected but the report shows text";
  if (issue === "no date") return "No date found for this value";
  return issue.charAt(0).toUpperCase() + issue.slice(1);
}

function Item({ r }: { r: Result }) {
  const { correct, addAlias, canEdit, openSource } = useApp();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(r.value_raw);
  const [testId, setTestId] = useState(r.test_id ?? "");
  const unmapped = !r.test_id;
  const t = testId ? TESTS[testId] : undefined;
  const [unit, setUnit] = useState(t?.unit ?? "");

  return (
    <div class="inbox-item">
      <div class="inbox-grid">
        <div class="inbox-value">
          <div class="inbox-num">
            {r.value_raw} <small>{r.unit_raw}</small>
          </div>
          <div class="note">{fmtDate(r.date)}</div>
        </div>
        <div>
          <div class="rowtitle">
            {r.test_id && testName(r.test_id) !== r.raw_name ? <>{testName(r.test_id)} <span class="note">printed as “{r.raw_name}”</span></> : r.raw_name}
          </div>
          <div class="inbox-why">
            {(r.issues ?? []).map((i) => (
              <span class="whyline">⚠ {reason(i)}</span>
            ))}
          </div>
          <div class="note">{r.lab ?? ""}</div>
        </div>
        <button class="btn viewpage" onClick={() => openSource({ doc_id: r.doc_id, page: r.page, title: r.raw_name, source_text: r.source_text, value_raw: r.value_raw, raw_name: r.raw_name })}>
          <FileSearch size={15} strokeWidth={1.9} /> View page {r.page}
        </button>
      </div>
      {unmapped ? (
        <div class={`flex wrapflex actions ${canEdit ? "" : "viewonly"}`} title={canEdit ? "" : "View only: an editor of this profile can resolve this"}>
          <TestSelect value={testId} onChange={setTestId} />
          <button class="primary" disabled={!testId} onClick={() => addAlias(r.raw_name, testId)} title="Map every result with this name to the chosen test">
            Map “{r.raw_name}” to this test
          </button>
          <button onClick={() => correct(r.id, { action: "ignore" })}>Ignore</button>
        </div>
      ) : editing ? (
        <div class={`flex wrapflex actions ${canEdit ? "" : "viewonly"}`} title={canEdit ? "" : "View only: an editor of this profile can resolve this"}>
          <input class="small-input" value={val} onInput={(e) => setVal((e.target as HTMLInputElement).value)} aria-label="Corrected value" />
          {t && Object.keys(t.units).length > 1 ? (
            <select value={unit} onChange={(e) => setUnit((e.target as HTMLSelectElement).value)} aria-label="Unit">
              {Object.keys(t.units).map((u) => (
                <option value={u}>{prettyUnit(u)}</option>
              ))}
            </select>
          ) : (
            <span class="note">{prettyUnit(t?.unit ?? "")}</span>
          )}
          <button
            class="primary"
            disabled={Number.isNaN(parseFloat(val.replace(",", ".")))}
            onClick={() => correct(r.id, { action: "edit", value: parseFloat(val.replace(",", ".")), unit: unit || t?.unit })}
          >
            Save
          </button>
          <button onClick={() => setEditing(false)}>Cancel</button>
        </div>
      ) : (
        <div class={`flex wrapflex actions ${canEdit ? "" : "viewonly"}`} title={canEdit ? "" : "View only: an editor of this profile can resolve this"}>
          <button class="primary" onClick={() => correct(r.id, { action: "confirm" })}>✓ Looks right</button>
          {r.kind === "numeric" && <button onClick={() => setEditing(true)}>Fix value</button>}
          <button onClick={() => correct(r.id, { action: "ignore" })}>Ignore</button>
        </div>
      )}
    </div>
  );
}

function CorrectedVersion({ s }: { s: Suggestion }) {
  const { decideDoc, openSource, canEdit } = useApp();
  const extra = [
    s.only_newer ? `${s.only_newer} test${s.only_newer === 1 ? "" : "s"} only in the newer` : "",
    s.only_older ? `${s.only_older} only in the older` : "",
  ].filter(Boolean);
  return (
    <div class="inbox-item suggestion">
      <div class="rowtitle">Is “{s.newer_filename}” a corrected version of “{s.older_filename}”?</div>
      <p class="note">
        Both reports are for samples collected on <b>{fmtDate(s.collected_date)}</b> and share {s.common} tests, but{" "}
        <b>
          {s.n_changed} value{s.n_changed === 1 ? "" : "s"} differ{s.n_changed === 1 ? "s" : ""}
        </b>
        {extra.length ? ` (${extra.join(", ")})` : ""}. Labs re-issue a report when they correct it. Choose which one to
        keep; the other report's values are set aside (not deleted — you can restore them from Documents).
      </p>
      <div class="tablewrap">
        <table class="compact">
          <thead>
            <tr>
              <th>Test</th>
              <th>
                Newer ·{" "}
                <button class="linkbtn" onClick={() => openSource({ doc_id: s.newer, page: 1, title: s.newer_filename })}>
                  {s.newer_filename}
                </button>
              </th>
              <th>
                Older ·{" "}
                <button class="linkbtn" onClick={() => openSource({ doc_id: s.older, page: 1, title: s.older_filename })}>
                  {s.older_filename}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {s.changed.map((c) => (
              <tr>
                <td>{c.name}</td>
                <td class="num">
                  {c.newer} <span class="note">{c.unit ?? ""}</span>
                </td>
                <td class="mono">
                  {c.older} {c.unit ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.n_changed > s.changed.length && <p class="note">…and {s.n_changed - s.changed.length} more.</p>}
      <div class={`flex wrapflex actions ${canEdit ? "" : "viewonly"}`} title={canEdit ? "" : "View only: an editor of this profile can resolve this"}>
        <button class="primary" onClick={() => decideDoc(s.older, { action: "supersede", by: s.newer })}>
          Use the newer report
        </button>
        <button onClick={() => decideDoc(s.newer, { action: "supersede", by: s.older })}>Use the older report</button>
        <button onClick={() => decideDoc(s.newer, { action: "keep_both", with: s.older })} title="They are different reports: keep every value">
          Keep both
        </button>
      </div>
    </div>
  );
}

export function Inbox() {
  const { data, corrections, correct, canEdit } = useApp();
  if (!data) return null;
  const flagged = data.results.filter((r) => r.status === "flagged");
  const suggestions = data.suggestions ?? [];
  const handled = data.results.filter((r) => corrections.results[r.id]);
  return (
    <>
      <PageHeader icon={<PageIcon name="inbox" />} title="Review inbox" meta={`${flagged.length + suggestions.length} to review`}>
        Values the app wasn't sure about. Compare each one with its report page, then confirm, fix or ignore it.
        {!canEdit && <b> View only: an editor of this profile can resolve these.</b>}
      </PageHeader>
      {suggestions.length > 0 && (
        <div class="card col-12">
          <h2>Possible corrected reports</h2>
          {suggestions.map((s) => (
            <CorrectedVersion s={s} key={`${s.newer}-${s.older}`} />
          ))}
        </div>
      )}
      <div class="card col-12">
        {!flagged.length && (
          <div class="allclear">
            <CircleCheck size={28} strokeWidth={1.7} />
            <div class="rowtitle">All values checked</div>
            <div class="note">New reports will show anything uncertain here.</div>
          </div>
        )}
        {flagged.map((r) => (
          <Item r={r} key={r.id} />
        ))}
      </div>
      {handled.length > 0 && (
        <div class="card col-12">
          <h2>Your corrections</h2>
          {handled.map((r) => (
            <div class="row">
              <div>
                <div class="rowtitle">
                  {testName(r.test_id, r.raw_name)} · {fmtDate(r.date)}
                </div>
                <div class="note">
                  {corrections.results[r.id].action} · printed “{r.value_raw} {r.unit_raw ?? ""}”
                </div>
              </div>
              <button class="linkbtn" hidden={!canEdit} onClick={() => correct(r.id, null)}>
                undo
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
