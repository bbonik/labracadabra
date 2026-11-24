/**
 * Opens the original report at the page a value came from and highlights the value when the page has a
 * text layer (scanned pages are shown without highlight). This is how users catch transcription errors.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../lib/state";

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(
    ([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    },
  );
  return pdfjsPromise;
}

const squash = (s: string) => s.toLowerCase().replace(/[\s,]+/g, "");

export function SourceViewer() {
  const { source, openSource, data, adapter, profile } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<string>("");
  const [hits, setHits] = useState(0);
  const doc = data?.documents.find((d) => d.id === source?.doc_id);

  useEffect(() => {
    if (!source) return;
    setPage(source.page);
    setUrl(null);
    setMsg("Loading document…");
    if (!doc || !profile) {
      setMsg("Document not found.");
      return;
    }
    if (doc.demo) {
      setMsg("Demo data — there is no original document behind these synthetic values.");
      return;
    }
    let revoke: string | null = null;
    adapter.docUrl(profile.id, doc.id, doc.media_type).then((u) => {
      if (!u) return setMsg("The original file could not be loaded. Reload the page and try again.");
      if (u.startsWith("blob:")) revoke = u;
      setUrl(u);
      setMsg("");
    });
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [source?.doc_id, source?.page]);

  useEffect(() => {
    if (!url || !doc || doc.media_type !== "application/pdf" || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const lib = await loadPdfJs();
      const pdf = await lib.getDocument({ url }).promise;
      const p = await pdf.getPage(Math.min(Math.max(1, page), pdf.numPages));
      const containerW = canvasRef.current!.parentElement!.clientWidth || 800;
      const base = p.getViewport({ scale: 1 });
      const scale = Math.min(2.2, (containerW - 4) / base.width);
      const dpr = window.devicePixelRatio || 1;
      const vp = p.getViewport({ scale: scale * dpr });
      const canvas = canvasRef.current!;
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.width = `${vp.width / dpr}px`;
      canvas.style.height = `${vp.height / dpr}px`;
      const ctx = canvas.getContext("2d")!;
      await p.render({ canvasContext: ctx, viewport: vp, canvas } as never).promise;
      if (cancelled || page !== source?.page) {
        setHits(0);
        return;
      }
      // highlight: text items on the page containing the value (prefer ones on the same line as the test name)
      const tc = await p.getTextContent();
      const items = tc.items.filter((i): i is (typeof tc.items)[number] & { str: string; transform: number[]; width: number } => "str" in i);
      const needle = squash(source?.value_raw ?? "");
      const nameWord = squash((source?.raw_name ?? "").split(/[\s(/]/)[0] ?? "");
      const rows = new Map<number, string>();
      for (const it of items) {
        const y = Math.round(it.transform[5]);
        rows.set(y, (rows.get(y) ?? "") + squash(it.str));
      }
      let cand = needle ? items.filter((it) => squash(it.str).includes(needle)) : [];
      const sameLine = cand.filter((it) => nameWord && (rows.get(Math.round(it.transform[5])) ?? "").includes(nameWord));
      if (sameLine.length) cand = sameLine;
      ctx.save();
      ctx.fillStyle = "rgba(245,179,66,0.35)";
      ctx.strokeStyle = "rgba(245,140,30,0.95)";
      ctx.lineWidth = 2 * dpr;
      for (const it of cand.slice(0, 6)) {
        const tx = lib.Util.transform(vp.transform, it.transform);
        const h = Math.hypot(tx[2], tx[3]);
        const w = it.width * vp.scale;
        ctx.fillRect(tx[4] - 3, tx[5] - h - 2, w + 6, h + 5);
        ctx.strokeRect(tx[4] - 3, tx[5] - h - 2, w + 6, h + 5);
      }
      ctx.restore();
      setHits(cand.length);
      if (cand[0]) {
        const tx = lib.Util.transform(vp.transform, cand[0].transform);
        canvas.parentElement!.scrollTo({ top: Math.max(0, tx[5] / dpr - 160), behavior: "smooth" });
      }
    })().catch((e) => setMsg(`Could not render: ${e}`));
    return () => {
      cancelled = true;
    };
  }, [url, page]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => e.key === "Escape" && openSource(null);
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  if (!source) return null;
  const isPdf = doc?.media_type === "application/pdf";
  return (
    <div class="modal-back" onClick={() => openSource(null)}>
      <div class="modal" role="dialog" aria-label="Source document" onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <div>
            <div class="modal-title">{source.title}</div>
            <div class="note">
              {doc?.filename ?? "document"} · page {page}
              {doc ? ` of ${doc.pages}` : ""}
              {source.value_raw && page === source.page && (
                <> · looking for “{source.value_raw}” {isPdf && url ? (hits ? "— highlighted" : "— no text layer match (scanned page?)") : ""}</>
              )}
            </div>
          </div>
          <div class="flex">
            {isPdf && doc && (
              <>
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
                <button disabled={page >= doc.pages} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
              </>
            )}
            {url && (
              <a class="btn" href={url} target="_blank" rel="noopener">
                Open file ↗
              </a>
            )}
            <button onClick={() => openSource(null)} aria-label="Close">✕</button>
          </div>
        </div>
        <div class="modal-body">
          {msg && <div class="empty">{msg}</div>}
          {url && isPdf && <canvas ref={canvasRef} class="pdfpage" />}
          {url && !isPdf && <img src={url} class="pdfpage" alt="Original report" />}
          {source.source_text && <div class="note snippet">Transcribed from: “{source.source_text}”</div>}
        </div>
      </div>
    </div>
  );
}
