// Renders social-preview.html to docs/social-preview.png (1280x640), the image GitHub shows when the repo
// link is shared. Upload it under Settings → General → Social preview.
//   cd docs/screenshots/tools && npm i puppeteer-core && CHROME=/path/to/chrome node social-preview.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--allow-file-access-from-files"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 640, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, "social-preview.html")).href, { waitUntil: "load" });
await page.screenshot({ path: path.join(here, "../../social-preview.png") });
await browser.close();
console.log("wrote docs/social-preview.png");
