import { expect, type Page, test } from "@playwright/test";

/**
 * How the main pages look, in both themes and on a phone, compared with the
 * screenshots committed in __screenshots__. A failure attaches the expected,
 * actual and difference images to the run. When a change is meant to alter
 * a page, refresh them with `scripts/quality.sh --update` and commit them
 * with the change, so the review shows the new look.
 *
 * Anything that differs from run to run (times, ids) is masked.
 */

const PASSWORD = "e2e-Passw0rd!23";
const EMAIL = "vera.visual@example.invalid";

async function signIn(page: Page): Promise<{ slug: string; id: string }> {
  // The first account on a server becomes its admin, which changes the
  // sidebar. Take that place with someone else, whatever ran before.
  await page.request.post("/api/auth/register", {
    data: { email: "first.admin@example.invalid", name: "First Admin", password: PASSWORD },
  });
  const registered = await page.request.post("/api/auth/register", {
    data: { email: EMAIL, name: "Vera Visual", password: PASSWORD },
  });
  if (registered.status() !== 201) {
    const login = await page.request.post("/api/auth/login", {
      data: { email: EMAIL, password: PASSWORD },
    });
    expect(login.ok(), await login.text()).toBe(true);
  }
  const me = await (await page.request.get("/api/auth/me")).json();
  return me.teams[0];
}

/** Content that makes the pages worth looking at, made once. */
async function seed(page: Page, team: { id: string }) {
  const projects = (await (await page.request.get("/api/projects")).json()).projects ?? [];
  if (projects.length === 0) {
    const made = await page.request.post("/api/projects", {
      data: { name: "Harbour Café", template: "vite-react", teamId: team.id },
    });
    expect(made.status(), await made.text()).toBe(201);
  }
  const vault =
    (await (await page.request.get(`/api/teams/${team.id}/vault`)).json()).secrets ?? [];
  if (vault.length === 0) {
    for (const [name, description, isProtected] of [
      ["STRIPE_KEY_LIVE", "Payments in production", true],
      ["STRIPE_KEY_TEST", "Payments while testing", false],
      ["SMTP_PASSWORD", null, false],
    ] as const) {
      await page.request.post(`/api/teams/${team.id}/vault`, {
        data: { name, value: `value-of-${name}`, description, protected: isProtected },
      });
    }
  }
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  // Skeletons and lazy panels have a frame or two to land.
  await page.waitForTimeout(400);
}

const volatile = (page: Page) => [page.locator("time"), page.locator("[data-volatile]")];

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => {
        try {
          localStorage.setItem("zelyq.theme", value);
          localStorage.setItem("zelyq.lang", "en");
          // The moving background texture never draws the same frame twice.
          localStorage.setItem("zelyq.texture", "off");
        } catch {
          // The theme follows colorScheme instead.
        }
      }, theme);
    });

    test(`sign-in page · ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/signin");
      await settle(page);
      await expect(page).toHaveScreenshot(`signin-${theme}.png`);
    });

    test(`team pages · ${theme}`, async ({ page }) => {
      test.setTimeout(5 * 60_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      const team = await signIn(page);
      await seed(page, team);
      const pages: Array<[string, string]> = [
        ["home", `/${team.slug}`],
        ["apps", `/${team.slug}/apps`],
        ["members", `/${team.slug}/members`],
        ["vault", `/${team.slug}/vault`],
        ["pipelines", `/${team.slug}/pipelines`],
        ["team-settings", `/${team.slug}/settings`],
        ["account", "/account"],
      ];
      for (const [name, path] of pages) {
        await page.goto(path);
        await settle(page);
        await expect(page, name).toHaveScreenshot(`${name}-${theme}.png`, {
          mask: volatile(page),
        });
      }
    });

    test(`phone · ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const team = await signIn(page);
      await seed(page, team);
      for (const [name, path] of [
        ["home", `/${team.slug}`],
        ["vault", `/${team.slug}/vault`],
      ] as const) {
        await page.goto(path);
        await settle(page);
        await expect(page, name).toHaveScreenshot(`phone-${name}-${theme}.png`, {
          mask: volatile(page),
        });
      }
    });
  });
}
