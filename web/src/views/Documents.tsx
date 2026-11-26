/**
 * Documents: upload reports (drag and drop or camera), follow extraction progress, handle duplicates and
 * corrected re-issues, and delete reports.
 */
import { useRef, useState } from "preact/hooks";
import { Empty } from "../components/bits";
import { fmtDate } from "../lib/format";
import { href, useRoute } from "../lib/router";
import { useApp, type UploadItem } from "../lib/state";
import type { Doc } from "../lib/types";
import { PageIcon } from "../components/icons";
import { Upload } from "lucide-preact";

const PAGE_TYPE_LABEL: Record<string, string> = {
  lab_results: "lab",
  summary: "summary",
  ecg: "ECG",
  imaging: "imaging",
  narrative: "text",
  cover: "cover",
  other: "other",
};

const ACCEPT = /\.(pdf|png|jpe?g|webp|gif)$/i;

function uploadLine(u: UploadItem): { pill: string; cls: string; text: string } {
  const st = u.status;
  switch (u.state) {
    case "checking":
      return { pill: "checking", cls: "idle", text: "Checking whether this file is already here…" };
    case "uploading":
      return { pill: "uploading", cls: "warn", text: "Sending to your private storage…" };
    case "queued":
      return { pill: "waiting", cls: "warn", text: "Uploaded. Waiting for the extractor to start…" };
    case "processing":
      return {
        pill: "extracting",
        cls: "warn",
        text: st?.chunks_total
          ? `Reading ${st.pages} page${st.pages === 1 ? "" : "s"} · part ${Math.min((st.chunks_done ?? 0) + 1, st.chunks_total)} of ${st.chunks_total}${st.chunks_done ? ` (${st.chunks_done} done)` : ""}`
          : "Reading the document…",
      };
    case "done":
      return {
        pill: "done",
        cls: "ok",
        text: st?.duplicate_of
          ? `Done — but every value was already in another report, so it is marked as a duplicate.${st.cost_usd != null ? ` Cost $${st.cost_usd.toFixed(2)}.` : ""}`
          : `${st?.values ?? 0} values extracted from ${st?.pages ?? "?"} page${st?.pages === 1 ? "" : "s"}${st?.cost_usd != null ? ` · $${st.cost_usd.toFixed(2)}` : ""}`,
      };
    case "duplicate":
      return {
        pill: "duplicate",
        cls: "idle",
        text: `Same ${st?.reason === "same content" ? "content" : "file"} as “${st?.duplicate_of}” — skipped, no cost.`,
      };
    case "skipped":
      return { pill: "already here", cls: "idle", text: u.message ?? "Already uploaded." };
    case "rejected":
      return { pill: "rejected", cls: "err", text: u.message ?? "Not a supported file." };
    default:
      return { pill: "failed", cls: "err", text: u.message ?? "Something went wrong." };
  }
}

export function Documents() {
  // arrived from the "+ Add report" button: point at the drop zone
  const wantUpload = useRoute().params.get("upload") === "1";
  const { data, adapter, profile, openSource, uploads, startUploads, clearUploads, decideDoc, canEdit } = useApp();
  const [msg, setMsg] = useState("");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!data || !profile) return null;
  const docs = [...data.documents].sort((a, b) => ((b.collected_date ?? b.uploaded_at) > (a.collected_date ?? a.uploaded_at) ? 1 : -1));
  const byId = new Map(data.documents.map((d) => [d.id, d]));
  const counts = new Map<string, number>();
  for (const r of data.results) if (r.status !== "superseded") counts.set(r.doc_id, (counts.get(r.doc_id) ?? 0) + 1);
  const totalCost = (data.spend ?? []).reduce((s, x) => s + (x.cost_usd ?? 0), 0) || docs.reduce((s, d) => s + (d.cost_usd ?? 0), 0);
  const mine = uploads.filter((u) => u.profile === profile.id);
  const readOnly = !canEdit;

  const pick = (files: FileList | File[]) => {
    const list = [...files];
    const ok = list.filter((f) => ACCEPT.test(f.name) || /pdf|image\//.test(f.type));
    const bad = list.length - ok.length;
    setMsg(bad ? `${bad} file(s) skipped: only PDF and image files (PNG, JPG, WebP, GIF) are supported.` : "");
    if (ok.length) startUploads(ok);
  };

  const remove = (d: Doc) => {
    const n = counts.get(d.id) ?? 0;
    if (!confirm(`Remove “${d.filename}” and its ${n} value${n === 1 ? "" : "s"} from ${profile.name}'s records?\n\nThe original file is deleted too. You can upload it again later.`)) return;
    decideDoc(d.id, { action: "delete", uploaded_at: d.uploaded_at || new Date().toISOString() });
  };

  return (
    <>
      <div class="card col-12 headcard">
        <div class="headrow">
          <h1 class="title">
            <span class="ticon"><PageIcon name="documents" /></span> Documents
          </h1>
          <span class="note">
            {docs.length} reports · {data.results.filter((r) => r.status !== "superseded").length} extracted values
            {totalCost ? (
              <>
                {" "}
                · AI cost so far <a href={href("usage")}>${totalCost.toFixed(2)}</a>
              </>
            ) : (
              ""
            )}
          </span>
        </div>
      </div>

      <div class="card col-12">
        {readOnly ? (
          <div class="dropzone disabled">
            <span class="dz-ico"><Upload size={22} strokeWidth={1.8} /></span>
            <div class="rowtitle">Drop lab reports here, or click to choose</div>
            <div class="note">PDF, JPG or PNG · any lab, unit or language · up to 100 pages · about $0.02 per page</div>
            <div class="note dz-off">
              {data.demo
                ? "This is the synthetic demo profile: uploads go to your own profiles."
                : `View-only access to ${profile.circleName ?? "this circle"}: ask an editor to upload new reports.`}
            </div>
          </div>
        ) : (
          <>
            <div class="flex between wrapflex" style={{ marginBottom: "10px" }}>
              <span>
                Uploading to <b>{profile.name}</b>
                {profile.circle && <span class="pill info" style={{ marginLeft: "6px" }}>shared in {profile.circleName}</span>}
                <span class="note"> — switch profile at the top right to file a report for someone else.</span>
              </span>
            </div>
            <div
              class={`dropzone ${drag ? "drag" : ""} ${wantUpload ? "pulse" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                if (e.dataTransfer?.files) pick(e.dataTransfer.files);
              }}
              onClick={() => fileRef.current?.click()}
            >
              <span class="dz-ico"><Upload size={22} strokeWidth={1.8} /></span>
              <div class="rowtitle">Drop lab reports here, or click to choose</div>
              <div class="note">PDF, JPG or PNG · any lab, unit or language · up to 100 pages · about $0.02 per page</div>
              <div class="note">
                {adapter.mode === "aws"
                  ? "Files go straight to your private storage. Values appear here automatically, usually within 1–3 minutes."
                  : "Local mode: files are saved under local-data/ and extracted on this computer with your API key."}{" "}
                A report you already uploaded is recognised and not paid for twice.
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/*"
                multiple
                hidden
                onChange={(e) => {
                  const f = (e.target as HTMLInputElement).files;
                  if (f) pick(f);
                  (e.target as HTMLInputElement).value = "";
                }}
              />
            </div>
            {msg && <p class="note">{msg}</p>}
          </>
        )}

        {mine.length > 0 && (
          <div class="uploads">
            <div class="flex between">
              <h2 style={{ margin: 0 }}>This session's uploads</h2>
              <button class="linkbtn" onClick={clearUploads}>
                clear finished
              </button>
            </div>
            {mine.map((u) => {
              const l = uploadLine(u);
              const st = u.status;
              const doc = st?.doc_id ? byId.get(st.doc_id) : undefined;
              const pct = u.state === "processing" && st?.chunks_total ? Math.round(((st.chunks_done ?? 0) / st.chunks_total) * 100) : null;
              return (
                <div class="upload-row">
                  <span class={`pill ${l.cls}`}>{l.pill}</span>
                  <div class="upload-main">
                    <div class="rowtitle">{u.name}</div>
                    <div class="note">{l.text}</div>
                    {pct != null && (
                      <div class="meter">
                        <span style={{ width: `${Math.max(4, pct)}%` }} />
                      </div>
                    )}
                  </div>
                  {u.state === "done" && doc && (
                    <button class="linkbtn" onClick={() => openSource({ doc_id: doc.id, page: 1, title: doc.filename })}>
                      open
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div class="card col-12">
        {!docs.length && <Empty>No documents yet.</Empty>}
        {docs.length > 0 && (
          <div class="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Collected</th>
                  <th>File</th>
                  <th>Lab / clinic</th>
                  <th class="num">Pages</th>
                  <th class="num">Values</th>
                  <th class="num">AI cost</th>
                  <th></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const types = Object.values(d.page_types ?? {}).reduce<Record<string, number>>((m, t) => ((m[t] = (m[t] ?? 0) + 1), m), {});
                  const dupOf = d.duplicate_of ? byId.get(d.duplicate_of) : undefined;
                  const repl = d.superseded_by ? byId.get(d.superseded_by) : undefined;
                  return (
                    <tr class={d.duplicate_of || d.superseded_by ? "rowdim" : ""}>
                      <td class="nowrap">{fmtDate(d.collected_date ?? d.report_date)}</td>
                      <td>
                        <button class="linkbtn" onClick={() => openSource({ doc_id: d.id, page: 1, title: d.filename })}>
                          {d.filename}
                        </button>
                        {dupOf && <div class="note">duplicate of “{dupOf.filename}” — its values were already there</div>}
                        {repl && <div class="note">replaced by the corrected version “{repl.filename}”</div>}
                        {d.status === "failed" && d.error && <div class="note">{d.error}</div>}
                      </td>
                      <td class="note">{d.labs.join(", ")}</td>
                      <td class="num" title={Object.entries(types).map(([k, v]) => `${v} ${PAGE_TYPE_LABEL[k] ?? k}`).join(", ")}>
                        {d.pages}
                      </td>
                      <td class="num">{counts.get(d.id) ?? 0}</td>
                      <td class="num">{d.cost_usd != null ? "$" + d.cost_usd.toFixed(2) : "—"}</td>
                      <td>
                        {d.superseded_by ? (
                          <span class="pill idle">replaced</span>
                        ) : d.duplicate_of ? (
                          <span class="pill idle">duplicate</span>
                        ) : d.status === "done" ? null : (
                          <span class={`pill ${d.status === "failed" ? "err" : "warn"}`}>{d.status}</span>
                        )}
                      </td>
                      <td>
                        {!readOnly && (
                          <button class="linkbtn" title="Remove this document and its values" onClick={() => remove(d)}>
                            remove
                          </button>
                        )}
                        {d.superseded_by && !readOnly && (
                          <button class="linkbtn" title="Use this version's values again" onClick={() => decideDoc(d.id, null)}>
                            restore
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
