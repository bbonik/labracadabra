/**
 * Application state (Preact context): loaded results, the current profile, user preferences (units,
 * reference-range choices, theme), uploads in progress, and derived per-test series.
 */
import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { analyze, type SeriesPoint, type SeriesStats } from "../analytics/patterns";
import type { DataAdapter } from "./adapter";
import { TESTS, catalogRef, displayUnit, fromDisplay, normName, refFor, toDisplay } from "./catalog";
import type { Note, NotesFile } from "./notes";
import type { Corrections, DocCorrection, Doc, Prefs, Profile, RefPref, Result, ResultsFile, UploadStatus } from "./types";

export type Theme = "auto" | "light" | "paper" | "navy" | "graphite";

export interface SourceTarget {
  doc_id: string;
  page: number;
  title: string;
  source_text?: string;
  value_raw?: string;
  raw_name?: string;
}

interface Ctx {
  adapter: DataAdapter;
  profiles: Profile[];
  profile: Profile | null;
  setProfileId: (id: string) => void;
  data: ResultsFile | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  corrections: Corrections;
  correct: (resultId: string, c: Corrections["results"][string] | null) => void;
  addAlias: (rawName: string, testId: string) => void;
  /** document-level decision (remove, use corrected version, keep both); null clears it */
  decideDoc: (docId: string, c: DocCorrection | null) => void;
  /** personal notes (context for results, cycle phase), newest first is up to the views */
  notes: Note[];
  /** add or replace a note (by id) */
  saveNote: (n: Note) => void;
  deleteNote: (id: string) => void;
  /** open the note editor; `draft` pre-fills it (a date, a result) or edits an existing note */
  editNote: (draft: Partial<Note> | null) => void;
  noteDraft: Partial<Note> | null;
  /** false for view-only circle members and the demo: hides uploads, corrections and removals */
  canEdit: boolean;
  /** files being uploaded in this session, newest first */
  uploads: UploadItem[];
  startUploads: (files: File[]) => void;
  clearUploads: () => void;
  theme: Theme;
  resolvedTheme: string;
  setTheme: (t: Theme) => void;
  printing: boolean;
  setPrinting: (b: boolean) => void;
  source: SourceTarget | null;
  openSource: (s: SourceTarget | null) => void;
  /** visible results grouped by test (excludes ignored), each list sorted by date */
  byTest: Map<string, Result[]>;
  /** byTest without the tests the user hid from the dashboards in Settings */
  shownByTest: Map<string, Result[]>;
  series: (testId: string, unit?: string) => SeriesPoint[];
  stats: (testId: string) => SeriesStats;
  /** effective reference-range choice for a test (per-test pref, else the global default) */
  refPref: (testId: string) => RefPref;
  /** distinct ranges the labs printed for a test (canonical units), most recent first */
  labRanges: (testId: string) => LabRange[];
  user?: string;
  onLogout?: () => void;
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

const EMPTY_PREFS: Prefs = { units: {}, pinned: [] };
const EMPTY_CORR: Corrections = { results: {}, aliases: {} };

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

/** Mirror of the server-side correction logic so edits show up immediately (server rebuild is authoritative). */
export interface LabRange {
  low?: number;
  high?: number;
  labs: string[];
  n: number;
  last: string;
}

export function refPrefFor(testId: string, prefs: Prefs): RefPref {
  return prefs.refs?.[testId] ?? { mode: prefs.refDefault ?? "lab" };
}

/**
 * Apply the user's reference-range choice: replaces ref_low/ref_high and recomputes the H/L flag for numeric results.
 * "lab" keeps each report's printed range (and the lab's own flag) untouched.
 */
function applyRefPrefs(results: Result[], prefs: Prefs, sex?: "M" | "F"): Result[] {
  const latest = new Map<string, Result>();
  for (const r of results)
    if (r.test_id && r.kind === "numeric" && r.ref_source === "lab" && r.date && r.status !== "ignored" && (!latest.has(r.test_id) || r.date > latest.get(r.test_id)!.date!))
      latest.set(r.test_id, r);
  return results.map((r) => {
    if (!r.test_id || r.kind !== "numeric" || !TESTS[r.test_id]) return r;
    const p = refPrefFor(r.test_id, prefs);
    let lo: number | undefined, hi: number | undefined, src: Result["ref_source"];
    if (p.mode === "lab") return r;
    if (p.mode === "latest") {
      const l = latest.get(r.test_id);
      if (!l) return r; // no lab printed a range: keep what we have
      [lo, hi, src] = [l.ref_low ?? undefined, l.ref_high ?? undefined, "lab"];
    } else if (p.mode === "catalog") {
      const c = catalogRef(r.test_id, sex);
      [lo, hi, src] = [c.low, c.high, "catalog"];
    } else {
      [lo, hi, src] = [p.low, p.high, "user"];
    }
    const v = r.value;
    let flag: Result["flag"] = null;
    if (v != null && !r.censor) flag = hi != null && v > hi ? "H" : lo != null && v < lo ? "L" : null;
    else if (v != null && r.censor) flag = r.censor.startsWith("<") && lo != null && v <= lo ? "L" : r.censor.startsWith(">") && hi != null && v >= hi ? "H" : null;
    return { ...r, ref_low: lo ?? null, ref_high: hi ?? null, ref_source: src, flag };
  });
}

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  profile: string;
  docId?: string;
  /** checking → uploading → queued → processing → done | duplicate | failed | rejected | skipped */
  state: "checking" | "uploading" | "queued" | "processing" | "done" | "duplicate" | "failed" | "rejected" | "skipped";
  status?: UploadStatus;
  message?: string;
  startedAt: number;
}
const TERMINAL = new Set(["done", "duplicate", "failed", "rejected", "skipped"]);

async function sha256Hex(file: File): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** documents the user removed (only copies uploaded before the removal) or replaced by a corrected version */
export function hiddenDocs(docs: Doc[], c: Corrections): Set<string> {
  const out = new Set<string>();
  for (const d of docs) {
    const x = c.documents?.[d.id];
    if (!x) continue;
    if (x.action === "delete" && (!x.uploaded_at || (d.uploaded_at || "") <= x.uploaded_at)) out.add(d.id);
    if (x.action === "supersede") out.add(d.id);
  }
  return out;
}

function applyCorrections(results: Result[], c: Corrections, hidden: Set<string> = new Set()): Result[] {
  return results.map((r) => {
    if (hidden.has(r.doc_id)) return { ...r, status: "superseded" as const }; // shown immediately; rebuild confirms
    let out = r;
    const alias = c.aliases[normName(r.raw_name)];
    if (alias && r.test_id !== alias) out = { ...out, test_id: alias, status: "user_corrected", issues: [] };
    const x = c.results[r.id];
    if (!x) return out;
    if (x.action === "ignore") return { ...out, status: "ignored" };
    if (x.action === "confirm") return { ...out, status: "user_corrected", issues: [] };
    const testId = x.test_id ?? out.test_id;
    out = { ...out, test_id: testId, status: "user_corrected", issues: [] };
    if (x.value != null && testId && TESTS[testId]) {
      const v = fromDisplay(x.value, testId, x.unit ?? TESTS[testId].unit);
      out.value = v;
      out.unit = TESTS[testId].unit;
      out.censor = undefined;
      out.flag = out.ref_high != null && v > out.ref_high ? "H" : out.ref_low != null && v < out.ref_low ? "L" : null;
    }
    if (x.date) out.date = x.date;
    return out;
  });
}

export function AppProvider(props: { adapter: DataAdapter; user?: string; onLogout?: () => void; children: ComponentChildren }) {
  const { adapter } = props;
  const [profiles, setProfiles] = useState<Profile[]>([]);
  // ?profile=<id> opens a specific profile (e.g. the synthetic demo for screenshots), else the last one used
  const [profileId, setProfileIdState] = useState<string | null>(new URLSearchParams(location.search).get("profile") || lsGet("pmt.profile"));
  const [raw, setRaw] = useState<ResultsFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(EMPTY_PREFS);
  const [corrections, setCorrections] = useState<Corrections>(EMPTY_CORR);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteDraft, editNote] = useState<Partial<Note> | null>(null);
  const [theme, setThemeState] = useState<Theme>((lsGet("pmt.theme") as Theme) || "auto");
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const [source, openSource] = useState<SourceTarget | null>(null);
  const [nonce, setNonce] = useState(0);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const fn = () => setSystemDark(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  const urlTheme = new URLSearchParams(location.search).get("theme");
  const resolvedTheme = printing ? "light" : urlTheme || (theme === "auto" ? (systemDark ? "navy" : "light") : theme);
  // set synchronously during render so child effects (charts) read the new theme's CSS variables
  if (document.documentElement.dataset.theme !== resolvedTheme) document.documentElement.dataset.theme = resolvedTheme;

  useEffect(() => {
    adapter
      .listProfiles()
      .then((ps) => {
        setProfiles(ps);
        if (!ps.length) setLoading(false);
        setProfileIdState((cur) => (cur && ps.some((p) => p.id === cur) ? cur : ps[0]?.id ?? null));
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [adapter]);

  useEffect(() => {
    if (!profileId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      adapter.getJSON<ResultsFile>(profileId, "results.json"),
      adapter.getPrefs(profileId),
      adapter.getJSON<Corrections>(profileId, "corrections.json"),
      adapter.getJSON<NotesFile>(profileId, "notes.json").catch(() => null),
    ])
      .then(([r, p, c, n]) => {
        if (!alive) return;
        setRaw(r ?? { schema: 1, updated_at: "", documents: [], results: [], findings: [] });
        setPrefsState({ ...EMPTY_PREFS, ...(p ?? {}) });
        setCorrections({ ...EMPTY_CORR, ...(c ?? {}) });
        setNotes(Array.isArray(n?.notes) ? n!.notes : []);
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [adapter, profileId, nonce]);

  const profile = profiles.find((p) => p.id === profileId) ?? null;

  // corrections applied, reference ranges still as printed by each lab
  const corrected = useMemo<ResultsFile | null>(
    () => {
      if (!raw) return null;
      const hidden = hiddenDocs(raw.documents, corrections);
      const removed = new Set([...hidden].filter((id) => corrections.documents?.[id]?.action === "delete"));
      return {
        ...raw,
        documents: raw.documents.filter((d) => !removed.has(d.id)),
        results: applyCorrections(raw.results, corrections, hidden),
        suggestions: (raw.suggestions ?? []).filter((s) => !hidden.has(s.newer) && !hidden.has(s.older) &&
          !(corrections.documents?.[s.newer]?.action === "keep_both")),
      };
    },
    [raw, corrections],
  );
  // …then the user's reference-range choice (this is what every view shows)
  const data = useMemo<ResultsFile | null>(
    () => (corrected ? { ...corrected, results: applyRefPrefs(corrected.results, prefs, profile?.sex) } : null),
    [corrected, prefs, profile],
  );

  const labRanges = useCallback(
    (testId: string): LabRange[] => {
      const m = new Map<string, LabRange>();
      for (const r of corrected?.results ?? []) {
        if (r.test_id !== testId || r.ref_source !== "lab" || r.status === "ignored" || !r.date) continue;
        const k = `${r.ref_low ?? ""}|${r.ref_high ?? ""}`;
        const e = m.get(k) ?? { low: r.ref_low ?? undefined, high: r.ref_high ?? undefined, labs: [], n: 0, last: "" };
        e.n++;
        if (r.lab && !e.labs.includes(r.lab)) e.labs.push(r.lab);
        if (r.date > e.last) e.last = r.date;
        m.set(k, e);
      }
      return [...m.values()].sort((a, b) => (b.last > a.last ? 1 : -1));
    },
    [corrected],
  );

  const byTest = useMemo(() => {
    const m = new Map<string, Result[]>();
    for (const r of data?.results ?? []) {
      if (!r.test_id || !r.date || r.status === "ignored" || r.status === "duplicate" || r.status === "superseded") continue;
      if (!m.has(r.test_id)) m.set(r.test_id, []);
      m.get(r.test_id)!.push(r);
    }
    for (const list of m.values()) list.sort((a, b) => (a.date! < b.date! ? -1 : 1));
    return m;
  }, [data]);

  const shownByTest = useMemo(() => {
    const hidden = new Set(prefs.hidden ?? []);
    return hidden.size ? new Map([...byTest].filter(([id]) => !hidden.has(id))) : byTest;
  }, [byTest, prefs.hidden]);

  const series = useCallback(
    (testId: string, unit?: string): SeriesPoint[] => {
      const u = unit ?? displayUnit(testId, prefs);
      return (byTest.get(testId) ?? [])
        .filter((r) => r.value != null && r.kind !== "text")
        .map((r) => {
          const ref = refFor(r, profile?.sex);
          return {
            id: r.id,
            date: r.date!,
            value: toDisplay(r.value!, testId, u),
            low: ref.low != null ? toDisplay(ref.low, testId, u) : undefined,
            high: ref.high != null ? toDisplay(ref.high, testId, u) : undefined,
            censored: !!r.censor,
            censor: r.censor,
          };
        });
    },
    [byTest, prefs, profile],
  );

  const statsCache = useMemo(() => new Map<string, SeriesStats>(), [series]);
  const stats = useCallback(
    (testId: string) => {
      let s = statsCache.get(testId);
      if (!s) {
        const t = TESTS[testId];
        s = t?.kind === "numeric" ? analyze(series(testId), { logScale: !!t.log }) : analyze([]);
        statsCache.set(testId, s);
      }
      return s;
    },
    [statsCache, series],
  );

  const setPrefs = (p: Prefs) => {
    setPrefsState(p);
    if (profileId) adapter.putPrefs(profileId, p).catch(() => undefined);
  };

  const saveCorrections = (c: Corrections) => {
    setCorrections(c);
    if (profileId) adapter.putJSON(profileId, "corrections.json", c).catch((e) => setError(String(e)));
  };

  const saveNotes = (list: Note[]) => {
    setNotes(list);
    if (profileId) adapter.putJSON(profileId, "notes.json", { notes: list } satisfies NotesFile).catch((e) => setError(String(e)));
  };
  const saveNote = (n: Note) => saveNotes([...notes.filter((x) => x.id !== n.id), n]);
  const deleteNote = (id: string) => saveNotes(notes.filter((x) => x.id !== id));

  const correct = (resultId: string, c: Corrections["results"][string] | null) => {
    const results = { ...corrections.results };
    if (c) results[resultId] = c;
    else delete results[resultId];
    saveCorrections({ ...corrections, results });
  };

  const decideDoc = (docId: string, c: DocCorrection | null) => {
    const documents = { ...(corrections.documents ?? {}) };
    if (c) documents[docId] = c;
    else delete documents[docId];
    saveCorrections({ ...corrections, documents });
  };

  // ───── uploads: kept here so they survive navigating between pages ─────
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const uploadsRef = useRef(uploads);
  const [pollTick, setPollTick] = useState(0); // re-arms polling even when a round found no change
  uploadsRef.current = uploads;
  const patch = (id: string, p: Partial<UploadItem>) => setUploads((us) => us.map((u) => (u.id === id ? { ...u, ...p } : u)));

  const startUploads = (files: File[]) => {
    if (!profileId) return;
    const pid = profileId;
    const known = new Map((raw?.documents ?? []).filter((d) => d.status !== "failed").map((d) => [d.id, d]));
    const items: UploadItem[] = files.map((f) => ({ id: crypto.randomUUID(), name: f.name, size: f.size, profile: pid, state: "checking", startedAt: Date.now() }));
    setUploads((us) => [...items, ...us]);
    // sequentially: keeps the order predictable and the Lambda queue small
    (async () => {
      for (const [i, f] of files.entries()) {
        const it = items[i];
        try {
          const docId = (await sha256Hex(f)).slice(0, 16); // same id the extractor gives the document
          const dup = known.get(docId);
          if (dup) {
            patch(it.id, { state: "skipped", docId, message: `Already uploaded as “${dup.filename}” — not sent again, no cost.` });
            continue;
          }
          patch(it.id, { state: "uploading", docId });
          await adapter.upload(pid, f, it.id);
          patch(it.id, { state: "queued" });
        } catch (e) {
          patch(it.id, { state: "failed", message: String((e as Error).message ?? e) });
        }
      }
    })();
  };
  const clearUploads = () => setUploads((us) => us.filter((u) => !TERMINAL.has(u.state)));

  // poll progress of uploads that are in flight; reload the data when one finishes
  useEffect(() => {
    const active = uploads.filter((u) => u.state === "queued" || u.state === "processing");
    if (!active.length) return;
    const t = setTimeout(async () => {
      let finished = false;
      for (const u of active) {
        const st = await adapter.getJSON<UploadStatus>(u.profile, `uploads/${u.id}.json`).catch(() => null);
        if (!st) {
          if (Date.now() - u.startedAt > 20 * 60_000)
            patch(u.id, { state: "failed", message: "No response from the extractor after 20 minutes. Try again, or check the alerts email." });
          continue;
        }
        const state = st.state === "processing" ? "processing" : st.state;
        if (TERMINAL.has(state)) finished = true;
        patch(u.id, { state, status: st, message: st.error });
      }
      if (finished) setNonce((n) => n + 1);
      setPollTick((n) => n + 1); // keep polling: on AWS the status file appears only after the Lambda starts
    }, 2500);
    return () => clearTimeout(t);
  }, [uploads, adapter, pollTick]);

  const addAlias = (rawName: string, testId: string) =>
    saveCorrections({ ...corrections, aliases: { ...corrections.aliases, [normName(rawName)]: testId } });

  const setTheme = (t: Theme) => {
    setThemeState(t);
    lsSet("pmt.theme", t);
  };

  const setProfileId = (id: string) => {
    setProfileIdState(id);
    lsSet("pmt.profile", id);
  };

  const value: Ctx = {
    adapter,
    profiles,
    profile,
    setProfileId,
    data,
    loading,
    error,
    reload: () => setNonce((n) => n + 1),
    prefs,
    setPrefs,
    corrections,
    correct,
    addAlias,
    decideDoc,
    notes,
    saveNote,
    deleteNote,
    editNote,
    noteDraft,
    canEdit: !!profile && !profile.readOnly && !raw?.demo,
    uploads,
    startUploads,
    clearUploads,
    theme,
    resolvedTheme,
    setTheme,
    printing,
    setPrinting,
    source,
    openSource,
    byTest,
    shownByTest,
    series,
    stats,
    refPref: (testId: string) => refPrefFor(testId, prefs),
    labRanges,
    user: props.user,
    onLogout: props.onLogout,
  };
  return <AppCtx.Provider value={value}>{props.children}</AppCtx.Provider>;
}
