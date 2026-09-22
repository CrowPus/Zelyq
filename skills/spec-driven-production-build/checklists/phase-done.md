# A phase is DONE when every line is true

- [ ] The implementation exists and is decomposed by domain (no file grew past ~500 lines to hold it).
- [ ] A test file named in the row's **Tests** cell exists and passes, and it asserts the phase's
      rules from the specification — invariants, refusals, state transitions, limits — not just the
      happy path. Fixtures are recorded from the real source where one exists.
- [ ] The acceptance criteria in the row were exercised on the **running** app: the route was hit,
      the job ran, the button was clicked, the file was uploaded. Not "it compiles".
- [ ] The **Evidence** cell says what was run and what was seen (a command and its result, a
      screen, a log line, a screenshot path). A status word is not evidence.
- [ ] Every integration the phase touches was probed for real (see `references/integration-probe.md`)
      and reports itself as *not configured* rather than pretending when its credential is missing.
- [ ] No fabricated data was introduced anywhere on a production path (see
      `references/truthful-data.md`). Grep before you tick this.
- [ ] `npm run check` (or the project's equivalent) is green — necessary, not sufficient.
- [ ] Documentation that the phase made stale is updated (README, `.env.example`, architecture).
- [ ] Earlier phases' tests still pass.

If any line is false, the status is VERIFYING or IN_PROGRESS. Say so. An honest IN_PROGRESS costs
nothing; a false DONE costs the user the whole programme's trust.
