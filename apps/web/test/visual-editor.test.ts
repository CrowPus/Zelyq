import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { VisualEditor } from "../src/components/pipelines/VisualEditor.js";

const SOURCE = `name: Shop
runs-on: local
source: {app: Shop}
stages:
  - name: Build
    steps:
      - checkout: true
      - setup: node@22
      - run: npm ci
  - name: Lint
    steps: [{run: npm run lint}]
  - name: Test
    parallel: true
    matrix: {node: [20, 22]}
    steps:
      - run: npm test
  - name: Ship
    if: always()
    steps:
      - deploy: {to: staging, port: 3000}
      - plugin: acme/hello@1.0.0
        with: {who: you}
`;

function render(source: string): string {
  return renderToString(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(VisualEditor, { teamId: "t", source, onChange: () => {}, canWrite: true }),
    ),
  ).replaceAll("<!-- -->", "");
}

test("the visual editor shows the stages, their steps and the pipeline's form", () => {
  const html = render(SOURCE);
  for (const text of [
    "Build",
    "Set up node@22",
    "npm ci",
    "Lint",
    "Test",
    "Matrix × 2",
    "Ship",
    "Always runs",
    "Deploy to staging",
    "acme/hello@1.0.0",
    "Runs on",
    "Where the code comes from",
  ]) {
    assert.ok(html.includes(text), `shows ${text}`);
  }
});

test("a file that is not valid YAML is not drawn", () => {
  assert.match(render("name: [x"), /not valid YAML/);
});

test("a real pipeline: every stage is shown, and each variable with its value", () => {
  const html = render(`name: App builder deploy
runs-on: web-builder
source:
  repo: https://github.com/you/site.git
  ref: main
  token: vault://GITHUB_TOKEN
env:
  APP_NAME: app-builder
timeout: 30m
stages:
  - name: Get
    steps:
      - checkout: true
  - name: Build
    steps:
      - name: Build the image
        run: docker build -t $APP_NAME:latest .
  - name: Deploy
    steps:
      - name: Replace the running container
        run: docker run -d --name $APP_NAME $APP_NAME:latest
  - name: If it failed
    if: failure()
    steps:
      - run: docker logs --tail 50 $APP_NAME || true
`);
  for (const text of [
    "Get",
    "Build the image",
    "Deploy",
    "Replace the running container",
    "If it failed",
    "Only after a failure",
    'value="APP_NAME"',
    'value="app-builder"',
    'value="https://github.com/you/site.git"',
    "web-builder (not found)",
  ]) {
    assert.ok(html.includes(text), `shows ${text}`);
  }
});

test("a problem shows on the stage it belongs to", () => {
  const html = render(`name: Broken
runs-on: local
stages:
  - name: Fine
    steps: [{run: echo ok}]
  - name: Wrong
    parallel: true
    steps:
      - approval: {message: ok}
`);
  assert.match(html, /1 problem/);
  assert.match(html, /aria-label="Has a problem"/);
});
