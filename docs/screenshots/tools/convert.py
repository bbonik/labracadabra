"""Convert raw 2x/3x PNG shots to WebP for the README and build the animated tour."""
import sys
from pathlib import Path
from PIL import Image

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
for p in sorted(src.glob("*.png")):
    im = Image.open(p).convert("RGB")
    if p.stem.startswith("phone-"):
        im = im.resize((780, round(im.height * 780 / im.width)), Image.LANCZOS)
    im.save(dst / f"{p.stem}.webp", "WEBP", quality=86, method=6)

# animated tour: 16:10 windows of key screens, 1440x900, with short cross-fades
TOUR = [("overview", 0), ("blood-panels", 0), ("explore-side-by-side", 0), ("test-ldl-dark", 0),
        ("explore-scatter", 0), ("explore-heatmap", None), ("explore-over-time", 0)]
frames = []
for name, top in TOUR:
    im = Image.open(src / f"{name}.png").convert("RGB")
    h = im.width * 10 // 16
    if top is None:
        top = max(0, im.height - h)  # bottom window (the heatmap sits below the test chips)
    frames.append(im.crop((0, top, im.width, top + h)).resize((1440, 900), Image.LANCZOS))
seq, dur = [], []
for i, f in enumerate(frames):
    seq.append(f); dur.append(2600)
    nxt = frames[(i + 1) % len(frames)]
    for k in (1, 2, 3):
        seq.append(Image.blend(f, nxt, k / 4)); dur.append(70)
seq[0].save(dst / "tour.webp", "WEBP", save_all=True, append_images=seq[1:], duration=dur, loop=0, quality=80, method=6)
for f in sorted(dst.glob("*.webp")):
    print(f"{f.name:34s} {f.stat().st_size // 1024:5d} KB")
