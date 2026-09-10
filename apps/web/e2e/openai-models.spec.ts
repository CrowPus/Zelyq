import { expect, test } from "@playwright/test";
import { OPENAI_MODELS, withOpenAIAuto } from "@zelyq/core";

const models = withOpenAIAuto(OPENAI_MODELS);
const password = "openai-browser-fixture-password";
test.beforeEach(async ({ page }) => {
  const response = await page.request.post("/api/auth/register", {
    data: {
      email: `openai-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`,
      name: "OpenAI tester",
      password,
    },
  });
  expect(response.status()).toBe(201);
});
test.afterEach(async ({ page }) => {
  await page.request.delete("/api/auth/me", { data: { password } });
});

test("project chat offers current OpenAI models and expands older models", async ({ page }) => {
  await page.route("**/api/providers", (route) =>
    route.fulfill({
      json: {
        default: "openai",
        providers: [
          {
            id: "openai",
            label: "OpenAI",
            configured: true,
            defaultModel: "gpt-5.6-terra",
            models,
            modelAvailability: "verified",
            modelNotice: "Models listed for your API key.",
          },
        ],
      },
    }),
  );
  const created = await page.request.post("/api/projects", {
    data: { name: "OpenAI selector check", template: "vite-react" },
  });
  expect(created.status()).toBe(201);
  await page.goto(`/projects/${(await created.json()).project.id}`);
  const picker = page.getByRole("button", { name: "Choose a model for this conversation" });
  await picker.click();
  const menu = page.getByRole("menu");
  for (const name of [
    "GPT-6 Astra",
    "GPT-5.6 Sol",
    "GPT-5.6 Terra",
    "GPT-5.6 Luna",
    "GPT-5.3 Codex",
  ])
    await expect(menu.getByRole("menuitem", { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "GPT-5.5", exact: true })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "More models…" }).click();
  await expect(menu.getByRole("menuitem", { name: /GPT-5.5 Previous generation/ })).toBeVisible();
  await menu.getByRole("menuitem", { name: /GPT-6 Astra/ }).click();
  await expect(picker).toHaveText("GPT-6 Astra");
  await picker.click();
  await menu.getByRole("menuitem", { name: /^Auto/ }).click();
  await expect(picker).toHaveText("Auto");
  await picker.click();
  await page.screenshot({ path: "/tmp/zelyq-openai-chat-picker.png" });
});

test("Settings saves a selected model and preserves custom IDs", async ({ page }) => {
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
            placeholder: "Default: GPT-5.6 Terra",
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
  const picker = page.getByRole("combobox", { name: "OpenAI model suggestions" });
  await picker.selectOption("gpt-6-astra");
  await expect(page.getByRole("textbox", { name: "Model", exact: true })).toHaveValue(
    "gpt-6-astra",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toHaveText("Saved");
  await page.reload();
  await expect(picker).toHaveValue("gpt-6-astra");
  await page
    .getByRole("heading", { name: "Model", exact: true })
    .locator("..")
    .screenshot({ path: "/tmp/zelyq-openai-settings.png" });
  await page.getByRole("textbox", { name: "Model", exact: true }).fill("my-custom-openai-model");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toHaveText("Saved");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Model", exact: true })).toHaveValue(
    "my-custom-openai-model",
  );
});
