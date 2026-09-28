# Issue 63 — ATCS 0.1.2 fresh-environment bounded journey

Cycle `hima-issue63-atcs-fresh01`. This is the only active acceptance path for Issue #63. It
replaces every earlier ATCS cycle. All earlier Homes, Workspaces, Campaigns, Runs, windows and
reports are historical evidence: never open, continue, inspect or reuse them.

## Identities (verify before the first click)

- Cycle main: the commit that adds this manual on `origin/main`. Its parent is
  `0e6e94d43832125aefcb684b59b57e038411f91a`. Pack, Site and `packages/` bytes are
  unchanged since `f95c1309`.
- Pack `agentic-timing-closure-system@0.1.2`, digest
  `7eefda6192db49be9d15cc31773372c0765cc6c3804684cf4f7c63ab7691b4d3`. It is a compiled
  candidate, not a sealed release.
- App `.hima-tmp/issue52-app-trial33/HimaHarness.app`, version `0.3.0-trial.33`.
  - Manifest SHA `64e22e3242f50c9f802bd091bb7e8574340d79844a3d5f342b0a44ca625042f9`.
  - Its bundled Harness and Desktop JS are byte-identical to a fresh build of `0e6e94d4`.
- Kit `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/atcs63-fresh-7eefda61`:
  - Home `<kit>/Fresh01 Data/dsh`, Workspace `<kit>/Fresh01 Workspace`. Both are empty: no
    Campaign, Run or Ledger.
  - Home config `cordis.patch.yml` SHA `0e7850c5d4ba39bbbb9863970382046024855908a23d1ebf1e3c9f21b3675dc0`.
  - Launcher `<kit>/launch-fresh01.command` v2, SHA
    `523473fd281c704f7295f4b0d10de5e2f607e51259938c9a424025e3b6ea0abc`. v2 unsets an
    inherited `ELECTRON_RUN_AS_NODE` and `DSH_*` shell environment. The v1 attempt, kept as
    `launch-fresh01.v1-inherited-env.command`, started Electron as a Node REPL with no window
    and ended `TEST_ENV_BLOCKED` before any click. It created no Campaign, Run or Home state.
- Installed Site `linglong-atcs28` SHA `24960bacfbf8f9b638ac2bfcf4d71648f967ad00050c6e9fe6919474f5633947`;
  Permit SHA `bd3daa67d7d0fd90b7ba6a7a7d081e52f1e6ad1d8ffeb14dadc628f46d9faca9`.
- Binding `<kit>/bindings.json`, SHA `40faa236b8ae421e39bbef4911ffdb796c098675de7d6e52edd833a15080932a`,
  id `linglong-atcs28:xtop-operator-v5:7eefda6192db49be`.
  - Environment `<kit>/environment.json`, SHA
    `b52ca592b5fdb76f9f18545764a107f2566cce0daf677589af04e70d8329d262`.
  - Bridge preflight: PASS, confinement enforced.
- Site inputs, on the server:

  | Input | SHA-256 |
  | --- | --- |
  | `/data/eda/project/hima_harness/atcs-inputs/designStateManifest.json` | `bdfe0c8c…4c39` |
  | `siteCapabilities-v4.json` | `26b99dab…0415` |
  | `analysisContract/scenarios.json` | `557060db…6ebe96` |
  | `analysisContract/policy.json` | `e6c8d46a…cb0` |
- Integrator preflight at kit creation, all with zero model calls, zero EDA and zero Desktop:
  - shipped Host cold start ready;
  - `checkPack` fit on `linglong-atcs28` OK;
  - zero HimaHarness main processes;
  - licence `selected=old`, old active;
  - no live EDA process and no tmux server.
- The product model is DeepSeek Flash; the credential is already stored natively in the new Home.
  Never print it.

## Screen and process gate

Follow [the human-like test discipline](himaharness-human-like-test-discipline.md).

1. Verify zero HimaHarness main processes.
2. Launch only `<kit>/launch-fresh01.command`, once.
3. Verify one main process and one window.
4. Move the complete window onto the Catsights display (1920x1200 external). Keep it there.
5. Capture Catsights before the first product click and record the two-display inventory.

Any ambiguity is `TEST_ENV_BLOCKED`: report it and tear down.

## One bounded journey

The Run's bounds:

- one Campaign, one persistent Run, one owner distinct from Guide;
- Goal: setup and hold WNS targets 0 ns; post-route-only;
- time budget 180 minutes, closing reserve 30 minutes;
- at most four generations, one concurrent Job, `w01` only;
- at most one worker effect and one joint refresh, or a reader-backed refusal.

Enforce the one-effect bound explicitly with the owner before execution.

1. Ask Guide what the installed ATCS Pack, Site, inputs, Goal and limits are. Complete
   Preparation, then confirm once. Record the Campaign, Run and owner.
2. Baseline: let the owner produce the reader-backed baseline observation, physical baseline,
   policy, risk and residual.
3. Next decision: let `decide-next` run.
   - A `request-admissible` FAIL followed by `revisit-next-decision` is normal method behaviour.
     The owner reads the Reader's reason and retries with new information.
   - If the owner cannot satisfy the revisit citation, record the exact error and the records
     it cited. Do not hand-edit anything.
4. Plan: the plan produces three work packages. Only `w01` is required; `w02` and `w03` stay parked.
5. `w01` Team:
   - the Researcher child and its exact owner adoption;
   - the Reviewer child and its exact adoption;
   - one typed XTop Operator child, which queries and checks the falsifier first, then makes at
     most one `atcs_size_cell` effect, dumps before and after, exports, closes, and is adopted.

   An evidence-backed no-fix or refusal is valid.
6. After the worker: Contribution, collect, composition, replay, reconciliation and presta.
7. Refresh: at most one admitted joint Innovus/StarRC/PT refresh, then evaluation, adoption,
   pointers and experience.
8. End: hold at a settled boundary with no Job running, then end the bounded trial truthfully.

## Stop, evidence, teardown

- **Stop at the first deterministic product defect.** Preserve the screenshot, the Run id, the
  node, the revision and the receipt.
  - Stop on execution, evidence, permission, duplicate-effect or recovery defects; UI polish is
    not a stop reason.
  - The tester does not edit source, Pack, Site, binding or Ledger, and never bypasses
    business work with raw Tcl or shell.
- **Before commercial work**, check `empyrean-license status`: old must be active. Never switch
  licences and never run QuaLib.
- **Evidence** goes to `<kit>/evidence/`, the report to `<kit>/report.md`, and the checkpoint and
  handoff through the tester skill's `tester_state.py`.
- **Verdict:** `PASS | FAIL | BLOCKED | TEST_ENV_BLOCKED`.
  - PASS means this bounded single-worker journey has retained evidence, a truthful ending
    and no duplicate effect.
  - PASS is not timing closure, three-worker ATCS, a release or delivery.
- **Every attempt ends with teardown:**
  1. write the report and checkpoint;
  2. record the Job and lease state;
  3. quit the App normally;
  4. verify zero HimaHarness main processes;
  5. capture the clean state.

  Closing the App is not cancelling the Run.

## Successor: fresh02 (Pack 0.1.3)

### What fresh01 left behind

Fresh01 Run `run-5a5b8ba5-eaea-413a-905a-eeee8c279749` stays preserved, paused at node
`capture-worker-01`, generation 3, revision 109.

- The journey got through baseline, the next-decision revisit, the plan, and the w01 Researcher,
  Reviewer and Operator adoptions.
- The Operator's single `atcs_size_cell` failed with `Library cell 'DFQD2BWP12T' not found`.
  The before and after dumps are byte-identical.
- Capture then refused the honest no-fix: `missing-input: ops.jsonl`.
- The fix is on main: commits `7fc5516b`, `b4aa95f4`, `41ea58d9`, plus the v6 wrapper source
  `025ac087`.

### Fresh02 identities

- Pack `0.1.3`, digest `fb30d7b6ae5f6cada7722a86906bcbb861e4335e9efdc87bef83bc2e42e12f1b`.
  - Flow `2929e78d9e1be6311e7a071c9653d7e60d3d16e2ee3cfd425bd9711e3e4faaa6`.
  - `atcs_cli.py` `11e6fa60baff1ff3f17a4875b8e9189ba0b872c04199d1c703320f62583148d1`.
  - The operator Tcl template is unchanged.
- Wrapper `operator-admin/atcs-v6/atcs-xtop-operator-v6.sh`, SHA
  `f95e477cc8f690818bb94756070a84224c2bd771eb25fb9da1f7adea389483c8`.
  - It was installed beside v5, which is unchanged.
  - The verifier is unchanged, `86321360…`.
- Kit `.hima-tmp/atcs63-fresh-fb30d7b6`:
  - Home `Fresh02 Data/dsh` and Workspace `Fresh02 Workspace`, both empty.
  - Launcher `launch-fresh02-nohup.sh`, SHA `4e21f5bb…`. It uses nohup and setsid, keeps Local
    Network access and survives a closing terminal.
  - Binding `linglong-atcs28:xtop-operator-v6:fb30d7b6ae5f6cad`, file SHA `c1839241…`.
  - Environment `666e942c…`.
  - Permit `50a1a666…`: reads `atcs-v6`.
  - Site `24960bac…`, unchanged.

### Changed-surface qualification (zero EDA)

The checks ran in the copy `atcs-runs/qual-issue63-v6-20260928`:
- The v6 verifier refuses the old 0.1.2 flow.
- The v6 verifier admits the 0.1.3 flow after a native `prepare-workers`.
- `capture-contribution` on the real fresh01 w01 outputs produces an admissible no-fix
  `1ff1d75e50d611aaff0c`, with a transcript-backed diagnosis.
- `collect` exits 0.
- The bridge preflight is enforced, and the Host cold-start fit is OK.

Not requalified: the XTop launch through v6. Its logic, image, verifier and template are
unchanged, and the Campaign exercises it.

The journey, bounds and teardown are the same as above. The operator for this cycle is the
integrator, using background per-window control on Catsights only.
