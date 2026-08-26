# Zelyq Application Security Engineering

This skill turns security into a senior engineering discipline rather than a scanner/pentest prompt.

It was informed by the useful methodology in the provided Strix prompt — especially strict scope, source+runtime correlation, systematic attack-surface understanding, mandatory validation, independent confirmation for meaningful findings, impact-based reporting, and remediation tied to each confirmed issue — while deliberately replacing indiscriminate exploitation/payload spraying with safer, risk-based validation.

The package uses:
- OWASP ASVS 5.0.0 for security requirements;
- OWASP Top 10:2025 and API Security Top 10:2023 for risk awareness;
- OWASP WSTG for web testing methodology;
- OWASP Cheat Sheet Series for implementation guidance;
- OWASP SAMM and NIST SSDF for lifecycle maturity;
- CWE Top 25:2025 for weakness taxonomy awareness;
- CVSS 4.0 for technical severity communication where useful.

The core is `SKILL.md`. Detailed knowledge is progressively loaded from `references/`, system-specific behavior from `profiles/`, repeatable methods from `recipes/`, and judgment is tested in `evals/`.
