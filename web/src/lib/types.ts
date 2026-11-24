/**
 * Types of the data files the extractor writes (results.json, upload status, spend log) and of user prefs.
 * Keep in sync with extractor/pmt/schema.py.
 */
export type Flag = "H" | "L" | "A";
export type Status = "ok" | "flagged" | "user_corrected" | "ignored" | "duplicate" | "superseded";

export interface Result {
  id: string;
  test_id: string | null;
  raw_name: string;
  date: string | null;
  kind: "numeric" | "qualitative" | "text";
  value?: number | null;
  censor?: "<" | ">" | "<=" | ">=";
  value_text?: string;
  unit?: string;
  value_raw: string;
  unit_raw?: string;
  ref_low?: number | null;
  ref_high?: number | null;
  ref_text?: string;
  ref_source?: "lab" | "catalog" | "user";
  flag?: Flag | null;
  lab_flag?: string;
  doc_id: string;
  page: number;
  page_type?: string;
  source_text?: string;
  lab?: string;
  section?: string;
  is_historical?: boolean;
  /** the rebuild moved this value to an earlier date: the date the report printed it under */
  date_on_report?: string;
  confidence: number;
  status: Status;
  issues?: string[];
  /** other places the same value is printed; date_on_report = a later report repeating it under its own date */
  also_in?: { doc_id: string; page: number; value_raw: string; unit_raw?: string; result_id: string; date_on_report?: string }[];
}

export interface Finding {
  id: string;
  doc_id: string;
  page: number;
  date: string | null;
  modality: string;
  body_part?: string;
  title: string;
  impression: string;
  is_abnormal?: boolean | null;
}

export interface Doc {
  id: string;
  filename: string;
  pages: number;
  media_type: string;
  uploaded_at: string;
  report_date?: string | null;
  collected_date?: string | null;
  labs: string[];
  page_types: Record<string, string>;
  status: "queued" | "processing" | "done" | "failed";
  error?: string;
  cost_usd?: number | null;
  model?: string | null;
  /** every value is already in this earlier document (re-scan / photo / re-download) */
  duplicate_of?: string | null;
  /** the user chose this newer, corrected version instead */
  superseded_by?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  demo?: boolean;
}

export interface ResultsFile {
  schema: number;
  updated_at: string;
  demo?: boolean;
  documents: Doc[];
  results: Result[];
  findings: Finding[];
  /** append-only log of extraction runs (incl. failed runs and later-removed documents) */
  spend?: SpendEntry[];
  /** questions for the user, e.g. "is this a corrected version of that report?" */
  suggestions?: Suggestion[];
}

export interface Suggestion {
  kind: "corrected_version";
  newer: string;
  older: string;
  newer_filename: string;
  older_filename: string;
  collected_date: string;
  common: number;
  only_newer: number;
  only_older: number;
  n_changed: number;
  changed: { test_id: string; name: string; newer: string; older: string; unit?: string | null }[];
}

/** progress of one upload, written by the extractor to uploads/<id>.json */
export interface UploadStatus {
  upload_id: string;
  filename: string;
  state: "processing" | "done" | "duplicate" | "failed" | "rejected";
  chunks_done?: number;
  chunks_total?: number;
  pages?: number;
  values?: number;
  cost_usd?: number | null;
  doc_id?: string;
  duplicate_of?: string | null;
  reason?: string;
  error?: string;
}

/** document-level decisions */
export type DocCorrection =
  | { action: "delete"; uploaded_at: string }
  | { action: "supersede"; by: string }
  | { action: "keep_both"; with: string };

export interface SpendEntry {
  at: string;
  doc_id: string;
  filename: string;
  pages: number;
  model: string;
  status: string; // done | failed | duplicate (removed)
  usage: Doc["usage"];
  cost_usd: number | null;
}

export interface Range {
  low?: number;
  high?: number;
}

export interface CatalogTest {
  id: string;
  name: string;
  panel: string;
  unit: string;
  kind: "numeric" | "qualitative" | "text";
  /** display unit → [a, b] with canonical = a × display + b */
  units: Record<string, [number, number]>;
  decimals?: number;
  ref?: Range;
  ref_m?: Range;
  ref_f?: Range;
  log?: boolean;
  limits?: [number, number];
  aliases?: string[];
}

export interface Panel {
  id: string;
  name: string;
  icon: string;
  children?: Panel[];
}

export interface Profile {
  /** "<pid>" in the private space, "<circleId>/<pid>" in a circle */
  id: string;
  name: string;
  sex?: "M" | "F";
  birth_year?: number;
  /** sharing circle this profile belongs to (absent = private) */
  circle?: string;
  circleName?: string;
  /** view-only membership: no uploads, corrections or removals */
  readOnly?: boolean;
}

export interface Prefs {
  units: Record<string, string>; // test_id → display unit
  pinned: string[];
  /** monthly AI-extraction budget (USD) shown on the Usage page; 0/undefined = none */
  budgetUsd?: number;
  /** per-test reference-range source; absent ⇒ refDefault */
  refs?: Record<string, RefPref>;
  /** default for tests without their own choice: each lab's printed range (default) or the latest report's */
  refDefault?: "lab" | "latest";
  /** chart options shared by every value-over-time chart */
  showTrend?: boolean;
  showRef?: boolean;
  /** tests left off the dashboards (overview, area pages, imaging, explore); still searchable and exportable */
  hidden?: string[];
  /** per-test y-axis scaling on charts */
  yScale?: Record<string, YScale>;
}

/** Where a test's reference range comes from. custom low/high are in the canonical unit. */
export interface RefPref {
  mode: "lab" | "latest" | "catalog" | "custom";
  low?: number;
  high?: number;
}

/** fit = zoom to the values · range = include the whole reference range · zero = start the axis at 0 */
export type YScale = "fit" | "range" | "zero";

export interface Corrections {
  results: Record<string, { action: "confirm" | "ignore" | "edit"; value?: number; unit?: string; test_id?: string; date?: string }>;
  aliases: Record<string, string>; // normalised raw name → test_id
  documents?: Record<string, DocCorrection>;
}
