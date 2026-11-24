/** A result's notes as small chips (spans, not buttons, so they still print). Click one to edit it. */
import { cycleText, tagLabel, type Note } from "../lib/notes";
import { useApp } from "../lib/state";

export function NoteChips({ notes, date }: { notes: Note[]; date?: string | null }) {
  const { canEdit, editNote } = useApp();
  if (!notes.length) return null;
  return (
    <>
      {notes.map((n) => {
        const cyc = cycleText(n, date ?? undefined);
        const words = [(n.tags ?? []).map(tagLabel).join(", "), (n.text ?? "").trim()].filter(Boolean).join(" · ");
        return (
          <span
            class={`notechip ${canEdit ? "" : "ro"}`}
            role={canEdit ? "button" : undefined}
            tabIndex={canEdit ? 0 : undefined}
            title={canEdit ? "Edit note" : undefined}
            onClick={canEdit ? () => editNote(n) : undefined}
            onKeyDown={canEdit ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), editNote(n)) : undefined}
          >
            {words}
            {words && cyc ? " · " : ""}
            {cyc && <span class="phase">{cyc}</span>}
          </span>
        );
      })}
    </>
  );
}
