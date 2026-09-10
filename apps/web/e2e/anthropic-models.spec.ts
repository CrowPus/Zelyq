import { expect, test } from "@playwright/test";
import { ANTHROPIC_MODELS, withAnthropicAuto } from "@zelyq/core";

const models = withAnthropicAuto(ANTHROPIC_MODELS);
const password = "anthropic-browser-fixture-password";

test.beforeEach(async ({ page }) => {
  const response = await page.request.post("/api/auth/register", {
    data: {
      email: `anthropic-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`,
      name: "Anthropic tester",
      password,
    },
  });
  expect(response.status()).toBe(201);
});
test.afterEach(async ({ page }) => {
  await page.request.delete("/api/auth/me", { data: { password } });
});

test("project chat offers current Claude models and expands older ones", async ({ page }) => {
  await page.route("**/api/providers", (route) =>
    route.fulfill({
      json: {
        default: "anthropic",
        providers: [
          {
            id: "anthropic",
            label: "Claude",
            configured: true,
            defaultModel: "claude-opus-5",
            models,
            modelAvailability: "verified",
            modelNotice: "Models listed for your API key.",
          },
        ],
      },
    }),
  );
  const created = await page.request.post("/api/projects", {
    data: { name: "Claude selector check", template: "vite-react" },
  });
  expect(created.status()).toBe(201);
  await page.goto(`/projects/${(await created.json()).project.id}`);

  const picker = page.getByRole("button", { name: "Choose a model for this conversation" });
  await picker.click();
  const menu = page.getByRole("menu");
  for (const name of [
    "Claude Opus 5",
    "Claude Fable 5\\.1",
    "Claude Sonnet 5",
    "Claude Haiku 4\\.5",
  ])
    await expect(menu.getByRole("menuitem", { name: new RegExp(`^${name}`) })).toBeVisible();

  // Previous-generation models stay behind "More models…".
  await expect(menu.getByRole("menuitem", { name: "Claude Opus 4.8", exact: true })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "More models…" }).click();
  await expect(
    menu.getByRole("menuitem", { name: /Claude Opus 4\.8 Previous generation/ }),
  ).toBeVisible();

  await menu.getByRole("menuitem", { name: /Claude Sonnet 5/ }).click();
  await expect(picker).toHaveText("Claude Sonnet 5");
  await picker.click();
  await menu.getByRole("menuitem", { name: /^Auto/ }).click();
  await expect(picker).toHaveText("Auto");
});

test("Settings saves a selected Claude model and preserves custom IDs", async ({ page }) => {
  let selected = "";
  const response = () => ({
    restartPending: false,
    groups: [
      {
        name: "Model",
        description: "Model settings",
        fields: [
          {
            key: "model",
            label: "Model",
            description: "Choose the model used by default.",
            kind: "text",
            group: "Model",
            value: selected,
            source: "database",
            envVar: "ZELYQ_MODEL",
            managedByEnv: false,
            restartRequired: false,
            suggestions: models.map((model) => model.value),
            modelOptions: models,
            modelNotice: "Models listed for your API key.",
            placeholder: "Default: claude-opus-5",
          },
        ],
      },
    ],
  });
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT") selected = route.request().postDataJSON().model;
    await route.fulfill({ json: response() });
  });

  await page.goto("/settings");
  const picker = page.getByRole("combobox", { name: "Model suggestions" });
  await picker.selectOption("claude-fable-5-1");
  await expect(page.getByRole("textbox", { name: "Model", exact: true })).toHaveValue(
    "claude-fable-5-1",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toHaveText("Saved");
  await page.reload();
  await expect(picker).toHaveValue("claude-fable-5-1");

  // A model typed by hand still wins over the curated list.
  await page.getByRole("textbox", { name: "Model", exact: true }).fill("my-custom-claude-model");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toHaveText("Saved");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Model", exact: true })).toHaveValue(
    "my-custom-claude-model",
  );
});
