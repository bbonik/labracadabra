/**
 * Runtime configuration: config.json is written by the CDK stack on deploy (AWS mode) or is absent in local
 * development (local mode).
 */
export interface AwsConfig {
  mode: "aws";
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  /** Cognito managed-login domain, e.g. https://my-labracadabra.auth.eu-west-1.amazoncognito.com */
  authDomain: string;
  identityPoolId: string;
  dataBucket: string;
  /** sharing circles defined by the stack; membership comes from the user's Cognito groups */
  circles?: { id: string; name: string; editRoleArn: string; viewRoleArn: string }[];
}

export interface LocalConfig {
  mode: "local";
}

export type AppConfig = AwsConfig | LocalConfig;

/** Deployed builds get /config.json from the CDK stack; the dev server falls back to local mode. */
export async function loadConfig(): Promise<AppConfig> {
  try {
    const r = await fetch("/config.json", { cache: "no-store" });
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) return (await r.json()) as AppConfig;
  } catch {
    /* fall through */
  }
  return { mode: "local" };
}
