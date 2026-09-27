# Issue 52 normal-close gate

The fresh native TEST Run `run-2306b485-ccae-4cca-9b56-4ba2c618ac88` reached its
legal `ended-budget-exhausted` boundary with one generation and one Operator Job.
The driver then failed its close-receipt assertion before TEST/seal generation.
Its original failed receipt remains unchanged in
`.hima-tmp/issue52-phase-a-v5/native-test-current/evidence.json`.

Exact retained facts: close input intent `#000100` has `effect:close`; matching input
and completion are `#000101`/`#000102`; Job `#000103` confirms exit code 0. There is
no explicit `interactive.closed` record. `interactive-runtime.ts:reconstructSessions`
incorrectly left the public session ready despite the authoritative finished Job.

Zero-EDA public projection regression went RED in 180 ms, then GREEN after deriving
process closure from the matching finished Job. An unfinished command remains retained;
exit code does not prove business success. Focused tests: 2/2 PASS, 1 in-process Host,
0 SSH/Electron/model/EDA. Harness build and targeted driver typecheck passed.
Reading the original immutable records through the corrected projection now returns one
closed session, cursor 30322, and no active command. No Ledger or Run was rewritten.

The driver now requires a matching typed close completion (command id, digest, request,
execution and session), one exit-code-0 Job, and one closed public session. It does not
substitute exit alone for mutation/save/finalizer acceptance.

The current TEST report stage can finish with `resume-xtop-native-test --report-only`:
only an ended TEST of the current method digest is admitted; execution/interactive/
delegation/Run-creation tools are denied. It verifies that Run/control/evidence identities
remain unchanged. This does not resume the business Run, rerun a baseline, create another
generation or alter any historical Attempt. Native TEST/seal remain unclaimed until this
report-only stage passes.

The first report-only pass was refused by the native author-record validator:
`INTENT.md` had an extra root `## Agent Team` section; `SPEC.md` had the same
format issue. Both now retain that content as `###` subsections within existing
allowed sections. This is an author-record formatting correction, not a change
to the method: `packDigestExcludes` excludes authoring records, and the digest
remains `5cab1ddba6d2b6d35f27e2c5a1ddc05a8cd1b8758d1330c9c6c569dfd0cd78b1`.
Only the current candidate's author folder receives this metadata correction;
Run/control, historical method snapshots, reports and prior failed Homes are
unchanged. The original failed report-only receipt is preserved separately.

The report gate also now validates the TEST record against the exact current Run
and Ledger, rather than accepting a format-valid historical TEST by stage alone.
Pack focused tests pass 7/7; the isolated fixture removes only its copied foreign
TEST/seal because its empty Ledger deliberately does not hold historical Runs.
