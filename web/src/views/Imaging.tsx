/**
 * Imaging and screening: radiology and other report impressions on a timeline.
 */
import { TestCard } from "../components/TestCard";
import { Disclaimer, Empty, SourceLink } from "../components/bits";
import { TESTS } from "../lib/catalog";
import { fmtDate } from "../lib/format";
import { useApp } from "../lib/state";
import { ModalityIcon, PageIcon } from "../components/icons";

export function Imaging() {
  const { data, shownByTest: byTest } = useApp();
  if (!data) return null;
  const findings = [...data.findings].sort((a, b) => ((b.date ?? "") > (a.date ?? "") ? 1 : -1));
  const groups = new Map<string, typeof findings>();
  for (const f of findings) {
    const k = `${f.modality}${f.body_part ? " · " + f.body_part : ""}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  const numeric = [...byTest.keys()].filter((id) => TESTS[id] && /^(imaging|screening|cardio)/.test(TESTS[id].panel));

  return (
    <>
      <div class="card col-12 headcard">
        <div class="headrow">
          <h1 class="title">
            <span class="ticon"><PageIcon name="imaging" /></span> Imaging, heart & screening
          </h1>
          <span class="note">
            {findings.length} report findings · {numeric.length} measured values
          </span>
        </div>
        <p class="note">Impressions are shown as written in the report (translated to English if needed). Click a source to read the full report page.</p>
      </div>
      {!findings.length && !numeric.length && (
        <div class="card col-12">
          <Empty>No imaging or screening reports yet.</Empty>
        </div>
      )}
      {[...groups.entries()].map(([k, fs]) => (
        <div class="card col-6">
          <h2>
            <ModalityIcon modality={fs[0].modality} size={14} /> {k}
          </h2>
          <div class="timeline">
            {fs.map((f) => (
              <div class="tl-item">
                <div class={`tl-dot ${f.is_abnormal ? "warn" : f.is_abnormal === false ? "ok" : ""}`} />
                <div class="tl-body">
                  <div class="flex between">
                    <b>{fmtDate(f.date)}</b>
                    <span class="flex">
                      {f.is_abnormal === true && <span class="pill warn">Finding noted</span>}
                      {f.is_abnormal === false && <span class="pill ok">Reported normal</span>}
                      <SourceLink r={{ ...f, raw_name: f.title }} label="report" />
                    </span>
                  </div>
                  <div class="note">{f.title}</div>
                  <div class="impression">{f.impression}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {numeric.length > 0 && (
        <div class="card col-12">
          <h2>Measured values</h2>
          <div class="tgrid">
            {numeric.map((id) => (
              <TestCard testId={id} />
            ))}
          </div>
        </div>
      )}
      <div class="col-12">
        <Disclaimer />
      </div>
    </>
  );
}
