/**
 * Personal notes: context for results ("had flu", "not fasting", "started statin") and, for female profiles, where
 * in the menstrual cycle a sample was taken. Stored per profile in notes.json, written by the browser only (the
 * extractor never reads it, so saving a note costs nothing and triggers no rebuild).
 */
import type { Result } from "./types";

export type NoteTag = "sick" | "period" | "not_fasting" | "medication" | "poor_sleep" | "exercise" | "stress" | "travel";

export const NOTE_TAGS: { id: NoteTag; label: string }[] = [
  { id: "sick", label: "Sick" },
  { id: "period", label: "On period" },
  { id: "not_fasting", label: "Not fasting" },
  { id: "medication", label: "New medication" },
  { id: "poor_sleep", label: "Poor sleep" },
  { id: "exercise", label: "Exercise before test" },
  { id: "stress", label: "Stress" },
  { id: "travel", label: "Travel" },
];
export const tagLabel = (t: NoteTag) => NOTE_TAGS.find((x) => x.id === t)?.label ?? t;

/** why cycle phase doesn't apply */
export type CycleNA = "contraception" | "pregnant" | "menopause";
export const CYCLE_NA: { id: CycleNA; label: string }[] = [
  { id: "contraception", label: "Hormonal contraception" },
  { id: "pregnant", label: "Pregnant" },
  { id: "menopause", label: "After menopause" },
];

export interface Note {
  id: string;
  /** the day, or the first day of a period of time (YYYY-MM-DD) */
  from: string;
  /** last day of a period of time (inclusive); absent = one day */
  to?: string;
  /** only about this one result (otherwise about every result in from…to) */
  result_id?: string;
  text?: string;
  tags?: NoteTag[];
  /** female profiles: first day of the last period before the sample */
  period_start?: string;
  /** usual cycle length in days (default 28) */
  cycle_length?: number;
  cycle_na?: CycleNA;
  created_at: string;
}

export interface NotesFile {
  notes: Note[];
}

export const DEFAULT_CYCLE = 28;

export type Phase = "menstrual" | "follicular" | "ovulation" | "luteal";
export const PHASE_LABEL: Record<Phase, string> = {
  menstrual: "Menstrual",
  follicular: "Follicular",
  ovulation: "Around ovulation",
  luteal: "Luteal",
};

const DAY = 86400000;
const toDay = (iso: string) => Math.round(Date.parse(iso.slice(0, 10) + "T00:00:00Z") / DAY);

/**
 * Cycle day (day 1 = first day of the period) and phase on `date`. Ovulation is taken as 14 days before the next
 * period (the luteal phase is the stable one), so it moves with the cycle length. Null when the date is before the
 * period start or more than a week past the expected next period (the phase can't be told).
 */
export function cyclePhase(periodStart: string, date: string, cycleLength = DEFAULT_CYCLE): { day: number; phase: Phase } | null {
  const len = Math.min(45, Math.max(21, Math.round(cycleLength || DEFAULT_CYCLE)));
  const day = toDay(date) - toDay(periodStart) + 1;
  if (!Number.isFinite(day) || day < 1 || day > len + 7) return null;
  const ov = len - 14;
  const phase: Phase = day <= 5 ? "menstrual" : day < ov - 1 ? "follicular" : day <= ov + 1 ? "ovulation" : "luteal";
  return { day, phase };
}

/** one short line describing the cycle part of a note on a given date ("Luteal · day 21"), or "" */
export function cycleText(n: Note, date?: string): string {
  if (n.cycle_na) return CYCLE_NA.find((x) => x.id === n.cycle_na)?.label ?? "";
  if (!n.period_start) return "";
  const c = cyclePhase(n.period_start, date ?? n.from, n.cycle_length);
  return c ? `${PHASE_LABEL[c.phase]} · day ${c.day}` : "";
}

/** does the note apply to this result? (its own result, or any result dated within from…to) */
export function noteApplies(n: Note, r: Pick<Result, "id" | "date">): boolean {
  if (n.result_id) return n.result_id === r.id;
  if (!r.date) return false;
  return r.date >= n.from && r.date <= (n.to || n.from);
}

export function notesFor(notes: Note[], r: Pick<Result, "id" | "date">): Note[] {
  return notes.filter((n) => noteApplies(n, r));
}

/** everything a note says, on one line ("Sick, Not fasting · flu · Luteal · day 21") */
export function noteSummary(n: Note, date?: string): string {
  const parts = [(n.tags ?? []).map(tagLabel).join(", "), (n.text ?? "").trim(), cycleText(n, date)].filter(Boolean);
  return parts.join(" · ");
}

/** tests whose levels change markedly across the menstrual cycle: show the phase next to them */
export const CYCLE_SENSITIVE = new Set([
  "estradiol", "progesterone", "lh", "fsh", "prolactin", "testosterone_total", "testosterone_free", "shbg",
  "amh", "ferritin", "iron", "transferrin_saturation",
]);

export function newNoteId(): string {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => (b.from > a.from ? 1 : b.from < a.from ? -1 : 0));
}
