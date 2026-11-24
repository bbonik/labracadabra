/** All personal notes for the profile, newest first: add, edit, delete; how many results each one explains. */
import { NoteChips } from "../components/NoteChips";
import { Disclaimer, Empty } from "../components/bits";
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
      <div class="card col-12">
        <div class="cardhead">
          <h2>Notes</h2>
          {canEdit && <button class="primary" onClick={() => editNote({})}>Add a note</button>}
        </div>
        <p class="note">
          What was going on around a test, e.g. being sick, not fasting, a new medication, or (for women) the phase of the menstrual
          cycle. Notes show next to the results they explain, on the charts and in exports, so you and your doctor can read
          the numbers in context.{" "}
          {canEdit ? "You can also add a note from any result on a test's page." : profile?.readOnly ? "You can view this profile's notes but not change them." : ""}
        </p>
      </div>

      <div class="card col-12 note-list">
        {!list.length && <Empty>No notes yet.</Empty>}
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
