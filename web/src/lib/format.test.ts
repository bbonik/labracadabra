import { describe, expect, it } from "vitest";
import { pointTooltip } from "../components/charts";
import { esc } from "./format";

describe("tooltip escaping", () => {
  it("escapes HTML in text that can come from a report", () => {
    expect(esc(`<img src=x onerror="a('b')">&`)).toBe("&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
    expect(esc(null)).toBe("");
  });
  it("never puts raw markup from names or units into a tooltip", () => {
    const html = pointTooltip("<b>x</b>", { date: "2025-01-02", value: 1 } as never, "<i>u</i>", 1);
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>u</i>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
