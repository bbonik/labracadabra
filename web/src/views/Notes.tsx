/** All personal notes for the profile, newest first: add, edit, delete; how many results each one explains. */
import { NoteChips } from "../components/NoteChips";
import { Disclaimer, PageHeader } from "../components/bits";
import { PageIcon } from "../components/icons";
import { NotebookPen } from "lucide-preact";
import { TESTS } from "../lib/catalog";
import { fmtDate } from "../lib/format";
import { noteApplies, sortNotes } from "../lib/notes";
import { href } from "../lib/router";
import { useApp } from "../lib/state";

export function Notes() {
  const { notes, data, canEdit, editNote, profile } = useApp();
  const results = (data?.results ?? []).filter((r) => r.test_id && r.date && !["ignored", "duplicate", "superseded"].includes(r.status));
  const list = sortNotes(notes);

  return (
    <>
      <PageHeader
        icon={<PageIcon name="notes" />}
        title="Notes"
        meta={list.length ? `${list.length} note${list.length === 1 ? "" : "s"}` : undefined}
        actions={canEdit && list.length > 0 && <button class="primary" onClick={() => editNote({})}>Add a note</button>}
      >
        What was going on around a test: being sick, not fasting, a new medication or the phase of the menstrual cycle.
        Notes appear next to the results they explain, on the charts and in exports.
        {profile?.readOnly ? " You can view this profile's notes but not change them." : ""}
      </PageHeader>

      <div class="card col-12 note-list">
        {!list.length && (
          <div class="emptystate">
            <span class="emptyicon"><NotebookPen size={22} strokeWidth={1.7} /></span>
            <div class="rowtitle">No notes yet</div>
            <div class="note">
              For example: “Flu the week before”, “Not fasting”, “Started vitamin D 2000 IU”. You can also add a note from
              any result on a test's page.
            </div>
            {canEdit ? (
              <button class="primary" onClick={() => editNote({})}>Add your first note</button>
            ) : (
              <span class="note">Only editors of this profile can add notes.</span>
            )}
          </div>
        )}
        {list.map((n) => {
          const covered = results.filter((r) => noteApplies(n, r));
          const one = n.result_id ? data?.results.find((r) => r.id === n.result_id) : undefined;
          return (
            <div class="row">
              <div class="when">
                <b>{fmtDate(n.from)}</b>
                {n.to && n.to !== n.from && <> – <b>{fmtDate(n.to)}</b></>}
                <div class="note">
                  {one?.test_id
                    ? <>only <a href={href("test", one.test_id)}>{TESTS[one.test_id]?.name}</a> {one.value_raw}</>
                    : `${covered.length} result${covered.length === 1 ? "" : "s"}`}
                </div>
              </div>
              <div class="what">
                <NoteChips notes={[n]} date={n.from} />
              </div>
            </div>
          );
        })}
      </div>
      <div class="col-12">
        <Disclaimer />
      </div>
    </>
  );
}
