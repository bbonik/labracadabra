#!/usr/bin/env python3
"""Generate the animated architecture diagram used in the README (light + dark variants).

    python3 docs/architecture/build_diagram.py

Writes architecture-light.svg and architecture-dark.svg next to this file. Pure SVG + SMIL/CSS animation (no
scripts), so it animates inside GitHub's <img> rendering. The animation walks through the request flow in numbered
steps; each step lights up its connector, sends a "packet" along it and shows a caption at the bottom.

To change the picture, edit BOXES / FLOWS / STEPS below and re-run. Stdlib only.
"""

from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import escape

W, H = 1280, 760
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
STEP_S = 2.2  # seconds per step

THEMES = {
    "light": dict(bg="#f8fafc", card="#ffffff", border="#dbe2ee", text="#0f172a", muted="#5b6b85", faint="#c9d3e3",
                  boundary="#3d6ef5", caption_bg="#eef2fb"),
    "dark": dict(bg="#0d1424", card="#131c30", border="#26324d", text="#e6ecf7", muted="#93a3c0", faint="#33405e",
                 boundary="#5b86ff", caption_bg="#18223a"),
}
CAT = {  # category → accent colour
    "CLIENT": "#64748b", "EDGE": "#3d6ef5", "AUTH": "#7c4dff", "STORAGE": "#0f9f68",
    "COMPUTE": "#e08a00", "AI": "#d97757", "OPS": "#8a94a8",
}

# id: (x, y, w, h, category, title, subtitle lines)
BOXES = {
    "browser": (40, 250, 180, 200, "CLIENT", "Browser", ["Preact web app", "desktop & phone", "", "charts · review inbox", "PDF / CSV export"]),
    "cf": (300, 110, 180, 80, "EDGE", "CloudFront", ["HTTPS · strict CSP"]),
    "site": (520, 110, 170, 80, "STORAGE", "S3 · web app", ["static files, private"]),
    "budget": (740, 110, 170, 80, "OPS", "Budget", ["monthly cost alerts"]),
    "up": (300, 250, 170, 80, "AUTH", "Cognito user pool", ["invitation only · MFA"]),
    "ip": (520, 250, 170, 80, "AUTH", "Identity pool", ["sign-in → IAM role"]),
    "roles": (740, 250, 170, 80, "AUTH", "IAM roles", ["private · circle edit / view"]),
    "data": (300, 420, 180, 120, "STORAGE", "S3 data bucket", ["users/<id>/ · circles/<id>/", "versioned · encrypted", "originals + JSON files"]),
    "sqs": (540, 440, 170, 80, "COMPUTE", "SQS queue", ["+ dead-letter queue"]),
    "lambda": (780, 430, 190, 100, "COMPUTE", "Lambda extractor", ["Python · max 2 in parallel", "units, merge, trends in code"]),
    "anthropic": (1050, 430, 190, 100, "AI", "Anthropic API", ["Claude transcribes pages", "no diagnosis"]),
    "alarms": (540, 585, 170, 64, "OPS", "Alarms → email", ["failures · unusual load"]),
    "ssm": (780, 585, 190, 64, "OPS", "SSM Parameter Store", ["API key, encrypted"]),
}

# Connectors: id → (path, colour, step numbers it belongs to, arrowhead?)
BLUE, VIOLET, GREEN, AMBER, GREY = "#3d6ef5", "#7c4dff", "#0f9f68", "#e08a00", "#8a94a8"
FLOWS = {
    "load": ("M220 285 C 262 285 258 150 300 150 L 520 150", BLUE, [1], True),
    "signin": ("M220 318 C 262 318 258 290 300 290 L 740 290", VIOLET, [2], True),
    "creds": ("M825 330 L 825 352 Q 825 362 815 362 L 222 362", VIOLET, [3], True),
    "upload": ("M220 418 C 262 418 258 462 300 462", GREEN, [4], True),
    "read": ("M300 505 C 258 505 262 440 222 440", GREEN, [7], True),
    "extract": ("M480 480 L 1050 480", AMBER, [5], True),
    "answer": ("M1050 508 L 972 508", AMBER, [6], True),
    "write": ("M860 430 L 860 400 Q 860 390 850 390 L 400 390 Q 390 390 390 400 L 390 418", AMBER, [6], True),
    "key": ("M875 585 L 875 532", GREY, [], True),
    "alarm": ("M780 512 C 745 512 745 617 712 617", GREY, [], True),
}
# The packet route for each step (several connectors can share a step).
STEPS = [
    (["load"], BLUE, "The browser loads the static app from CloudFront (private S3 origin, strict security headers)."),
    (["signin"], VIOLET, "You sign in on Cognito's hosted page: invitation only, PKCE, optional or required MFA."),
    (["creds"], VIOLET, "Your circle memberships map to IAM roles; the browser receives 1-hour AWS credentials."),
    (["upload"], GREEN, "The app talks straight to S3 (no API servers) and uploads a report to your inbox/ folder."),
    (["extract"], AMBER, "S3 → SQS → Lambda: the pages are sent to Claude, which only transcribes what is printed."),
    (["answer", "write"], AMBER, "Deterministic code converts units, merges duplicates, flags trends, writes results.json."),
    (["read"], GREEN, "The app shows the new values; every one links back to the highlighted source page."),
]
BADGES = {1: (262, 214), 2: (500, 290), 3: (600, 362), 4: (262, 440), 5: (745, 480), 6: (620, 390), 7: (262, 472)}
CYCLE = STEP_S * len(STEPS)


def _kt(*ts: float) -> str:
    return ";".join(f"{t:.4f}" for t in ts)


def window(step: int) -> tuple[float, float]:
    """Fraction of the cycle in which a step is active."""
    return (step - 1) / len(STEPS), step / len(STEPS)


def opacity_anim(step: int, off: float, on: float) -> str:
    a, b = window(step)
    e = 0.012
    ts, vs = [0.0], [off]
    if a > 0:
        ts += [a]
        vs += [off]
    ts += [a + e, b - e, b]
    vs += [on, on, off]
    if b < 1:
        ts += [1.0]
        vs += [off]
    return (f'<animate attributeName="opacity" dur="{CYCLE}s" repeatCount="indefinite" '
            f'keyTimes="{_kt(*ts)}" values="{";".join(f"{v:g}" for v in vs)}"/>')


def motion_anim(step: int, path_id: str, lag: float, part: tuple[float, float] = (0.0, 1.0)) -> str:
    a, b = window(step)
    span = b - a
    s0 = min(b - 0.02, a + span * (0.08 + 0.8 * part[0]) + lag)
    s1 = min(b - 0.01, a + span * (0.08 + 0.8 * part[1]) + lag)
    return (f'<animateMotion dur="{CYCLE}s" repeatCount="indefinite" calcMode="linear" '
            f'keyPoints="0;0;1;1" keyTimes="{_kt(0, s0, s1, 1)}"><mpath xlink:href="#p-{path_id}"/></animateMotion>')


def box(t: dict, key: str) -> str:
    x, y, w, h, cat, title, lines = BOXES[key]
    accent = CAT[cat]
    out = [f'<g class="box" id="b-{key}">',
           f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{t["card"]}" stroke="{t["border"]}" filter="url(#shadow)"/>',
           f'<rect x="{x}" y="{y + 12}" width="4" height="{h - 24}" rx="2" fill="{accent}"/>',
           f'<text x="{x + 16}" y="{y + 22}" class="cat" fill="{accent}">{cat}</text>',
           f'<text x="{x + 16}" y="{y + 42}" class="title" fill="{t["text"]}">{escape(title)}</text>']
    for i, line in enumerate(lines):
        out.append(f'<text x="{x + 16}" y="{y + 61 + 16 * i}" class="sub" fill="{t["muted"]}">{escape(line)}</text>')
    out.append("</g>")
    return "".join(out)


def render(theme: str) -> str:
    t = THEMES[theme]
    o: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {W} {H}" '
        f'width="{W}" height="{H}" role="img" aria-labelledby="t d">',
        '<title id="t">Labracadabra architecture</title>',
        '<desc id="d">Browser, CloudFront, Cognito, IAM, S3, SQS, Lambda and the Anthropic API, with the request '
        'flow animated in seven steps.</desc>',
        "<defs>",
        '<filter id="shadow" x="-10%" y="-10%" width="120%" height="140%">'
        f'<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0b1530" flood-opacity="{0.10 if theme == "light" else 0.45}"/></filter>',
        '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5" result="b"/>'
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
    ]
    for name, colour in {"blue": BLUE, "violet": VIOLET, "green": GREEN, "amber": AMBER, "grey": GREY}.items():
        o.append(f'<marker id="m-{name}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" '
                 f'orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="{colour}"/></marker>')
    for fid, (d, *_rest) in FLOWS.items():
        o.append(f'<path id="p-{fid}" d="{d}"/>')
    o += ["</defs>",
          "<style>",
          f"text{{font-family:{FONT}}} .cat{{font-size:10px;font-weight:700;letter-spacing:.12em}} "
          ".title{font-size:15px;font-weight:650} .sub{font-size:12px} "
          ".flow{fill:none;stroke-width:2;stroke-dasharray:5 7;animation:dash 1.1s linear infinite} "
          ".hi{fill:none;stroke-width:3.5;stroke-linecap:round} "
          "@keyframes dash{to{stroke-dashoffset:-12}} "
          "@media (prefers-reduced-motion: reduce){.flow{animation:none}}",
          "</style>",
          f'<rect width="{W}" height="{H}" rx="20" fill="{t["bg"]}"/>']

    # account boundary + labels
    o.append(f'<rect x="270" y="70" width="730" height="604" rx="18" fill="none" stroke="{t["boundary"]}" '
             f'stroke-opacity=".55" stroke-dasharray="7 6"/>')
    o.append(f'<text x="290" y="96" class="cat" fill="{t["boundary"]}">YOUR AWS ACCOUNT · ONE CDK STACK · NO SERVERS</text>')
    o.append(f'<text x="1050" y="418" class="cat" fill="{t["muted"]}">OUTSIDE AWS</text>')

    # legend
    o.append(f'<g transform="translate(1050 110)"><rect width="190" height="150" rx="12" fill="{t["card"]}" stroke="{t["border"]}"/>'
             f'<text x="16" y="26" class="cat" fill="{t["muted"]}">FLOWS</text>')
    for i, (label, colour) in enumerate([("Load the app", BLUE), ("Sign in & credentials", VIOLET),
                                         ("Your data (direct to S3)", GREEN), ("Extraction", AMBER)]):
        o.append(f'<circle cx="22" cy="{50 + 24 * i}" r="5" fill="{colour}"/>'
                 f'<text x="36" y="{54 + 24 * i}" class="sub" fill="{t["text"]}">{escape(label)}</text>')
    o.append("</g>")

    # connectors: faint flowing dashes always, a bright overlay while their step is active
    for fid, (d, colour, steps, arrow) in FLOWS.items():
        mname = {BLUE: "blue", VIOLET: "violet", GREEN: "green", AMBER: "amber", GREY: "grey"}[colour]
        marker = f' marker-end="url(#m-{mname})"' if arrow else ""
        o.append(f'<path d="{d}" class="flow" stroke="{colour}" stroke-opacity="{0.55 if steps else 0.45}"{marker}/>')
        for s in steps:
            o.append(f'<path d="{d}" class="hi" stroke="{colour}" opacity="0" filter="url(#glow)">{opacity_anim(s, 0, 0.9)}</path>')

    # Lambda "working" halo during steps 5-6
    x, y, w, h = BOXES["lambda"][:4]
    o.append(f'<rect x="{x - 5}" y="{y - 5}" width="{w + 10}" height="{h + 10}" rx="16" fill="none" stroke="{AMBER}" '
             f'stroke-width="2" opacity="0">{opacity_anim(5, 0, 0.8)}</rect>')
    o.append(f'<rect x="{x - 5}" y="{y - 5}" width="{w + 10}" height="{h + 10}" rx="16" fill="none" stroke="{AMBER}" '
             f'stroke-width="2" opacity="0">{opacity_anim(6, 0, 0.8)}</rect>')

    # boxes on top of the lines
    o += [box(t, k) for k in BOXES]

    # packets: a short comet of three dots per route, drawn above the boxes' edges
    for n, (routes, colour, _caption) in enumerate(STEPS, start=1):
        for r_i, fid in enumerate(routes):
            part = (r_i / len(routes), (r_i + 1) / len(routes))
            for k, (radius, alpha) in enumerate([(5.5, 1), (4, 0.6), (3, 0.35)]):
                o.append(f'<circle r="{radius}" fill="{colour}" opacity="0" filter="url(#glow)">'
                         f'{motion_anim(n, fid, -0.006 * k, part)}{opacity_anim(n, 0, alpha)}</circle>')

    # numbered step badges
    for n, (bx, by) in BADGES.items():
        colour = STEPS[n - 1][1]
        o.append(f'<g><circle cx="{bx}" cy="{by}" r="11" fill="{t["card"]}" stroke="{colour}" stroke-width="1.5"/>'
                 f'<circle cx="{bx}" cy="{by}" r="11" fill="{colour}" opacity="0">{opacity_anim(n, 0, 1)}</circle>'
                 f'<text x="{bx}" y="{by + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="{t["text"]}">{n}'
                 f'</text><text x="{bx}" y="{by + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" '
                 f'opacity="0">{n}{opacity_anim(n, 0, 1)}</text></g>')

    # caption bar: one sentence per step
    o.append(f'<rect x="40" y="692" width="{W - 80}" height="44" rx="12" fill="{t["caption_bg"]}"/>')
    for n, (_r, colour, caption) in enumerate(STEPS, start=1):
        o.append(f'<g opacity="0">{opacity_anim(n, 0, 1)}'
                 f'<circle cx="68" cy="714" r="11" fill="{colour}"/>'
                 f'<text x="68" y="718" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">{n}</text>'
                 f'<text x="90" y="719" font-size="14" fill="{t["text"]}">{escape(caption)}</text></g>')
    o.append("</svg>")
    return "\n".join(o)


if __name__ == "__main__":
    here = Path(__file__).resolve().parent
    for name in THEMES:
        (here / f"architecture-{name}.svg").write_text(render(name), encoding="utf-8")
        print(f"wrote {here / f'architecture-{name}.svg'}")
