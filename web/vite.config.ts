import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { contentSecurityPolicy } from "../infra/lib/csp.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const LOCAL = path.join(REPO, "local-data");
const PMT = path.join(REPO, "extractor", ".venv", "bin", "pmt");
const MAX_UPLOAD = 40 * 1024 * 1024;

/** ANTHROPIC_API_KEY from the environment, else (macOS) the Keychain entry the README suggests. Never logged. */
let cachedKey: string | null | undefined;
function apiKey(): string | null {
  if (cachedKey !== undefined) return cachedKey;
  cachedKey = process.env.ANTHROPIC_API_KEY || null;
  if (!cachedKey && process.platform === "darwin") {
    try {
      const service = process.env.PMT_KEYCHAIN_SERVICE || "labracadabra-anthropic";
      cachedKey = execFileSync("security", ["find-generic-password", "-s", service, "-w"], { encoding: "utf8" }).trim() || null;
    } catch {
      cachedKey = null;
    }
  }
  return cachedKey;
}

/**
 * Local twin of the Lambda: one `pmt process-inbox` run at a time per profile; anything that arrives meanwhile
 * (another upload, a corrections change) triggers one more run when it finishes.
 */
const running = new Map<string, { again: boolean }>();
function kick(profileDir: string, log: (m: string) => void) {
  const r = running.get(profileDir);
  if (r) {
    r.again = true;
    return;
  }
  running.set(profileDir, { again: false });
  const env = { ...process.env };
  const key = apiKey();
  if (key) env.ANTHROPIC_API_KEY = key;
  const p = spawn(PMT, ["process-inbox", "--data", profileDir], { env, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", (b) => log(`[pmt] ${String(b).trim()}`));
  p.stderr.on("data", (b) => {
    const s = String(b).trim();
    if (/error|traceback|failed/i.test(s)) log(`[pmt] ${s.split("\n").slice(-3).join(" | ")}`);
  });
  p.on("error", (e) => log(`[pmt] could not start ${PMT}: ${e.message} (did you create extractor/.venv?)`));
  p.on("close", () => {
    const again = running.get(profileDir)?.again;
    running.delete(profileDir);
    if (again) kick(profileDir, log);
  });
}

/**
 * Dev-only: serve ../local-data/<profile>/... (written by `pmt ingest`) and ../fixtures/demo at /local-data/...
 * so the app runs locally without AWS, accept uploads into <profile>/inbox/ and process them like the Lambda.
 * Never included in a production build.
 */
function localData(): Plugin {
  const roots = [LOCAL, path.join(REPO, "fixtures")];
  return {
    name: "pmt-local-data",
    apply: "serve",
    configureServer(server) {
      const log = (m: string) => server.config.logger.info(m);
      server.middlewares.use("/local-data", (req, res) => {
        const rel = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "");
        if (rel === "_profiles") {
          const profiles = roots.flatMap((r) =>
            fs.existsSync(r) ? fs.readdirSync(r).filter((d) => fs.existsSync(path.join(r, d, "results.json"))) : [],
          );
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify([...new Set(profiles)]));
        }

        // POST /local-data/<profile>/_upload   (headers: x-upload-id, x-file-name)
        const up = rel.match(/^([a-z0-9-]{1,40})\/_upload$/i);
        if (up && req.method === "POST") {
          const dir = path.join(LOCAL, up[1]);
          const uploadId = String(req.headers["x-upload-id"] || "");
          const name = decodeURIComponent(String(req.headers["x-file-name"] || "")).replace(/[/\\]/g, "_");
          const fail = (code: number, msg: string) => {
            res.statusCode = code;
            res.end(msg);
          };
          if (!fs.existsSync(path.join(dir, "results.json")) && !fs.existsSync(dir))
            return fail(403, "This profile is read-only (the demo profile, or not a local-data folder).");
          if (!/^[0-9a-f-]{36}$/.test(uploadId) || !name) return fail(400, "bad upload request");
          if (!apiKey()) return fail(500, "No Anthropic API key: export ANTHROPIC_API_KEY before `npm run dev` (or add the Keychain entry).");
          const chunks: Buffer[] = [];
          let size = 0;
          req.on("data", (c: Buffer) => {
            size += c.length;
            if (size <= MAX_UPLOAD) chunks.push(c);
          });
          req.on("end", () => {
            if (size > MAX_UPLOAD) return fail(413, "File too large (max 40 MB)");
            const target = path.join(dir, "inbox", uploadId, name);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, Buffer.concat(chunks));
            log(`upload ${name} (${Math.round(size / 1024)} KB) → ${up[1]}`);
            res.end("ok");
            kick(dir, log);
          });
          return;
        }

        for (const root of roots) {
          const p = path.resolve(root, rel);
          if (!p.startsWith(root + path.sep)) continue;
          if (req.method === "PUT") {
            if (root !== LOCAL) {
              res.statusCode = 403;
              return res.end("read-only");
            }
            let body = "";
            req.on("data", (c) => (body += c));
            req.on("end", () => {
              fs.mkdirSync(path.dirname(p), { recursive: true });
              const tmp = `${p}.${crypto.randomUUID()}.tmp`;
              fs.writeFileSync(tmp, body);
              fs.renameSync(tmp, p);
              res.end("ok");
              // like the Lambda: a corrections change re-builds results.json (deletions, replaced reports, edits)
              if (path.basename(p) === "corrections.json") kick(path.dirname(p), log);
            });
            return;
          }
          if (fs.existsSync(p) && fs.statSync(p).isFile()) {
            const ext = path.extname(p).toLowerCase();
            const types: Record<string, string> = { ".json": "application/json", ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
            res.setHeader("content-type", types[ext] || "application/octet-stream");
            res.setHeader("cache-control", "no-store");
            return fs.createReadStream(p).pipe(res);
          }
        }
        res.statusCode = 404;
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [preact(), localData()],
  // same CSP as CloudFront, so CSP problems show up locally too (ws: = Vite's hot-reload socket)
  server: { headers: { "Content-Security-Policy": contentSecurityPolicy(["ws:"]) } },
  preview: { headers: { "Content-Security-Policy": contentSecurityPolicy([]) } },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
