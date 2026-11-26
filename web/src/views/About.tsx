/** What Labracadabra is, how values are read, privacy, what the patterns mean, costs and limits. */
import { FileText, ScanText, ShieldCheck, LineChart, CircleCheck } from "lucide-preact";
import { PageHeader } from "../components/bits";
import { PageIcon } from "../components/icons";
import { href } from "../lib/router";

const STEPS = [
  { icon: FileText, title: "Your report", text: "A PDF, scan or phone photo from any lab, in any language." },
  { icon: ScanText, title: "Transcribed", text: "An AI model copies each value, unit and range exactly as printed." },
  { icon: CircleCheck, title: "Checked in code", text: "Names, units and ranges are standardised by rules, not by the AI. Anything uncertain goes to review." },
  { icon: LineChart, title: "Your charts", text: "Every point links back to the page it came from." },
];

const GLOSSARY: [string, string, string][] = [
  ["Reference range", "The range the lab considers typical for most healthy people. Labs differ, so each result is compared with the range printed on its own report.", ""],
  ["Rising / falling trend", "The values keep moving in one direction over several results, not just once.", "Mann–Kendall trend test (p < 0.1); slope by Theil–Sen."],
  ["Step up / step down", "The values settled at a new level at some point, for example after a change in treatment or lifestyle.", "Pettitt change-point test, confirmed with Mann–Whitney (p < 0.05)."],
  ["Outlier", "One result far from the usual level. Often worth checking against the report: it may be a transcription or unit issue.", "More than 3.5 × the median absolute deviation from the median."],
  ["Rate of change", "How much the value changes per year on average.", "Theil–Sen slope, robust to single odd values."],
];

export function About() {
  return (
    <>
      <PageHeader icon={<PageIcon name="about" />} title="About Labracadabra" meta="Open source · MIT licence">
        Labracadabra keeps your family's lab results in one private place: it reads your reports, puts every value on a
        common scale and shows how things change over time, always linked to the original page.
      </PageHeader>

      <div class="card col-12">
        <h2>How your values are read</h2>
        <div class="about-steps">
          {STEPS.map((s, i) => (
            <div class="about-step">
              <span class="about-num">{i + 1}</span>
              <s.icon size={20} strokeWidth={1.8} class="about-ico" />
              <div class="rowtitle">{s.title}</div>
              <div class="note">{s.text}</div>
            </div>
          ))}
        </div>
      </div>

      <div class="card col-6">
        <h2>
          <ShieldCheck size={14} strokeWidth={2} /> Privacy
        </h2>
        <ul class="about-list">
          <li><b>Where your data lives:</b> in a private, encrypted storage bucket in the owner's own cloud account. There is no shared database and no third-party analytics.</li>
          <li><b>What leaves it:</b> only the pages of a report you upload, sent to the Claude API to be transcribed. They are not used to train models.</li>
          <li><b>Who can see what:</b> your private space is yours alone. Profiles in a shared circle are visible to its members; view-only members can't change anything.</li>
        </ul>
      </div>
      <div class="card col-6">
        <h2>Costs</h2>
        <ul class="about-list">
          <li><b>Reading reports:</b> about $0.01–0.03 per page, paid with your own Claude API key. Re-uploading the same report is detected and free.</li>
          <li><b>Hosting:</b> usually $0–2 a month. No servers run while nobody is using the app.</li>
          <li>See <a href={href("usage")}>Usage &amp; cost</a> for what you've spent, and set a monthly reminder in Settings.</li>
        </ul>
      </div>

      <div class="card col-12">
        <h2>What the patterns mean</h2>
        <div class="glossary">
          {GLOSSARY.map(([term, plain, method]) => (
            <div class="gloss">
              <div class="rowtitle">{term}</div>
              <div>{plain}</div>
              {method && <div class="note">Method: {method}</div>}
            </div>
          ))}
        </div>
      </div>

      <div class="card col-12 about-limits">
        <h2>Limits</h2>
        <p>
          Labracadabra organises the numbers in your own reports. It does not diagnose or give medical advice, and the
          pattern labels are statistical descriptions only. The transcription is done by an AI model and can make
          mistakes: check surprising values against the source page (one click from any result), and discuss anything
          that concerns you with a doctor.
        </p>
        <p class="note">
          Version 0.1 · <a href="https://github.com/bbonik/labracadabra" target="_blank" rel="noopener">Source code on GitHub</a> ·
          MIT licence · Report a problem on GitHub Issues
        </p>
      </div>
    </>
  );
}
