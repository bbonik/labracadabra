/**
 * Overview dashboard: headline numbers, values outside their reference range, and detected trends and
 * changes.
 */
import { useState } from "preact/hooks";
import { TestCard } from "../components/TestCard";
import { Disclaimer, Empty, FlagPill, PageHeader, PatternPills, useValueText } from "../components/bits";
import { PANELS, TESTS, groupOf, panelById } from "../lib/catalog";
import { ago, fmtDate } from "../lib/format";
import { href } from "../lib/router";
import { useApp } from "../lib/state";
import { DocIcon, PageIcon, PanelIcon } from "../components/icons";

export function Overview() {
  const { data, shownByTest: byTest, stats, prefs, profile } = useApp();
  const valueText = useValueText();
  const [allTrends, setAllTrends] = useState(false);
  if (!data) return null;
  const tested = [...byTest.keys()].filter((id) => TESTS[id]);
  const lastDate = data.results.reduce((m, r) => (r.date && r.date > m ? r.date : m), "");
  const inbox = data.results.filter((r) => r.status === "flagged").length + (data.suggestions?.length ?? 0);

  const attention = tested
    .map((id) => {
      const list = byTest.get(id)!;
      return { id, latest: list[list.length - 1], s: stats(id) };
    })
    .filter((x) => x.latest.flag && x.latest.date && lastDate && x.latest.date >= addYears(lastDate, -1.5))
    .sort((a, b) => (b.s.streak - a.s.streak) || (b.latest.date! > a.latest.date! ? 1 : -1));

  const trends = tested
    .map((id) => ({ id, s: stats(id) }))
    .map((x) => ({ ...x, p: x.s.patterns.filter((p) => ["rising", "falling", "step_up", "step_down", "spike"].includes(p.kind)) }))
    .filter((x) => x.p.length);

  const latestVisit = data.results.filter((r) => r.date === lastDate && r.test_id && r.status !== "ignored");
  const latestFlags = latestVisit.filter((r) => r.flag).length;
  const latestDocs = data.documents.filter((d) => (d.collected_date ?? d.report_date) === lastDate);
  const latestLabs = [...new Set(latestDocs.flatMap((d) => d.labs))];

  if (!data.results.length) {
    return (
      <div class="card col-12">
        <h2>Welcome{profile ? `, ${profile.name}` : ""}</h2>
        <Empty>
          No reports yet. Go to <a href={href("documents")}>Documents</a> to upload a lab report (PDF or photo). Values
          are extracted, standardised and charted automatically.
        </Empty>
      </div>
    );
  }

  return (
    <>
      <PageHeader icon={<PageIcon name="overview" />} title={profile ? profile.name : "Overview"} meta={`${tested.length} tests from ${data.documents.length} reports`} />
      <div class="card col-12 latest-strip">
        <div class="latest-main">
          <span class="ticon small"><DocIcon size={16} strokeWidth={1.9} /></span>
          <div>
            <div class="note">Latest report · {ago(lastDate)}</div>
            <div class="rowtitle">
              {fmtDate(lastDate)}
              {latestLabs.length ? ` · ${latestLabs.join(", ")}` : ""}
            </div>
          </div>
        </div>
        <div class="latest-facts">
          <span><b>{latestVisit.length}</b> values</span>
          <span class={latestFlags ? "warntext" : ""}><b>{latestFlags}</b> outside range</span>
          {latestDocs[0] && <a class="btn small" href={href("documents")}>Open report</a>}
        </div>
      </div>
      <div class="card col-3 kpi">
        <h2>Tests tracked</h2>
        <div class="stat">{tested.length}</div>
        <div class="note">{data.results.length} values from {data.documents.length} reports</div>
      </div>
      <div class="card col-3 kpi">
        <h2>Latest results</h2>
        <div class="stat">{fmtDate(lastDate)}</div>
        <div class="note">{ago(lastDate)} · {latestVisit.length} values{latestFlags ? `, ${latestFlags} flagged` : ""}</div>
      </div>
      <div class="card col-3 kpi">
        <h2>Outside range</h2>
        <div class="stat">{attention.length}</div>
        <div class="note">latest value outside range</div>
      </div>
      <div class="card col-3 kpi">
        <h2>To review</h2>
        <div class="stat">{inbox}</div>
        <div class="note">
          {inbox ? <a href={href("inbox")}>values to check against the source →</a> : "nothing to check ✓"}
        </div>
      </div>

      <div class="card col-6 selfstart">
        <h2>Outside the reference range</h2>
        {!attention.length && <p class="note">All recent results are within their reference ranges.</p>}
        {attention.slice(0, 10).map(({ id, latest, s }) => (
          <a class="row rowlink" href={href("test", id)}>
            <div>
              <div class="rowtitle">{TESTS[id].name}</div>
              <div class="note">
                {valueText(latest)} · {fmtDate(latest.date)}
                {s.streak >= 2 ? ` · ${s.streak}× in a row` : s.outOfRange > 1 ? ` · ${s.outOfRange}× overall` : ""}
              </div>
            </div>
            <FlagPill flag={latest.flag} />
          </a>
        ))}
      </div>

      <div class="card col-6 selfstart">
        <h2>Trends & changes</h2>
        {!trends.length && <p class="note">No consistent trends detected.</p>}
        {trends.slice(0, allTrends ? 99 : 5).map(({ id, p }) => (
          <a class="row rowlink" href={href("test", id)}>
            <div>
              <div class="rowtitle">{TESTS[id].name}</div>
              <div class="note">{p[0].detail}</div>
            </div>
            <div class="flex">
              <PatternPills patterns={p} max={2} />
            </div>
          </a>
        ))}
        {trends.length > 5 && (
          <button class="linkbtn showall" onClick={() => setAllTrends(!allTrends)}>
            {allTrends ? "Show fewer" : `Show all ${trends.length}`}
          </button>
        )}
      </div>

      {prefs.pinned.length > 0 && (
        <div class="card col-12">
          <h2>Pinned</h2>
          <div class="tgrid">
            {prefs.pinned.filter((id) => byTest.has(id)).map((id) => (
              <TestCard testId={id} />
            ))}
          </div>
        </div>
      )}

      <div class="card col-12">
        <h2>Browse by area</h2>
        <div class="areas">
          {PANELS.map((g) => {
            const ids = tested.filter((id) => groupOf(TESTS[id].panel) === g.id);
            const findings = g.id === "imaging" ? data.findings.length : 0;
            if (!ids.length && !findings) return null;
            const flagged = ids.filter((id) => {
              const l = byTest.get(id)!;
              return l[l.length - 1].flag;
            }).length;
            return (
              <a class="area" href={href(g.id === "imaging" ? "imaging" : "group", g.id === "imaging" ? undefined : g.id)}>
                <span class="area-icon"><PanelIcon id={g.id} size={20} /></span>
                <div>
                  <div class="rowtitle">{g.name}</div>
                  <div class="note">
                    {ids.length ? `${ids.length} ${ids.length === 1 ? "test" : "tests"}` : ""}
                    {findings ? `${ids.length ? " · " : ""}${findings} findings` : ""}
                    {flagged ? ` · ${flagged} flagged` : ""}
                  </div>
                  <div class="area-panels note">
                    {(() => {
                      const names = (g.children ?? []).filter((c) => ids.some((id) => TESTS[id].panel === c.id)).map((c) => panelById[c.id].name);
                      return names.slice(0, 3).join(" · ") + (names.length > 3 ? ` · +${names.length - 3} more` : "");
                    })()}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </div>
      <div class="col-12">
        <Disclaimer />
      </div>
    </>
  );
}

function addYears(iso: string, years: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Math.round(years * 365.25));
  return d.toISOString().slice(0, 10);
}
