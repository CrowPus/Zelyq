import assert from "node:assert/strict";
import { it, describe as suite } from "node:test";
import { scopeRelevant } from "../evals/checks.js";

/**
 * `max_files_changed` is the restraint check: it has to count scope decisions,
 * not files. Every case below is a real file list from the 2026-08-31 /
 * 2026-09-01 runs of the same five cases across three models, so this suite is
 * a regression test against the actual behaviour that motivated the change —
 * and, just as importantly, against over-correcting it.
 */
suite("scopeRelevant", () => {
  it("discounts the manifest and its lockfiles", () => {
    assert.deepEqual(
      scopeRelevant(["package.json", "package-lock.json", "pnpm-lock.yaml", "src/App.tsx"]),
      ["src/App.tsx"],
    );
  });

  it("keeps counting the entry document and the global stylesheet", () => {
    // These are scope decisions, not side effects. Discounting them would let
    // the landing-page failure below pass.
    assert.deepEqual(scopeRelevant(["index.html", "src/index.css"]), [
      "index.html",
      "src/index.css",
    ]);
  });

  it("passes the correct decomposition that the raw count failed (todo-app, cap 6)", () => {
    const changed = [
      "package.json",
      "src/App.tsx",
      "src/components/AddTodoForm.tsx",
      "src/components/TodoItem.tsx",
      "src/components/TodoList.tsx",
      "src/types.ts",
      "src/useTodos.ts",
    ];
    assert.equal(changed.length, 7, "raw count failed the cap of 6");
    assert.equal(scopeRelevant(changed).length, 6, "every remaining file is part of the todo list");
  });

  it("passes pricing-toggle, which failed by one manifest file (cap 7)", () => {
    const changed = [
      "index.html",
      "package.json",
      "src/App.tsx",
      "src/index.css",
      "src/pricing/BillingToggle.tsx",
      "src/pricing/PlanCard.tsx",
      "src/pricing/PricingSection.tsx",
      "src/pricing/plans.ts",
    ];
    assert.equal(changed.length, 8, "raw count failed the cap of 7");
    assert.equal(scopeRelevant(changed).length, 7);
  });

  it("STILL fails landing-page, where components nobody asked for were built (cap 7)", () => {
    // The request named a hero, three feature cards and a footer. Wordmark and
    // AnnotatedPage are the invented scope this check exists to catch, and the
    // check must keep catching it.
    const changed = [
      "index.html",
      "package.json",
      "src/App.tsx",
      "src/components/AnnotatedPage.tsx",
      "src/components/Features.tsx",
      "src/components/Footer.tsx",
      "src/components/Hero.tsx",
      "src/components/Wordmark.tsx",
      "src/index.css",
    ];
    assert.equal(scopeRelevant(changed).length, 8, "still over the cap of 7");
    assert.ok(scopeRelevant(changed).includes("src/components/Wordmark.tsx"));
  });

  it("still fails a todo app that invented a filter nobody asked for (cap 6)", () => {
    const changed = [
      "package.json",
      "src/App.tsx",
      "src/components/EmptyState.tsx",
      "src/components/TodoFilter.tsx",
      "src/components/TodoHeader.tsx",
      "src/components/TodoInput.tsx",
      "src/components/TodoItem.tsx",
      "src/hooks/useTodos.ts",
      "src/types/todo.ts",
    ];
    assert.equal(scopeRelevant(changed).length, 8, "still over the cap of 6");
  });

  it("leaves a single-file implementation exactly where it was", () => {
    assert.deepEqual(scopeRelevant(["src/App.tsx"]), ["src/App.tsx"]);
  });
});
