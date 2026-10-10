import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDotEnv, vaultSecretNameSchema } from "../src/vault.js";

test("secret names are environment-variable shaped", () => {
  assert.ok(vaultSecretNameSchema.parse("STRIPE_KEY"));
  for (const name of ["lowercase", "WITH-DASH", "1LEADING", "WITH SPACE", "PATH="]) {
    assert.equal(vaultSecretNameSchema.safeParse(name).success, false, name);
  }
});

test("names Zelyq sets, or that would be published to the browser, are refused", () => {
  for (const name of ["VITE_KEY", "ZELYQ_X", "DATABASE_URL", "AUTH_ISSUER", "PATH", "NODE_ENV"]) {
    assert.equal(vaultSecretNameSchema.safeParse(name).success, false, name);
  }
  assert.ok(vaultSecretNameSchema.parse("PATHWAY_KEY"), "PATH is reserved only as a whole name");
});

test("a .env file is read the way it is written in practice", () => {
  const { entries, invalid } = parseDotEnv(
    [
      "# a comment",
      "",
      "PLAIN=value",
      "export EXPORTED=yes",
      'DOUBLE="two words"',
      "SINGLE='keep \\n literal'",
      'ESCAPED="line1\\nline2"',
      "INLINE=value # trailing comment",
      "EMPTY=",
      "PLAIN=later wins",
      "not an assignment",
    ].join("\n"),
  );
  assert.deepEqual(Object.fromEntries(entries.map((e) => [e.name, e.value])), {
    PLAIN: "later wins",
    EXPORTED: "yes",
    DOUBLE: "two words",
    SINGLE: "keep \\n literal",
    ESCAPED: "line1\nline2",
    INLINE: "value",
    EMPTY: "",
  });
  assert.deepEqual(invalid, ["not an assignment"]);
});

test("Windows line endings and a hash inside quotes are kept intact", () => {
  const { entries } = parseDotEnv('A=1\r\nB="has # inside"\r\n');
  assert.deepEqual(entries, [
    { name: "A", value: "1" },
    { name: "B", value: "has # inside" },
  ]);
});

test("a hostile line cannot stall the parser", () => {
  // Shapes that make a backtracking pattern run in quadratic time.
  const spaces = " ".repeat(100_000);
  const started = performance.now();
  parseDotEnv(`A=${spaces}x`);
  parseDotEnv(`A=x${spaces}y`);
  parseDotEnv(`export${spaces}`);
  parseDotEnv(`A${spaces}=1`);
  assert.ok(performance.now() - started < 500, "parsing took too long");
  assert.deepEqual(parseDotEnv(`A${spaces}=1`).entries, [{ name: "A", value: "1" }]);
});
