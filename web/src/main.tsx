/**
 * Browser entry point: loads config.json, picks the data adapter (local dev server or S3 with Cognito
 * credentials), handles sign-in, and renders the app.
 */
import { render } from "preact";
import { App } from "./app";
import { LocalAdapter, S3Adapter, type DataAdapter } from "./lib/adapter";
import { currentIdToken, emailFromIdToken, getIdToken, login, logout } from "./lib/auth";
import { loadConfig } from "./lib/config";
import { AppProvider } from "./lib/state";
import { SignIn } from "./components/SignIn";
import "@fontsource-variable/inter";
import "./styles.css";

async function boot() {
  const root = document.getElementById("app")!;
  const cfg = await loadConfig();
  let adapter: DataAdapter;
  let user: string | undefined;
  let onLogout: (() => void) | undefined;

  if (cfg.mode === "aws") {
    let token: string | null = null;
    try {
      token = await getIdToken(cfg);
    } catch (e) {
      console.error(e);
    }
    if (!token) {
      render(<SignIn onSignIn={() => login(cfg)} />, root);
      return;
    }
    const s3 = new S3Adapter(cfg);
    await s3.init(token, () => currentIdToken(cfg));
    adapter = s3;
    user = emailFromIdToken(token);
    onLogout = () => logout(cfg);
  } else {
    if (new URLSearchParams(location.search).has("signin")) {
      render(<SignIn onSignIn={() => history.replaceState(null, "", location.pathname)} />, root);
      return;
    }
    adapter = new LocalAdapter();
  }

  render(
    <AppProvider adapter={adapter} user={user} onLogout={onLogout}>
      <App />
    </AppProvider>,
    root,
  );
}

boot().catch((e) => {
  document.getElementById("app")!.textContent = `Failed to start: ${e}`;
});
