/**
 * Add or edit a personal note: a day or a period of time (or one result), quick tags, free text and, unless the
 * profile is marked male, where in the menstrual cycle the sample was taken.
 */
import { useEffect, useState } from "preact/hooks";
import { TESTS } from "../lib/catalog";
import { fmtDate } from "../lib/format";
import { CYCLE_NA, DEFAULT_CYCLE, NOTE_TAGS, PHASE_LABEL, cyclePhase, newNoteId, type CycleNA, type Note, type NoteTag } from "../lib/notes";
import { useApp } from "../lib/state";
import { X } from "lucide-preact";

export function NoteDialog({ draft, onClose }: { draft: Partial<Note>; onClose: () => void }) {
  const { saveNote, deleteNote, notes, data, profile } = useApp();
  const existing = draft.id ? notes.find((n) => n.id === draft.id) : undefined;
  const today = new Date().toISOString().slice(0, 10);
  const result = draft.result_id ? data?.results.find((r) => r.id === draft.result_id) : undefined;

  const [from, setFrom] = useState(draft.from ?? today);
  const [to, setTo] = useState(draft.to ?? "");
  const [isPeriod, setIsPeriod] = useState(!!draft.to);
  const [onlyResult, setOnlyResult] = useState(!!existing?.result_id);
  const [tags, setTags] = useState<Set<NoteTag>>(new Set(draft.tags ?? []));
  const [text, setText] = useState(draft.text ?? "");
  const [periodStart, setPeriodStart] = useState(draft.period_start ?? "");
  const [cycleLength, setCycleLength] = useState(String(draft.cycle_length ?? lastCycleLength(notes) ?? DEFAULT_CYCLE));
  const [na, setNa] = useState<CycleNA | "">(draft.cycle_na ?? "");
  const showCycle = profile?.sex !== "M";

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const len = Number(cycleLength) || DEFAULT_CYCLE;
  const phase = periodStart && !na ? cyclePhase(periodStart, from, len) : null;
  const empty = !tags.size && !text.trim() && !periodStart && !na;
  const badPeriod = isPeriod && !!to && to < from;

  const toggle = (t: NoteTag) => {
    const s = new Set(tags);
    s.has(t) ? s.delete(t) : s.add(t);
    setTags(s);
  };

  const save = () => {
    const n: Note = {
      id: existing?.id ?? newNoteId(),
      from: onlyResult && result?.date ? result.date : from,
      created_at: existing?.created_at ?? new Date().toISOString(),
    };
    if (isPeriod && to && to !== from && !onlyResult) n.to = to;
    if (onlyResult && result) n.result_id = result.id;
    if (tags.size) n.tags = NOTE_TAGS.map((t) => t.id).filter((t) => tags.has(t));
    if (text.trim()) n.text = text.trim().slice(0, 1000);
    if (showCycle && na) n.cycle_na = na;
    else if (showCycle && periodStart) {
      n.period_start = periodStart;
      if (len !== DEFAULT_CYCLE) n.cycle_length = len;
    }
    saveNote(n);
    onClose();
  };

  const resultName = result?.test_id ? TESTS[result.test_id]?.name ?? result.raw_name : result?.raw_name;

  return (
    <div class="modal-back" onClick={onClose}>
      <div class="modal export" role="dialog" aria-label={existing ? "Edit note" : "Add note"} onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <div>
            <div class="modal-title">{existing ? "Edit note" : "Add a note"}</div>
            <div class="note">Context that helps read your results later, for you and your doctor. Only people who can see this profile see it.</div>
          </div>
          <button class="iconbtn" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={1.9} /></button>
        </div>
        <div class="modal-body export-body">
          {result && (
            <section>
              <div class="tlabel">About</div>
              <div class="seg fill" role="group" aria-label="About">
                <button class={!onlyResult ? "active" : ""} onClick={() => setOnlyResult(false)}>Every result {isPeriod ? "in this period" : "on this day"}</button>
                <button class={onlyResult ? "active" : ""} onClick={() => setOnlyResult(true)}>Only {resultName} {result.value_raw}</button>
              </div>
            </section>
          )}

          {!onlyResult && (
            <section>
              <div class="tlabel">When</div>
              <div class="seg fill" role="group" aria-label="When">
                <button class={!isPeriod ? "active" : ""} onClick={() => setIsPeriod(false)}>One day</button>
                <button class={isPeriod ? "active" : ""} onClick={() => { setIsPeriod(true); if (!to) setTo(from > today ? from : today); }}>A period of time</button>
              </div>
              <div class="ex-row">
                <label class="inline">{isPeriod ? "From" : "Day"} <input type="date" value={from} max={today} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} /></label>
                {isPeriod && (
                  <label class="inline">to <input type="date" value={to} min={from} onInput={(e) => setTo((e.target as HTMLInputElement).value)} /></label>
                )}
              </div>
              {badPeriod && <div class="note warntext">The end is before the start.</div>}
            </section>
          )}

          <section>
            <div class="tlabel">What was going on</div>
            <div class="chips tight">
              {NOTE_TAGS.map((t) => (
                <button class={`chip toggle ${tags.has(t.id) ? "active" : "off"}`} aria-pressed={tags.has(t.id)} onClick={() => toggle(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <textarea rows={3} maxLength={1000} placeholder="Anything else, e.g. “flu the week before”, “started vitamin D 2000 IU”, “blood taken in the afternoon”"
              value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
          </section>

          {showCycle && !onlyResult && (
            <section>
              <div class="tlabel">Menstrual cycle <span class="note">(optional)</span></div>
              <div class="ex-row">
                <label class="inline">First day of last period <input type="date" value={periodStart} max={from} disabled={!!na}
                  onInput={(e) => setPeriodStart((e.target as HTMLInputElement).value)} /></label>
                <label class="inline">Usual cycle <input type="number" min={21} max={45} value={cycleLength} disabled={!!na} style="width:64px"
                  onInput={(e) => setCycleLength((e.target as HTMLInputElement).value)} /> days</label>
              </div>
              <div class="ex-row">
                <label class="inline">Or: doesn't apply{" "}
                  <select value={na} onChange={(e) => setNa((e.target as HTMLSelectElement).value as CycleNA | "")}>
                    <option value="">—</option>
                    {CYCLE_NA.map((x) => <option value={x.id}>{x.label}</option>)}
                  </select>
                </label>
              </div>
              <div class="note">
                {phase
                  ? <>On {fmtDate(from)}: <b>{PHASE_LABEL[phase.phase]}</b> phase, day {phase.day} of the cycle.</>
                  : periodStart && !na
                    ? "That is more than a week past the expected next period, so the phase can't be worked out."
                    : "Hormone levels (estradiol, progesterone, LH, FSH…) change a lot across the cycle; the phase is shown next to those results."}
              </div>
            </section>
          )}

          <div class="export-foot">
            <div class="export-summary note">{empty ? "Pick a tag, write something or fill in the cycle to save." : ""}</div>
            <div class="export-actions">
              {existing && (
                <button class="danger" onClick={() => { deleteNote(existing.id); onClose(); }}>Delete</button>
              )}
              <button onClick={onClose}>Cancel</button>
              <button class="primary" disabled={empty || badPeriod} onClick={save}>Save note</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** the cycle length used last time, so it needn't be typed again */
function lastCycleLength(notes: Note[]): number | undefined {
  return [...notes].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).find((n) => n.cycle_length)?.cycle_length;
}
