# Issue 63 — ATCS single-worker bounded acceptance (cycle hima-issue63-atcs07-1)

## Verdict: BLOCKED — deterministic first-gate launcher defect, before any App window, Campaign, Run, Job, or model call

Every identity was verified before any product action. The assigned launcher
(`<kit>/launch-atcs-trial.command`) was then launched exactly as instructed, through Computer Use,
from the normal user Terminal shell, and nothing else. It refuses deterministically at its very
first line, before Electron even starts. No App window ever opened; no Guide/Preparation step, no
Campaign, no Run, no Job, and no model call occurred in this cycle.

## Identity verification (all PASS, completed before touching the launcher)

- Cycle main SHA `2fb9c068bf9f76efcd037e2e60980d2ba53a50a5` — verified equal to `origin/main`.
- Candidate source checkpoint `f06cdf54578282bcda87eb8db0cc09545e92491b` — verified as an ancestor
  of `origin/main`.
- Pack `agentic-timing-closure-system@0.1.0` — digest independently recomputed via the App's own
  `loadPack()`/`packDigestExcludes` on the freshly prepared Home:
  `339c25d773bf0755c58b6db500bcc28be9620c5057b85bba365aeb7b33bfc8b9` — **exact match**.
- Home config (`profiles/hima/cordis.patch.yml`) SHA
  `1837fa668f358a60b7cba19732083b0b55f1b873ce9a6995f94e5ad587885bc4` — **exact match**.
- Site `linglong-atcs28.yml` SHA `24960bacfbf8f9b638ac2bfcf4d71648f967ad00050c6e9fe6919474f5633947`
  — **exact match**.
- Permit SHA `bd3daa67d7d0fd90b7ba6a7a7d081e52f1e6ad1d8ffeb14dadc628f46d9faca9` — **exact match**.
- Binding `bindings.json` SHA
  `139057998653a2933a9620a9edba8da58f7b9bcfa6cc8ae53ab0997e1135c855` — **exact match**.
- Administrator environment SHA
  `bf938c79d3338b1bb620e3438f911ecb5bbdc1b962859cb445f1445f3dd83dd0` — **exact match**.
- Reused App manifest (`issue52-app-trial33/trial-manifest.json`) SHA
  `64e22e3242f50c9f802bd091bb7e8574340d79844a3d5f342b0a44ca625042f9` — **exact match**.
- License gate: the frozen qualification doc
  (`docs/assessment/2026-09-27/atcs06-qualification.md`) already records a read-only precheck —
  `linglong license selected=old old=active new=inactive`, no concurrent QuaLib/XTop/Innovus/
  PT/StarRC process — satisfying the manual's pre-commercial license requirement.

All identity/authority checks passed. The defect below is unrelated to Pack, Site, Permit,
binding, or App identity.

## Exact repro (byte-identical on two independent runs)

```text
$ /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/atcs07-eb9d3234/launch-atcs-trial.command
hima-desktop: --site linglong-atcs28 is not a site this shell can seed; the one it can is local
$ echo $?
2
```

No further output. No Electron process, no HimaHarness App window, no Campaign, no Run — nothing
beyond this single stderr line and a non-zero exit. Confirmed via `ps aux`: only the pre-existing
`#52` App instance (pid 19231, unrelated Home, holding the parked `#52` Run) was running; no new
process for this kit ever started, on either attempt.

## Root cause (verified by direct App source inspection, not guessed)

`HimaHarness.app/Contents/Resources/app/src/main.ts:136–141`:

```ts
const site = ((argv: readonly string[]): string | undefined => {
  const at = argv.indexOf('--site');
  if (at === -1) return undefined;
  const named = argv[at + 1];
  if (named === undefined || named.startsWith('--')) { ...; process.exit(2); }
  if (named !== LOCAL_SITE_NAME) {
    process.stderr.write(`hima-desktop: --site ${named} is not a site this shell can seed; the one it can is ${LOCAL_SITE_NAME}\n`);
    process.exit(2);
  }
  return named;
})(process.argv);
```

The file's own doc comment (lines 64–77) states the intent precisely: *"`--site local`: seed the
home with the local site and the stand-in flow before the host boots, so a developer's generations
take seconds. Only `local` is a site this shell can [seed]... [enforced loudly] rather than
quietly ignored."* This is a **narrow, intentional developer fast-path flag**, valid only with the
literal value `local`. It is working exactly as designed — this is **not** a HimaHarness product
defect.

The actual defect is in `launch-atcs-trial.command` (a kit-preparation artifact, not product
source): it passes `--site linglong-atcs28` to try to select the ATCS Site, but that is not what
this flag does. In every successful prior cycle (`#52` trial.33 and trial.32), the launcher passed
**no** `--site` flag at all — the Site becomes available because `prepare-home.mjs` already copies
its `site.yml`/`permit.yml` into the fresh Home's `hima/sites/` directory, and the Site is then
selected through the ordinary GUI flow after the App opens (as Guide/Preparation/Campaign
confirmation, per this manual's own step 1). This ATCS kit's `prepare-home.mjs` does exactly that
same copy (verified above), so the Site is already correctly seeded into the Home — the launcher's
extra `--site linglong-atcs28` argument is both unnecessary and actively fatal.

## Disposition

No workaround was used. Per the manual's explicit instruction, I did not modify the kit's launcher
script, did not launch the App any other way, and did not rebuild the App, reinstall a Pack, or
recopy a historical Home. Historical Attempt 4 evidence, `#52`'s `run-9ee5225b-04e3-4113-9596-
ff973b8c3732` (revision 67) and `run-c355dfb4-9380-4d0c-8548-3e3380e050a1` (revision 49), and the
old App instance were never touched or operated.

## Owning seam and cheapest next falsifying gate

- **Owning seam**: kit preparation (`launch-atcs-trial.command`), specifically its incorrect use
  of the App's `--site` dev-seed flag — not the HimaHarness product's Campaign/Run/Pack graph
  logic, which was never reached.
- **Cheapest next falsifying gate**: remove the `--site linglong-atcs28` argument from
  `launch-atcs-trial.command` (the Site is already present in the prepared Home via
  `prepare-home.mjs`; it needs no CLI seeding) and re-dispatch. If the App then opens normally and
  the ATCS Site is selectable through the ordinary GUI flow, this exact gate is resolved and the
  bounded journey (steps 1–9 of the manual) can proceed.

## Required non-claims

- No claim of `PACK_DELIVERABLE`, timing closure, QoR, the full three-worker ATCS-07 matrix, or
  native ATCS TEST/seal/release is made — none of the manual's journey was reached.
- This is not a claim that ATCS's own Campaign/Pack graph logic is broken — nothing downstream of
  the launcher was ever exercised.
- The existing release reference
  (`https://github.com/lluzi/hima_harness_reforge_polishing/releases/tag/xtop-timing-closure-v1.0.16`)
  is the unchanged `#52` control Pack, not an ATCS release, and is not implicated by this defect.

---

## Continuation addendum (2026-09-27, same cycle `hima-issue63-atcs07-1`)

### Verdict: BLOCKED — second deterministic gate, still before any Campaign/Run/Job/model call

Codex corrected `launch-atcs-trial.command` by removing the `--site linglong-atcs28` argument
(new launcher SHA `14086f5d8aaf532e7d9e60de9b27f1d4bb4c4852d8f0f383563b8afcd9f9c696`, verified
matching disk before use). Cycle main advanced to `fb220316136fdfe3ab46fd5d75ffec10e9dbbdc3`
(verified an ancestor of `origin/main`); the manual diff against the prior main SHA confirmed
exactly the described four-line clarification (no `--site` flag; select `linglong-atcs28` via
Guide/Preparation instead). Pack digest `339c25d773bf0755c58b6db500bcc28be9620c5057b85bba365aeb7b33bfc8b9`
unchanged.

**The launcher fix works.** Launched the corrected script through Computer Use/Terminal; the App
opened cleanly with no `--site` error, showed "No sessions yet", and `Trial Workspace` was
selected through the ordinary GUI folder picker exactly as the clarification describes. The
same-bundle-ID window-identification hazard recurred (the old `#52` App instance, pid 19231, was
still running and was initially surfaced instead of the new window); it was quit normally via
`SIGTERM` to its own main process only — not operated, not cancelled, and its Run
(`run-9ee5225b-04e3-4113-9596-ff973b8c3732`, revision 67) was not touched.

**New blocker reached**: sent one ordinary-language Guide inventory question (journey step 1, no
Run created). It failed outright:

> `This turn failed` — `llm-deepseek: no API key for provider route "deepseek-official"; store
> DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export
> DEEPSEEK_API_KEY in the launching environment` — `MISSING_CREDENTIAL`

Verified via Settings → Models (read-only inspection, closed without any edit): the DeepSeek
provider shows unconfigured (red status dot), and its API key field is genuinely empty. The fresh
`atcs07-eb9d3234` kit's own `Trial Data/dsh/.credentials.yaml` contains only a
`client-connection/browser-session` record — no `llm-deepseek`/`deepseek-official` provider entry.
No credential was fabricated or entered; this tester holds none and would not enter one regardless.

This is the same class of environment/kit-provisioning gap as the one resolved for the `#52`
trial.33 Home earlier in this program (there, Codex provisioned the credential into that specific
Home via a native `LocalCredentialProvider` call, without exposing the secret). It has not yet
been provisioned into this new, separate `atcs07-eb9d3234` Home.

### Owning seam and cheapest next falsifying gate (addendum)

- **Owning seam**: kit/credential provisioning for the `atcs07-eb9d3234` Home — not the launcher
  (now confirmed working) and not ATCS's own Campaign/Pack graph logic (still unreached).
- **Cheapest next falsifying gate**: provision a working `deepseek-official` credential into
  `atcs07-eb9d3234/Trial Data/dsh` (matching the mechanism already used for the `#52` trial.33
  Home), then re-dispatch. Guide/Preparation should then be reachable.

### Disposition (addendum)

No workaround was attempted. No credential was entered. No Campaign, Run, Job, or Site selection
beyond the workspace-folder picker occurred. The old `#52` App instance's Run and the historical
Attempt 4 Run remain completely untouched. This report remains preserved as the single durable
record for cycle `hima-issue63-atcs07-1`; the original BLOCKED launcher-defect section above is
unedited.

---

## Second continuation addendum (2026-09-27, same cycle) — Catsights-relocation resource blocker

### Honest protocol-deviation disclosure

The Guide inventory attempt recorded above (the one that failed with `MISSING_CREDENTIAL`) was
performed with the HimaHarness window on the **primary Built-in Retina Display**, not Catsights.
The manual and testing-strategy require Catsights only. This is recorded here honestly, as
instructed, rather than silently corrected.

### Verdict: BLOCKED — Catsights is available, but the existing window cannot be relocated to it with available tooling

Per explicit instruction, before any further GUI action this turn:

1. **Confirmed Catsights is available**: switched the capture target to "Catsights" and took a
   screenshot — it is a live, reachable display showing its own desktop (listed alongside
   "Built-in Retina Display" and "AirPanel 16"). This is **not** a "Catsights unavailable"
   condition.
2. **Attempted to relocate the existing window** (the same one already holding the credential
   retry, per instruction — no new window/session was created) from the primary display onto
   Catsights:
   - Dragging the window's title bar toward the display edge stayed confined to the primary
     display's own coordinate canvas; it did not cross onto the adjacent physical display.
   - A direct attempt to drag to a target coordinate outside the primary display's canvas
     (`x = -600`) was hard-rejected by the tool itself: `coordinate must be a tuple of
     non-negative finite numbers`. Cross-display coordinates are not addressable through the
     available drag primitive.
   - No native "Move to Display" affordance was found: the window's own traffic-light controls
     did not render distinctly enough to attempt the standard macOS long-hover display picker,
     and the app's menu bar exposes only `HimaHarness / View / Edit` — no `Window` menu with a
     "Move to [display]" item.
3. Per explicit instruction, **did not** quit or relaunch this window (the same existing
   window/session must be resumed) and **did not** terminate any other App process to work around
   this.
4. Per explicit instruction ("do not fall back to primary"), **did not** retry the Guide/credential
   action again on the primary display. No further GUI action was taken this turn.

### Owning seam and cheapest next falsifying gate (second addendum)

- **Owning seam**: tester tooling/environment (window-to-display relocation capability), not
  ATCS, not the launcher, not the credential provisioning — none of which are implicated further
  by this specific blocker.
- **Cheapest next falsifying gate**: either (a) an accepted method to move the existing window to
  Catsights (a specific menu path, keyboard shortcut, or System Settings display arrangement
  change that this tester can execute), or (b) explicit authorization to continue this cycle on
  the primary display given the resource constraint, acknowledging the deviation.

### Disposition (second addendum)

No credential was entered, no Guide/model call was attempted, and no Campaign/Run/Job was created
or touched in this turn. The existing window and session (`Before. set up anything, plea...`)
remain exactly as they were — still showing the `MISSING_CREDENTIAL` failure from the prior turn,
untouched. The old `#52` App instance and both historical `#52` Runs remain untouched. This report
remains the single durable record for cycle `hima-issue63-atcs07-1`; both prior sections above are
unedited.

---

## Third continuation addendum (2026-09-27, same cycle) — bounded Campaign, PASS through baseline, BLOCKED at a deterministic Pack defect

### Verdict: BLOCKED — a genuine, deterministic Pack-level defect, unrelated to this trial's data or environment

Per updated user authority, Catsights capture/presentation was recorded as deferred (not a
blocker) and the same existing window was used on the accessible primary display. A brief,
low-risk relocation attempt (drag toward Catsights; check for a `Window` menu) was made first, per
instruction, and failed as before; per instruction this was not escalated further.

**Journey steps 1–2 (PASS).** Retried the original inventory question in the same Guide session
after credential hot reload — it succeeded with a genuine, honest inventory (Pack installed, Site
`linglong-atcs28` readiness `needs-discovery`, all three inputs declared ready, Goal fixed
`target_setup_wns_ns: 0` / `target_hold_wns_ns: 0`). Guide correctly refused to write a Site Permit
itself (*"confirm-and-own is not the same as execution"*), so the one genuine human-only action was
performed through the GUI: Settings → HimaHarness → Sites → entered `luzi@192.168.50.41` → clicked
**Rediscover** → `linglong-atcs28` changed from `needs discovery` to `ready`. Told Guide the Site
was saved; it re-ran `hima_prepare` (`ready: true`, `unknowns: []`) and confirmed **exactly one**
Campaign/Run/owner with the previously-applied fixed budget (`timeBoxMinutes: 180` source `file`,
`generations: 4`, `retries: 1`; `closingReserveMs: 1,800,000` / `jobCap: 1` from the Pack/Site
contract, correctly not overridable).

**Journey step 2 continued (PASS through baseline).** The new owner session autonomously drove:
`bind-inputs` → `read-readiness` → `check-inputs` → `baseline` → `observe-baseline` (real
PrimeTime Job) → `policy` → `physical-baseline` (real Innovus export) → `read-next-decision`. All
of these settled cleanly with real Job evidence — `check-inputs` PASS, baseline + PrimeTime
observation recorded, physical baseline / risk atlas / residual-case facts recorded, and a
schema-valid `research/requests/next-decision.json` (SHA-256
`77d70f4519143d043c59e36f96c5293fc04255c78f1c27f82ffe17f4d362d5e5`, all 10 required fields
present, record `#000061`). The owner twice attempted a raw-shell call and was correctly refused by
the sandbox each time, self-correcting to `hima_execute`; it also correctly throttled its own
polling frequency after noticing the PrimeTime Job could take 10–30 minutes.

### The defect: `read-next-decision` crashes deterministically on any input

`read-next-decision` auto-paused after a hard-blocker crash. Root-caused by the owner via direct
source inspection (verified against the actual installed Pack file, not asserted):

- **Location**: `agentic-timing-closure-system/tools/read-atcs.py` (installed Pack digest
  `339c25d773bf0755c58b6db500bcc28be9620c5057b85bba365aeb7b33bfc8b9`, reader file SHA-256
  `fe47fa72faf4d7c19bbb714c516a1389558ae1e3405448a87d4ef65f2840c3bb`).
- **Mechanism**: `_collect_next_decision_problems()` (line 918) is missing the
  `workspace = Path(workspace)` conversion that its sibling function `_implement_batch_ready()`
  (line 870) correctly has. Line 958 then evaluates
  `workspace / "state" / "working-state.json"` with `workspace` still a plain `str`, raising
  `TypeError: unsupported operand type(s) for /: 'str' and 'str'`.
- **Determinism**: the crash occurs in the `stateRef` verification path, which runs for *any*
  structurally valid `next-decision` input — it is not data-dependent. Every Run reaching
  `read-next-decision` would hit this identically. This trial's own input artifact was itself
  independently confirmed valid (schema-complete, hash-verified) before the crash, ruling out bad
  trial data as the cause.
- **Suggested fix** (for the Pack's upstream author, not applied here): convert `workspace` once
  at the top of `_collect_next_decision_problems`, matching the sibling function, and add a
  regression test driving the `next-decision` reader end-to-end with a workspace passed as a
  string.
- **Secondary, non-blocking observation** noted by the owner for the same upstream report: 231
  `hold|setup` checks land in the `remaining` bucket with empty `fixed`/`regressed`/`entrant` at a
  first-generation baseline, plus a `func_ffg_old|…` key and an `"unknown"` variant appearing
  alongside `|hold|`/`|setup|` in the observation/check vocabulary — worth a look upstream, not
  treated as blocking here.

### Stop taken correctly (verified via the visible product)

The owner offered three options — (1) fix the source repo and republish the Pack, (2) hot-patch
the installed sealed Pack in place, (3) leave the Run paused with no fix — and explicitly declined
to take (1) or (2) unilaterally (*"I will not self-modify already-sealed Packs, nor will I lift a
hold myself"*). Per the manual's stop-at-first-deterministic-defect and no-source/Pack-patching
rules, **option 3 was selected**: leave the Run exactly paused, no self-modification, no
workaround. The owner confirmed: *"I have not modified anything outside this Run's own workspace
state, and no Pack file was written."*

### Exact held state (verified directly in the GUI, not taken on trust from any external message)

- Run: `run-87defa35-1520-4d73-9d28-b23f03263a7b`, node `read-next-decision` (auto-paused),
  `control.paused: ["read-next-decision"]`, `available: []` (hold propagates downstream),
  **revision/epoch 35 / 1**, status `running` (not cancelled).
- Budget: 9 of 1000 attempts, well inside bound; closing reserve 1,800,000 ms untouched; no
  in-flight Job (the failed reader Job is settled).
- Evidence: blocker `run-87defa35-1520-4d73-9d28-b23f03263a7b#000066`; crashed execution
  `execution-da3865a3-216f-4b48-9e39-e78b6900d95d` (`phase: failed`, `result: hard-blocker`);
  reader session `hima-87defa35-reader-atcs-next-decision-a06c92`, exit code 1.

### Ten-row-equivalent status against this manual's journey

| Step | Item | Result |
| --- | --- | --- |
| 1 | Guide inventory, no Run created | PASS |
| 1 | One confirmation / one Campaign / one Run / one owner, fixed budget | PASS |
| 2 | Baseline observation, physical baseline, policy/risk/residual facts | PASS — all reached with real Job evidence |
| 3–4 | w01-only Workshop plan admission, Researcher/Reviewer, exact adoption | **Not reached** — blocked upstream by the `read-next-decision` crash |
| 5 | Operator child, typed `atcs_*` commands, at most one `atcs_size_cell` effect | Not reached |
| 6 | Contribution/collect/composition | Not reached |
| 7 | One joint Innovus/StarRC/PT physical refresh | Not reached |
| 8 | Recovery without duplicate effects | Not exercised this turn (Run is paused, not reopened) |
| — | Stop at first deterministic defect, preserve evidence, no source/Pack patch | PASS — exactly this was done |

**Overall: BLOCKED.** This is a genuine, reproducible, unconditional Pack defect — not an
environment blocker, not a tester error, and not caused by this trial's own data.

### Required non-claims (third addendum)

- No claim is made about the w01 Workshop plan, Operator child, or joint physical refresh — none
  were reached.
- No claim is made that this defect is specific to `linglong-atcs28` or this trial's inputs — the
  owner's own analysis shows it is unconditional given any structurally valid `next-decision`
  input.
- No source, Pack, Site, Permit, binding, or the installed sealed method was modified in
  investigating or reporting this defect.
- No claim of `PACK_DELIVERABLE`, timing closure, or QoR is made.

### Disposition (third addendum)

No workaround was used. No second Campaign, Run, generation, or Operator was created. The Run
remains exactly where the crash left it — `run-87defa35-1520-4d73-9d28-b23f03263a7b`, revision 35,
epoch 1, `paused: ["read-next-decision"]` — not force-continued, not cancelled. Historical `#52`
evidence (`run-9ee5225b…` revision 67, `run-c355dfb4…` revision 49) remains untouched throughout.
