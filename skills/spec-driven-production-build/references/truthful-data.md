# Truthful data

Nothing the application presents or stores as fact may be invented. The line is simple: **if the
user could mistake it for real, it must be real.**

## Placeholders that are never acceptable on a production path

- a seed that inserts a persona, customer, job, message or company into the runtime database;
- a hardcoded list returned by a "discover", "search", "sync", "fetch" or "import" endpoint;
- a fallback that returns a plausible value when the real source is unavailable
  (`return ["Python", "React"]`, `score = 85`, `status = "delivered"`);
- a model call that, without a key, returns a made-up answer instead of schema defaults and a
  clear "model not configured" state;
- dashboard numbers typed into the component instead of computed from the data;
- `return {"ok": true}` handlers, buttons with no handler, `setTimeout` pretending work happened;
- "demo mode", "evaluation mode" or "sandbox mode" that runs on the production path by default.

## Where invented data may live

- **Test fixtures**, ideally recorded from the real source (see `integration-probe.md`).
- **A development seed** that is off by default, named for what it is (`seed_dev_fixtures`), gated
  by an explicit environment flag, and documented in the README as development-only.
- **A built-in test target** the executor is proven against (a mock form server, a fake SMTP
  server in tests) — disabled in production and labelled as a test target in every UI it appears in.

## The audit

When the user reports *one* fake thing, audit for the class. Run these from the project root and
list every hit in your reply before fixing all of them:

```
grep -rniE "seed|demo|sample|placeholder|mock|fake|lorem|example\.com|TODO" --include=*.py --include=*.ts --include=*.tsx src backend/app | grep -v tests/
grep -rnE "return \{\s*[\"']?(ok|success)[\"']?\s*:\s*[Tt]rue" backend/app
grep -rnE "Math\.random|faker|randint\(" src backend/app
```

Then look at every list literal longer than two items in a route or service, every numeric literal
in a dashboard component, and every `except … return <value>` that swallows a failure into a value.
