import assert from "node:assert/strict";
import { it, describe as suite } from "node:test";
import { unrequestedComponents } from "../evals/checks.js";

/**
 * `no_unrequested_components` is the direct form of the restraint check:
 * `max_files_changed` counts files and so cannot tell a clean decomposition of
 * the asked-for feature from components nobody asked for. This one names the
 * second kind. Every file list below is a real diff from the 2026-08-31 /
 * 2026-09-01 runs across three models, the same data the `scopeRelevant` suite
 * guards — so the two together pin both halves of F6.
 */
suite("unrequestedComponents", () => {
  it("passes a clean decomposition of exactly what was asked (todo-app)", () => {
    const created = [
      "src/App.tsx",
      "src/components/AddTodoForm.tsx",
      "src/components/TodoItem.tsx",
      "src/components/TodoList.tsx",
      "src/types.ts",
      "src/useTodos.ts",
    ];
    assert.deepEqual(unrequestedComponents(created, ["Todo", "Add", "Item", "Input"]), []);
  });

  it("catches the filter a todo app invented, and only that", () => {
    const created = [
      "src/App.tsx",
      "src/components/TodoInput.tsx",
      "src/components/TodoItem.tsx",
      "src/components/TodoFilter.tsx",
      "src/hooks/useTodos.ts",
      "src/types/todo.ts",
    ];
    assert.deepEqual(unrequestedComponents(created, ["Todo", "Add", "Item", "Input"]), [
      "src/components/TodoFilter.tsx",
    ]);
  });

  it("passes the pricing decomposition that lost to a monolith on file count", () => {
    const created = [
      "src/App.tsx",
      "src/pricing/BillingToggle.tsx",
      "src/pricing/PlanCard.tsx",
      "src/pricing/PricingSection.tsx",
      "src/pricing/plans.ts",
    ];
    assert.deepEqual(
      unrequestedComponents(created, ["Pricing", "Plan", "Tier", "Toggle", "Billing"]),
      [],
    );
  });

  it("catches Wordmark and AnnotatedPage on landing-page — the real F6 failure", () => {
    const created = [
      "src/App.tsx",
      "src/components/AnnotatedPage.tsx",
      "src/components/Features.tsx",
      "src/components/Footer.tsx",
      "src/components/Hero.tsx",
      "src/components/Wordmark.tsx",
    ];
    assert.deepEqual(
      unrequestedComponents(created, ["Hero", "Feature", "Footer", "CallToAction", "Cta"]),
      ["src/components/AnnotatedPage.tsx", "src/components/Wordmark.tsx"],
    );
  });

  it("a single-file implementation invents nothing", () => {
    assert.deepEqual(unrequestedComponents(["src/App.tsx"], ["Hero", "Feature", "Footer"]), []);
  });

  it("ignores non-component files — hooks, types, modules", () => {
    const created = ["src/useTodos.ts", "src/types.ts", "src/lib/format.ts", "src/plans.ts"];
    assert.deepEqual(unrequestedComponents(created, []), []);
  });

  it("a layout noun is not a feature claim: PlanCard needs only Plan", () => {
    assert.deepEqual(unrequestedComponents(["src/PlanCard.tsx"], ["Plan"]), []);
    assert.deepEqual(unrequestedComponents(["src/PlanComparison.tsx"], ["Plan"]), [
      "src/PlanComparison.tsx",
    ]);
  });

  it("plurals and stems match: Features ⇄ Feature, Stats ⇄ Stat", () => {
    assert.deepEqual(
      unrequestedComponents(["src/Features.tsx", "src/StatGrid.tsx"], ["Feature", "Stat"]),
      [],
    );
  });

  it("entry-point renames are neutral", () => {
    assert.deepEqual(
      unrequestedComponents(["src/App.tsx", "src/Root.tsx", "src/Router.tsx"], []),
      [],
    );
  });

  it("only looks at newly created files — a modified component is not invention", () => {
    // `unrequestedComponents` is handed the created set by the check; a file
    // that already existed never reaches it. Documented here so the contract is
    // explicit.
    assert.deepEqual(unrequestedComponents([], ["Hero"]), []);
  });
});
