# Trial 26 findings — XTop timing closure 1.0.1

Run under test: `run-7f3044b7-3343-458b-a6ba-4ef5cbe5a37b`
Campaign: `xtop-timing-closure-20260922-041317-14a1`
Pack: `xtop-timing-closure@1.0.1` digest `0e263e38d3e34a5cfdf1d37b140c6ba57d3b83ba81bf9ab1311540ce8dbb0d49`
Site: `linglong-swerv28`

Facts and source cites only. No claim of a measured EDA result is made here.

---

## Finding 1 — a changed development Pack version cannot be installed over an existing install

**Observed.** With `xtop-timing-closure@1.0.0` already installed, the Configuration page's
"Install Pack from folder" for `1.0.1` returned only:

```
export destination already exists; no existing files will be overwritten
```

with no file list and no way to proceed.

**Root cause.** `packages/harness/src/release.ts:841` in `transferSnapshot`:

```ts
if (request.mode !== 'upgrade' && lstatSync(to, { throwIfNoEntry: false }))
  throw new PackFolderError('export destination already exists; no existing files will be overwritten');
```

The destination is not the folder typed in the form. The route always targets the installed Pack
directory (`packages/harness/src/index.ts:500-505`):

```ts
const installed = path.resolve(this.config.packsDir, validPackId.parse(request.pack));
const operation = { from: fromSource ? request.source! : installed,
                    to: fromSource ? installed : request.to, mode: request.mode, ... };
```

The throw happens in the preview (`previewPackTransfer` -> `transferSnapshot`), before the review
object is populated, which is why the UI showed bare text and no table. `install` and also
`share`/`migrate` pointed at the installed folder all reach the same guard, and
`installPackMethod` — the only function that replaces an installed method — is called only for
`install`/`upgrade` (`release.ts:897-899`).

**Why `upgrade` does not route around it.** `release.ts:877` requires a released source:

```ts
if (packStageFrom(folder).stage !== 'released')
  throw new PackFolderError('upgrade candidate must have a tested release');
```

The ladder is cumulative (`packs.ts:3278-3318`): `released` needs `VERSION.yml` and the `tested`
rung, which needs `TEST.md` naming a Run. The folder stands at `compiled`, so `upgrade` fails with
the same class of refusal, one message later.

**Workaround used.** Preserved `run-assets/` and `.hima-method-history/` (the App's own Run
evidence and prior-method archive, present inside the installed Pack folder), removed only the
installed Pack directory, and installed 1.0.1 fresh. There is no in-product force/replace path.

**Side effect worth recording.** The App keeps Run archives inside the installed Pack folder
(`run-assets/run-<id>/…`, `run-assets/.evidence/…`). A fresh install produces an empty
`run-assets/`, so the replacement discarded Trial 25's Run archives from the App's own tree;
they survive only in the manual backup at
`…/Trial Data/dsh/hima/pre-1.0.1-install-backup`. Whether `/hima status` can still read those Runs'
materials is not yet checked.

---

## Finding 2 — the Configuration page's Rediscover drops Permit authority and capacity

**Fixed since Trial 25.** Saved Site bindings survive the page's Rediscover.
`packages/harness/src/index.ts:780-783` re-attaches them:

```ts
const withSavedBindings = reuse === undefined ? discovered : {
  ...discovered, site: { ...discovered.site, bindings: { ...reuse.bindings } } };
```

Licence seats are also re-derived from the selected Pack (`index.ts:784-794`), so the page proposes
`Innovus/StarRC/PrimeTime/XTop = 1` rather than an empty licence table.

**Still broken.** `packages/harness/src/sites.ts:210` hardcodes the Permit's forbidden list inside
`discoverSshSite`:

```ts
forbidden: ['deletions'],
```

`forbidden` is not a discovery request field, so there is no path by which the saved list
(`services`, `licence-servers`, `network-settings`, `dns`, `proxy`, `tailscale`, `deletions`,
`moves-of-run-directories`, `repository-downloads`) survives a rediscover-and-save. Capacity is also
replaced by observed hardware rather than the saved values: the probe returned
`cores: 32, memoryGiB: 117.6, parallelJobs: 5` against the saved `16 / 64 / 1`.

**Additional hazard.** `saveDiscoveredSite` derives the Permit filename from the Site *name*, not
from the path already on file (`sites.ts:226,235`):

```ts
const permitFile = path.join(sitesDir, `${name}.permit.yml`);
```

The saved `site.yml` referenced `./permit.yml` and no `linglong-swerv28.permit.yml` existed, so a
naive Save would have written a new Permit containing only `forbidden: [deletions]` and repointed
`site.yml` at it, leaving the hand-corrected `permit.yml` orphaned.

**Note on the read-only probe.** `hima_site rediscover` (the tool path, `tools.ts`) returns
`bindings: {}` — it does not apply the `index.ts:780-783` re-attachment. That is a reporting
difference only: the tool never writes a Site, so no binding can be lost through it. The page's
save path is the one that preserves them.

---

## Finding 3 — an unsealed development Pack structurally cannot produce an unmarked Campaign Run

**Observed.** The Campaign Run created for `xtop-timing-closure@1.0.1` carries `purpose: "test"` in
the Ledger, and every face renders it as **"test run"** (banner, run list, `/hima status`). No test
flag was passed by the operator; `hima_run` exposes no such parameter.

**Root cause.** `packages/harness/src/fabric.ts:142-145` decides the purpose from the folder's
authoring stage, not from the caller:

```ts
function packPurpose(folder: PackFolderSnapshot): RunPurpose {
  const stage = packStageFrom(folder).stage;
  return stage === 'none' || stage === 'released' ? 'campaign' : 'test';
}
```

with `fabric.ts:517`: `const purpose = req.test === true ? 'test' : packPurpose(folder);`. The
comment at `fabric.ts:130-134` states the rule deliberately: a folder still in the pipeline is a
pack under construction, and a Campaign of it is the author exercising their own work.

**Consequence.** The mark is documented as meaning *"do not read this Run as a result: it is a pack
author exercising their own work"* (`card-labels.ts:82-89`). The Pack stands at `compiled`, and
reaching `released` requires `VERSION.yml` plus a passing `tested` rung (`packs.ts:3278-3318`) —
while the trial instruction for this same Campaign forbids adding `TEST.md`, hand-editing
`VERSION.yml`, or calling the Pack released during the trial.

**The tension.** Within one trial the two requirements cannot both hold: an unmarked `campaign`
purpose requires a seal, and the trial forbids sealing. Any evidence this Run produces is marked as
a test run, including the evidence a later `TEST.md` would be expected to rest on. This is
independent of the 1.0.1 fix — it holds for any unsealed development Pack on this build.

**Not a test *lane*.** The Run was admitted through the ordinary owner-bound path with a real
proposal id, the normal `jobCap`, and the full reference graph; nothing about its execution is
reduced. The difference is the label and the standing of its results.

---

## Finding 4 — StarRC cannot start: the Pack never sets the TBB library path inside the container

**Observed.** `extract-baseline` failed on its first attempt, exit code 1, after ~1.2 s of StarRC
licence time (`licenceMs: {StarRC: 1192}`). The Pack's own log records:

```
Rejected: commercial tool exited 127; see .../flow/iterations/g000/STARRC/cworst_T.log
```

and `cworst_T.log` holds only:

```
Loading EDA init: /data/eda/env/edarun-init.sh
EDA 完整全集环境已成功加载
StarXtract: error while loading shared libraries: libtbb.so.12: cannot open shared object file: No such file or directory
```

**Root cause.** StarRC's binary is on `PATH` inside the container, and the library it needs is
present in the tool's own tree — `…/starrc/X-2025.06-SP1/linux64_starrc/lib/libtbb.so.12`. What is
missing is the search path. The Foundation Flow supplies it in its own wrapper:

```bash
# foundation/scripts/run_starrc.sh
starrc_root=/data/eda/software/eda_tools/synopsys/starrc/X-2025.06-SP1
export LD_LIBRARY_PATH="$starrc_root/linux64_starrc/lib:$starrc_root/linux64_starrc/lib/shlib:${LD_LIBRARY_PATH:-}"
StarXtract -clean cworst_T.cmd
```

The Pack does not go through that wrapper. `flow/closure.py` `extract_current` patches the corner
template into `<corner>.cmd` and invokes the binary directly:

```python
run_eda(profile, ["StarXtract", "-clean", str(cmd)], root, log)
```

`edarun-init.sh` does not set `LD_LIBRARY_PATH` (verified: no `LD_LIBRARY_PATH` or StarRC line in
that file), so nothing supplies it. This is the same class of defect as Finding 1's 1.0.0 blocker —
a value that must cross the container boundary is never delivered — one layer further out. The
Pack's own knowledge (`knowledge/source-flow.md` §E) already states the rule the Pack breaks:
*"不要绕开 `edarun` 自行拼接库路径。StarRC 的 TBB 兼容路径只在 `scripts/run_starrc.sh` 和迭代脚本中局部设置。"*

**Verified fix.** Setting the path *inside* the container — not on the outer Python subprocess, which
the boundary strips — makes StarRC both load and complete:

```
StarRC (TM)  Version X-2025.06-SP1 for linux64 - Jul 29, 2025
...
Done          Elp=00:01:57 Cpu=00:01:54
Warnings: 0    Errors: 0
```

That probe also wrote a valid 83 MB `swerv_wrapper.cworst_T.spef` from the Run's own patched
`cworst_T.cmd`, so the corner template, LEF/grd inputs and `TOP_DEF_FILE` are all correct — only
the library search path was wrong. The probe's artifacts were quarantined to
`<workspace>/probe-artifacts-quarantine/` so they cannot be mistaken for Run evidence.

**Consequence for the Run.** `extract-baseline` is `phase: failed` / `result: retrying` — the
harness's own retry allowance is 2, so it schedules a second identical attempt. Because the cause is
deterministic rather than transient, the retry cannot succeed. The Run was paused at that node.

**Suggested change (not applied).** Pass the library path to the Site's shell for the StarRC
invocation only, e.g. extend `run_eda` to accept an in-container environment prefix for the extract
stage, mirroring the Foundation wrapper. The same question should be asked of XTop and PrimeTime
before they are reached; `ldd` shows StarXtract links one `tbb` library, and neither `edarun-init.sh`
nor the Pack sets a search path for the other tools either.

### Implementation in 1.0.2

Applied in the Pack source as version 1.0.2. `run_eda` gained an optional `shell_env` argument,
distinct from its `env`: `env` is handed to the tool's Python subprocess and is stripped at the
container boundary, while `shell_env` prefixes the command the wrapper runs, so the value is set
inside the container's own shell. `extract_current` now calls a `run_starrc` helper that supplies
`LD_LIBRARY_PATH` built from the toolkit's `linux64_starrc/lib` and `lib/shlib`, with the
container's inherited value appended rather than discarded.

The toolkit root is discovered inside the container by walking up from `command -v StarXtract` to
the directory that actually holds `linux64_starrc`, not by counting path levels. Two earlier
attempts at this were wrong and are worth recording: host-side `ldd` reports
`not a dynamic executable` for this launcher, and a fixed `../../..`-style depth picked the wrong
directory. A Site profile may also declare `starrcHome`; it is permitted but **not required**, so the
already-deployed profile needs no edit. An unresolvable toolkit raises `Rejected` before StarXtract
is launched, rather than failing again on the same shared library.

`pt_shell` and `xtop` need no equivalent: `run_pt.sh` and `run_xtop.sh` set no environment beyond
what `edarun-init.sh` already provides, and invoke their tools exactly as the Pack does.

Verified against the live site: discovery resolves
`/data/eda/software/eda_tools/synopsys/starrc/X-2025.06-SP1`, the emitted command is valid shell,
and StarRC loads with those two directories prepended (the pre-fix probe reached the StarRC banner
only when the path was set *inside* the container, and failed when it was set outside). The seven
unit tests are hermetic — they use a synthetic toolkit tree — and cover the assignment, quoting for
a path containing spaces, and the profile contract.

**Not done.** No 1.0.2 Run has been started, so the fix is proven by the hermetic unit tests and
the discovery/library-path probe against the live Site, not yet by a Campaign. The contract/graph
version strings were left at `1.0.1` on this tester branch; bumping the Pack's declared version and
releasing `1.0.2` is the improver's action, consistent with how 1.0.0 -> 1.0.1 was handled after
Trial 25.
