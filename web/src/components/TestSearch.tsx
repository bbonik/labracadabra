/**
 * Type-ahead search over the test catalog: names AND aliases in any language ("SGPT" → ALT, "总胆固醇" → cholesterol),
 * tests with results first. Optionally offers whole panels.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { PANELS, TESTS, normName, panelById } from "../lib/catalog";
import { useApp } from "../lib/state";

interface Hit {
  key: string; // test id or "panel:<id>"
  label: string;
  sub: string;
  matched?: string;
  has: boolean;
}

export function TestSearch(props: {
  onPick: (key: string) => void;
  placeholder?: string;
  panels?: boolean;
  onlyWithData?: boolean;
  exclude?: string[];
  /** only offer tests passing this check */
  filter?: (id: string) => boolean;
  /** focus with the "/" key */
  hotkey?: boolean;
  className?: string;
}) {
  const { byTest } = useApp();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!props.hotkey) return;
    const fn = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [props.hotkey]);

  const index = useMemo(
    () =>
      Object.values(TESTS).map((t) => ({
        t,
        name: normName(t.name),
        keys: [t.id, ...(t.aliases ?? [])].map((a) => ({ raw: a, n: normName(a) })),
      })),
    [],
  );

  const hits: Hit[] = useMemo(() => {
    const n = normName(q);
    if (!n) return [];
    const out: (Hit & { score: number })[] = [];
    for (const { t, name, keys } of index) {
      if (props.exclude?.includes(t.id) || (props.filter && !props.filter(t.id))) continue;
      const has = byTest.has(t.id);
      if (props.onlyWithData && !has) continue;
      let score = -1,
        matched: string | undefined;
      if (name.startsWith(n)) score = 100;
      else if (name.includes(n)) score = 70;
      else {
        const a = keys.find((k) => k.n.startsWith(n)) ?? keys.find((k) => k.n.includes(n));
        if (a) {
          score = a.n.startsWith(n) ? 60 : 40;
          matched = a.raw;
        }
      }
      if (score < 0) continue;
      out.push({ key: t.id, label: t.name, sub: panelById[t.panel]?.name ?? "", matched, has, score: score + (has ? 1000 : 0) - name.length / 100 });
    }
    if (props.panels) {
      for (const p of PANELS.flatMap((g) => g.children ?? [])) {
        if (!normName(p.name).includes(n)) continue;
        const count = [...byTest.keys()].filter((id) => TESTS[id]?.panel === p.id && TESTS[id].kind === "numeric").length;
        if (count > 1) out.push({ key: `panel:${p.id}`, label: `Whole panel: ${p.name}`, sub: `${count} tests with results`, has: true, score: 1500 });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 12);
  }, [q, index, byTest, props.exclude?.join(), props.panels, props.onlyWithData]);

  const pick = (h?: Hit) => {
    if (!h) return;
    props.onPick(h.key);
    setQ("");
    setOpen(false);
    ref.current?.blur();
  };

  return (
    <div class={`search ${props.className ?? ""}`}>
      <input
        ref={ref}
        type="search"
        value={q}
        placeholder={props.placeholder ?? "Search tests…"}
        aria-label={props.placeholder ?? "Search tests"}
        autocomplete="off"
        onInput={(e) => {
          setQ((e.target as HTMLInputElement).value);
          setOpen(true);
          setSel(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(s + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, 0));
          } else if (e.key === "Enter") pick(hits[sel]);
          else if (e.key === "Escape") {
            setQ("");
            ref.current?.blur();
          }
        }}
      />
      {open && q && (
        <div class="search-pop" role="listbox">
          {!hits.length && <div class="search-empty note">No matching test</div>}
          {hits.map((h, i) => (
            <button
              class={`search-item ${i === sel ? "sel" : ""} ${h.has ? "" : "nodata"}`}
              role="option"
              aria-selected={i === sel}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(h)}
            >
              <span>
                {h.label}
                {h.matched && <span class="note"> · “{h.matched}”</span>}
              </span>
              <span class="note">{h.has ? h.sub : `${h.sub} · no results yet`}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
