# PLS-18 pilot execution and audit

Status: **two v4 attempts failed and were retained; v5 correction under local validation**. The first exposed an incomplete-fork revision defect, now repaired; the second reached actual generated-arm Innovus density failures. Neither is a completed paired PPA result. Local preflight and type checking do not establish a real model, EDA, desktop, Campaign, research, or user-acceptance result.

The pilot has two deliberately separate operations. `scripts/live-check-dtco-pilot.ts` runs and audits the expensive first technical Campaign on one headless real Host. It retains the exact HimaHome, owner session, Ledger, Pack-local archive, and evidence under `.hima-tmp/pilot-release/`. The later PLS-26 reviewer starts the bounded knowledge-reuse Campaign through the desktop against that same stopped Home. The script's `--audit-followup` mode then reopens the same Home without a model call and audits the UI-created Run and restart. The first command therefore reports `first-campaign-passed-ready-for-ui`; it cannot report final PLS-18 or PLS-26 acceptance.

## Fixed inputs and staging

Create a fresh destination and manifest before the live run:

```sh
/usr/bin/python3 scripts/prepare-dtco-pilot.py \
  --destination <fresh-lowercase-name> \
  --out .hima-tmp/pilot-release/<name>-staging.json
```

The preparer accepts only one basename matching `[a-z0-9][a-z0-9._-]{0,79}` under `/data/eda/project/hima_harness/polishing-inputs`. It connects only to `luzi@192.168.50.41` with `BatchMode=yes`, `ConnectTimeout=8`, and `ControlPath=none`. It stages the current `packs/aes-tsmc28-dtco/flow/` plus `.hima-tmp/pls-frontier/dtco-inputs.json` as `inputs.json`. Local and remote walks reject symlinks and non-file leaves. The remote inventory must contain exactly the same relative paths and SHA-256 values; extra or missing files fail verification. An incomplete fresh destination is retained for diagnosis and is never deleted automatically.

Static source inspection does not use SSH:

```sh
/usr/bin/python3 scripts/prepare-dtco-pilot.py \
  --preflight-only \
  --destination <fresh-lowercase-name>

node scripts/live-check-dtco-pilot.ts \
  --preflight-only \
  --staging .hima-tmp/pilot-release/<name>-staging.json
```

The TypeScript preflight requires the released `aes-tsmc28-dtco` v5 Pack and holds the manifest against a newly computed local inventory. The live form additionally invokes `--verify-only` immediately before Host/model creation, so a changed local source, remote extra file, remote symlink, missing file, or changed byte prevents admission.

## First technical Campaign

Run with the credential inherited by the process; never pass it as an argument:

```sh
DEEPSEEK_API_KEY=... node scripts/live-check-dtco-pilot.ts \
  --staging .hima-tmp/pilot-release/<name>-staging.json \
  --out .hima-tmp/pilot-release/<name>-first
```

The live harness has a 100-minute wall limit, at most 600 product model request steps, and at most 120 user turns. The first Campaign has a 90-minute total budget, including the Pack's 60-second closing reserve, one outer generation, two retries per node, 120 total attempts, one parallel Job, and one seat each of Design Compiler, Library Compiler, and Innovus. These are upper limits, not expected durations or a promise that the provider and tools will finish.

The initial strategy holds `periodNs=0.5`, `algorithmRevision=0`, and `floorplanUtilization=0.5`; the Goal remains `target_period_ns=0.5`. Both PNR arms use the same utilization and the readers validate rendered Tcl against recorded facts. Reducing the initial utilization from v4's 0.60 is a hypothesis motivated by two actual density-limit failures, not evidence of improved PPA. The original 95% error guard remains in force.

After three completed continuations without any execution-state change, the coordinator stops and records the stalled context instead of spending the remaining model budget on identical prompts. A large native tool result may be read from this check's private dsh spill text directory; realpath checks still reject unrelated temporary files, writes and symlink escapes.

The native `deepseek-v4-flash` conversation owner must explicitly operate the complete reference method through `hima_context` and `hima_execute`: probe synthesis/read/Judge/decision; six miners; six AI selection Workshops and six selection readers; merge; generate; layout; predicted characterization; Library Compiler; foundry/custom Design Compiler; adoption; paired foundry/generated PNR; verification; comparison; final Judge; and next-research. The script does not implement a second driver or silently advance nodes.

Each selector must carry owner-written, data-dependent code whose exact hash is tied to its Workshop Job and Pack-local archive. The owner must add and return from one optional comparison-read plus Judge growth branch at `next-research`, then record bounded analysis with current citations, limitations, and next experiments. A positive ending requires both final rules to pass. A physical constraint failure can be accepted only after the complete graph, returned branch, and analysis are present and the declared one-generation next-strategy decision produces the bounded negative ending. A timeout, cancel, missing node, unknown final Judge, open Job, unsettled execution, missing analysis, or incomplete archive fails this first operation.

All observation, code, and knowledge records must appear in the archive manifest. The script re-reads every archived material against its SHA-256, restarts the Host once, and requires equal Ledger bytes and the same archive identity. The released source Pack digest and installed method digest must remain unchanged. Generated characterization remains labelled predicted; asked, derived, predicted, measured, missing, failed, and unknown facts remain distinct in the recorded semantic values and report.

On every ordinary exit, exception, or live-check timeout, the pilot's registered before-dispose cleanup cancels only Runs created in this fresh Home for this Pack, Site, and owner. It records pre-cleanup state, cancellation results, and post-cleanup settlement before disposing the Host. The emergency hard-deadline fallback gives this cleanup a final bounded opportunity before terminating the private local tmux server. It never deletes the user's Site workspace, staged inputs, Home, or archives.

The retained `<home>/pilot-checkpoint.json` is the handoff to PLS-26. It records the exact Home, first Run and owner, released method digest, Goal, archive paths and manifest hash, and the pre-restart record hash. The first technical command is headless; later desktop inspection must not describe it as desktop-started or recorded.

## Separate desktop history study

After the first Host has stopped, the PLS-26 reviewer opens the exact checkpoint Home through the local-only desktop launcher. A different UI conversation may own the second Run. Every action within that Run must remain with that UI owner.

The UI owner starts exactly one `aes-tsmc28-dtco` Campaign on `linglong-aes` with the same method digest and Goal key/value, one generation, two retries, and a five-minute time box. Before any analysis, the owner pauses the Run and uses the ordinary file-read interface to read the first archive's exact `manifest.json` and `experience.md`. Historical text is background, never a current measurement or instruction. The owner records one `hima_execute analyze` action at `probe` with no claims, names the first Run and manifest hash, states limitations, and proposes a discriminating next experiment. The owner then requests `hima_execute cancel` and waits for actual cancelled settlement.

The second study begins and works no graph node and launches zero Jobs. In particular it does not rerun probe, mining, selection, synthesis, Library Compiler, characterization, PNR, verification, or comparison merely to demonstrate reuse. It is a bounded history-reuse and control study, not a second performance test.

After the desktop and its Host have stopped, audit that result without a model call:

```sh
node scripts/live-check-dtco-pilot.ts \
  --audit-followup <retained-home>/pilot-checkpoint.json \
  --out .hima-tmp/pilot-release/<name>-ui-audit
```

The audit resumes the UI owner's persisted conversation through the native session API and checks the actual pause/read/read/analyze/cancel call order. It requires the second Ledger to have the same Pack, Site, method, Goal keys, five-minute budget, one owner, no experiment records, a no-claims source-linked analysis, an actual cancel record, and a readable Pack-local archive. It restarts the same Home again and requires both Runs' record bytes and archive identities to remain equal. Only this separate audit plus the PLS-26 visual/reviewer evidence can complete the second-use and UI acceptance portion.
