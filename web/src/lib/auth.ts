/**
 * Cognito managed login (OAuth2 authorization code + PKCE). No passwords ever touch this app:
 * the user signs in on the Cognito-hosted page and comes back with a code we exchange for tokens.
 * PKCE binds the code to this browser tab; the `state` value additionally rejects sign-in responses this tab
 * did not start (login CSRF).
 */
import type { AwsConfig } from "./config";

const KEY = "pmt.tokens";
const VERIFIER = "pmt.pkce";
const STATE = "pmt.state";

interface Tokens {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

const redirectUri = () => window.location.origin + "/";

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  arr.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function load(): Tokens | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(KEY) || "null") as Tokens | null;
    return t;
  } catch {
    return null;
  }
}

function save(t: Tokens) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* private mode: tokens live only in memory for this page */
  }
}

export async function login(cfg: AwsConfig): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(VERIFIER, verifier);
  sessionStorage.setItem(STATE, state);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const q = new URLSearchParams({
    response_type: "code",
    client_id: cfg.userPoolClientId,
    redirect_uri: redirectUri(),
    scope: "openid email",
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  window.location.assign(`${cfg.authDomain}/oauth2/authorize?${q}`);
}

export function logout(cfg: AwsConfig) {
  sessionStorage.removeItem(KEY);
  const q = new URLSearchParams({ client_id: cfg.userPoolClientId, logout_uri: redirectUri() });
  window.location.assign(`${cfg.authDomain}/logout?${q}`);
}

async function tokenRequest(cfg: AwsConfig, body: Record<string, string>): Promise<Tokens> {
  const r = await fetch(`${cfg.authDomain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.userPoolClientId, ...body }),
  });
  if (!r.ok) throw new Error(`token exchange failed (${r.status})`);
  const j = await r.json();
  return {
    id_token: j.id_token,
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? body.refresh_token,
    expires_at: Date.now() + (j.expires_in - 60) * 1000,
  };
}

/**
 * A valid ID token for later calls, refreshed when the current one has expired (ID tokens last an hour).
 * Calls made at the same time share one refresh.
 */
let refreshing: Promise<string | null> | null = null;
export function currentIdToken(cfg: AwsConfig): Promise<string | null> {
  const t = load();
  if (t && Date.now() < t.expires_at) return Promise.resolve(t.id_token);
  refreshing ??= getIdToken(cfg).finally(() => (refreshing = null));
  return refreshing;
}

/** Returns a valid ID token, completing the OAuth redirect or refreshing as needed; null ⇒ not signed in. */
export async function getIdToken(cfg: AwsConfig): Promise<string | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (code) {
    const verifier = sessionStorage.getItem(VERIFIER) || "";
    const expected = sessionStorage.getItem(STATE);
    sessionStorage.removeItem(STATE);
    if (!expected || url.searchParams.get("state") !== expected) {
      // not a sign-in this tab started: drop it and show the sign-in screen
      sessionStorage.removeItem(VERIFIER);
      window.history.replaceState({}, "", url.pathname + url.hash);
      return null;
    }
    const t = await tokenRequest(cfg, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    });
    save(t);
    sessionStorage.removeItem(VERIFIER);
    window.history.replaceState({}, "", url.pathname + url.hash);
    return t.id_token;
  }
  const t = load();
  if (!t) return null;
  if (Date.now() < t.expires_at) return t.id_token;
  if (!t.refresh_token) return null;
  try {
    const nt = await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: t.refresh_token });
    save(nt);
    return nt.id_token;
  } catch {
    return null;
  }
}

export function emailFromIdToken(idToken: string): string {
  try {
    return JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email ?? "";
  } catch {
    return "";
  }
}
