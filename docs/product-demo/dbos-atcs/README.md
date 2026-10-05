# DBOS ATCS happy-path demo (2026-10-05)

Happy-path recordings of ATCS 0.4.0 on the DBOS-migrated HimaHarness, made on branch
`codex/dbos-fabric-atcs-migration` after the sealed Mac trial (`7c6f9fcd`). The previous
pre-DBOS demo and its preparation guide live on `customer-demo`
(`docs/product-demo/customer-demo/HAPPY-PATH-GUIDE.md`).

## Scope agreed with the user

| Question | Answer |
| --- | --- |
| Pack, Site | ATCS `agentic-timing-closure-system` 0.4.0 (method digest `ede79eca…f3c83e`, sealed), Site `linglong-atcs28`, real XTop |
| Live runs | Two full live Campaigns: one with an English conversation, one with a Chinese conversation |
| UI language | English UI for both; the Chinese version talks to HimaHarness in Chinese |
| Agent bounds | One resident engineering round, Pack default budget (120 min), honest ending |
| Where things land | Fixes and this document on the migration branch; recordings and kits under `.hima-tmp/dbos-demo/` (not in Git) |
| Another running App | The CellFmax demo App was quit with "Quit now and keep jobs" at the user's request |

## Candidates

| Candidate | App | Source | artifactDigest |
| --- | --- | --- | --- |
| A | `.hima-tmp/dbos-migration/u10/mac-release-02` 0.3.0-trial.35 | `fd9cb10c` | `dfae0348…5e83db` |
| B | `.hima-tmp/dbos-demo/mac-release-03` 0.3.0-trial.36 | `019838c9` (fix `fcd019ff`) | `11b22fac…2dbde0` |

Candidate B is candidate A plus the zombie-closure fix below. The Pack, Site and Permit bytes are
the same for both (Site `5d0fe095…`, Permit `876ebc13…`).

Kits: one fresh Home per Run (`.hima-tmp/dbos-demo/kit-*`), prepared by
`.hima-tmp/dbos-demo/prepare-kit.mjs`: ordinary profile plus the declared Site/Permit only. The ATCS
Pack is installed through Settings → HimaHarness on camera. The model credential is sourced at launch
from the local secrets file; no value is copied.

## Results

Every number below is a Pack Reader value from raw XTop reports (`delivery/report.json`), not
model prose. All values are prediction-only native XTop timing; the four collateral checks
(transition, capacitance, fanout, legality) are UNKNOWN and nothing here is physical sign-off.

### Run A: English conversation, candidate A

Run `run-1a29b362-86ce-4977-8d6d-d2d4fd71071e`, Campaign
`agentic-timing-closure-system-20261005-112556-436d`. Started 11:25:56Z, ended by itself
11:48:31Z as `ended-goal-not-met`; all five tasks succeeded in generation 1.

| Reader value | Before (common R1) | After (selected checkpoint) |
| --- | --- | --- |
| Setup violations / WNS / TNS | 28 / −0.0380 ns / −0.2306 ns | 16 / −0.0237 ns / −0.1256 ns |
| Hold violations / WNS / TNS | 109 / −0.1523 ns / −4.7021 ns | 0 / 0 / 0 |

What the recording shows:
- One Guide proposal and one "Confirm Start"; the owner was briefed with the bounds.
- **DBOS resume.** During `fix-timing` the App was quit with "Quit now and keep jobs" and reopened
  on the same Home. The same Run, the same engineering Job (`hima-effect-d61f2128…`, started
  11:27:12Z) and the same remote resident session continued; there was no second launch.
- The first engineering delivery was refused by the Reader; the producer re-emitted to a fresh
  revisioned path in the same task, without re-running engineering, and the Run then advanced
  through evaluate and deliver by itself.
- The hash-verified `REPORT.md`, `report.json` and engineering package (checkpoint, ECO, scripts,
  raw reports, reproduction notes) open from Evidence.

### Run B: Chinese conversation, candidate A, blocked by a defect

Run `run-d529a082-b558-416b-823e-165035c981a9`, Campaign
`agentic-timing-closure-system-20261005-115514-67c5`. The Guide and owner answered in Chinese.
`fix-timing` produced its result (owner's summary: setup 28 → 17, hold 109 → 12). `evaluate-timing`
then exited 0 at 12:18:39Z but stayed `waiting · resource-closure`.

Root cause: the Site's shared tmux server never reaped the evaluate Job's shell, which stayed a
zombie (`Zs`). `kill -s 0 -- -<pgid>` still succeeds for a group holding only zombies, so the
Host never confirmed closure. Fixed in `fcd019ff`, reviewed independently, and re-checked on the
live zombie (old probe "alive", new probe "closed", a live control group still "alive").
Run B is left as evidence in its own Home (`.hima-tmp/dbos-demo/kit-zh`). Only the original
executable may resume it.

### Run C: Chinese conversation, candidate B (the delivered Chinese demo)

Run `run-f612a1ea-650c-43a9-b30c-41c501af673f`, Campaign
`agentic-timing-closure-system-20261005-130754-0ccf`. Started 13:07:54Z and ended by itself as
`ended-goal-not-met`, with all five tasks succeeded in generation 1. The Guide proposal, the
confirmation ("确认，按这个方案开始。"), the owner briefing and every answer were in Chinese.

| Reader value | Before (common R1) | After (selected checkpoint `o1`) |
| --- | --- | --- |
| Setup violations / WNS / TNS | 28 / −0.0380 ns / −0.2306 ns | 23 / −0.0333 ns / −0.1544 ns |
| Hold violations / WNS / TNS | 109 / −0.1523 ns / −4.7021 ns | 7 / −0.0429 ns / −0.1685 ns |

The engineering agent ran about 18 experiments, so `fix-timing` took about 50 minutes, against about
15 minutes in Run A. It stopped at its best measured state. In its words, the remaining 7 hold
endpoints are a `flush_lower` scan-flop cluster where both the min and max checks fail, so no
accepted XTop method could reduce them without a setup regression. As in Run A, the first delivery
was refused by the Reader and repaired in the same task. All seven Jobs exited with no live or
zombie process left on the Site.

### Why the three results differ

The language did not cause the difference. The Chinese conversation reaches only the Guide and the
owner. The resident engineer on the Site receives the same Pack instructions, inputs and budget each
time. With one resident round per Run, each attempt picks its own path:
- Run A buffered the launch side of hold paths and cleared hold completely.
- Run B repaired the reset cluster first and stopped at 12 shared input-port hold paths.
- Run C stopped at the scan-flop cluster.

Treat the three results as separate one-round attempts, not as a language comparison.

## Fix made for this demo

| Fix | Commit | Notes |
| --- | --- | --- |
| A process group holding only unreaped zombies is closed: `kill -s 0` plus the fixed read-only `ps -A -o pgid=,stat=` (a `Zl` leader with live threads stays alive; covers the macOS "not permitted" answer) | `fcd019ff` | RED test built from the live shape, plus a real-kernel test on the local channel. interactive-job/jobs/ssh 19/19, typecheck, boundary. Independent Opus review: two Important findings fixed and re-checked. Re-checked against the live Site zombie |
| App version 0.3.0-trial.36 | `019838c9` | Packaged by the ordinary `package-trial.mjs` (verify + relocated Host smoke) |

## Recordings

Recordings live in `.hima-tmp/dbos-demo/kit-*/recordings/` and are not in Git. The Catsights
screen is `Capture screen 1` this session.

| File | Length | Content |
| --- | --- | --- |
| `kit-en/01-atcs-setup-en` | 7:35 | Workspace, Site rediscovery, Pack install review and confirm |
| `kit-en/02-atcs-start-en` | 9:31 | Guide proposal, Confirm Start, owner briefing, live graph; the owner corrects a stale first status |
| `kit-en/03-atcs-restart-resume-en` | 5:32 | Quit and keep jobs mid-`fix-timing`, reopen, same Run and Job continue (DBOS recovery) |
| `kit-en/04-atcs-finish-en` | 7:08 | Reader repair, automatic evaluate/deliver, `ended · Goal not met`, Report and verified `REPORT.md` |
| `kit-zh/05-atcs-setup-zh` | 1:11 | Setup on candidate A (Run B) |
| `kit-zh/06-atcs-start-zh` | 9:28 | Chinese proposal card and confirmation, Chinese owner briefing (Run B) |
| `kit-zh/07-atcs-runB-defect-zh` | 29:55 | Run B stuck in `resource-closure` (defect evidence, not for customers) |
| `kit-zh2/08-atcs-setup-zh` | 1:05 | Setup on candidate B |
| `kit-zh2/09-atcs-start-zh` | 10:10 | Chinese goal, Chinese text confirmation, Chinese owner briefing, live graph (Run C) |
| `kit-zh2/10-atcs-results-zh` | 10:41 | Chinese result summary, Evidence, verified `REPORT.md` (Run C) |

Suggested customer cut:
- English: 01 → 02 → 03 → 04.
- Chinese: 08 → 09 → 10. Segment 06 has the better Chinese confirmation card if one is wanted.

Long waits in 07, 09 and 10 need trimming.

## Known limits, stated honestly

- None of the three Runs met the 0/0 Goal. Collateral checks are UNKNOWN, timing is
  prediction-only, and nothing here is physical sign-off. No AutoFix comparison Campaign was run.
- The Chinese demo uses the English UI. The zh UI exists only on the pre-DBOS `customer-demo`
  branch and has not been ported.
- The owner's job accounting can miss a finished resident session. In Run C, session
  `hima-effect-6b074a36…` exited 0 on the Site but stayed in `unsettledSessionIds`. The Run itself
  ended correctly.
- The owner sometimes describes the 120-minute box as "7 h" (a reading of 7 197 s).
- The interactive XTop close watcher still uses only `kill -s 0`. ATCS did not hit it here.
- During shutdown a transient "Run list unavailable: /hima/options failed" banner can appear.
- Settings dialog fields and the fullscreen Campaign view are partly invisible to background
  accessibility automation. This affects testing, not users.
- When the CellFmax demo App was quit with "keep jobs", its resident on linglong (`opencode acp`,
  Run `b38106d8`) kept running. Reopen that kit to finish or cancel it through its own UI.
