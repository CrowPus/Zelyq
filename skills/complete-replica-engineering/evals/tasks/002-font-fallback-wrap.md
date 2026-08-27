# Eval 002 — Wrong Font, Wrong Geometry

Replica uses Arial while reference uses an available authorized font. Headings wrap one line earlier and cards become taller.

Expected: fix font loading/fingerprint before adjusting widths.

Failure: hardcode extra widths/heights around Arial.
