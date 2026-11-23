/**
 * Formatting helpers: dates, numbers, relative times, and HTML escaping for tooltip strings.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso: string | null | undefined, short = false): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y) return iso;
  return short ? `${MONTHS[(m || 1) - 1]} ${String(y).slice(2)}` : `${d} ${MONTHS[(m || 1) - 1]} ${y}`;
}

export function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  const d = Math.max(0, Math.min(6, decimals));
  return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtSigned(v: number, decimals = 2): string {
  const s = fmtNum(Math.abs(v), decimals);
  return (v > 0 ? "+" : v < 0 ? "−" : "±") + s;
}

export const toTime = (iso: string) => Date.parse(iso + "T00:00:00Z");
export const YEAR_MS = 365.25 * 24 * 3600 * 1000;

/** Escape text for HTML strings (e.g. ECharts tooltips): names, units and values can come from report text. */
export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const days = Math.round((Date.now() - toTime(iso.slice(0, 10))) / 86400000);
  if (days < 1) return "today";
  if (days < 60) return `${days} days ago`;
  if (days < 730) return `${Math.round(days / 30.4)} months ago`;
  return `${(days / 365.25).toFixed(1)} years ago`;
}
