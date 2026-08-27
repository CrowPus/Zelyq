#!/usr/bin/env python3
from PIL import Image, ImageChops
import sys, json, math

if len(sys.argv) < 3:
    print("Usage: compare-images.py <reference.png> <replica.png> [diff.png]", file=sys.stderr)
    sys.exit(2)

ref_path, rep_path = sys.argv[1], sys.argv[2]
diff_path = sys.argv[3] if len(sys.argv) > 3 else "visual-diff.png"

a = Image.open(ref_path).convert("RGBA")
b = Image.open(rep_path).convert("RGBA")

if a.size != b.size:
    print(json.dumps({"match": False, "reason": "size_mismatch", "reference": a.size, "replica": b.size}, indent=2))
    sys.exit(1)

diff = ImageChops.difference(a, b)
bbox = diff.getbbox()
pixels = a.width * a.height

changed = 0
sum_sq = 0
for px in diff.getdata():
    if px[:3] != (0,0,0):
        changed += 1
    sum_sq += px[0]**2 + px[1]**2 + px[2]**2

ratio = changed / pixels if pixels else 0
rmse = math.sqrt(sum_sq / (pixels * 3)) if pixels else 0

diff.save(diff_path)
print(json.dumps({
    "match": bbox is None,
    "width": a.width,
    "height": a.height,
    "changed_pixels": changed,
    "changed_ratio": ratio,
    "rgb_rmse": rmse,
    "diff_path": diff_path,
}, indent=2))
sys.exit(0 if bbox is None else 1)
