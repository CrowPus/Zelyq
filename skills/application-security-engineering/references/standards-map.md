# Standards Map

Use standards according to purpose.

## OWASP ASVS 5.0.0 — verification requirements
Primary baseline for defining and verifying web application security requirements.

Latest stable: 5.0.0, released May 2025.

ASVS 5.0 contains about 345 requirements across 17 chapters and explicitly supports tailoring irrelevant chapters/sections by application context and risk.

Use versioned requirement references where possible:
`v5.0.0-<requirement>`.

Sources:
- https://owasp.org/www-project-application-security-verification-standard/
- https://github.com/OWASP/ASVS

## OWASP Top 10:2025 — awareness
Current categories:
1. Broken Access Control
2. Security Misconfiguration
3. Software Supply Chain Failures
4. Cryptographic Failures
5. Injection
6. Insecure Design
7. Authentication Failures
8. Software or Data Integrity Failures
9. Security Logging and Alerting Failures
10. Mishandling of Exceptional Conditions

Top 10 is an awareness document, not a complete verification standard.

Source:
https://owasp.org/Top10/

## OWASP API Security Top 10:2023
Use for API-specific awareness:
- object-level authorization;
- authentication;
- object-property authorization;
- resource consumption;
- function-level authorization;
- sensitive business flows;
- SSRF;
- misconfiguration;
- inventory;
- unsafe consumption of APIs.

Source:
https://owasp.org/API-Security/editions/2023/en/0x11-t10/

## OWASP WSTG
Use for web application testing methodology and test scenarios.

Stable guide:
https://owasp.org/www-project-web-security-testing-guide/stable/

The latest development guide is evolving toward v5. Use stable or versioned references in durable reports.

## OWASP Cheat Sheet Series
Use for implementation/remediation guidance:
https://cheatsheetseries.owasp.org/

## OWASP SAMM
Security maturity model with five business functions:
- Governance
- Design
- Implementation
- Verification
- Operations

Source:
https://owaspsamm.org/model/

## NIST SSDF
NIST SP 800-218 v1.1 is the current final SSDF. NIST published an initial public draft of SSDF 1.2 in December 2025; do not call the draft final.

Source:
https://csrc.nist.gov/projects/ssdf

## CWE
Use CWE for root-cause taxonomy.

Current CWE Top 25 is the 2025 list:
https://cwe.mitre.org/top25/

Do not treat Top 25 as a complete test plan.

## CVSS
CVSS v4.0 is the current FIRST severity framework.

When publishing a CVSS score, provide the vector so the reasoning is inspectable.

Source:
https://www.first.org/cvss/v4.0/

## Principle

Use:
- ASVS for "what must hold";
- threat modeling for "what matters here";
- WSTG/testing for "how to verify";
- Cheat Sheets for "how to implement/fix";
- CWE for "what root weakness is this";
- CVSS + business context for "how severe/urgent";
- SAMM/SSDF for "how the organization builds security continuously".
