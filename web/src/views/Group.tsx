/**
 * An area page (e.g. Blood tests): test cards grouped by panel, in catalog order.
 */
import { TestCard } from "../components/TestCard";
import { Disclaimer, Empty, PageHeader } from "../components/bits";
import { Columns3, Grid3x3 } from "lucide-preact";
import { PANELS, TESTS, groupOf } from "../lib/catalog";
import { href } from "../lib/router";
import { useApp } from "../lib/state";
import { PanelIcon } from "../components/icons";

export function Group({ groupId, panelFilter }: { groupId: string; panelFilter?: string }) {
  const { shownByTest: byTest } = useApp();
  const group = PANELS.find((g) => g.id === groupId);
  if (!group) return <div class="card col-12"><Empty>Unknown area.</Empty></div>;
  const ids = [...byTest.keys()].filter((id) => TESTS[id] && groupOf(TESTS[id].panel) === groupId);
  const panels = (group.children ?? []).filter((p) => ids.some((id) => TESTS[id].panel === p.id));
  const shown = panelFilter ? panels.filter((p) => p.id === panelFilter) : panels;
  // keep catalog order inside each panel
  const order = Object.keys(TESTS);

  return (
    <>
      <PageHeader icon={<PanelIcon id={group.id} size={18} />} title={group.name} meta={`${ids.length} tests with results`}>
        <div class="chips chipscroll">
          <a class={`chip ${!panelFilter ? "active" : ""}`} href={href("group", groupId)}>
            All
          </a>
          {panels.map((p) => (
            <a class={`chip ${panelFilter === p.id ? "active" : ""}`} href={href("group", groupId, { panel: p.id })}>
              <PanelIcon id={p.id} size={14} /> {p.name}
            </a>
          ))}
        </div>
      </PageHeader>
      {!ids.length && (
        <div class="card col-12">
          <Empty>No results in this area yet.</Empty>
        </div>
      )}
      {shown.map((p) => {
        const pids = ids.filter((id) => TESTS[id].panel === p.id).sort((a, b) => order.indexOf(a) - order.indexOf(b));
        const numeric = pids.filter((id) => TESTS[id].kind === "numeric");
        return (
          <div class={`card ${pids.length <= 2 ? "col-6" : "col-12"} panelcard`} id={p.id}>
            <div class="cardhead">
              <h2>
                <PanelIcon id={p.id} size={14} /> {p.name}
              </h2>
              {numeric.length > 1 && (
                <div class="flex panelactions">
                  <a class="btn quiet" href={href("explore", undefined, { type: "multi", tests: numeric })} title="All these tests side by side">
                    <Columns3 size={15} strokeWidth={1.9} />
                  </a>
                  <a class="btn quiet" href={href("explore", undefined, { type: "heatmap", tests: numeric })} title="Heatmap of these tests">
                    <Grid3x3 size={15} strokeWidth={1.9} />
                  </a>
                </div>
              )}
            </div>
            <div class="tgrid">
              {pids.map((id) => (
                <TestCard testId={id} />
              ))}
            </div>
          </div>
        );
      })}
      <div class="col-12">
        <Disclaimer />
      </div>
    </>
  );
}
