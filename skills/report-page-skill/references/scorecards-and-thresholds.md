# Scorecards and Thresholds

A score should communicate:
- value;
- denominator/scale;
- direction;
- interpretation;
- threshold/reference.

`55` alone is weak.
`55.0 / 100 — REJECT — threshold 70` is interpretable.

Good visual encodings:
- tabular number + bar;
- number + threshold marker;
- labeled state chip + score;
- position against reference.

Avoid:
- gauge charts for every metric;
- color-only pass/fail;
- giant score without denominator;
- hidden threshold.

If bar length encodes a 0–100 bounded score, use the full meaningful scale.

If scale is not naturally zero-based, label the range and avoid implying a false zero.

Use source precision.

Number sections/items only if rank itself has meaning.
