/**
 * Data access. Each profile is a folder:  results.json, corrections.json, docs/<id>.<ext>, status/, uploads/, …
 * A profile lives either in the user's PRIVATE space or in a sharing CIRCLE:
 *     users/<identityId>/profiles/<pid>/…        profile key "<pid>"
 *     circles/<circleId>/profiles/<pid>/…        profile key "<circleId>/<pid>"
 * Display preferences are per user (prefs live in the user's private space), so circle members don't overwrite
 * each other's units or ranges, and view-only members can still have their own.
 *
 *   LocalAdapter — dev server middleware over ../local-data and ../fixtures (no AWS, no sign-in)
 *   S3Adapter    — direct S3 access with Cognito Identity Pool credentials: one set for the private space and
 *                  one per circle the user belongs to (IAM decides read/write vs read-only, not this code)
 */
import type { AwsConfig } from "./config";
import type { Prefs, Profile } from "./types";

export interface Space {
  /** null = the user's private space */
  circle: string | null;
  name: string;
  writable: boolean;
}

export interface DataAdapter {
  readonly mode: "local" | "aws";
  readonly canUpload: boolean;
  listProfiles(): Promise<Profile[]>;
  /** where new profiles can be created */
  spaces(): Space[];
  addProfile(name: string, circle: string | null): Promise<void>;
  getJSON<T>(profile: string, key: string): Promise<T | null>;
  putJSON(profile: string, key: string, value: unknown): Promise<void>;
  getPrefs(profile: string): Promise<Prefs | null>;
  putPrefs(profile: string, prefs: Prefs): Promise<void>;
  /** URL (object URL or signed URL) for an original document */
  docUrl(profile: string, docId: string, mediaType: string): Promise<string | null>;
  /** send a file to the profile's inbox; progress then appears in uploads/<uploadId>.json */
  upload(profile: string, file: File, uploadId: string): Promise<void>;
}

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** safe file name for the inbox key; extension lower-cased (the S3 trigger matches lower-case suffixes) */
export function safeName(name: string): string {
  const s = name.replace(/[^\w.\-() ]+/g, "_").slice(-120);
  return s.replace(/\.([A-Za-z0-9]+)$/, (_, e: string) => "." + e.toLowerCase());
}

export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `p${Date.now()}`;

export class LocalAdapter implements DataAdapter {
  readonly mode = "local" as const;
  readonly canUpload = true;

  async listProfiles(): Promise<Profile[]> {
    const ids: string[] = await fetch("/local-data/_profiles").then((r) => (r.ok ? r.json() : []));
    return Promise.all(
      ids.map(async (id) => {
        // profile.json may simulate a circle locally ("circle", "circleName", "readOnly") to try the shared UI
        const p = await this.getJSON<Partial<Profile>>(id, "profile.json");
        return { id, name: p?.name ?? id, sex: p?.sex, birth_year: p?.birth_year, circle: p?.circle, circleName: p?.circleName, readOnly: p?.readOnly };
      }),
    );
  }

  spaces(): Space[] {
    return [];
  }

  async addProfile(): Promise<void> {
    throw new Error("Local mode: create a folder under ./local-data/ (e.g. by ingesting a report into it).");
  }

  async getJSON<T>(profile: string, key: string): Promise<T | null> {
    const r = await fetch(`/local-data/${encodeURIComponent(profile)}/${key}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  }

  async putJSON(profile: string, key: string, value: unknown): Promise<void> {
    const r = await fetch(`/local-data/${encodeURIComponent(profile)}/${key}`, { method: "PUT", body: JSON.stringify(value) });
    if (!r.ok) throw new Error((await r.text()) || `save failed (${r.status})`);
  }

  getPrefs(profile: string) {
    return this.getJSON<Prefs>(profile, "prefs.json");
  }

  async putPrefs(profile: string, prefs: Prefs): Promise<void> {
    await this.putJSON(profile, "prefs.json", prefs).catch(() => undefined); // read-only demo: keep in memory
  }

  async docUrl(profile: string, docId: string, mediaType: string): Promise<string | null> {
    const url = `/local-data/${encodeURIComponent(profile)}/docs/${docId}.${EXT[mediaType] ?? "pdf"}`;
    const r = await fetch(url, { method: "HEAD" });
    return r.ok ? url : null;
  }

  async upload(profile: string, file: File, uploadId: string): Promise<void> {
    const r = await fetch(`/local-data/${encodeURIComponent(profile)}/_upload`, {
      method: "POST",
      headers: { "x-upload-id": uploadId, "x-file-name": encodeURIComponent(safeName(file.name)) },
      body: file,
    });
    if (!r.ok) throw new Error((await r.text()) || `upload failed (${r.status})`);
  }
}

type S3 = import("@aws-sdk/client-s3").S3Client;

export class S3Adapter implements DataAdapter {
  readonly mode = "aws" as const;
  readonly canUpload = true;
  private root = ""; // users/<identityId>/
  private s3!: S3; // private space
  private circleClients = new Map<string, { s3: S3; writable: boolean; name: string }>();
  private mod!: typeof import("@aws-sdk/client-s3");

  constructor(private cfg: AwsConfig) {}

  /**
   * Exchange the Cognito ID token for temporary AWS credentials. The token's cognito:roles claim lists the circle
   * roles an admin granted this user (via Cognito groups); we ask the identity pool for each of them.
   */
  async init(idToken: string): Promise<void> {
    const [{ fromCognitoIdentityPool }, mod] = await Promise.all([
      import("@aws-sdk/credential-provider-cognito-identity"),
      import("@aws-sdk/client-s3"),
    ]);
    this.mod = mod;
    const logins = { [`cognito-idp.${this.cfg.region}.amazonaws.com/${this.cfg.userPoolId}`]: idToken };
    const base = { clientConfig: { region: this.cfg.region }, identityPoolId: this.cfg.identityPoolId, logins };
    const provider = fromCognitoIdentityPool(base);
    const creds = await provider();
    this.root = `users/${creds.identityId}/`;
    this.s3 = new mod.S3Client({ region: this.cfg.region, credentials: provider });

    const roles = tokenRoles(idToken);
    for (const c of this.cfg.circles ?? []) {
      const role = roles.includes(c.editRoleArn) ? c.editRoleArn : roles.includes(c.viewRoleArn) ? c.viewRoleArn : null;
      if (!role) continue;
      const p = fromCognitoIdentityPool({ ...base, customRoleArn: role });
      this.circleClients.set(c.id, { s3: new mod.S3Client({ region: this.cfg.region, credentials: p }), writable: role === c.editRoleArn, name: c.name });
    }
  }

  /** profile key → (S3 client, key prefix) */
  private where(profile: string): { s3: S3; prefix: string } {
    const i = profile.indexOf("/");
    if (i < 0) return { s3: this.s3, prefix: `${this.root}profiles/${profile}/` };
    const circle = profile.slice(0, i);
    const c = this.circleClients.get(circle);
    if (!c) throw new Error(`You are not a member of circle "${circle}"`);
    return { s3: c.s3, prefix: `circles/${circle}/profiles/${profile.slice(i + 1)}/` };
  }

  private async getText(s3: S3, key: string): Promise<string | null> {
    try {
      // JSON here changes behind the page's back (the Lambda rewrites results.json, upload status…): never let the
      // browser reuse a cached copy. The override also changes the URL, so copies cached earlier are not hit either.
      const r = await s3.send(new this.mod.GetObjectCommand({ Bucket: this.cfg.dataBucket, Key: key, ResponseCacheControl: "no-store" }));
      return (await r.Body?.transformToString()) ?? null;
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === "NoSuchKey" || name === "AccessDenied") return null;
      throw e;
    }
  }

  private async putText(s3: S3, key: string, body: string): Promise<void> {
    await s3.send(new this.mod.PutObjectCommand({ Bucket: this.cfg.dataBucket, Key: key, Body: body, ContentType: "application/json", CacheControl: "no-cache" }));
  }

  async listProfiles(): Promise<Profile[]> {
    const txt = await this.getText(this.s3, this.root + "profiles.json");
    const own = txt ? (JSON.parse(txt) as Profile[]) : [];
    const out: Profile[] = (own.length ? own : [{ id: "me", name: "Me" }]).map((p) => ({ ...p, circle: undefined, readOnly: false }));
    for (const [id, c] of this.circleClients) {
      const t = await this.getText(c.s3, `circles/${id}/profiles.json`);
      for (const p of t ? (JSON.parse(t) as Profile[]) : [])
        out.push({ ...p, id: `${id}/${p.id}`, circle: id, circleName: c.name, readOnly: !c.writable });
    }
    return out;
  }

  spaces(): Space[] {
    return [
      { circle: null, name: "Private (only you)", writable: true },
      ...[...this.circleClients].map(([id, c]) => ({ circle: id, name: c.name, writable: c.writable })),
    ];
  }

  async addProfile(name: string, circle: string | null): Promise<void> {
    const s3 = circle ? this.circleClients.get(circle)?.s3 : this.s3;
    if (!s3) throw new Error("not a member of that circle");
    const key = circle ? `circles/${circle}/profiles.json` : this.root + "profiles.json";
    const txt = await this.getText(s3, key);
    const list: Profile[] = txt ? JSON.parse(txt) : circle ? [] : [{ id: "me", name: "Me" }];
    let id = slug(name);
    while (list.some((p) => p.id === id)) id += "-2";
    list.push({ id, name });
    await this.putText(s3, key, JSON.stringify(list));
  }

  async getJSON<T>(profile: string, key: string): Promise<T | null> {
    const w = this.where(profile);
    const txt = await this.getText(w.s3, w.prefix + key);
    return txt ? (JSON.parse(txt) as T) : null;
  }

  async putJSON(profile: string, key: string, value: unknown): Promise<void> {
    const w = this.where(profile);
    await this.putText(w.s3, w.prefix + key, JSON.stringify(value));
  }

  /** per-user display preferences for a profile, kept in the user's private space */
  private prefsKey(profile: string) {
    return `${this.root}prefs/${profile.replace("/", "~")}.json`;
  }

  async getPrefs(profile: string): Promise<Prefs | null> {
    const txt = await this.getText(this.s3, this.prefsKey(profile));
    return txt ? (JSON.parse(txt) as Prefs) : null;
  }

  async putPrefs(profile: string, prefs: Prefs): Promise<void> {
    await this.putText(this.s3, this.prefsKey(profile), JSON.stringify(prefs));
  }

  async docUrl(profile: string, docId: string, mediaType: string): Promise<string | null> {
    try {
      const w = this.where(profile);
      const r = await w.s3.send(new this.mod.GetObjectCommand({ Bucket: this.cfg.dataBucket, Key: `${w.prefix}docs/${docId}.${EXT[mediaType] ?? "pdf"}` }));
      const bytes = await r.Body!.transformToByteArray();
      return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mediaType }));
    } catch {
      return null;
    }
  }

  async upload(profile: string, file: File, uploadId: string): Promise<void> {
    if (file.size > 40 * 1024 * 1024) throw new Error("File too large (max 40 MB)");
    const w = this.where(profile);
    await w.s3.send(
      new this.mod.PutObjectCommand({
        Bucket: this.cfg.dataBucket,
        Key: `${w.prefix}inbox/${uploadId}/${safeName(file.name)}`,
        Body: new Uint8Array(await file.arrayBuffer()),
        ContentType: file.type || "application/octet-stream",
      }),
    );
  }
}

/** the role ARNs this user may assume, from the ID token's cognito:roles claim (signature checked by AWS, not here) */
function tokenRoles(idToken: string): string[] {
  try {
    const claims = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return (claims["cognito:roles"] as string[]) ?? [];
  } catch {
    return [];
  }
}
