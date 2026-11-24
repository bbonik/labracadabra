/**
 * App shell: sidebar navigation, top bar (test search, profile switch, theme, print, CSV export) and the
 * hash router that picks the view.
 */
import { useEffect, useState } from "preact/hooks";
import { ExportDialog } from "./components/ExportDialog";
import { NoteDialog } from "./components/NoteDialog";
import { SourceViewer } from "./components/SourceViewer";
import { TestSearch } from "./components/TestSearch";
import { Empty } from "./components/bits";
import { PANELS, TESTS, groupOf, panelById } from "./lib/catalog";
import { fmtDate } from "./lib/format";
import { go, href, useRoute } from "./lib/router";
import { useApp } from "./lib/state";
import { Documents } from "./views/Documents";
import { Explore } from "./views/Explore";
import { Group } from "./views/Group";
import { Imaging } from "./views/Imaging";
import { Inbox } from "./views/Inbox";
import { Notes } from "./views/Notes";
import { Overview } from "./views/Overview";
import { Settings } from "./views/Settings";
import { TestDetail } from "./views/TestDetail";
import { Usage } from "./views/Usage";
import { FileSpreadsheet, Menu, Moon, Printer, Sun } from "lucide-preact";

interface NavItem {
  key: string;
  label: string;
  hash: string;
  icon: string;
  match: (view: string, arg?: string) => boolean;
  badge?: number;
}

export function App() {
  const app = useApp();
  const { data, loading, error, profile, profiles, setProfileId, resolvedTheme, setTheme, setPrinting, user, onLogout } = app;
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  useEffect(() => setNavOpen(false), [route.view, route.arg]);

  const inbox = (data?.results.filter((r) => r.status === "flagged").length ?? 0) + (data?.suggestions?.length ?? 0);
  const groupsWithData = new Set([...app.byTest.keys()].map((id) => TESTS[id]?.panel.split(".")[0]));
  const healthNav: NavItem[] = PANELS.filter((g) => g.id !== "imaging" && g.id !== "screening" && groupsWithData.has(g.id)).map((g) => ({
    key: g.id,
    label: g.name,
    hash: href("group", g.id),
    icon: g.id,
    match: (v, a) => (v === "group" && a === g.id) || (v === "test" && !!a && TESTS[a]?.panel.startsWith(g.id)),
  }));
  const nav: { group: string; items: NavItem[] }[] = [
    { group: "", items: [{ key: "overview", label: "Overview", hash: href("overview"), icon: "overview", match: (v) => v === "overview" }] },
    {
      group: "My health",
      items: [
        ...healthNav,
        { key: "imaging", label: "Imaging & screening", hash: href("imaging"), icon: "imaging", match: (v, a) => v === "imaging" || (v === "test" && !!a && /^(imaging|screening)/.test(TESTS[a]?.panel ?? "")) },
      ],
    },
    { group: "Analyse", items: [{ key: "explore", label: "Explore & compare", hash: href("explore"), icon: "explore", match: (v) => v === "explore" }] },
    {
      group: "Data",
      items: [
        { key: "documents", label: "Documents", hash: href("documents"), icon: "documents", match: (v) => v === "documents" },
        { key: "notes", label: "Notes", hash: href("notes"), icon: "notes", match: (v) => v === "notes" },
        { key: "inbox", label: "Review inbox", hash: href("inbox"), icon: "inbox", match: (v) => v === "inbox", badge: inbox },
        { key: "usage", label: "Usage & cost", hash: href("usage"), icon: "usage", match: (v) => v === "usage" },
        { key: "settings", label: "Settings", hash: href("settings"), icon: "settings", match: (v) => v === "settings" },
      ],
    },
  ];
  const active = nav.flatMap((g) => g.items).find((i) => i.match(route.view, route.arg));
  const title = route.view === "test" && route.arg ? TESTS[route.arg]?.name ?? "Test" : active?.label ?? "Overview";

  // the document title is what browsers use as the default PDF file name
  const pageTitle = `${title}${profile && profiles.length > 1 ? ` - ${profile.name}` : ""}`;
  const printTitle = `${title}${profile ? ` - ${profile.name}` : ""} - ${new Date().toISOString().slice(0, 10)}`.replace(/[\\/:*?"<>|]+/g, " ");
  useEffect(() => {
    document.title = `${pageTitle} · Labracadabra`;
  }, [pageTitle]);
  useEffect(() => {
    // also when printing from the browser menu (Ctrl/Cmd+P), not only from the PDF button
    const before = () => {
      document.title = printTitle;
      setPrinting(true);
    };
    const after = () => {
      document.title = `${pageTitle} · Labracadabra`;
      setPrinting(false);
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [pageTitle, printTitle]);

  // tests on the current page, offered as the default CSV export choice
  const [pageTests, pageLabel] = ((): [string[], string] => {
    if (route.view === "test" && route.arg && TESTS[route.arg]) return [[route.arg], "This test"];
    if (route.view === "group" && route.arg) {
      const panel = route.params.get("panel");
      const ids = [...app.byTest.keys()].filter((id) => TESTS[id] && (panel ? TESTS[id].panel === panel : groupOf(TESTS[id].panel) === route.arg));
      return [ids, (panel && panelById[panel]?.name) || PANELS.find((g) => g.id === route.arg)?.name || "This page"];
    }
    if (route.view === "explore") return [(route.params.get("tests") ?? "").split(",").filter((id) => TESTS[id]), "Tests on the chart"];
    return [[], ""];
  })();

  const print = () => {
    document.title = printTitle;
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 700);
  };

  let view: preact.JSX.Element;
  if (error) view = <div class="card col-12"><Empty>Could not load data: {error}</Empty></div>;
  else if (loading && !data) view = <div class="card col-12"><Empty>Loading…</Empty></div>;
  else if (!profile) view = <div class="card col-12"><Empty>No profiles yet. Run <code>pmt ingest</code> or add a profile in Settings.</Empty></div>;
  else
    switch (route.view) {
      case "group":
        view = <Group groupId={route.arg ?? "blood"} panelFilter={route.params.get("panel") ?? undefined} />;
        break;
      case "test":
        view = <TestDetail testId={route.arg ?? ""} />;
        break;
      case "explore":
        view = <Explore route={route} />;
        break;
      case "imaging":
        view = <Imaging />;
        break;
      case "documents":
        view = <Documents />;
        break;
      case "inbox":
        view = <Inbox />;
        break;
      case "usage":
        view = <Usage />;
        break;
      case "notes":
        view = <Notes />;
        break;
      case "settings":
        view = <Settings />;
        break;
      default:
        view = <Overview />;
    }

  const dark = resolvedTheme === "navy" || resolvedTheme === "graphite";
  return (
    <div class={`shell ${navOpen ? "nav-open" : ""}`}>
      <nav class="sidenav" aria-label="Main">
        <div class="brand">
          <img class="logo" src="/logo.svg" alt="" />
          <span class="wordmark"><b>Lab</b>racadabra</span>
        </div>
        {nav.map((g) => (
          <>
            {g.group && <div class="navgroup">{g.group}</div>}
            {g.items.map((i) => (
              <a class={`navbtn ${active?.key === i.key ? "active" : ""}`} href={i.hash} data-ic={i.icon}>
                <span class="navlabel">{i.label}</span>
                {!!i.badge && <span class="badge">{i.badge}</span>}
              </a>
            ))}
          </>
        ))}
        <div class="navfoot note">{data?.demo ? "Demo data — synthetic values" : data?.updated_at ? `Updated ${fmtDate(data.updated_at.slice(0, 10))}` : ""}</div>
      </nav>
      <div class="navscrim" onClick={() => setNavOpen(false)} />
      <div class="main">
        <header class="topbar">
          <button class="iconbtn hamburger" aria-label="Menu" onClick={() => setNavOpen(!navOpen)}><Menu size={18} strokeWidth={1.9} /></button>
          <h1>{title}</h1>
          <span class="spacer" />
          <TestSearch hotkey placeholder="Search tests…  ( / )" onPick={(id) => go(href("test", id))} className="topsearch" />
          {profiles.length > 1 ? (
            <select class="profilesel" value={profile?.id} onChange={(e) => setProfileId((e.target as HTMLSelectElement).value)} aria-label="Profile">
              {profiles.some((p) => p.circle)
                ? [...new Map(profiles.map((p) => [p.circle ?? "", p.circleName ?? (p.circle ? p.circle : "Private")])).entries()].map(([c, name]) => (
                    <optgroup label={c ? `${name}${profiles.find((p) => p.circle === c)?.readOnly ? " (view only)" : ""}` : name}>
                      {profiles
                        .filter((p) => (p.circle ?? "") === c)
                        .map((p) => (
                          <option value={p.id}>{p.name}</option>
                        ))}
                    </optgroup>
                  ))
                : profiles.map((p) => <option value={p.id}>{p.name}</option>)}
            </select>
          ) : (
            profile && <span class="note hide-sm">{profile.name}</span>
          )}
          {profile?.readOnly && (
            <span class="pill idle hide-sm" title="You can look at this profile but not upload or change anything">
              view only
            </span>
          )}
          <button class="iconbtn" title={dark ? "Light theme" : "Dark theme"} aria-label="Toggle theme" onClick={() => setTheme(dark ? "light" : "navy")}>
            {dark ? <Sun size={16} strokeWidth={1.9} /> : <Moon size={16} strokeWidth={1.9} />}
          </button>
          {data && profile && app.byTest.size > 0 && (
            <button onClick={() => setExporting(true)} title="Download values as a spreadsheet (CSV), e.g. for your doctor">
              <FileSpreadsheet size={15} strokeWidth={1.9} class="ico" /> <span class="hide-sm">CSV</span>
            </button>
          )}
          <button onClick={print} title="Print or save this page as PDF (e.g. for your doctor)"><Printer size={15} strokeWidth={1.9} class="ico" /> <span class="hide-sm">PDF</span></button>
          {onLogout && (
            <button class="hide-sm" onClick={onLogout} title={user}>
              Sign out
            </button>
          )}
        </header>
        <div class="print-header">
          <b>{profile?.name}</b> · {title} · printed {fmtDate(new Date().toISOString().slice(0, 10))}
          <div>Compiled from the patient's own laboratory and imaging reports. Not a diagnosis; values should be verified against the original reports.</div>
        </div>
        <main class="wrap">{view}</main>
      </div>
      <SourceViewer />
      {app.noteDraft && <NoteDialog key={app.noteDraft.id ?? "new"} draft={app.noteDraft} onClose={() => app.editNote(null)} />}
      {exporting && <ExportDialog pageTests={pageTests} pageLabel={pageLabel} onClose={() => setExporting(false)} />}
    </div>
  );
}
