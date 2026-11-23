// apply the saved theme before first paint (kept as a file so the CSP needs no inline scripts)
try {
  var t = localStorage.getItem("pmt.theme") || "auto";
  if (t === "auto") t = matchMedia("(prefers-color-scheme: dark)").matches ? "navy" : "light";
  document.documentElement.dataset.theme = t;
} catch (e) {}
