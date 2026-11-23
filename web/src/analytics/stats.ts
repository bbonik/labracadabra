/** Small, dependency-free statistics used for trend/pattern flags. All times are in years. */

export interface Pt {
  t: number; // years (any origin)
  v: number;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** median absolute deviation, scaled to be consistent with σ for normal data */
export function mad(xs: number[]): number {
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

export function linreg(pts: Pt[]): { slope: number; intercept: number; r2: number } {
  const n = pts.length;
  if (n < 2) return { slope: 0, intercept: pts[0]?.v ?? 0, r2: 0 };
  const mt = pts.reduce((s, p) => s + p.t, 0) / n;
  const mv = pts.reduce((s, p) => s + p.v, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (const p of pts) {
    sxy += (p.t - mt) * (p.v - mv);
    sxx += (p.t - mt) ** 2;
    syy += (p.v - mv) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  return { slope, intercept: mv - slope * mt, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Mann–Kendall monotonic trend test (with tie correction). Returns S, Z and two-sided p. */
export function mannKendall(pts: Pt[]): { s: number; z: number; p: number } {
  const x = [...pts].sort((a, b) => a.t - b.t).map((p) => p.v);
  const n = x.length;
  if (n < 3) return { s: 0, z: 0, p: 1 };
  let s = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(x[j] - x[i]);
  const ties = new Map<number, number>();
  for (const v of x) ties.set(v, (ties.get(v) ?? 0) + 1);
  let tieTerm = 0;
  for (const c of ties.values()) if (c > 1) tieTerm += c * (c - 1) * (2 * c + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  const z = variance > 0 ? (s > 0 ? (s - 1) / Math.sqrt(variance) : s < 0 ? (s + 1) / Math.sqrt(variance) : 0) : 0;
  return { s, z, p: 2 * (1 - normCdf(Math.abs(z))) };
}

/** Theil–Sen slope (units per year). */
export function senSlope(pts: Pt[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < pts.length - 1; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const dt = pts[j].t - pts[i].t;
      if (Math.abs(dt) > 1e-6) slopes.push((pts[j].v - pts[i].v) / dt);
    }
  return slopes.length ? median(slopes) : 0;
}

/** Pettitt change-point test. Returns the index of the last point *before* the change and approx p-value. */
export function pettitt(values: number[]): { index: number; k: number; p: number } {
  const n = values.length;
  if (n < 4) return { index: -1, k: 0, p: 1 };
  let best = 0,
    idx = -1;
  for (let t = 0; t < n - 1; t++) {
    let u = 0;
    for (let i = 0; i <= t; i++) for (let j = t + 1; j < n; j++) u += Math.sign(values[i] - values[j]);
    if (Math.abs(u) > best) {
      best = Math.abs(u);
      idx = t;
    }
  }
  const p = Math.min(1, 2 * Math.exp((-6 * best * best) / (n ** 3 + n ** 2)));
  return { index: idx, k: best, p };
}

/** Mann–Whitney U test (normal approximation with continuity correction); two-sided p. */
export function mannWhitney(a: number[], b: number[]): number {
  const n1 = a.length,
    n2 = b.length;
  if (n1 < 2 || n2 < 2) return 1;
  let u = 0;
  for (const x of a) for (const y of b) u += x > y ? 1 : x === y ? 0.5 : 0;
  const mu = (n1 * n2) / 2;
  const sd = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = (Math.abs(u - mu) - 0.5) / sd;
  return Math.min(1, 2 * (1 - normCdf(Math.max(0, z))));
}
