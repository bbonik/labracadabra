/**
 * Minimal hash router (#/view/arg?params) with a hook that re-renders on navigation.
 */
import { useEffect, useState } from "preact/hooks";

export interface Route {
  view: string;
  arg?: string;
  params: URLSearchParams;
}

export function parseHash(h = location.hash): Route {
  const [path, query = ""] = h.replace(/^#\/?/, "").split("?");
  const [view, ...rest] = path.split("/");
  return { view: view || "overview", arg: rest.length ? decodeURIComponent(rest.join("/")) : undefined, params: new URLSearchParams(query) };
}

export function useRoute(): Route {
  const [r, setR] = useState(parseHash());
  useEffect(() => {
    const fn = () => {
      setR(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  return r;
}

export function href(view: string, arg?: string, params?: Record<string, string | string[] | undefined>): string {
  let h = `#/${view}${arg ? "/" + encodeURIComponent(arg) : ""}`;
  if (params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === "") continue;
      if (Array.isArray(v)) {
        if (v.length) q.set(k, v.join(","));
      } else q.set(k, v);
    }
    const s = q.toString();
    if (s) h += "?" + s;
  }
  return h;
}

export const go = (h: string) => {
  location.hash = h;
};
