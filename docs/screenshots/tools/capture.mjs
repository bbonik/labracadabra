// Capture the README screenshots from the synthetic demo profile with headless Chrome.
//
//   cd web && npx vite --port 5199 --strictPort          # in one terminal
//   cd docs/screenshots/tools && npm i --no-save puppeteer-core@23
//   node capture.mjs raw 2 [name-filter]                 # raw PNGs (2x)
//   python3 convert.py raw ..                            # WebP + animated tour.webp (needs Pillow)
//
// CHROME can be set to your Chrome/Chromium executable (default: the macOS location).

import fs from "node:fs";
import puppeteer from "puppeteer-core";

const [out = "out", dprArg = "1", filter = ""] = process.argv.slice(2);
const BASE = "http://localhost:5199/?profile=demo";
const lipids = "ldl,hdl,cholesterol_total,triglycerides,apob";
const SHOTS = [
  // name, hash, theme, height (0 = full page), width (default 1440), phone?
  ["overview", "#/overview", "light", 1000],
  ["overview-dark", "#/overview", "navy", 1000],
  ["blood-panels", "#/group/blood", "light", 0],
  ["blood-panels-dark", "#/group/blood", "navy", 0],
  ["vitals", "#/group/vitals", "paper", 640],
  ["explore-side-by-side", `#/explore?type=multi&tests=${lipids}`, "light", 0],
  ["explore-side-by-side-dark", `#/explore?type=multi&tests=${lipids}`, "graphite", 0],
  ["explore-over-time", "#/explore?type=time&tests=ldl,cholesterol_total,triglycerides", "light", 900],
  ["explore-scatter", "#/explore?type=scatter&tests=ldl,cholesterol_total", "light", 900],
  ["explore-heatmap", `#/explore?type=heatmap&tests=${lipids},hba1c,glucose_fasting,alt,ggt,ferritin,vitamin_d,psa_total`, "navy", 0],
  ["explore-velocity", "#/explore?type=velocity&tests=psa_total", "light", 900],
  ["test-psa", "#/test/psa_total", "light", 0],
  ["test-ldl-dark", "#/test/ldl", "graphite", 0],
  ["inbox", "#/inbox", "light", 500],
  ["documents", "#/documents", "light", 790],
  ["usage", "#/usage", "light", 1000],
  ["settings", "#/settings", "light", 1000],
  ["phone-overview", "#/overview", "light", 844, 390, true],
  ["phone-test", "#/test/ldl", "navy", 844, 390, true],
  ["phone-blood", "#/group/blood", "light", 844, 390, true],
];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--hide-scrollbars"],
});
fs.mkdirSync(out, { recursive: true });
for (const [name, hash, theme, height, width = 1440, phone = false] of SHOTS) {
  if (filter && !name.includes(filter)) continue;
  const page = await browser.newPage();
  await page.setViewport({ width, height: height || 900, deviceScaleFactor: phone ? 3 : Number(dprArg), isMobile: phone, hasTouch: phone });
  await page.evaluateOnNewDocument((t) => localStorage.setItem("pmt.theme", t), theme);
  await page.goto(BASE + hash, { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 2500)); // charts animate in
  if (!height) {
    // grow the viewport to the page (so 100vh sidebars span it and charts lay out once), then let charts settle
    const full = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewport({ width, height: full, deviceScaleFactor: Number(dprArg) });
    await new Promise((r) => setTimeout(r, 2500));
  }
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
  console.log("shot", name);
}
await browser.close();
