/**
 * An area page (e.g. Blood tests): test cards grouped by panel, in catalog order.
 */
import { TestCard } from "../components/TestCard";
import { Disclaimer, Empty } from "../components/bits";
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
      <div class="card col-12 headcard">
        <div class="headrow">
          <h1 class="title">
            <span class="ticon"><PanelIcon id={group.id} size={18} /></span> {group.name}
          </h1>
          <span class="note">{ids.length} tests with results</span>
        </div>
        <div class="chips">
          <a class={`chip ${!panelFilter ? "active" : ""}`} href={href("group", groupId)}>
            All
          </a>
          {panels.map((p) => (
            <a class={`chip ${panelFilter === p.id ? "active" : ""}`} href={href("group", groupId, { panel: p.id })}>
              <PanelIcon id={p.id} size={14} /> {p.name}
            </a>
          ))}
        </div>
      </div>
      {!ids.length && (
        <div class="card col-12">
          <Empty>No results in this area yet.</Empty>
        </div>
      )}
      {shown.map((p) => {
        const pids = ids.filter((id) => TESTS[id].panel === p.id).sort((a, b) => order.indexOf(a) - order.indexOf(b));
        const numeric = pids.filter((id) => TESTS[id].kind === "numeric");
        return (
          <div class="card col-12" id={p.id}>
            <div class="cardhead">
              <h2>
                <PanelIcon id={p.id} size={14} /> {p.name}
              </h2>
              {numeric.length > 1 && (
                <div class="flex">
                  <a class="btn small" href={href("explore", undefined, { type: "multi", tests: numeric })}>
                    Side by side
                  </a>
                  <a class="btn small" href={href("explore", undefined, { type: "heatmap", tests: numeric })}>
                    Heatmap
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
