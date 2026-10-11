import type { TestSummary } from "@zelyq/core";
import { XMLParser } from "fast-xml-parser";

/**
 * Reads JUnit XML — what Jest, Vitest, pytest, Go, JUnit, PHPUnit and .NET
 * test tools write — into a summary: how many passed, failed and were
 * skipped, and what each failure said.
 */

const MAX_FAILURES = 100;
const MAX_TEXT = 4000;

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text",
  isArray: (name) => ["testsuite", "testcase", "failure", "error", "skipped"].includes(name),
  // Test reports never need entities beyond the XML basics.
  processEntities: true,
  htmlEntities: false,
});

function list(value: unknown): Node[] {
  if (Array.isArray(value)) return value as Node[];
  return value && typeof value === "object" ? [value as Node] : [];
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const node = value as Node;
    return String(node.message ?? node["#text"] ?? "");
  }
  return "";
}

/** Adds one JUnit document to a running summary. Throws when it is not XML. */
export function addJunit(summary: TestSummary, xml: string): void {
  const document = parser.parse(xml) as Node;
  const suites = [
    ...list((document.testsuites as Node | undefined)?.testsuite),
    ...list(document.testsuite),
  ];
  const walk = (suite: Node) => {
    for (const nested of list(suite.testsuite)) walk(nested);
    for (const test of list(suite.testcase)) {
      const failures = [...list(test.failure), ...list(test.error)];
      if (failures.length > 0) {
        summary.failed += 1;
        if (summary.failures.length < MAX_FAILURES) {
          const first = failures[0] as Node;
          summary.failures.push({
            name: String(test.name ?? "(unnamed)"),
            suite: String(test.classname ?? suite.name ?? ""),
            message: text(first.message ?? first).slice(0, 500),
            details: String(first["#text"] ?? "")
              .trim()
              .slice(0, MAX_TEXT),
          });
        }
      } else if (test.skipped !== undefined) {
        summary.skipped += 1;
      } else {
        summary.passed += 1;
      }
    }
  };
  for (const suite of suites) walk(suite);
}

export function emptySummary(): TestSummary {
  return { passed: 0, failed: 0, skipped: 0, failures: [] };
}
