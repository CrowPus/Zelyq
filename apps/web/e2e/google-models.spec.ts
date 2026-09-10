import { expect, test } from "@playwright/test";
import { GOOGLE_MODELS, withGoogleAuto } from "@zelyq/core";

const models = withGoogleAuto(GOOGLE_MODELS);
const password = "google-browser-fixture-password";

test.beforeEach(async ({ page }) => {
  const response = await page.request.post("/api/auth/register", {
    data: {
      email: `google-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`,
      name: "Gemini tester",
      password,
    },
  });
  expect(response.status()).toBe(201);
});
test.afterEach(async ({ page }) => {
  await page.request.delete("/api/auth/me", { data: { password } });
});

test("project chat offers current Gemini models and hides the 2.5 family behind More models", async ({
  page,
}) => {
  await page.route("**/api/providers", (route) =>
    route.fulfill({
      json: {
        default: "google",
        providers: [
          {
            id: "google",
            label: "Gemini",
            configured: true,
            defaultModel: "gemini-pro-latest",
            models,
            modelAvailability: "verified",
            modelNotice: "Models listed for your API key.",
          },
        ],
      },
    }),
  );
  const created = await page.request.post("/api/projects", {
    data: { name: "Gemini selector check", template: "vite-react" },
  });
  expect(created.status()).toBe(201);
  await page.goto(`/projects/${(await created.json()).project.id}`);

  const picker = page.getByRole("button", { name: "Choose a model for this conversation" });
  await picker.click();
  const menu = page.getByRole("menu");
  for (const name of [
    "Gemini Pro \\(latest\\)",
    "Gemini 3\\.8 Flash",
    "Gemini Flash \\(latest\\)",
    "Gemini Flash Lite \\(latest\\)",
  ])
    await expect(menu.getByRole("menuitem", { name: new RegExp(`^${name}`) })).toBeVisible();

  // The legacy 2.5 line stays out of the way.
  await expect(menu.getByRole("menuitem", { name: "Gemini 2.5 Pro", exact: true })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "More models…" }).click();
  await expect(menu.getByRole("menuitem", { name: /Gemini 2\.5 Pro Legacy/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Gemini 3\.7 Flash Previous/ })).toBeVisible();

  await menu.getByRole("menuitem", { name: /Gemini 3\.8 Flash/ }).click();
  await expect(picker).toHaveText("Gemini 3.8 Flash");
  await picker.click();
  await menu.getByRole("menuitem", { name: /^Auto/ }).click();
  await expect(picker).toHaveText("Auto");
});

test("Settings saves a selected Gemini model and preserves custom IDs", async ({ page }) => {
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
            placeholder: "Default: gemini-pro-latest",
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
  await picker.selectOption("gemini-3.8-flash");
  await expect(page.getByRole("textbox", { name: "Model", exact: true })).toHaveValue(
    "gemini-3.8-flash",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toHaveText("Saved");
  await page.reload();
  await expect(picker).toHaveValue("gemini-3.8-flash");

  await page.getByRole("textbox", { name: "Model", exact: true }).fill("gemini-custom-preview");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toHaveText("Saved");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Model", exact: true })).toHaveValue(
    "gemini-custom-preview",
  );
});
