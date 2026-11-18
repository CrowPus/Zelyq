import assert from "node:assert/strict";
import { test } from "node:test";
import { ARTICLE_IDS, articleFor, loadArticles } from "../src/help/articles.js";

/**
 * Help is written once per language. Every language must have every article,
 * with a title and a body, or a reader lands on an empty panel.
 */

test("every language has every help article", async () => {
  for (const language of ["en", "fr", "de"]) {
    const articles = await loadArticles(language);
    assert.deepEqual(Object.keys(articles).sort(), [...ARTICLE_IDS].sort(), language);
    for (const id of ARTICLE_IDS) {
      assert.ok(articles[id].title.trim(), `${language}/${id} has a title`);
      assert.ok(articles[id].body.length > 200, `${language}/${id} has a body`);
    }
  }
});

test("translations keep the same paragraphs and lists as English", async () => {
  const en = await loadArticles("en");
  const shape = (body: string) =>
    body.split("\n").map((line) => (line.startsWith("- ") ? "-" : line.trim() ? "p" : ""));
  for (const language of ["fr", "de"]) {
    const other = await loadArticles(language);
    for (const id of ARTICLE_IDS) {
      assert.deepEqual(shape(other[id].body), shape(en[id].body), `${language}/${id}`);
    }
  }
});

test("a language without help gets English", async () => {
  const en = await loadArticles("en");
  assert.equal((await loadArticles("pseudo")).start.title, en.start.title);
});

test("each page opens its own article", () => {
  const cases: Array<[string, string]> = [
    ["/default", "start"],
    ["/default/apps", "apps"],
    ["/default/apps/prj_1", "build"],
    ["/default/apps/prj_1/overview", "app-settings"],
    ["/default/apps/prj_1/settings", "app-settings"],
    ["/default/pipelines", "pipelines"],
    ["/default/pipelines/pl_1", "pipelines"],
    ["/default/pipelines/pl_1/runs/r_1", "runs"],
    ["/default/deployments/env_1/apps/shop", "deployments"],
    ["/default/vault", "vault"],
    ["/default/members", "members"],
    ["/default/agents", "agents"],
    ["/default/ops", "ops"],
    ["/default/studio/video", "studio"],
    ["/default/settings", "team-settings"],
    ["/account", "account"],
    ["/admin", "admin"],
    ["/docs", "start"],
  ];
  for (const [path, article] of cases) assert.equal(articleFor(path), article, path);
});
