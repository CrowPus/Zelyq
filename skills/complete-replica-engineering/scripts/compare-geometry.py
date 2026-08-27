#!/usr/bin/env python3
import json, sys

if len(sys.argv) < 3:
    print("Usage: compare-geometry.py <reference.json> <replica.json> [tolerance_px]", file=sys.stderr)
    sys.exit(2)

ref = json.load(open(sys.argv[1], encoding="utf-8"))
rep = json.load(open(sys.argv[2], encoding="utf-8"))
tol = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0

issues = []

for selector, ref_items in ref.get("data", {}).items():
    rep_items = rep.get("data", {}).get(selector, [])
    if len(ref_items) != len(rep_items):
        issues.append({
            "selector": selector,
            "type": "count",
            "reference": len(ref_items),
            "replica": len(rep_items),
        })
    for i, a in enumerate(ref_items[:len(rep_items)]):
        b = rep_items[i]
        for key in ("x","y","width","height"):
            av = float(a["rect"][key]); bv = float(b["rect"][key])
            delta = bv - av
            if abs(delta) > tol:
                issues.append({
                    "selector": selector,
                    "index": i,
                    "property": key,
                    "reference": av,
                    "replica": bv,
                    "delta": delta,
                })

print(json.dumps({
    "tolerance_px": tol,
    "issue_count": len(issues),
    "issues": issues,
}, indent=2))

sys.exit(1 if issues else 0)
