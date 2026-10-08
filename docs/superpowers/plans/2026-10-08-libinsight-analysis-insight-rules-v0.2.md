# LibInsight Analysis Pack 0.2 (Insight Rules) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Pack `libinsight-analysis` to 0.2.0 so that one chat message ("which cells limit my Vmin?") becomes a named rule with a plain sentence, runs on linglong on prepared Liberty facts, is admitted as a `hima-libinsight-insight/1` result checked by LibInsight's own validator, and ends on its LibInsight Data Insight page (lib_insight spec `docs/spec/library-insight-rules.md` §9, §9.1, §11 P2).

**Architecture:** The existing route (prepare → resident engineering task → Reader → admit → deliver, ADR-0017/0020/0021) is kept and deepened. A new deterministic `prepare-data` task finds every Liberty file's facts in the corpus or extracts them with QuaLib and admits them; the Reader runs LibInsight's validator, vendored at the pinned lib_insight commit and verified by SHA-256 before import. The Host exports each admitted insight result into a Harness-owned folder that the Host passes to its LibInsight viewer with `--analyses-root`; the conversation card and the analysis page open Data Insight focused on the rule.

**Tech Stack:** Pack: Python 3.6-compatible stdlib (`unittest`); `prepare-data` and LibInsight's netlist reader on the Site host's Python ≥ 3.9 (linglong `/usr/bin/python3` 3.12 + numpy 1.26). Harness: TypeScript on Node 24, dsh Host, React client, Electron desktop; tests with `node --test` through `scripts/run-contract-tests.mjs` and `scripts/run-unit-tests.mjs`.

## Global Constraints

- Repo rules override habits: read `AGENTS.md`, `docs/agents/polishing-discipline.md`, `docs/agents/model-policy.md`, `docs/testing-strategy.md` before the first task. Work in the existing modules named per task; no new runtime, control plane or second Agent Loop.
- Work in the worktree `/Users/lluzi/code/hima_harness_insight_v02` on branch `feat/libinsight-insight-rules-v0.2`, created from `origin/main` (5d2ea5bd or later). `/Users/lluzi/code/hima_harness_reforge_claude` and `/Users/lluzi/code/himaharness` stay read-only. The lib_insight checkout `/Users/lluzi/code/lib_insight` is read only through `git show`/`git archive`; never switch its branch and never write in it.
- After every commit: push and verify the remote SHA (AGENTS.md). Use exactly:
  ```bash
  git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
  ```
  A failed push or SHA mismatch stops the task; report it. The pre-push hook (when installed) runs `pnpm run check:local`; let it run.
- Commit messages: conventional style as in the history (`feat(libinsight): …`, `docs(adr): …`), ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Model allocation (docs/agents/model-policy.md): every task is executed by a Claude Code sub-agent on Opus 5.5 in a fresh context; Task 18 (L4) is executed by the Claude Code main agent on Opus 5.5 with the `himaharness-human-like-tester` skill. Product model stays DeepSeek 4.1 Flash. Record the actual model and effort in the task's commit body.
- Data policy: foundry (TSMC, N12) data and anything derived from it may be used locally but never committed, never in fixtures, docs, plans, commit messages, issues or Artifacts. Committed fixtures and reference results are synthetic (`INVX1`, `NAND2X2`, `NOR3X1` …) or SAED14. Evidence of real runs goes to the git-ignored `.hima-tmp/` only; check `git status --short` before every commit.
- linglong: never `sudo`; never change licence services, network, proxy, DNS, Tailscale or firewall. The user alone runs `empyrean-license new|old`. A step that needs licence mode `new` says so, asks the user to switch, and reminds them to switch back with `empyrean-license old` afterwards. One heavy job at a time; check `free -h` first; bound every combinatoric loop.
- Python in the Pack: every file under `packs/libinsight-analysis/flow/` runs on Python 3.6.8 (resident sandbox) unless the task says "host only" (`prepare-data`, the vendored `insight_actions` and `netlist`, which need ≥ 3.9). The vendored `insight_result` validator runs on 3.6. No walrus, no `dataclasses`, no `from __future__ import annotations`, no `capture_output=` in Pack code.
- Product wording on pages, cards and Guide text: plain English, customer words (cell, arc, corner, derate, slew, load), one idea per sentence; no internal names (Expectation, Finding, Kit Release, E-numbers).
- Build before TS tests: `pnpm run build` once per source change; leaf test commands do not build. Pass, fail, skip and not-run are reported separately; a skip is never a pass.
- Pack Python tests: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'` from the worktree root (macOS `python3` is 3.9.6; tests that need ≥ 3.9 skip, visibly, on an older interpreter).
- New contract test files must be listed in `test/contract-groups.json` (the runner refuses unlisted files).

## Decisions taken in this plan

| Question | Decision | Why |
| --- | --- | --- |
| How does the viewer's `analyses_roots` get the Harness folder without Harness writing LibInsight's data folder? | The Host passes `--analyses-root <Harness Home>/libinsight-results` when it launches `app/server.py` (ADR-0019 already makes the Host own the viewer process and its argv). LibInsight appends that root to the `analyses_roots` it read from `app.json`, in memory. Harness never writes `app.json` or the data folder; the user's own `analyses_roots` keep working. Older pinned LibInsight without the flag is detected (no `--analyses-root` in `app/server.py`) and the flag is not passed. | The process launch is already Host-owned; a derived `app.json` would have to rewrite LibInsight's Kit paths and would drift from what LibInsight writes. Recorded in ADR-0022. |
| Where do the format checks live? | Only in LibInsight's `libinsight/insight_result.py` (P1a plan `lib_insight/docs/superpowers/plans/2026-10-08-insight-p1a-result-core.md`: self-contained, Python 3.6 syntax, stdlib only, `validate(result, *, prepared=None, root=None, byte_size=None, current_sha=None)` mirrors every check of the 0.1 Reader: sources and re-hash, size, code files on disk, run, datasets, nulls). It is vendored at the pinned commit together with the import closure of `insight_actions` and `netlist` and LibInsight's `extract/libapi_extract.py`, under `flow/libinsight_analysis/vendor/`, listed with SHA-256 in `vendor/VENDOR.json`. The vendored commit must equal `packages/desktop/libinsight.pin.json`. The Pack keeps only what LibInsight cannot know: the result is an insight result, its id is the rule the person confirmed, and the design files prepare-data hashed are unchanged. | One validator, one LibInsight version for page and Pack. |
| Which Python runs the validator? | `insight_result` runs on Python 3.6, so the Reader and admission (Site host, 3.12) and the resident's `check-delivery` (sandbox, 3.6.8) run the same validator. `insight_actions` and `netlist` need 3.9 and run only on the Site host (`prepare-data`) and in the Pack tests. If a future pin's validator stops importing on 3.6, `check-delivery` says the format checks are deferred to the Reader, which never accepts without them. | One set of rules everywhere it can run; fail closed where it matters. |
| "Extract when facts are missing": reuse library-intelligence's worker? | `library-intelligence/tools/libapi_worker.py` is a qualification probe, not a facts extractor. `prepare-data` reuses its pattern (one Liberty file per process under `edarun` with the vendor Python, hash before and after, licence seat declared) and runs LibInsight's own extractor (vendored `extract/libapi_extract.py`, the one that wrote the corpus). Extracted facts are admitted into a Site facts store keyed by Liberty SHA-256. | Same facts schema as the corpus; no new extractor. |
| How does a request name a Kit? | A Site kit catalogue (`kitCatalog`, `hima-libinsight-kits/1`) maps a Kit name (`saed14`) to Liberty folders, a file-name pattern with `variant`/`corner` groups and netlist folders. The request names `kit: {name, variants, corners}`. | The Guide never guesses Site paths. |
| Request format | `hima-libinsight-request/2` adds `rule`, `kit`, `netlists`, `design`, `needs`. The Host writes `/2` only for an installed Pack ≥ 0.2.0, `/1` otherwise. | Lets Host and Pack land in either order. |
| How does the Guide recognise the Pack? | A generic optional contract field `offers` (named capabilities: id, title, sentence, example, parameters) is read by `packs.ts` and listed in the Guide inventory; the product context says how to map a library question to an offered rule. | Generic Pack seam (module map: "Pack 读取与适用性"), no Pack name hard-coded in the Host. |
| Reference results | Four Pack-owned Python 3.6 rule scripts (`flow/reference_rules/`) run on a synthetic Kit; their outputs (`flow/reference_results/*.json`) must pass the vendored validator. A shared `insight_builder.py` is the one place the result shape is spelled for scripts. | Gold examples the resident can run in its own sandbox; synthetic data only. |
| "Open in Data Insight" from the analysis page (a script-free page in its own window) | A `hima://data-insight/?insight=<id>@<version>` link; the desktop shell intercepts it and dispatches `hima:open-insight` in the main window, which opens the Workbench on Data Insight focused on the rule. The frame URL carries `?insight=<id>@<version>`. | No Host route, no script in the page, works with the existing navigation fence. |

## LibInsight prerequisites (P1 must ship them; Task 1 verifies them)

1. `libinsight/insight_result.py`, `insight_score.py`, `insight_actions.py`, `insight_store.py`, `netlist.py`, `app/static/insight_page.js`, `app/static/insight_charts.js` (shared brief names).
2. `app/server.py --analyses-root DIR` (repeatable), appended in memory to `app.json`'s `analyses_roots`, never written back.
3. The Insights page opens the rule named in the page URL query `?insight=<id>@<version>` (or `?insight=<id>` for the newest version) and falls back to its normal landing when the rule is absent.
4. `libinsight/insight_result.py` stays self-contained (stdlib only, Python 3.6 syntax) with `validate(result, *, prepared=None, root=None, byte_size=None, current_sha=None)`, `measures(result)`, `canonical_bytes(value)` and the normative shapes of the P1a plan ("Normative details": top-level keys without `plots`, subject grammar, chart encodings incl. compound `gap`/`missing`/`box`/`class_box`, action targets and params, `redesign_cell` symptoms and levers, score weight classes). `insight_actions.py`, `netlist.py` (P1c) import only the standard library, numpy and `libinsight`.

If 2 or 3 is missing at the commit the coordinator names, stop at Task 1 and report: the Host cannot list Harness results or focus a rule.

## File Structure

Pack `packs/libinsight-analysis/` (all paths below are under it unless absolute):

| Path | Responsibility |
| --- | --- |
| `contract.yml`, `graph.yml`, `schemas/tasks.json`, `semantics.yml` | 0.2.0 route: prepare-request → prepare-data → custom-analysis → admit-analysis → deliver |
| `flow/libinsight_analysis/common.py` | shared constants: rule ids, schemas, paths |
| `flow/libinsight_analysis/request.py` | request `/2`, kit catalogue, netlists, design, extraction list |
| `flow/libinsight_analysis/data.py` (new, host only) | `prepare-data`: facts lookup, QuaLib extraction, facts admission, netlist facts, design hashes |
| `flow/libinsight_analysis/vendored.py` (new) | verify `vendor/VENDOR.json` and import vendored LibInsight modules |
| `flow/libinsight_analysis/vendor/**` (generated) | LibInsight code at the pinned commit |
| `flow/libinsight_analysis/delivery.py` | Pack checks + vendored validator for `hima-libinsight-insight/1` |
| `flow/libinsight_analysis/insight_builder.py` (new, 3.6) | how rule scripts write a result and a delivery candidate |
| `flow/libinsight_analysis/library.py`, `tasks.py` | admission and final report for insight results |
| `flow/libinsight_cli.py` | task ABI incl. `task-prepare-data`; `check-delivery` |
| `flow/reference_rules/*.py`, `flow/reference_rules/catalog.json` (new) | the four reference rules and their catalogue |
| `flow/reference_results/*.json` (new, generated) | reference results on the synthetic Kit |
| `tools/read-insight.py`, `readers/libinsight-insight.yml`, `rules/insight-delivery-ready.yml` (new) | Reader and Judge rule |
| `knowledge/insight-playbook.md`, `insight-result-contract.md`, `rule-catalog.md` (new) | resident and Guide knowledge |
| `flow/tests/synthetic_kit.py`, `flow/tests/fixtures/insight-tiny/tiny_rule.py` (new) | synthetic Kit, netlist, design and a minimal rule for tests |
| `flow/tests/test_*.py` | Pack unit tests |

Harness and repo:

| Path | Responsibility |
| --- | --- |
| `scripts/vendor-libinsight.py` (new) | write and verify the vendored LibInsight copy |
| `packages/desktop/libinsight.pin.json` | LibInsight commit for Data Insight and the Pack |
| `packages/harness/src/packs.ts`, `index.ts` | contract `offers`; Guide inventory and product context |
| `packages/harness/src/libinsight-analyses.ts`, `tools.ts` | request `/2`, rule on the proposal, insight results, export |
| `packages/harness/src/libinsight-viewer.ts` | `--analyses-root` launch argument |
| `packages/harness/src/analysis-page.ts` | insight summary and "Open in Data Insight" |
| `packages/harness/src/client/{insight-analysis-card.ts,InsightAnalysisCard.tsx,insight-focus.ts,workbench-address.ts,HimaWorkbench.tsx,LibInsightAppPanel.tsx,index.ts}` | card, focus, frame URL |
| `packages/desktop/src/{insight-link.ts,main.ts}` | `hima://data-insight` link handling |
| `sites/linglong-libinsight/*` | bindings, kit catalogue, capability v2, README |
| `scripts/package-trial.mjs` | Pack asset list |
| `docs/adr/0022-*.md`, `CONTEXT.md`, `docs/specs/libinsight-resident/spec.zh-CN.md` | decision record and vocabulary |
| `test/contract/*`, `test/fixtures/*`, `test/contract-groups.json` | L2/L3 tests and fixtures |

---

### Task 0: Worktree and baseline

**Files:** none changed.

**Interfaces:** Produces the worktree `/Users/lluzi/code/hima_harness_insight_v02` used by every task.

- [ ] **Step 1: Create the worktree and branch**

```bash
git -C /Users/lluzi/code/hima_harness_reforge_polishing fetch origin
git -C /Users/lluzi/code/hima_harness_reforge_polishing worktree add /Users/lluzi/code/hima_harness_insight_v02 -b feat/libinsight-insight-rules-v0.2 origin/main
cd /Users/lluzi/code/hima_harness_insight_v02 && pnpm install --frozen-lockfile && pnpm run build
```
Expected: build exits 0.

- [ ] **Step 2: Record the baseline of the suites this plan touches**

```bash
cd /Users/lluzi/code/hima_harness_insight_v02
python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'
pnpm run test:local --files test/contract/libinsight-analyses.test.ts test/contract/libinsight-viewer.test.ts test/contract/product-context.host.test.ts
pnpm run test:unit
node scripts/run-contract-tests.mjs atcs-dry --files test/contract/libinsight-resident-durable.host.test.ts
```
Expected: all PASS. Write the counts (pass/fail/skip, elapsed) into the Task 1 commit body. A baseline failure stops the plan: report it before changing anything.

No commit in this task.

---

### Task 1: Pin LibInsight to the insight-rules commit (P1)

**Files:**
- Modify: `packages/desktop/libinsight.pin.json`
- Create: `test/contract/libinsight-pin.test.ts`
- Modify: `test/contract-groups.json` (add the new file to `local`)

**Interfaces:**
- Consumes: the lib_insight commit the coordinator names as P1 done (spec §11: four reference results validate, render, generate files, score popup sums them). Call it `LI_P1` (40 hex).
- Produces: `libinsight.pin.json.commit == LI_P1`, used by Task 2 (vendoring) and packaging.

- [ ] **Step 1: Write the failing test**

`test/contract/libinsight-pin.test.ts`:
```ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './support/dsh-home.ts';

// ADR-0022: Data Insight and the libinsight-analysis Pack use one LibInsight commit, and that commit
// ships the insight rules (lib_insight spec §11 P1) plus the two seams the Host relies on.
const pin = JSON.parse(readFileSync(path.join(repoRoot, 'packages/desktop/libinsight.pin.json'), 'utf8')) as { schema: string; commit: string; paths: string[] };
const P1_FILES = ['libinsight/insight_result.py', 'libinsight/insight_score.py', 'libinsight/insight_actions.py',
  'libinsight/insight_store.py', 'libinsight/netlist.py', 'app/static/insight_page.js', 'app/static/insight_charts.js'];

test('the LibInsight pin is a full commit of app/ and libinsight/', () => {
  assert.equal(pin.schema, 'hima-libinsight-pin/1');
  assert.match(pin.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(pin.paths, ['app', 'libinsight']);
});

test('the pinned commit ships the insight rules and the Host seams', {
  skip: process.env.HIMA_LIBINSIGHT_SOURCE ? false : 'set HIMA_LIBINSIGHT_SOURCE to a lib_insight checkout (not run, not passed)',
}, () => {
  const source = process.env.HIMA_LIBINSIGHT_SOURCE!;
  const show = (file: string) => execFileSync('git', ['-C', source, 'show', `${pin.commit}:${file}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  for (const file of P1_FILES) assert.ok(show(file).length > 0, `${file} at ${pin.commit}`);
  assert.match(show('app/server.py'), /--analyses-root/, 'the viewer takes the Harness results folder as a launch argument');
  assert.match(show('app/static/insight_page.js'), /searchParams\.get\(\s*['"]insight['"]\s*\)|[?&]insight=/, 'the page opens a rule named in ?insight=');
  assert.match(show('libinsight/insight_result.py'), /SCHEMA\s*=\s*["']hima-libinsight-insight\/1["']/);
});
```
Add `"test/contract/libinsight-pin.test.ts",` to the `local` array of `test/contract-groups.json`, directly after `"test/contract/libinsight-analyses.test.ts",`.

- [ ] **Step 2: Run it against the current pin to see it fail**

```bash
cd /Users/lluzi/code/hima_harness_insight_v02 && pnpm run build
HIMA_LIBINSIGHT_SOURCE=/Users/lluzi/code/lib_insight pnpm run test:local --files test/contract/libinsight-pin.test.ts
```
Expected: FAIL in "the pinned commit ships the insight rules" (`git show 55e27bfa…:libinsight/insight_result.py` does not exist).

- [ ] **Step 3: Verify the P1 commit and run LibInsight's own tests on it**

```bash
LI=/Users/lluzi/code/lib_insight
git -C $LI fetch origin
LI_P1=<the 40-hex commit the coordinator named>
git -C $LI cat-file -e "$LI_P1^{commit}"
git -C $LI show "$LI_P1:app/server.py" | grep -n -- '--analyses-root'
git -C $LI show "$LI_P1:app/static/insight_page.js" | grep -n "insight"
S=$(mktemp -d /private/tmp/li-p1.XXXXXX); git -C $LI archive "$LI_P1" | tar -x -C "$S"
(cd "$S" && /usr/bin/python3 -m pytest -q)
```
Expected: both greps print a line; pytest passes on the Mac's Python 3.9 (record the pass count). If a grep prints nothing, stop and report the missing prerequisite (see "LibInsight prerequisites").

- [ ] **Step 4: Bump the pin**

```bash
cd /Users/lluzi/code/hima_harness_insight_v02
node -e "const fs=require('fs');const f='packages/desktop/libinsight.pin.json';const p=JSON.parse(fs.readFileSync(f,'utf8'));p.commit=process.argv[1];p.note='Data Insight frames this LibInsight web app (ADR-0019) and lists the Harness insight results through --analyses-root (ADR-0022). The libinsight-analysis Pack vendors the same commit. Update by changing commit, re-running scripts/vendor-libinsight.py and repackaging with --libinsight-source <lib_insight checkout>.';fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n')" "$LI_P1"
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
HIMA_LIBINSIGHT_SOURCE=/Users/lluzi/code/lib_insight pnpm run test:local --files test/contract/libinsight-pin.test.ts
```
Expected: 2 PASS.

- [ ] **Step 6: Commit and push**

```bash
git add packages/desktop/libinsight.pin.json test/contract/libinsight-pin.test.ts test/contract-groups.json
git commit -m "build(desktop): pin LibInsight to the insight-rules release

Baseline (Task 0): <paste counts>. LibInsight pytest at the new pin: <count> passed on Python 3.9.
Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---
### Task 2: Vendor LibInsight's validator, netlist reader and extractor

**Files:**
- Create: `scripts/vendor-libinsight.py`
- Create (generated by the script): `packs/libinsight-analysis/flow/libinsight_analysis/vendor/**`, `.../vendor/VENDOR.json`
- Create: `packs/libinsight-analysis/flow/libinsight_analysis/vendored.py`
- Create: `packs/libinsight-analysis/flow/tests/test_vendor.py`
- Modify: `.gitignore` (add `__pycache__/`)

**Interfaces:**
- Consumes: `packages/desktop/libinsight.pin.json.commit` (Task 1).
- Produces:
  - `vendored.VENDOR: str` (absolute path of the vendor folder), `vendored.MIN_PYTHON = {"insight_result": (3, 6)}`, `vendored.DEFAULT_MIN_PYTHON = (3, 9)` (per vendored module)
  - `vendored.manifest() -> dict` and `vendored.verify() -> dict` (raise `LiaError('pack-defect', …)`)
  - `vendored.load(module: str) -> module` for `"insight_result"` (Python ≥ 3.6), `"insight_actions"`, `"netlist"` (≥ 3.9); raises `LiaError('validator-unavailable', …)` on an old Python or an import failure, `LiaError('pack-defect', …)` on a hash mismatch
  - vendored extractor path: `os.path.join(vendored.VENDOR, "extract", "libapi_extract.py")`

- [ ] **Step 1: Write the failing test**

`packs/libinsight-analysis/flow/tests/test_vendor.py`:
```python
"""The vendored LibInsight code is the pinned commit's, byte for byte, and is refused when it is not."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from libinsight_analysis import common, vendored  # noqa: E402
import synthetic  # noqa: E402

REPO = os.path.dirname(os.path.dirname(synthetic.PACK))


class Vendored(unittest.TestCase):
    def test_manifest_lists_the_files_on_disk(self):
        doc = vendored.verify()
        self.assertRegex(doc["commit"], r"^[0-9a-f]{40}$")
        for name in ("libinsight/__init__.py", "libinsight/insight_result.py", "libinsight/insight_actions.py",
                     "libinsight/netlist.py", "extract/libapi_extract.py"):
            self.assertIn(name, doc["files"])

    def test_commit_is_the_data_insight_pin(self):
        pin = os.path.join(REPO, "packages", "desktop", "libinsight.pin.json")
        if not os.path.isfile(pin):
            self.skipTest("Pack copied outside the repository")
        with open(pin) as stream:
            self.assertEqual(vendored.manifest()["commit"], json.load(stream)["commit"])

    def test_a_changed_byte_is_a_pack_defect(self):
        target = os.path.join(vendored.VENDOR, "libinsight", "insight_result.py")
        with open(target, "rb") as stream:
            original = stream.read()
        try:
            with open(target, "ab") as stream:
                stream.write(b"\n# tampered\n")
            with self.assertRaises(common.LiaError) as caught:
                vendored.verify()
            self.assertEqual(caught.exception.code, "pack-defect")
            self.assertIn("libinsight/insight_result.py hashes", caught.exception.detail)
        finally:
            with open(target, "wb") as stream:
                stream.write(original)

    def test_an_extra_file_is_a_pack_defect(self):
        extra = os.path.join(vendored.VENDOR, "libinsight", "extra.py")
        with open(extra, "w") as stream:
            stream.write("x = 1\n")
        try:
            with self.assertRaises(common.LiaError) as caught:
                vendored.verify()
            self.assertIn("extra ['libinsight/extra.py']", caught.exception.detail)
        finally:
            os.remove(extra)

    def test_validator_imports_from_the_vendored_copy(self):
        module = vendored.load("insight_result")
        self.assertEqual(module.SCHEMA, "hima-libinsight-insight/1")
        self.assertTrue(os.path.realpath(module.__file__).startswith(os.path.realpath(vendored.VENDOR) + os.sep))
        self.assertTrue(module.validate({}), "an empty object is not a result")
        self.assertEqual(module.canonical_bytes({"b": 1, "a": "x"}), common.canonical_bytes({"b": 1, "a": "x"}))

    def test_the_validator_is_self_contained_python_3_6_code(self):
        import ast
        with open(os.path.join(vendored.VENDOR, "libinsight", "insight_result.py"), encoding="utf-8") as stream:
            tree = ast.parse(stream.read())
        walrus = getattr(ast, "NamedExpr", None)
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                self.assertNotEqual(node.module, "__future__")
                self.assertEqual(node.level, 0, "the validator imports nothing from its own package")
                self.assertNotEqual((node.module or "").split(".")[0], "libinsight")
            self.assertNotIsInstance(node, ast.AnnAssign)
            if walrus is not None:
                self.assertNotIsInstance(node, walrus)
            if isinstance(node, ast.FunctionDef):
                self.assertIsNone(node.returns)
                self.assertTrue(all(arg.annotation is None for arg in node.args.args + node.args.kwonlyargs))

    def test_an_old_python_is_refused_plainly(self):
        saved = dict(vendored.MIN_PYTHON)
        vendored.MIN_PYTHON["insight_result"] = (99, 0)
        try:
            with self.assertRaises(common.LiaError) as caught:
                vendored.load("insight_result")
            self.assertEqual(caught.exception.code, "validator-unavailable")
            self.assertIn("Python 99.0 or later", caught.exception.detail)
        finally:
            vendored.MIN_PYTHON.clear()
            vendored.MIN_PYTHON.update(saved)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/lluzi/code/hima_harness_insight_v02
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_vendor.py'
```
Expected: ERROR `ImportError: cannot import name 'vendored'`.

- [ ] **Step 3: Write the vendoring script**

`scripts/vendor-libinsight.py`:
```python
#!/usr/bin/env python3
"""Copy the LibInsight code the libinsight-analysis Pack runs, from one pinned lib_insight commit (ADR-0022).

    python3 scripts/vendor-libinsight.py --source /path/to/lib_insight     # write the copy
    python3 scripts/vendor-libinsight.py --verify [--source /path]          # check it

The commit is packages/desktop/libinsight.pin.json's, so Data Insight and the Pack run one LibInsight.
Files are read with `git show <commit>:<path>`: the checkout's working tree and data folder are never
read. The copy is the import closure, inside the `libinsight` package, of ENTRY_MODULES, plus
LibInsight's QuaLib extractor. VENDOR.json records the commit and each file's SHA-256; the Pack Reader
re-checks them before it imports anything.
"""
import argparse
import ast
import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIN = os.path.join(ROOT, "packages", "desktop", "libinsight.pin.json")
TARGET = os.path.join(ROOT, "packs", "libinsight-analysis", "flow", "libinsight_analysis", "vendor")
SCHEMA = "hima-libinsight-vendor/1"
ENTRY_MODULES = ("libinsight.insight_result", "libinsight.insight_actions", "libinsight.netlist")
EXTRA_FILES = ("extract/libapi_extract.py",)
ALLOWED_TOP = frozenset((
    "__future__", "argparse", "bisect", "collections", "copy", "csv", "dataclasses", "datetime", "enum", "fnmatch",
    "functools", "gzip", "hashlib", "heapq", "io", "itertools", "json", "math", "numbers", "operator", "os",
    "platform", "re", "resource", "stat", "statistics", "string", "sys", "textwrap", "time", "traceback", "typing",
    "numpy", "tmlib"))


def pinned_commit():
    with open(PIN, "r") as stream:
        commit = json.load(stream).get("commit", "")
    if len(commit) != 40:
        raise SystemExit("%s has no full commit" % PIN)
    return commit


def git_bytes(source, commit, path):
    completed = subprocess.run(["git", "-C", source, "show", "%s:%s" % (commit, path)],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return completed.stdout if completed.returncode == 0 else None


def module_file(source, commit, module):
    """(repository path, bytes) of a libinsight module or package, or (None, None) for a plain name."""
    base = module.replace(".", "/")
    for candidate in (base + ".py", base + "/__init__.py"):
        data = git_bytes(source, commit, candidate)
        if data is not None:
            return candidate, data
    return None, None


def imports(path, data):
    """(libinsight module names, other top-level names) one file imports."""
    tree = ast.parse(data.decode("utf-8"), filename=path)
    package = (path[:-len("/__init__.py")] if path.endswith("/__init__.py") else path.rsplit("/", 1)[0]).replace("/", ".")
    internal, external = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] == "libinsight":
                    internal.add(alias.name)
                else:
                    external.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                parts = package.split(".")
                base = ".".join(parts[:len(parts) - (node.level - 1)])
                target = base + "." + node.module if node.module else base
                internal.add(target)
                internal.update(target + "." + alias.name for alias in node.names)
            elif node.module.split(".")[0] == "libinsight":
                internal.add(node.module)
                internal.update(node.module + "." + alias.name for alias in node.names)
            else:
                external.add(node.module.split(".")[0])
    return internal, external


def closure(source, commit):
    """{repository path: bytes} of every file the Pack carries."""
    files, queue, seen = {}, list(ENTRY_MODULES), set()
    while queue:
        module = queue.pop()
        if module in seen:
            continue
        seen.add(module)
        path, data = module_file(source, commit, module)
        if path is None:
            if module in ENTRY_MODULES:
                raise SystemExit("LibInsight %s has no module %s" % (commit, module))
            continue
        files[path] = data
        parts = module.split(".")
        queue.extend(".".join(parts[:depth]) for depth in range(1, len(parts)))
        internal, external = imports(path, data)
        refused = sorted(external - ALLOWED_TOP)
        if refused:
            raise SystemExit("%s imports %s, which the Site Reader cannot rely on" % (path, ", ".join(refused)))
        queue.extend(sorted(internal))
    for extra in EXTRA_FILES:
        data = git_bytes(source, commit, extra)
        if data is None:
            raise SystemExit("LibInsight %s has no %s" % (commit, extra))
        files[extra] = data
    return files


def on_disk():
    found = {}
    for directory, folders, names in os.walk(TARGET):
        folders[:] = [folder for folder in folders if folder != "__pycache__"]
        for name in names:
            if name == "VENDOR.json" or name.endswith(".pyc"):
                continue
            at = os.path.join(directory, name)
            with open(at, "rb") as stream:
                found[os.path.relpath(at, TARGET).replace(os.sep, "/")] = hashlib.sha256(stream.read()).hexdigest()
    return found


def write(source):
    commit = pinned_commit()
    files = closure(source, commit)
    if os.path.isdir(TARGET):
        shutil.rmtree(TARGET)
    for rel, data in sorted(files.items()):
        at = os.path.join(TARGET, *rel.split("/"))
        if not os.path.isdir(os.path.dirname(at)):
            os.makedirs(os.path.dirname(at))
        with open(at, "wb") as stream:
            stream.write(data)
    manifest = {"schema": SCHEMA, "source": "lib_insight", "commit": commit, "entryModules": list(ENTRY_MODULES),
                "python": {"insight_result": ">=3.6", "other modules": ">=3.9"}, "files": dict((rel, hashlib.sha256(data).hexdigest()) for rel, data in sorted(files.items()))}
    with open(os.path.join(TARGET, "VENDOR.json"), "w") as stream:
        stream.write(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print("vendored LibInsight %s: %d files into %s" % (commit, len(files), os.path.relpath(TARGET, ROOT)))


def verify(source):
    with open(os.path.join(TARGET, "VENDOR.json")) as stream:
        manifest = json.load(stream)
    commit, problems, found = pinned_commit(), [], on_disk()
    if manifest.get("commit") != commit:
        problems.append("VENDOR.json commit %s differs from the pin %s" % (manifest.get("commit"), commit))
    if found != manifest.get("files"):
        problems.append("vendored files differ from VENDOR.json")
    if source:
        expected = dict((rel, hashlib.sha256(data).hexdigest()) for rel, data in closure(source, commit).items())
        if expected != found:
            problems.append("the vendored copy is not the import closure of %s at %s" % (", ".join(ENTRY_MODULES), commit))
    if problems:
        raise SystemExit("\n".join(problems))
    print("vendored LibInsight %s: %d files verified" % (commit, len(found)))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--source", help="a lib_insight git checkout")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args(argv)
    if args.verify:
        verify(args.source)
    elif args.source:
        write(args.source)
    else:
        parser.error("give --source to write, or --verify")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Write the loader**

`packs/libinsight-analysis/flow/libinsight_analysis/vendored.py`:
```python
"""The LibInsight code this Pack carries, verified by SHA-256 before use (ADR-0022).

`vendor/` holds LibInsight's validator, action generators, netlist reader and QuaLib extractor at the
commit recorded in `vendor/VENDOR.json` (the same commit Data Insight shows). Nothing is imported
before every file matches its recorded hash. The validator (`insight_result`) is Python 3.6 code and
runs everywhere, the resident sandbox included; the other modules need Python 3.9+ (the Site host).
"""
import hashlib
import json
import os
import sys

from .common import LiaError

VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor")
MANIFEST = os.path.join(VENDOR, "VENDOR.json")
SCHEMA = "hima-libinsight-vendor/1"
MIN_PYTHON = {"insight_result": (3, 6)}
DEFAULT_MIN_PYTHON = (3, 9)


def manifest():
    try:
        with open(MANIFEST, "rb") as stream:
            doc = json.loads(stream.read().decode("utf-8"))
    except (OSError, ValueError) as error:
        raise LiaError("pack-defect", "vendored LibInsight manifest %s is unreadable: %s" % (MANIFEST, error))
    if doc.get("schema") != SCHEMA or not isinstance(doc.get("files"), dict) or not doc["files"]:
        raise LiaError("pack-defect", "vendored LibInsight manifest %s is not a %s document" % (MANIFEST, SCHEMA))
    return doc


def verify():
    doc = manifest()
    found = set()
    for directory, folders, names in os.walk(VENDOR):
        folders[:] = [folder for folder in folders if folder != "__pycache__"]
        for name in names:
            if name == "VENDOR.json" or name.endswith(".pyc"):
                continue
            found.add(os.path.relpath(os.path.join(directory, name), VENDOR).replace(os.sep, "/"))
    listed = set(doc["files"])
    if found != listed:
        raise LiaError("pack-defect", "vendored LibInsight files differ from VENDOR.json: extra %s, missing %s" % (
            sorted(found - listed), sorted(listed - found)))
    for rel, digest in sorted(doc["files"].items()):
        with open(os.path.join(VENDOR, *rel.split("/")), "rb") as stream:
            actual = hashlib.sha256(stream.read()).hexdigest()
        if actual != digest:
            raise LiaError("pack-defect", "vendored %s hashes %s, but VENDOR.json records %s for LibInsight %s" % (
                rel, actual, digest, doc.get("commit")))
    return doc


def load(module):
    """libinsight.<module> imported from the verified vendored copy."""
    needed = tuple(MIN_PYTHON.get(module, DEFAULT_MIN_PYTHON))
    if tuple(sys.version_info[:2]) < needed:
        raise LiaError("validator-unavailable", "LibInsight's %s needs Python %d.%d or later; this is Python %s" % (
            module, needed[0], needed[1], sys.version.split()[0]))
    verify()
    if VENDOR not in sys.path:
        sys.path.insert(0, VENDOR)
    try:
        imported = __import__("libinsight." + module, fromlist=[module])
    except Exception as error:  # an import error of vendored code is reported, never raised through
        raise LiaError("validator-unavailable", "vendored libinsight.%s does not import here: %s: %s" % (
            module, type(error).__name__, error))
    where = os.path.realpath(getattr(imported, "__file__", "") or "")
    if not where.startswith(os.path.realpath(VENDOR) + os.sep):
        raise LiaError("pack-defect", "libinsight.%s was imported from %s, not from the vendored copy" % (module, where))
    return imported
```

- [ ] **Step 5: Generate the copy and ignore bytecode**

```bash
cd /Users/lluzi/code/hima_harness_insight_v02
printf '__pycache__/\n' >> .gitignore
python3 scripts/vendor-libinsight.py --source /Users/lluzi/code/lib_insight
python3 scripts/vendor-libinsight.py --verify --source /Users/lluzi/code/lib_insight
git -C /Users/lluzi/code/lib_insight status --short | head -3
```
Expected: "vendored LibInsight <LI_P1>: N files …" then "N files verified"; the lib_insight status is unchanged from before (the script never writes there). If the script refuses an import ("imports X, which the Site Reader cannot rely on"), stop and report it to the coordinator: it is LibInsight prerequisite 4.

- [ ] **Step 6: Run the test to verify it passes**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'
```
Expected: all PASS (the six new tests and the existing suite).

- [ ] **Step 7: Commit and push**

```bash
git add .gitignore scripts/vendor-libinsight.py packs/libinsight-analysis/flow/libinsight_analysis/vendored.py packs/libinsight-analysis/flow/libinsight_analysis/vendor packs/libinsight-analysis/flow/tests/test_vendor.py
git status --short
git commit -m "feat(libinsight): vendor LibInsight's validator, netlist reader and extractor at the pinned commit

The Pack carries the import closure of insight_result, insight_actions and netlist plus
extract/libapi_extract.py from the commit in libinsight.pin.json; VENDOR.json records every
file's SHA-256 and the loader refuses to import a copy that differs.
Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---

### Task 3: Synthetic Kit and the insight builder

**Files:**
- Create: `packs/libinsight-analysis/flow/tests/synthetic_kit.py`
- Create: `packs/libinsight-analysis/flow/libinsight_analysis/insight_builder.py`
- Create: `packs/libinsight-analysis/flow/tests/fixtures/insight-tiny/tiny_rule.py`
- Create: `packs/libinsight-analysis/flow/tests/test_builder.py`

**Interfaces:**
- Consumes: `vendored.load("insight_result")` (Task 2).
- Produces:
  - `synthetic_kit.write_kit(root) -> dict` with keys `root, lib, corpus, netlist, design, catalog, design_netlist, timing_report`; constants `KIT="synthetic"`, `RELEASE="r1"`, `VARIANTS`, `CORNERS`, `SPIKE`, `NETLIST_CELLS`, `TINY_RULE`, `TINY_SCRIPT`, `READER`; `synthetic_kit.run_rule(private, script, prepared_path, data_path, version=1) -> dict` (the result).
  - `insight_builder` (Python 3.6): `arguments(rule_id, description)`, `read_json(path)`, `parameter(prepared, name, default)`, `facts_entries(data, variants=None, corners=None)`, `Sources` (`load(entry) -> facts`, `entries() -> list`), `operating_point(facts) -> (volt, temp)`, `number(value)`, `function_of(cell) -> str`, `arcs(cell)`, `table(timing, kind)`, `grid(library, item) -> (slews, loads, value)`, `interpolate(library, item, slew, load)`, `arc_delay(library, timing, slew, load)`, `time_scale_ns(library)`, `cap_scale_ff(library)`, `prefix(kit, release, variant, corner, view="nldm")`, `cell_subject`, `arc_subject`, `table_subject`, `function_subject(pre, function)`, `stage_subject(design, path, stage=None)`, `arc_label`, `split_variant`, `column`, `dataset`, `enc`, `chart` (a dict value is a compound encoding such as `gap={"from": "gap_low", "to": "gap_high"}`), `fact`, `rule_block`, `scope`, `library_block`, `items_block`, `action`, `impact`, `rows_target(dataset, column, filter=None)`, `selection_target(dataset, column)`, `score_block(dimension, affected, checked, weight="custom")`, `arc_param(input, output, edge="both", when="")`, `sibling(cell, drive=None, value=None, area=None, input_cap=None, leakage=None)`, `lever(kind, change, effect=None)`, `effect(value, unit, basis)`, `evidence(label, dataset, column, where_column, equals)`, `r6`, `pct`, `median`, `quantile(values, q)`, `Sources.add_file(path, kind, sha256)` (non-facts sources: `cell_netlist`, `design_netlist`, `timing_report`), `finish(args, started, prepared, sources, parts) -> dict`. All shapes follow the P1a plan's "Normative details".

- [ ] **Step 1: Write the synthetic Kit**

`packs/libinsight-analysis/flow/tests/synthetic_kit.py`:
```python
"""A synthetic Kit for the insight rules: tests, reference results and the Host dry tests.

Four variants (track x VT) at six corners (supply x temperature) and seven combinational functions in
several drive strengths; a SPICE netlist for a few 9-track HVT cells; one design with a timing report.
Every name and number is synthetic. Stub `.lib` files stand in for Liberty bytes: each facts record
carries its stub's SHA-256 exactly as QuaLib extraction would, so lookup by Liberty identity works.
The delay model is linear in slew and load except one injected spike, so the table rule finds exactly
that spike; NOR stacks slow down more at low supply, so the Vmin rule finds them; 9-track NAND2 lacks
X4, so the size rule finds that gap.
"""
import gzip
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
FLOW = os.path.dirname(TESTS)
PACK = os.path.dirname(FLOW)
READER = os.path.join(PACK, "tools", "read-insight.py")
BUILDER = os.path.join(FLOW, "libinsight_analysis", "insight_builder.py")
TINY_SCRIPT = os.path.join(TESTS, "fixtures", "insight-tiny", "tiny_rule.py")
TINY_RULE = {"id": "tiny_rule", "title": "Largest cells",
             "sentence": "A cell is listed when it is among the largest cells by area in the first Liberty file.",
             "parameters": [{"name": "top", "value": 3, "meaning": "how many cells to list"}]}

KIT = "synthetic"
RELEASE = "r1"
VARIANTS = ("7t_rvt", "7t_hvt", "9t_rvt", "9t_hvt")
CORNERS = (("0p60vm40c", 0.60, -40.0), ("0p60v125c", 0.60, 125.0), ("0p72vm40c", 0.72, -40.0),
           ("0p72v125c", 0.72, 125.0), ("0p80vm40c", 0.80, -40.0), ("0p80v125c", 0.80, 125.0))
# (function, inputs, output, Liberty function, series stack, low-supply stack penalty, drives)
FUNCTIONS = (
    ("INV", ("A",), "ZN", "!A", 1, 0.0, (1, 2, 4, 8, 16)),
    ("BUF", ("A",), "Z", "A", 1, 0.0, (1, 2, 4, 8)),
    ("NAND2", ("A1", "A2"), "ZN", "!(A1&A2)", 2, 0.02, (1, 2, 4, 8)),
    ("NOR2", ("A1", "A2"), "ZN", "!(A1|A2)", 2, 0.25, (1, 2, 4)),
    ("NAND3", ("A1", "A2", "A3"), "ZN", "!(A1&A2&A3)", 3, 0.02, (1, 2, 4)),
    ("NOR3", ("A1", "A2", "A3"), "ZN", "!(A1|A2|A3)", 3, 0.25, (1, 2, 4)),
    ("AOI21", ("A1", "A2", "B"), "ZN", "!((A1&A2)|B)", 2, 0.10, (1, 2)),
)
MISSING = (("9t", "NAND2", 4),)
VTH = {"rvt": 0.30, "hvt": 0.38}
SLEWS = (0.01, 0.03, 0.08, 0.2, 0.5)
LOADS = (0.5, 1.0, 2.0, 4.0, 8.0)
SPIKE = {"variant": "9t_rvt", "corner": "0p80v125c", "cell": "NAND2X2", "kind": "cell_rise", "at": (2, 3), "factor": 1.35}
NETLIST_VARIANT = "9t_hvt"
NETLIST_CELLS = ("INVX1", "NOR3X1", "NOR3X2", "NOR3X4")
DESIGN_VARIANT, DESIGN_CORNER = "9t_rvt", "0p72v125c"
PATHS = (("r1", "r2", (("u1", "NAND2X1"), ("u2", "NOR3X1"), ("u3", "INVX1"))),
         ("r3", "r4", (("u4", "AOI21X1"), ("u5", "NOR2X1"), ("u6", "BUFX2"))),
         ("r5", "r6", (("u7", "NAND3X1"), ("u8", "INVX2"))))
STAGE_LOADS = (4.8, 6.4, 12.0, 3.2, 5.6, 9.0, 4.0, 10.0)
CLOCK_NS = 0.30
CATALOG_PATTERN = r"^synth_(?P<variant>[0-9]+t_[a-z]+vt)_(?P<corner>[0-9p]+vm?[0-9]+c)\.lib$"


def cell_name(function, drive):
    return "%sX%d" % (function, drive)


def spec_of(function):
    for spec in FUNCTIONS:
        if spec[0] == function:
            return spec
    raise KeyError(function)


def delay_ns(spec, drive, vt, volt, temp, slew, load, edge):
    """Delay grows with slew and with load per unit drive; a low supply hurts series stacks."""
    stack, penalty = spec[4], spec[5]
    alpha = 1.25 + penalty * (stack - 1)
    vfac = ((0.80 - VTH[vt]) / (volt - VTH[vt])) ** alpha
    tfac = 1.0 + 0.0012 * (temp - 25.0)
    base = 0.010 * stack + 0.20 * slew + 0.0045 * stack * load / drive
    return base * vfac * tfac * (1.0 if edge == "rise" else 0.9)


def transition_ns(delay, slew):
    return 0.8 * delay + 0.05 * slew


def drives_of(track, spec):
    return [drive for drive in spec[6] if (track, spec[0], drive) not in MISSING]


def _cell(variant, corner, volt, temp, spec, drive):
    function, inputs, output, liberty_function = spec[0], spec[1], spec[2], spec[3]
    track, vt = variant.split("_")
    name = cell_name(function, drive)
    loads = [round(load * drive, 4) for load in LOADS]
    timing = []
    for pin in inputs:
        tables = []
        for kind, edge in (("cell_rise", "rise"), ("cell_fall", "fall"), ("rise_transition", "rise"), ("fall_transition", "fall")):
            values = []
            for i, slew in enumerate(SLEWS):
                for j, load in enumerate(loads):
                    value = delay_ns(spec, drive, vt, volt, temp, slew, load, edge)
                    if kind.endswith("transition"):
                        value = transition_ns(value, slew)
                    if (variant, corner, name, kind, (i, j)) == (SPIKE["variant"], SPIKE["corner"], SPIKE["cell"], SPIKE["kind"], SPIKE["at"]):
                        value *= SPIKE["factor"]
                    values.append(round(value, 6))
            tables.append({"kind": kind, "sigma": "", "template": "delay_5x5", "index": [list(SLEWS), loads], "values": values})
        timing.append({"related_pin": pin, "timing_type": "combinational",
                       "timing_sense": "negative_unate" if liberty_function.startswith("!") else "positive_unate",
                       "when": "", "sdf_cond": "", "tables": tables})
    area = round((0.10 + 0.05 * len(inputs)) * (0.6 + 0.4 * drive) * (1.0 if track == "7t" else 1.28), 4)
    leakage = round((40.0 if vt == "rvt" else 8.0) * drive * len(inputs), 3)
    pins = [{"name": pin, "direction": "input", "is_clock": False, "is_bus": False, "is_bus_bit": False,
             "cap": round(0.4 * drive, 4), "attrs": {}, "timing": [], "internal_power": []} for pin in inputs]
    pins.append({"name": output, "direction": "output", "is_clock": False, "is_bus": False, "is_bus_bit": False,
                 "cap": 0.0, "attrs": {"function": liberty_function}, "timing": timing, "internal_power": []})
    return {"name": name, "area": area, "footprint": function,
            "flags": {"dff": False, "latch": False, "clock_gating": False, "icg": False, "memory": False},
            "attrs": {"cell_leakage_power": leakage, "cell_footprint": function},
            "leakage": [{"when": "", "value": leakage, "related_pg_pin": "VDD"}],
            "pg_pins": [{"name": "VDD", "pg_type": "primary_power", "attrs": {}},
                        {"name": "VSS", "pg_type": "primary_ground", "attrs": {}}],
            "pins": pins, "sequential": []}


def liberty_bytes(variant, corner):
    return ("/* synthetic stand-in Liberty: kit %s variant %s corner %s */\nlibrary (synth_%s_%s) { }\n" % (
        KIT, variant, corner, variant, corner)).encode("utf-8")


def facts_record(variant, corner, volt, temp, liberty_path, liberty_sha):
    """A lib-insight-facts/1 record in the extractor's key order (schema, source, ... status before library)."""
    track = variant.split("_")[0]
    cells = [_cell(variant, corner, volt, temp, spec, drive) for spec in FUNCTIONS for drive in drives_of(track, spec)]
    return {
        "schema": "lib-insight-facts/1",
        "source": {"path": liberty_path, "bytes": len(liberty_bytes(variant, corner)), "sha256": liberty_sha,
                   "sha256_after": liberty_sha, "source_unchanged": True},
        "producer": {"api": "synthetic", "schema": "lib-insight-facts/1"},
        "started": "2026-10-08T00:00:00+0000",
        "timing": {"counts": {"cells": len(cells)}},
        "status": "ok",
        "library": {
            "name": "synth_%s_%s" % (variant, corner),
            "attrs": {"time_unit": "1ns", "capacitive_load_unit": [1, "ff"], "leakage_power_unit": "1pW",
                      "nom_voltage": volt, "nom_temperature": temp},
            "units": {"time_s": 1e-09, "cap_F": 1e-15, "res_ohm": 1000.0, "voltage_V": 1.0, "current_A": 1e-06,
                      "leakage_W": 1e-12, "dynamic_W": 1e-15},
            "operating_conditions": [{"name": corner, "attrs": {"voltage": volt, "temperature": temp, "process": 1}}],
            "templates": [{"type": "lu_table_template", "name": "delay_5x5",
                           "variables": ["input_net_transition", "total_output_net_capacitance"],
                           "index": [[True, list(SLEWS)], [True, list(LOADS)]]}],
            "other_groups": {}, "cells": cells},
        "finished": "2026-10-08T00:00:01+0000",
    }


def write_facts_gz(path, record):
    buffer = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buffer, mtime=0) as stream:
        stream.write(json.dumps(record, separators=(",", ":")).encode("utf-8"))
    with open(path, "wb") as stream:
        stream.write(buffer.getvalue())


def netlist_text():
    lines = ["* synthetic SPICE netlist of a few %s cells" % NETLIST_VARIANT]
    for name in NETLIST_CELLS:
        drive = int(name.split("X")[-1])
        wp, wn = 0.10 * drive, 0.07 * drive
        if name.startswith("INV"):
            lines += [".subckt %s A ZN VDD VSS" % name,
                      "MP0 ZN A VDD VDD pch_hvt w=%.3fu l=0.016u nf=%d" % (2 * wp, drive),
                      "MN0 ZN A VSS VSS nch_hvt w=%.3fu l=0.016u nf=%d" % (2 * wn, drive),
                      ".ends %s" % name]
        else:
            lines += [".subckt %s A1 A2 A3 ZN VDD VSS" % name,
                      "MP3 n2 A3 VDD VDD pch_hvt w=%.3fu l=0.016u nf=%d" % (3 * wp, drive),
                      "MP2 n1 A2 n2 VDD pch_hvt w=%.3fu l=0.016u nf=%d" % (3 * wp, drive),
                      "MP1 ZN A1 n1 VDD pch_hvt w=%.3fu l=0.016u nf=%d" % (3 * wp, drive),
                      "MN1 ZN A1 VSS VSS nch_hvt w=%.3fu l=0.016u nf=%d" % (wn, drive),
                      "MN2 ZN A2 VSS VSS nch_hvt w=%.3fu l=0.016u nf=%d" % (wn, drive),
                      "MN3 ZN A3 VSS VSS nch_hvt w=%.3fu l=0.016u nf=%d" % (wn, drive),
                      ".ends %s" % name]
    return "\n".join(lines) + "\n"


def design_netlist_text():
    lines = ["// synthetic design netlist", "module synth_top (clk);", "  input clk;"]
    for start, end, stages in PATHS:
        lines.append("  DFFX1 %s ();" % start)
        lines += ["  %s %s ();" % (cell, instance) for instance, cell in stages]
        lines.append("  DFFX1 %s ();" % end)
    return "\n".join(lines + ["endmodule"]) + "\n"


def timing_report_text():
    """A PrimeTime-style report in ns and fF whose numbers come from the same delay model."""
    volt, temp = [(v, t) for name, v, t in CORNERS if name == DESIGN_CORNER][0]
    vt = DESIGN_VARIANT.split("_")[1]
    loads = iter(STAGE_LOADS)
    lines = ["Report : timing", "Design : synth_top", "Units  : ns, fF", ""]
    for start, end, stages in PATHS:
        lines += ["Startpoint: %s (rising edge-triggered flip-flop clocked by clk)" % start,
                  "Endpoint: %s (rising edge-triggered flip-flop clocked by clk)" % end, "Path Group: clk", "",
                  "  Point                        Fanout      Cap    Trans      Incr      Path"]
        slew, arrival = 0.040, 0.090
        lines.append("  %-28s %6s %8.3f %8.3f %9.3f %9.3f r" % ("%s/Q (DFFX1)" % start, "", 1.2, slew, arrival, arrival))
        for instance, cell in stages:
            function, drive = cell.rsplit("X", 1)
            spec, drive = spec_of(function), int(drive)
            load = next(loads)
            incr = (delay_ns(spec, drive, vt, volt, temp, slew, load, "rise") + delay_ns(spec, drive, vt, volt, temp, slew, load, "fall")) / 2
            out_slew = transition_ns(incr, slew)
            arrival += incr
            lines.append("  %-28s %6d %8.3f %8.3f %9.3f %9.3f f" % ("%s/%s (%s)" % (instance, spec[2], cell), 2, load, out_slew, incr, arrival))
            slew = out_slew
        lines.append("  %-28s %6s %8s %8.3f %9.3f %9.3f f" % ("%s/D (DFFX1)" % end, "", "", slew, 0.0, arrival))
        lines += ["  data required time %47.3f" % CLOCK_NS,
                  "  slack (%s) %45.3f" % ("VIOLATED" if CLOCK_NS - arrival < 0 else "MET", CLOCK_NS - arrival), ""]
    return "\n".join(lines) + "\n"


def write_kit(root):
    """Write the Kit under `root` and its kit catalogue; return the paths."""
    lib, corpus, netlist, design = (os.path.join(root, name) for name in ("lib", "corpus", "netlist", "design"))
    for folder in (lib, os.path.join(corpus, KIT), netlist, design):
        if not os.path.isdir(folder):
            os.makedirs(folder)
    for variant in VARIANTS:
        for corner, volt, temp in CORNERS:
            stub = os.path.join(lib, "synth_%s_%s.lib" % (variant, corner))
            data = liberty_bytes(variant, corner)
            with open(stub, "wb") as stream:
                stream.write(data)
            write_facts_gz(os.path.join(corpus, KIT, "synth_%s_%s.json.gz" % (variant, corner)),
                           facts_record(variant, corner, volt, temp, stub, hashlib.sha256(data).hexdigest()))
    with open(os.path.join(netlist, "synth_%s.sp" % NETLIST_VARIANT), "w") as stream:
        stream.write(netlist_text())
    with open(os.path.join(design, "synth_top.v"), "w") as stream:
        stream.write(design_netlist_text())
    with open(os.path.join(design, "synth_top.timing.rpt"), "w") as stream:
        stream.write(timing_report_text())
    catalog = os.path.join(root, "kits.json")
    with open(catalog, "w") as stream:
        json.dump({"schema": "hima-libinsight-kits/1", "kits": [{
            "name": KIT, "title": "Synthetic 7- and 9-track kit", "release": RELEASE, "libertyRoots": [lib],
            "pattern": CATALOG_PATTERN, "netlistRoots": [netlist], "netlistPattern": r"\.sp$"}]}, stream, indent=2)
    return {"root": root, "lib": lib, "corpus": corpus, "netlist": netlist, "design": design, "catalog": catalog,
            "design_netlist": os.path.join(design, "synth_top.v"),
            "timing_report": os.path.join(design, "synth_top.timing.rpt")}


def run_rule(private, script, prepared_path, data_path, version=1):
    """Run a rule script the way the resident does: from `private`, with the builder copied beside it."""
    analysis = os.path.join(private, "analysis")
    if not os.path.isdir(analysis):
        os.makedirs(analysis)
    name = os.path.basename(script)
    shutil.copyfile(script, os.path.join(analysis, name))
    shutil.copyfile(BUILDER, os.path.join(analysis, "insight_builder.py"))
    completed = subprocess.run(
        [sys.executable, "analysis/" + name, "--prepared", prepared_path, "--data", data_path,
         "--out", "analysis-result.json", "--candidate", "resident-delivery.json", "--version", str(version),
         "--main", "analysis/" + name, "--builder", "analysis/insight_builder.py"],
        cwd=private, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if completed.returncode != 0:
        raise AssertionError(completed.stderr.decode("utf-8", "replace"))
    with open(os.path.join(private, "analysis-result.json"), "rb") as stream:
        return json.loads(stream.read().decode("utf-8"))
```

- [ ] **Step 2: Write the failing builder test**

`packs/libinsight-analysis/flow/tests/test_builder.py`:
```python
"""insight_builder writes what LibInsight's validator accepts, and reads facts the way the rules need."""
import gzip
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from libinsight_analysis import insight_builder as ib, vendored  # noqa: E402
import synthetic_kit  # noqa: E402


def sha(path):
    with open(path, "rb") as stream:
        return hashlib.sha256(stream.read()).hexdigest()


class Builder(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = os.path.realpath(tempfile.mkdtemp())
        cls.paths = synthetic_kit.write_kit(os.path.join(cls.base, "kit"))
        cls.facts = os.path.join(cls.paths["corpus"], "synthetic", "synth_9t_rvt_0p80v125c.json.gz")
        cls.lib = os.path.join(cls.paths["lib"], "synth_9t_rvt_0p80v125c.lib")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.base)

    def inputs(self):
        prepared = os.path.join(self.base, "prepared.json")
        data = os.path.join(self.base, "data.json")
        with open(prepared, "w") as stream:
            json.dump({"schema": "hima-libinsight-prepared-request/2", "rule": synthetic_kit.TINY_RULE,
                       "request": {"requestId": "req-20261008120000-test01", "question": "Which cells are the largest?"},
                       "kit": {"name": "synthetic", "title": "Synthetic", "release": "r1", "files": []}}, stream)
        with open(data, "w") as stream:
            json.dump({"schema": "hima-libinsight-prepared-data/1", "facts": [{
                "liberty": self.lib, "libertySha256": sha(self.lib), "facts": self.facts, "factsSha256": sha(self.facts),
                "variant": "9t_rvt", "corner": "0p80v125c", "origin": "corpus"}], "netlistFacts": None, "design": None}, stream)
        return prepared, data

    def test_facts_helpers(self):
        with gzip.open(self.facts, "rb") as stream:
            facts = json.loads(stream.read().decode("utf-8"))
        library = facts["library"]
        self.assertEqual(ib.operating_point(facts), (0.8, 125.0))
        cells = dict((cell["name"], cell) for cell in library["cells"])
        self.assertEqual(ib.function_of(cells["NAND2X1"]), ib.function_of(cells["NAND2X2"]))
        self.assertNotEqual(ib.function_of(cells["NAND2X1"]), ib.function_of(cells["NOR2X1"]))
        pin, timing = next(ib.arcs(cells["INVX1"]))
        item = ib.table(timing, "cell_rise")
        slews, loads, value = ib.grid(library, item)
        self.assertEqual(ib.interpolate(library, item, slews[1], loads[2]), value(1, 2))
        middle = ib.interpolate(library, item, (slews[1] + slews[2]) / 2, loads[2])
        self.assertAlmostEqual(middle, (value(1, 2) + value(2, 2)) / 2)
        self.assertEqual(ib.arc_label(pin, timing), "A->ZN")
        pre = ib.prefix("synthetic", "r1", "9t_rvt", "0p80v125c")
        self.assertEqual(ib.cell_subject(pre, "INVX1"), "synthetic/r1/9t_rvt/0p80v125c/nldm :: INVX1")
        self.assertEqual(ib.table_subject(pre, "INVX1", pin["name"], timing, "cell_rise", "", (1, 2)),
                         "synthetic/r1/9t_rvt/0p80v125c/nldm :: INVX1/ZN/{A,combinational,negative_unate,}/cell_rise[] @ (1,2)")
        self.assertEqual(ib.split_variant("9t_hvt"), ("9t", "hvt"))
        self.assertEqual(ib.split_variant("rvt"), ("-", "rvt"))
        self.assertEqual(ib.time_scale_ns(library), 1.0)
        self.assertEqual(ib.cap_scale_ff(library), 1.0)
        self.assertEqual(ib.median([3, 1, 2, 10]), 2.5)
        self.assertEqual(ib.quantile([0.0, 10.0], 0.25), 2.5)
        self.assertEqual(ib.function_subject(ib.prefix("synthetic", "r1", "9t_rvt", "*"), "NAND2"),
                         "synthetic/r1/9t_rvt/*/nldm :: fn:NAND2")
        self.assertEqual(ib.stage_subject("synth_top", "1", 2), "design:synth_top :: path:1/stage:2")
        self.assertEqual(ib.chart("l", "Ladder", "ladder", "d", item_key="item", x="drive", y="area",
                                  gap={"from": "lo", "to": "hi"})["gap"], {"from": {"column": "lo"}, "to": {"column": "hi"}})

    def test_tiny_rule_writes_a_valid_result_and_candidate(self):
        prepared, data = self.inputs()
        private = os.path.join(self.base, "private-tiny")
        doc = synthetic_kit.run_rule(private, synthetic_kit.TINY_SCRIPT, prepared, data)
        self.assertEqual(doc["schema"], "hima-libinsight-insight/1")
        self.assertEqual(doc["id"], "tiny_rule")
        self.assertEqual(doc["rule"]["sentence"], synthetic_kit.TINY_RULE["sentence"])
        self.assertEqual(len(doc["datasets"]["largest"]["rows"]), 3)
        for chart in doc["items"]["charts"]:
            self.assertEqual(chart["filter"], {"column": "cell", "equals": "$item"})
        with open(synthetic_kit.TINY_SCRIPT, encoding="utf-8") as stream:
            self.assertEqual(doc["code"]["main"]["text"], stream.read())
        self.assertEqual(doc["code"]["files"][0]["path"], "analysis/insight_builder.py")
        self.assertEqual(doc["sources"][0]["sha256Before"], doc["sources"][0]["sha256After"])
        with open(os.path.join(private, "resident-delivery.json")) as stream:
            candidate = json.load(stream)
        self.assertEqual(sorted(a["path"] for a in candidate["artifacts"]),
                         ["analysis-result.json", "analysis/insight_builder.py", "analysis/tiny_rule.py"])
        for artifact in candidate["artifacts"]:
            self.assertEqual(artifact["sha256"], sha(os.path.join(private, artifact["path"])))
        validator = vendored.load("insight_result")
        self.assertEqual(validator.validate(doc), [])
        self.assertEqual(validator.subject_kind(doc["datasets"]["largest"]["rows"][0][4]), "cell")
        self.assertEqual(validator.subject_kind(ib.function_subject(ib.prefix("k", "r", "v", "*"), "NAND2")), "function")
        self.assertEqual(validator.subject_kind(ib.stage_subject("synth_top", "1", 2)), "stage")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run it to verify it fails**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_builder.py'
```
Expected: ERROR `cannot import name 'insight_builder'`.

- [ ] **Step 4: Write the builder**

`packs/libinsight-analysis/flow/libinsight_analysis/insight_builder.py`:
```python
"""Write a hima-libinsight-insight/1 result with Python 3.6 and no numpy (the resident sandbox).

This is the one place a rule script spells the result's shape (lib_insight spec §4-§6). LibInsight's
validator, vendored beside this module, is the authority: when it names a shape this module writes
differently, change it here and every rule follows. Copy this file next to your script as
analysis/insight_builder.py; finish() lists it in code.files.
"""
import argparse
import gzip
import hashlib
import json
import math
import os
import re
import shlex
import sys
import time

SCHEMA = "hima-libinsight-insight/1"
ROLES = ("problem", "selected", "reference", "candidate", "other")
SLEW_VARIABLES = ("input_net_transition", "constrained_pin_transition", "related_pin_transition")


# Files and prepared inputs -------------------------------------------------------------------

def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 22), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path):
    with open(path, "rb") as stream:
        return json.loads(stream.read().decode("utf-8"))


def load_facts(path):
    with gzip.open(path, "rb") as stream:
        doc = json.loads(stream.read().decode("utf-8"))
    if doc.get("schema") != "lib-insight-facts/1" or doc.get("status") != "ok":
        raise SystemExit("%s is not an ok lib-insight-facts/1 record" % path)
    return doc


def arguments(rule_id, description):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--prepared", required=True, help="<campaign>/state/prepared-request.json")
    parser.add_argument("--data", required=True, help="<campaign>/state/prepared-data.json")
    parser.add_argument("--out", default="analysis-result.json")
    parser.add_argument("--candidate", help="also write the resident delivery candidate here")
    parser.add_argument("--version", type=int, default=1)
    parser.add_argument("--main", default="analysis/%s.py" % rule_id, help="this script, relative to the working directory")
    parser.add_argument("--builder", default="analysis/insight_builder.py", help="this module, relative to the working directory")
    return parser


def parameter(prepared, name, default):
    for item in prepared["rule"]["parameters"]:
        if item["name"] == name:
            return item["value"]
    return default


def facts_entries(data, variants=None, corners=None):
    """Prepared facts records {liberty, libertySha256, facts, factsSha256, variant, corner, origin}, filtered and sorted."""
    chosen = [entry for entry in data["facts"]
              if (not variants or entry.get("variant") in variants) and (not corners or entry.get("corner") in corners)]
    return sorted(chosen, key=lambda entry: (entry.get("variant") or "", entry.get("corner") or "", entry["facts"]))


class Sources(object):
    """Every file a rule reads: hashed before it is read and again when the result is written. Facts files
    carry their Liberty identity; netlists and design files are sources of their own kind."""

    def __init__(self):
        self.read = {}

    def load(self, entry):
        path = entry["facts"]
        before = sha256_file(path)
        if before != entry["factsSha256"]:
            raise SystemExit("%s changed since prepare-data (sha256 %s, prepared %s)" % (path, before, entry["factsSha256"]))
        self.read[path] = (before, "facts", entry["libertySha256"])
        return load_facts(path)

    def add_file(self, path, kind, sha256):
        """Record a cell_netlist, design_netlist or timing_report source; refuse one that changed since prepare-data."""
        before = sha256_file(path)
        if before != sha256:
            raise SystemExit("%s changed since prepare-data (sha256 %s, prepared %s)" % (path, before, sha256))
        self.read[path] = (before, kind, None)
        return path

    def entries(self):
        out = []
        for path in sorted(self.read):
            before, kind, liberty = self.read[path]
            entry = {"path": path, "kind": kind, "sha256Before": before, "sha256After": sha256_file(path)}
            if liberty is not None:
                entry["libertySha256"] = liberty
            out.append(entry)
        return out


# Facts ---------------------------------------------------------------------------------------

def number(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def operating_point(facts):
    for condition in facts["library"].get("operating_conditions") or []:
        attrs = condition.get("attrs") or {}
        if number(attrs.get("voltage")) is not None and number(attrs.get("temperature")) is not None:
            return number(attrs["voltage"]), number(attrs["temperature"])
    attrs = facts["library"].get("attrs") or {}
    voltage, temperature = number(attrs.get("nom_voltage")), number(attrs.get("nom_temperature"))
    if voltage is None or temperature is None:
        raise SystemExit("library %s states no operating voltage and temperature" % facts["library"].get("name"))
    return voltage, temperature


def function_of(cell):
    """The functional signature: each output pin with its Liberty function, and the input pin names."""
    outputs = sorted((pin["name"], (pin.get("attrs") or {}).get("function", "")) for pin in cell.get("pins") or []
                     if pin.get("direction") == "output")
    inputs = sorted(pin["name"] for pin in cell.get("pins") or [] if pin.get("direction") == "input")
    return "%s|%s" % (";".join("%s=%s" % pair for pair in outputs), ",".join(inputs))


def arcs(cell):
    """(output pin, timing group) for every combinational arc."""
    for pin in cell.get("pins") or []:
        if pin.get("direction") != "output":
            continue
        for timing in pin.get("timing") or []:
            if timing.get("timing_type", "combinational") in ("combinational", "combinational_rise", "combinational_fall"):
                yield pin, timing


def table(timing, kind):
    for item in timing.get("tables") or []:
        if item.get("kind") == kind and len(item.get("index") or []) == 2:
            return item
    return None


def _axes(library, item):
    for template in library.get("templates") or []:
        if template.get("name") == item.get("template"):
            variables = template.get("variables") or []
            if len(variables) >= 2:
                slew = 0 if variables[0] in SLEW_VARIABLES else 1
                return slew, 1 - slew
    return 0, 1


def grid(library, item):
    """(slews, loads, value(i_slew, j_load)) of a 2-D table; a missing value reads as None."""
    slew_axis, load_axis = _axes(library, item)
    index = item["index"]
    slews = [float(value) for value in index[slew_axis]]
    loads = [float(value) for value in index[load_axis]]
    width = len(index[1])

    def value(i, j):
        row, column = (i, j) if slew_axis == 0 else (j, i)
        return number(item["values"][row * width + column])
    return slews, loads, value


def _bracket(axis, x):
    if x <= axis[0]:
        return 0, 0, 0.0
    if x >= axis[-1]:
        return len(axis) - 1, len(axis) - 1, 0.0
    for k in range(len(axis) - 1):
        if axis[k] <= x <= axis[k + 1]:
            return k, k + 1, (x - axis[k]) / (axis[k + 1] - axis[k])
    return len(axis) - 1, len(axis) - 1, 0.0


def interpolate(library, item, slew, load):
    """Bilinear value at (slew, load), clamped to the grid; None when a corner value is missing."""
    slews, loads, value = grid(library, item)
    i0, i1, fi = _bracket(slews, slew)
    j0, j1, fj = _bracket(loads, load)
    corners = [value(i0, j0), value(i0, j1), value(i1, j0), value(i1, j1)]
    if any(v is None for v in corners):
        return None
    low = corners[0] * (1 - fj) + corners[1] * fj
    high = corners[2] * (1 - fj) + corners[3] * fj
    return low * (1 - fi) + high * fi


def arc_delay(library, timing, slew, load):
    """Mean of cell_rise and cell_fall at one operating point (library time units); None when missing."""
    values = []
    for kind in ("cell_rise", "cell_fall"):
        item = table(timing, kind)
        value = interpolate(library, item, slew, load) if item is not None else None
        if value is None:
            return None
        values.append(value)
    return sum(values) / len(values)


def time_scale_ns(library):
    """Nanoseconds per library time unit."""
    return float(library["units"]["time_s"]) / 1e-09


def cap_scale_ff(library):
    """Femtofarads per library capacitance unit."""
    return float(library["units"]["cap_F"]) / 1e-15


# Subjects (LibInsight addresses) --------------------------------------------------------------

def prefix(kit, release, variant, corner, view="nldm"):
    return "/".join([kit or "custom", release or "-", variant or "-", corner or "-", view])


def cell_subject(pre, cell):
    return "%s :: %s" % (pre, cell)


def arc_subject(pre, cell, pin, timing):
    return "%s :: %s/%s/{%s,%s,%s,%s}" % (pre, cell, pin, timing.get("related_pin", ""), timing.get("timing_type", ""),
                                          timing.get("timing_sense", ""), timing.get("when", ""))


def table_subject(pre, cell, pin, timing, kind, sigma="", point=None):
    text = "%s/%s[%s]" % (arc_subject(pre, cell, pin, timing), kind, sigma)
    return text if point is None else "%s @ (%d,%d)" % (text, point[0], point[1])


def function_subject(pre, function):
    return "%s :: fn:%s" % (pre, function)


def stage_subject(design, path, stage=None):
    text = "design:%s :: path:%s" % (design, path)
    return text if stage is None else "%s/stage:%d" % (text, stage)


def arc_label(pin, timing):
    return "%s->%s" % (timing.get("related_pin", ""), pin["name"] if isinstance(pin, dict) else pin)


def split_variant(variant):
    found = re.match(r"^(\d+t)_(.+)$", variant or "")
    return (found.group(1), found.group(2)) if found else ("-", variant or "-")


# Result pieces --------------------------------------------------------------------------------

def r6(value):
    return None if value is None else round(float(value), 6)


def pct(fraction):
    return None if fraction is None else round(100.0 * float(fraction), 2)


def median(values):
    ordered = sorted(values)
    if not ordered:
        return None
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2.0


def quantile(values, q):
    """Linear-interpolated quantile (q in 0..1); None for no values."""
    ordered = sorted(values)
    if not ordered:
        return None
    position = q * (len(ordered) - 1)
    low = int(math.floor(position))
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def column(name, kind, unit=None, null_means=None):
    declared = {"name": name, "type": kind}
    if unit:
        declared["unit"] = unit
    if null_means:
        declared["nullMeans"] = null_means
    return declared


def dataset(columns, rows):
    return {"columns": list(columns), "rows": [list(row) for row in rows]}


def enc(name):
    """One encoding: the column a chart reads (spec §5)."""
    return {"column": name}


def chart(chart_id, title, kind, dataset_name, item_key=None, **encodings):
    """A chart of the closed catalogue; `item_key` filters an item chart to the selected item. A dict value
    is a compound encoding ({"from": column, "to": column} -> {"from": {column}, "to": {column}})."""
    drawn = {"id": chart_id, "title": title, "kind": kind, "dataset": dataset_name}
    for key in sorted(encodings):
        value = encodings[key]
        if key == "columns":
            drawn[key] = list(value)
        elif isinstance(value, dict):
            drawn[key] = dict((part, enc(name)) for part, name in value.items())
        else:
            drawn[key] = enc(value)
    if item_key:
        drawn["filter"] = {"column": item_key, "equals": "$item"}
    return drawn


def fact(label, value, unit=None):
    item = {"label": label, "value": value}
    if unit:
        item["unit"] = unit
    return item


def scope(prepared, variants, corners, design=None):
    kit = prepared.get("kit") or {}
    out = {"kit": kit.get("name") or "custom", "variants": sorted(set(v for v in variants if v)),
           "corners": sorted(set(c for c in corners if c))}
    if design:
        out["design"] = design
    return out


def rule_block(prepared, rule_scope):
    rule = prepared["rule"]
    return {"title": rule["title"], "sentence": rule["sentence"], "parameters": list(rule["parameters"]),
            "prompt": prepared["request"]["question"], "scope": rule_scope}


def library_block(headline, checked, flagged, unit, facts, charts):
    return {"headline": headline[:160], "counts": {"checked": checked, "flagged": flagged, "unit": unit},
            "facts": list(facts)[:8], "charts": list(charts)[:3]}


def items_block(dataset_name, key, label, sort_column, order, charts, text=None):
    block = {"dataset": dataset_name, "key": key, "label": label, "sort": {"column": sort_column, "order": order},
             "charts": list(charts)[:3]}
    if text:
        block["text"] = text
    return block


def impact(label, value, unit=None):
    return fact(label, value, unit)


def rows_target(dataset_name, column_name, filter=None):
    target = {"dataset": dataset_name, "column": column_name}
    if filter is not None:
        target["filter"] = filter
    return target


def selection_target(dataset_name, column_name):
    """The person marks rows in the page; the dataset needs a subject column."""
    return {"selection": True, "dataset": dataset_name, "column": column_name}


def action(kind, title, who, reason, impacts, targets, params):
    return {"kind": kind, "title": title, "who": who, "reason": reason, "impact": list(impacts),
            "targets": targets, "params": params}


def arc_param(input_pin, output_pin, edge="both", when=""):
    return {"input": input_pin, "output": output_pin, "edge": edge, "when": when}


def sibling(cell, drive=None, value=None, area=None, input_cap=None, leakage=None):
    return {"cell": cell, "drive": drive, "value": value, "area": area, "input_cap": input_cap, "leakage": leakage}


def effect(value, unit, basis):
    return {"value": value, "unit": unit, "basis": basis}


def lever(kind, change, lever_effect=None):
    """One redesign lever of the closed list (kind), its concrete change, and its computed effect or None
    (qualitative)."""
    return {"kind": kind, "change": change, "effect": lever_effect}


def evidence(label, dataset_name, column_name, where_column, equals):
    return {"label": label, "dataset": dataset_name, "column": column_name,
            "where": {"column": where_column, "equals": equals}}


def score_block(dimension, affected, checked, weight="custom"):
    return {"dimension": dimension, "weight": weight, "affected": affected, "checked": checked}


# Finish ---------------------------------------------------------------------------------------

def finish(args, started, prepared, sources, parts):
    """Write the result (and the candidate) from parts: rule, summary, datasets, library, items,
    actions, score, assumptions, limits. Returns the result."""
    with open(args.main, "rb") as stream:
        main_text = stream.read().decode("utf-8")
    files = [{"path": args.builder, "sha256": sha256_file(args.builder)}] if os.path.isfile(args.builder) else []
    doc = {
        "schema": SCHEMA, "id": prepared["rule"]["id"], "version": args.version, "rule": parts["rule"],
        "question": prepared["request"]["question"], "summary": parts["summary"], "sources": sources.entries(),
        "datasets": parts["datasets"], "library": parts["library"], "items": parts["items"],
        "actions": parts["actions"], "score": parts["score"],
        "code": {"main": {"path": args.main, "sha256": hashlib.sha256(main_text.encode("utf-8")).hexdigest(), "text": main_text},
                 "files": files},
        "run": {"command": "python3 " + " ".join(shlex.quote(arg) for arg in sys.argv),
                "exitCode": 0, "elapsedSeconds": round(time.time() - started, 3), "usedQualib": False},
        "assumptions": list(parts["assumptions"]), "limits": list(parts["limits"]),
    }
    encoded = (json.dumps(doc, sort_keys=True, allow_nan=False, ensure_ascii=False) + "\n").encode("utf-8")
    with open(args.out, "wb") as stream:
        stream.write(encoded)
    if args.candidate:
        artifacts = [{"path": os.path.relpath(os.path.abspath(args.out), os.getcwd()).replace(os.sep, "/"),
                      "sha256": hashlib.sha256(encoded).hexdigest(), "kind": "result"},
                     {"path": args.main, "sha256": doc["code"]["main"]["sha256"], "kind": "support"}]
        artifacts += [{"path": item["path"], "sha256": item["sha256"], "kind": "support"} for item in files]
        with open(args.candidate, "w") as stream:
            json.dump({"schema": "hima-resident-engineering-candidate/1", "outcome": "completed", "summary": parts["summary"],
                       "stopReason": "analysis complete", "artifacts": artifacts}, stream, sort_keys=True)
    return doc
```

- [ ] **Step 5: Write the tiny rule used by the Pack's own tests**

`packs/libinsight-analysis/flow/tests/fixtures/insight-tiny/tiny_rule.py`:
```python
#!/usr/bin/env python3
"""tiny_rule: the largest cells by area in the first prepared facts file (a test rule, Python 3.6+)."""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), "libinsight_analysis")]
import insight_builder as ib  # noqa: E402


def main(argv=None):
    started = time.time()
    args = ib.arguments("tiny_rule", __doc__).parse_args(argv)
    prepared, data = ib.read_json(args.prepared), ib.read_json(args.data)
    top = int(ib.parameter(prepared, "top", 3))
    sources = ib.Sources()
    entry = ib.facts_entries(data)[0]
    facts = sources.load(entry)
    kit = prepared.get("kit") or {}
    pre = ib.prefix(kit.get("name"), kit.get("release"), entry.get("variant"), entry.get("corner"))
    cells = sorted(facts["library"]["cells"], key=lambda cell: (-float(cell["area"]), cell["name"]))
    columns = [ib.column("cell", "string"), ib.column("function", "string"), ib.column("area", "number", "um2"),
               ib.column("role", "string"), ib.column("subject", "string"), ib.column("text", "string")]
    rows = []
    for rank, cell in enumerate(cells):
        listed = rank < top
        rows.append([cell["name"], cell.get("footprint") or "", ib.r6(cell["area"]), "problem" if listed else "other",
                     ib.cell_subject(pre, cell["name"]),
                     "%s is among the %d largest cells." % (cell["name"], top) if listed else ""])
    largest = [row for row in rows if row[3] == "problem"]
    parts = {
        "rule": ib.rule_block(prepared, ib.scope(prepared, [entry.get("variant")], [entry.get("corner")])),
        "summary": "The %d largest of %d cells are listed." % (len(largest), len(rows)),
        "datasets": {"cells": ib.dataset(columns, rows), "largest": ib.dataset(columns, largest)},
        "library": ib.library_block("%d of %d cells are the largest" % (len(largest), len(rows)), len(rows), len(largest),
                                    "cells", [ib.fact("Cells checked", len(rows))],
                                    [ib.chart("area-by-cell", "Area by cell", "bar", "cells", x="cell", y="area")]),
        "items": ib.items_block("largest", "cell", "cell", "area", "desc",
                                [ib.chart("item-area", "Area", "table", "largest", item_key="cell")], text="text"),
        "actions": [ib.action("dont_use", "Avoid the largest cells", "chip_designer", "They cost the most area.",
                              [ib.impact("Cells", len(largest))], ib.rows_target("largest", "cell"), {})],
        "score": ib.score_block("quality", len(largest), len(rows)),
        "assumptions": ["Area is the Liberty cell area."],
        "limits": ["Only the first prepared facts file is read."],
    }
    ib.finish(args, started, prepared, sources, parts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'
```
Expected: PASS. If `validate(doc)` returns problems, they name a shape the builder writes differently from LibInsight's validator (P1a "Normative details"); change only the builder function that writes that piece to the validator's form, read in `flow/libinsight_analysis/vendor/libinsight/insight_result.py`, and re-run. Do not change the vendored file.

- [ ] **Step 7: Commit and push**

```bash
git add packs/libinsight-analysis/flow/libinsight_analysis/insight_builder.py packs/libinsight-analysis/flow/tests/synthetic_kit.py packs/libinsight-analysis/flow/tests/fixtures/insight-tiny packs/libinsight-analysis/flow/tests/test_builder.py
git commit -m "feat(libinsight): insight builder for rule scripts and a synthetic 7/9-track Kit

Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---
### Task 4: Request `/2`: rule, Kit catalogue, netlists, design and the extraction list

**Files:**
- Modify: `packs/libinsight-analysis/flow/libinsight_analysis/common.py` (constants)
- Modify: `packs/libinsight-analysis/flow/libinsight_analysis/request.py` (request `/2`; `/1` keeps working until Task 10)
- Modify: `packs/libinsight-analysis/flow/libinsight_analysis/tasks.py` (`prepare_task` inputs and value)
- Modify: `packs/libinsight-analysis/flow/tests/synthetic_kit.py` (add `request_v2`)
- Create: `packs/libinsight-analysis/flow/tests/test_request_v2.py`

**Interfaces:**
- Produces in `common`: `RULE_ID` (regex `^[a-z0-9][a-z0-9_-]{1,62}$`), `BUILDS_ON` (now allows `_`), `REQUEST_SCHEMA_V2 = "hima-libinsight-request/2"`, `PREPARED_SCHEMA_V2 = "hima-libinsight-prepared-request/2"`, `PREPARED_DATA_SCHEMA = "hima-libinsight-prepared-data/1"`, `PREPARED_DATA_PATH = "state/prepared-data.json"`, `NETLIST_FACTS_SCHEMA = "hima-libinsight-netlist-facts/1"`, `NETLIST_FACTS_PATH = "state/netlist-facts.json"`, `INSIGHT_SCHEMA = "hima-libinsight-insight/1"`, `KITS_SCHEMA = "hima-libinsight-kits/1"`.
- Produces in `request`: `validate_request_v2(doc) -> doc`, `kit_catalog(path) -> {name: kit}`, `prepare(workspace, request_path, library, corpus, capability_path, mode_file="", source_roots=None, kit_catalog_path="", facts_store="") -> (prepared, path)`; a `/2` prepared document has keys `schema, request, requestSha256, requestPath, rule, needs, sources, kit, netlists, design, extract, buildsOn, library, factsCorpus, factsStore, licence, readRoots, sandboxReadOnlyRoots`. `goal_text_v2(prepared, prepared_path) -> str`.
- Produces in `tasks.prepare_task`: reads optional `KIT_CATALOG` and `FACTS_STORE`; a `/2` value adds `rule {id,title,sentence}`, `kit` (name or null), `needs`, `extract` (Liberty paths to extract).
- Produces in `synthetic_kit`: `request_v2(rule, kit=None, sources=(), netlists=(), design=None, needs=("facts",), builds=(), request_id="req-20261008120000-test01", question=None) -> dict`.

- [ ] **Step 1: Add the request helper to the synthetic Kit**

Append to `packs/libinsight-analysis/flow/tests/synthetic_kit.py`:
```python
def request_v2(rule, kit=None, sources=(), netlists=(), design=None, needs=("facts",), builds=(),
               request_id="req-20261008120000-test01", question=None):
    """A hima-libinsight-request/2 document as the Host writes it."""
    return {"schema": "hima-libinsight-request/2", "requestId": request_id,
            "question": question or "Run the rule %s on the synthetic Kit." % rule["id"],
            "rule": rule, "kit": kit, "sources": list(sources), "netlists": list(netlists), "design": design,
            "needs": list(needs), "buildsOn": list(builds), "createdAt": "2026-10-08T12:00:00Z"}
```

- [ ] **Step 2: Write the failing test**

`packs/libinsight-analysis/flow/tests/test_request_v2.py`:
```python
"""prepare-request for hima-libinsight-request/2: rule, Kit catalogue, netlists, design, extraction list."""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from libinsight_analysis import common, request, tasks  # noqa: E402
import synthetic  # noqa: E402
import synthetic_kit  # noqa: E402


class RequestV2(unittest.TestCase):
    def setUp(self):
        self.base = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.base)
        self.paths = synthetic_kit.write_kit(os.path.join(self.base, "kit"))
        self.workspace = synthetic.campaign(os.path.join(self.base, "campaign"))
        self.mode = os.path.join(self.base, "mode")
        self.set_mode("old")

    def set_mode(self, word):
        with open(self.mode, "w") as stream:
            stream.write(word + "\n")

    def prepare(self, doc, catalog=None):
        path = os.path.join(self.base, "request.json")
        with open(path, "w") as stream:
            json.dump(doc, stream)
        return tasks.prepare_task(self.workspace, {
            "ANALYSIS_REQUEST": path, "ANALYSIS_LIBRARY": os.path.join(self.base, "library"),
            "FACTS_CORPUS": self.paths["corpus"], "ENGINEERING_CAPABILITIES": "", "LICENCE_MODE_FILE": self.mode,
            "SOURCE_READ_ROOTS": self.base, "KIT_CATALOG": catalog or self.paths["catalog"],
            "FACTS_STORE": os.path.join(self.base, "facts-store")})

    def prepared(self):
        with open(os.path.join(self.workspace, common.PREPARED_PATH)) as stream:
            return json.load(stream)

    def kit_request(self, corners=("0p80v125c",), variants=(), needs=("facts",), design=None, rule=None):
        return synthetic_kit.request_v2(rule or synthetic_kit.TINY_RULE,
                                        kit={"name": "synthetic", "variants": list(variants), "corners": list(corners)},
                                        needs=needs, design=design)

    def assertRefused(self, doc, code, fragment):
        with self.assertRaises(common.LiaError) as caught:
            self.prepare(doc)
        self.assertEqual(caught.exception.code, code, caught.exception.detail)
        self.assertIn(fragment, caught.exception.detail)

    def test_a_kit_request_lists_its_files_with_their_facts(self):
        value, _ = self.prepare(self.kit_request())
        prepared = self.prepared()
        self.assertEqual(prepared["schema"], "hima-libinsight-prepared-request/2")
        self.assertEqual(prepared["rule"]["id"], "tiny_rule")
        self.assertEqual(sorted(f["variant"] for f in prepared["kit"]["files"]), sorted(synthetic_kit.VARIANTS))
        self.assertTrue(all(f["corner"] == "0p80v125c" and len(f["factsAlternatives"]) == 1 for f in prepared["kit"]["files"]))
        self.assertEqual(prepared["extract"], [])
        self.assertEqual([os.path.basename(n["path"]) for n in prepared["netlists"]], ["synth_9t_hvt.sp"])
        self.assertEqual(value["rule"], {"id": "tiny_rule", "title": synthetic_kit.TINY_RULE["title"],
                                         "sentence": synthetic_kit.TINY_RULE["sentence"]})
        self.assertEqual(value["kit"], "synthetic")
        self.assertEqual(value["extract"], [])
        self.assertIn("insight-playbook.md", value["goal"])

    def test_an_unknown_kit_names_the_known_ones(self):
        doc = self.kit_request()
        doc["kit"]["name"] = "nope"
        self.assertRefused(doc, "missing-input", "known kits: synthetic")

    def test_too_many_kit_files_are_refused(self):
        saved = request.MAX_KIT_FILES
        request.MAX_KIT_FILES = 3
        try:
            self.assertRefused(self.kit_request(corners=()), "too-many-files", "name variants or corners")
        finally:
            request.MAX_KIT_FILES = saved

    def test_a_design_rule_without_design_files_is_refused(self):
        self.assertRefused(self.kit_request(needs=("facts", "design")), "missing-input", "netlist and timing report")

    def test_a_netlist_rule_without_netlists_is_refused(self):
        with open(self.paths["catalog"]) as stream:
            catalog = json.load(stream)
        catalog["kits"][0]["netlistRoots"] = []
        other = os.path.join(self.base, "kits-no-netlists.json")
        with open(other, "w") as stream:
            json.dump(catalog, stream)
        with self.assertRaises(common.LiaError) as caught:
            self.prepare(self.kit_request(needs=("facts", "netlists")), catalog=other)
        self.assertIn("needs the cell netlists", caught.exception.detail)

    def test_design_files_are_hashed(self):
        self.prepare(self.kit_request(needs=("facts", "design"), design={
            "netlist": self.paths["design_netlist"], "timingReport": self.paths["timing_report"]}))
        design = self.prepared()["design"]
        self.assertEqual(design["timingReport"]["sha256"], common.sha256_file(self.paths["timing_report"]))

    def test_missing_facts_need_extraction_and_licence_mode_new(self):
        os.remove(os.path.join(self.paths["corpus"], "synthetic", "synth_7t_rvt_0p80v125c.json.gz"))
        self.assertRefused(self.kit_request(), "licence-mode", "empyrean-license new")
        self.set_mode("new")
        value, _ = self.prepare(self.kit_request())
        self.assertEqual([os.path.basename(p) for p in value["extract"]], ["synth_7t_rvt_0p80v125c.lib"])

    def test_the_rule_is_validated(self):
        bad = dict(synthetic_kit.TINY_RULE, id="Vmin Bottleneck")
        self.assertRefused(self.kit_request(rule=bad), "invalid-input", "rule.id")
        long = dict(synthetic_kit.TINY_RULE, sentence="x" * 301)
        self.assertRefused(self.kit_request(rule=long), "invalid-input", "rule.sentence")

    def test_a_request_without_kit_or_sources_is_refused(self):
        doc = synthetic_kit.request_v2(synthetic_kit.TINY_RULE)
        self.assertRefused(doc, "invalid-input", "name a kit or at least one source")

    def test_builds_on_accepts_rule_names(self):
        target = os.path.join(self.base, "library", "tiny_rule", "v1")
        os.makedirs(target)
        common.write_json(os.path.join(target, "admission.json"), {
            "schema": common.ADMISSION_SCHEMA, "id": "tiny_rule", "version": 1, "path": target,
            "question": "q", "resultSha256": "a" * 64, "codeSha256s": {}})
        doc = self.kit_request()
        doc["buildsOn"] = ["tiny_rule@1"]
        value, _ = self.prepare(doc)
        self.assertEqual(value["buildsOn"], ["tiny_rule@1"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run it to verify it fails**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_request_v2.py'
```
Expected: FAIL/ERROR (`analysis request fields: missing [] ; unexpected ['design', 'kit', 'needs', 'netlists', 'rule']` from the `/1` validator).

- [ ] **Step 4: Add the constants**

In `packs/libinsight-analysis/flow/libinsight_analysis/common.py`, replace the line
`BUILDS_ON = re.compile(r"^([a-z0-9][a-z0-9-]{1,62})@([1-9][0-9]{0,8})$")` with:
```python
BUILDS_ON = re.compile(r"^([a-z0-9][a-z0-9_-]{1,62})@([1-9][0-9]{0,8})$")
RULE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{1,62}$")
```
and after `FACTS_SCHEMA = "lib-insight-facts/1"` add:
```python
REQUEST_SCHEMA_V2 = "hima-libinsight-request/2"
PREPARED_SCHEMA_V2 = "hima-libinsight-prepared-request/2"
PREPARED_DATA_SCHEMA = "hima-libinsight-prepared-data/1"
NETLIST_FACTS_SCHEMA = "hima-libinsight-netlist-facts/1"
INSIGHT_SCHEMA = "hima-libinsight-insight/1"
KITS_SCHEMA = "hima-libinsight-kits/1"
PREPARED_DATA_PATH = "state/prepared-data.json"
NETLIST_FACTS_PATH = "state/netlist-facts.json"
```

- [ ] **Step 5: Implement request `/2`**

In `packs/libinsight-analysis/flow/libinsight_analysis/request.py`:

(a) add `import re` to the imports and, after `MAX_CORPUS_ENTRIES = 500`, add:
```python
REQUEST_KEYS_V2 = {"schema", "requestId", "question", "rule", "kit", "sources", "netlists", "design", "needs",
                   "buildsOn", "createdAt"}
RULE_KEYS = {"id", "title", "sentence", "parameters"}
KIT_KEYS = {"name", "variants", "corners"}
KIT_ENTRY_KEYS = {"name", "title", "release", "libertyRoots", "pattern", "netlistRoots", "netlistPattern"}
NEEDS = ("facts", "netlists", "design")
KIT_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
MAX_NETLISTS = 16
MAX_KIT_FILES = 64
MAX_NETLIST_FILES = 64
```

(b) in `library_catalog`, replace `if not common.SLUG.match(name) or os.path.islink(folder) or not os.path.isdir(folder):` with `if not common.RULE_ID.match(name) or os.path.islink(folder) or not os.path.isdir(folder):`.

(c) replace the body of `describe_source` with a version that shares the root checks:
```python
def bound_file(path, label, readable_roots=None, site_roots=None):
    """`path` as a plain readable file inside the Site read roots and the resident sandbox roots."""
    common.plain_file(path, label)
    if site_roots is not None and not common.inside(path, site_roots):
        raise LiaError("invalid-input", "%s %s is outside the Site read roots %s; name a file the Site "
                       "Permit lets this Site read" % (label, path, site_roots))
    if readable_roots is not None and not common.inside(path, readable_roots):
        raise LiaError("invalid-input", "%s %s is outside the resident sandbox read-only roots %s; "
                       "the resident could not read it" % (label, path, readable_roots))
    return {"path": path, "sha256": common.sha256_file(path), "bytes": os.path.getsize(path)}


def describe_source(path, readable_roots=None, site_roots=None):
    """{path, kind, sha256, bytes[, liberty]} for one plain source file."""
    common.plain_file(path, "source")
    kind = source_kind(path)
    described = bound_file(path, "source", readable_roots, site_roots)
    described["kind"] = kind
    if kind == "facts":
        header = common.facts_header(path)
        liberty = {"path": header["source"]["path"], "sha256": header["source"]["sha256"]}
        if isinstance(header["source"].get("bytes"), int):
            liberty["bytes"] = header["source"]["bytes"]
        described["liberty"] = liberty
    return described
```

(d) add the `/2` validation, catalogue and preparation functions before `def prepare(`:
```python
def _text(value, low, high):
    return isinstance(value, str) and low <= len(value) <= high and value.strip() != ""


def _abs_paths(value, label, limit):
    if not isinstance(value, list) or len(value) > limit:
        raise LiaError("invalid-input", "%s must be a list of at most %d absolute Site paths" % (label, limit))
    for item in value:
        if not isinstance(item, str) or not os.path.isabs(item):
            raise LiaError("invalid-input", "%s entry %r must be an absolute Site path" % (label, item))
    if len(set(value)) != len(value):
        raise LiaError("invalid-input", "%s must not repeat a path" % label)
    return value


def validate_rule(rule):
    if not isinstance(rule, dict) or set(rule) != RULE_KEYS:
        raise LiaError("invalid-input", "rule must be exactly {id, title, sentence, parameters}")
    if not isinstance(rule["id"], str) or not common.RULE_ID.match(rule["id"]):
        raise LiaError("invalid-input", "rule.id %r must be a rule name like vmin_bottleneck (lowercase letters, "
                       "digits, '_' or '-', 2..63 characters)" % (rule["id"],))
    if not _text(rule["title"], 1, 120):
        raise LiaError("invalid-input", "rule.title must be 1..120 characters")
    if not _text(rule["sentence"], 1, 300):
        raise LiaError("invalid-input", "rule.sentence must be one plain sentence of 1..300 characters")
    parameters = rule["parameters"]
    if not isinstance(parameters, list) or len(parameters) > 12:
        raise LiaError("invalid-input", "rule.parameters must be a list of at most 12 {name, value, meaning[, unit]}")
    names = set()
    for index, item in enumerate(parameters):
        at = "rule.parameters[%d]" % index
        if not isinstance(item, dict) or not {"name", "value", "meaning"} <= set(item) or set(item) - {"name", "value", "meaning", "unit"}:
            raise LiaError("invalid-input", "%s must be {name, value, meaning[, unit]}" % at)
        if not _text(item["name"], 1, 64) or item["name"] in names:
            raise LiaError("invalid-input", "%s.name must be a unique name of 1..64 characters" % at)
        names.add(item["name"])
        value = item["value"]
        if not (common.finite_number(value) or (isinstance(value, str) and len(value) <= 200)):
            raise LiaError("invalid-input", "%s.value must be a finite number or a string of at most 200 characters" % at)
        if not _text(item["meaning"], 1, 300):
            raise LiaError("invalid-input", "%s.meaning must say in 1..300 characters what the value means" % at)
        if "unit" in item and not _text(item["unit"], 1, 32):
            raise LiaError("invalid-input", "%s.unit must be 1..32 characters" % at)
    return rule


def validate_request_v2(value):
    if not isinstance(value, dict) or set(value) != REQUEST_KEYS_V2:
        keys = set(value) if isinstance(value, dict) else set()
        raise LiaError("invalid-input", "analysis request fields: missing %s; unexpected %s; expected exactly %s" % (
            sorted(REQUEST_KEYS_V2 - keys), sorted(keys - REQUEST_KEYS_V2), sorted(REQUEST_KEYS_V2)))
    if value["schema"] != common.REQUEST_SCHEMA_V2:
        raise LiaError("invalid-input", "analysis request schema is %r, expected %s" % (value["schema"], common.REQUEST_SCHEMA_V2))
    if not isinstance(value["requestId"], str) or not common.REQUEST_ID.match(value["requestId"]):
        raise LiaError("invalid-input", "requestId %r must match ^req-[0-9]{14}-[a-z0-9]{6}$" % (value["requestId"],))
    if not _text(value["question"], 1, 4000):
        raise LiaError("invalid-input", "question must be a non-empty string of at most 4000 characters")
    validate_rule(value["rule"])
    kit = value["kit"]
    if kit is not None:
        if not isinstance(kit, dict) or set(kit) != KIT_KEYS:
            raise LiaError("invalid-input", "kit must be null or exactly {name, variants, corners}")
        if not isinstance(kit["name"], str) or not KIT_NAME.match(kit["name"]):
            raise LiaError("invalid-input", "kit.name %r must be a Kit name from the Site kit catalogue" % (kit["name"],))
        for key, limit in (("variants", 16), ("corners", 32)):
            items = kit[key]
            if not isinstance(items, list) or len(items) > limit or not all(_text(item, 1, 64) for item in items):
                raise LiaError("invalid-input", "kit.%s must be a list of at most %d names" % (key, limit))
    sources = _abs_paths(value["sources"], "sources", MAX_SOURCES)
    _abs_paths(value["netlists"], "netlists", MAX_NETLISTS)
    design = value["design"]
    if design is not None:
        if not isinstance(design, dict) or set(design) != {"netlist", "timingReport"}:
            raise LiaError("invalid-input", "design must be null or exactly {netlist, timingReport}")
        _abs_paths([design["netlist"], design["timingReport"]], "design", 2)
    needs = value["needs"]
    if (not isinstance(needs, list) or "facts" not in needs or len(set(needs)) != len(needs)
            or any(item not in NEEDS for item in needs)):
        raise LiaError("invalid-input", "needs must list facts and optionally netlists and design, each once")
    if kit is None and not sources:
        raise LiaError("invalid-input", "name a kit or at least one source: an analysis needs Liberty data")
    builds = value["buildsOn"]
    if not isinstance(builds, list) or len(builds) > MAX_BUILDS_ON:
        raise LiaError("invalid-input", "buildsOn must be a list of at most %d id@version references" % MAX_BUILDS_ON)
    for item in builds:
        if not isinstance(item, str) or not common.BUILDS_ON.match(item):
            raise LiaError("invalid-input", "buildsOn entry %r must be <id>@<version>, e.g. vmin_bottleneck@1" % (item,))
    if len(set(builds)) != len(builds):
        raise LiaError("invalid-input", "buildsOn must not repeat a reference")
    if not isinstance(value["createdAt"], str) or not common.ISO_TIME.match(value["createdAt"]):
        raise LiaError("invalid-input", "createdAt must be an ISO-8601 timestamp with a zone, e.g. 2026-10-05T12:00:00Z")
    return value


def kit_catalog(path):
    """{name: kit} of the Site kit catalogue, each with compiled patterns."""
    if not path:
        raise LiaError("missing-input", "this Site binds no kit catalogue (kitCatalog); name Liberty sources instead of a kit")
    doc = common.read_json_file(path, "kit catalogue")
    if not isinstance(doc, dict) or doc.get("schema") != common.KITS_SCHEMA or not isinstance(doc.get("kits"), list):
        raise LiaError("invalid-input", "kit catalogue %s is not a %s document" % (path, common.KITS_SCHEMA))
    kits = {}
    for index, kit in enumerate(doc["kits"]):
        if not isinstance(kit, dict) or set(kit) != KIT_ENTRY_KEYS:
            raise LiaError("invalid-input", "kit catalogue entry %d must be exactly %s" % (index, sorted(KIT_ENTRY_KEYS)))
        try:
            pattern, netlist_pattern = re.compile(kit["pattern"]), re.compile(kit["netlistPattern"])
        except (re.error, TypeError) as error:
            raise LiaError("invalid-input", "kit %r has an invalid pattern: %s" % (kit.get("name"), error))
        if set(pattern.groupindex) != {"variant", "corner"}:
            raise LiaError("invalid-input", "kit %r pattern must name exactly the groups variant and corner" % kit["name"])
        kits[kit["name"]] = dict(kit, compiled=pattern, compiledNetlist=netlist_pattern)
    return kits


def _listing(root, label):
    try:
        return sorted(os.listdir(root))
    except OSError as error:
        raise LiaError("missing-input", "%s %s cannot be listed: %s" % (label, root, error.strerror))


def kit_files(kit, wanted, readable, site_roots):
    chosen = []
    for root in kit["libertyRoots"]:
        for name in _listing(root, "kit %s Liberty folder" % kit["name"]):
            found = kit["compiled"].search(name)
            path = os.path.join(root, name)
            if not found or os.path.islink(path) or not os.path.isfile(path):
                continue
            variant, corner = found.group("variant"), found.group("corner")
            if (wanted["variants"] and variant not in wanted["variants"]) or (wanted["corners"] and corner not in wanted["corners"]):
                continue
            chosen.append((path, variant, corner))
    if not chosen:
        raise LiaError("missing-input", "kit %s has no Liberty file for variants %s and corners %s under %s" % (
            kit["name"], wanted["variants"] or "any", wanted["corners"] or "any", kit["libertyRoots"]))
    if len(chosen) > MAX_KIT_FILES:
        raise LiaError("too-many-files", "kit %s selects %d Liberty files; name variants or corners so that at most %d "
                       "are selected" % (kit["name"], len(chosen), MAX_KIT_FILES))
    files = []
    for path, variant, corner in chosen:
        item = describe_source(path, readable, site_roots)
        item.update(variant=variant, corner=corner)
        files.append(item)
    return files


def netlist_files(paths, kit, readable, site_roots):
    found = list(paths)
    if kit is not None:
        for root in kit["netlistRoots"]:
            found += [os.path.join(root, name) for name in _listing(root, "kit %s netlist folder" % kit["name"])
                      if kit["compiledNetlist"].search(name)]
    unique = sorted(set(found))
    if len(unique) > MAX_NETLIST_FILES:
        raise LiaError("too-many-files", "%d netlist files are named; at most %d" % (len(unique), MAX_NETLIST_FILES))
    return [bound_file(path, "netlist", readable, site_roots) for path in unique]


def resolve_builds(references, library):
    analyses, invalid = library_catalog(library)
    catalog = dict(((item["id"], item["version"]), item) for item in analyses)
    builds = []
    for reference in references:
        found = common.BUILDS_ON.match(reference)
        key = (found.group(1), int(found.group(2)))
        if key not in catalog:
            raise LiaError("missing-input", "buildsOn %s is not an admitted analysis in %s; admitted: %s" % (
                reference, library, ", ".join("%s@%d" % k for k in sorted(catalog)) or "none"))
        builds.append({"ref": reference, "id": key[0], "version": key[1], "path": catalog[key]["path"],
                       "resultSha256": catalog[key]["resultSha256"]})
    return builds, analyses, invalid


def goal_text_v2(prepared, prepared_path):
    rule = prepared["rule"]
    return ("Deliver the insight rule %s for request %s as one hima-libinsight-insight/1 result. Rule sentence: %s "
            "The person's question: %s\n\nThe prepared request is %s; the prepared data (every Liberty file as "
            "facts, netlist facts, design files) is state/prepared-data.json in the Campaign workspace. Follow "
            "insight-playbook.md (method, charts, actions, score), insight-result-contract.md (the exact result and "
            "delivery) and rule-catalog.md (the reference rules; their scripts are under flow/reference_rules). Check "
            "the result with `python3 <campaignWorkspace>/flow/libinsight_cli.py check-delivery . analysis-result.json` "
            "before writing the delivery candidate." % (rule["id"], prepared["request"]["requestId"], rule["sentence"],
                                                       prepared["request"]["question"], prepared_path))


def prepare_v2(workspace, request_path, value, library, corpus, capability_path, mode_file, source_roots,
               kit_catalog_path, facts_store):
    site_roots = common.read_roots(source_roots)
    roots = readable_roots(capability_path)
    sources = [describe_source(path, roots, site_roots) for path in value["sources"]]
    kit, kit_doc = None, None
    if value["kit"] is not None:
        kits = kit_catalog(kit_catalog_path)
        if value["kit"]["name"] not in kits:
            raise LiaError("missing-input", "kit %s is not in the Site kit catalogue; known kits: %s" % (
                value["kit"]["name"], ", ".join(sorted(kits)) or "none"))
        kit = kits[value["kit"]["name"]]
        kit_doc = {"name": kit["name"], "title": kit["title"], "release": kit["release"],
                   "files": kit_files(kit, value["kit"], roots, site_roots)}
    netlists = netlist_files(value["netlists"], kit, roots, site_roots)
    if "netlists" in value["needs"] and not netlists:
        raise LiaError("missing-input", "this rule needs the cell netlists, but neither the request nor the kit names "
                       "any; add the Site paths of the cell netlists")
    design = None
    if value["design"] is not None:
        design = {"netlist": bound_file(value["design"]["netlist"], "design netlist", roots, site_roots),
                  "timingReport": bound_file(value["design"]["timingReport"], "timing report", roots, site_roots)}
    if "design" in value["needs"] and design is None:
        raise LiaError("missing-input", "this rule needs the design's netlist and timing report; ask the person for "
                       "both Site paths")
    corpus_files = facts_corpus(corpus)
    store_files = facts_corpus(facts_store) if facts_store else []
    by_liberty = {}
    for entry in corpus_files + store_files:
        if "liberty" in entry:
            by_liberty.setdefault(entry["liberty"]["sha256"], []).append(entry["path"])
    extract = []
    for item in sources + (kit_doc["files"] if kit_doc else []):
        if item["kind"] == "liberty":
            item["factsAlternatives"] = by_liberty.get(item["sha256"], [])
            if not item["factsAlternatives"] and item["path"] not in extract:
                extract.append(item["path"])
    mode = licence_mode(mode_file)
    if extract and mode != "new":
        raise LiaError("licence-mode", "%s. %d Liberty file(s) have no facts yet and need QuaLib extraction." % (
            XTOP_MODE_MESSAGE, len(extract)))
    builds, analyses, invalid = resolve_builds(value["buildsOn"], library)
    prepared = {
        "schema": common.PREPARED_SCHEMA_V2, "request": value, "requestSha256": common.sha256_file(request_path),
        "requestPath": request_path, "rule": value["rule"], "needs": value["needs"], "sources": sources,
        "kit": kit_doc, "netlists": netlists, "design": design, "extract": extract, "buildsOn": builds,
        "library": {"path": library, "analyses": analyses, "invalid": invalid},
        "factsCorpus": {"path": corpus, "files": corpus_files},
        "factsStore": {"path": facts_store or None, "files": store_files},
        "licence": {"modeFile": mode_file or None, "mode": mode, "liveQualibAvailable": mode == "new",
                    "extractionNeeded": extract},
        "readRoots": site_roots, "sandboxReadOnlyRoots": roots,
    }
    target = os.path.join(workspace, common.PREPARED_PATH)
    common.write_json(target, prepared)
    return prepared, target
```

(e) change `prepare` to dispatch on the request schema (the `/1` body stays as it is below the dispatch):
```python
def prepare(workspace, request_path, library, corpus, capability_path, mode_file="", source_roots=None,
            kit_catalog_path="", facts_store=""):
    raw = common.read_json_file(request_path, "analysis request")
    if isinstance(raw, dict) and raw.get("schema") == common.REQUEST_SCHEMA_V2:
        return prepare_v2(workspace, request_path, validate_request_v2(raw), library, corpus, capability_path,
                          mode_file, source_roots, kit_catalog_path, facts_store)
    request = validate_request(raw)
```
(the remaining lines of the old `prepare`, from `site_roots = common.read_roots(source_roots)` to `return prepared, target`, stay unchanged).

- [ ] **Step 6: Pass the new inputs and report the rule**

In `packs/libinsight-analysis/flow/libinsight_analysis/tasks.py`, replace `prepare_task` with:
```python
def prepare_task(workspace, inputs):
    prepared, target = request.prepare(
        workspace, inputs["ANALYSIS_REQUEST"], inputs["ANALYSIS_LIBRARY"], inputs.get("FACTS_CORPUS") or "",
        inputs.get("ENGINEERING_CAPABILITIES") or "", inputs.get("LICENCE_MODE_FILE") or "",
        inputs["SOURCE_READ_ROOTS"], inputs.get("KIT_CATALOG") or "", inputs.get("FACTS_STORE") or "")
    req = prepared["request"]
    value = {
        "requestId": req["requestId"],
        "question": req["question"],
        "preparedPath": common.PREPARED_PATH,
        "preparedSha256": common.sha256_file(target),
        "sources": [{"path": item["path"], "kind": item["kind"], "sha256": item["sha256"]} for item in prepared["sources"]],
        "buildsOn": [item["ref"] for item in prepared["buildsOn"]],
        "libraryAnalyses": len(prepared["library"]["analyses"]),
    }
    if prepared["schema"] == common.PREPARED_SCHEMA_V2:
        rule = prepared["rule"]
        value.update(rule={"id": rule["id"], "title": rule["title"], "sentence": rule["sentence"]},
                     kit=(prepared["kit"] or {}).get("name"), needs=list(prepared["needs"]), extract=list(prepared["extract"]),
                     goal=request.goal_text_v2(prepared, os.path.join(workspace, common.PREPARED_PATH)))
    else:
        value["goal"] = request.goal_text(req, os.path.join(workspace, common.PREPARED_PATH))
    return value, [_artifact("prepared-request", common.PREPARED_PATH)]
```

- [ ] **Step 7: Run all Pack tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'
```
Expected: PASS, including the unchanged `/1` tests in `test_tasks.py`.

- [ ] **Step 8: Commit and push**

```bash
git add packs/libinsight-analysis/flow/libinsight_analysis/common.py packs/libinsight-analysis/flow/libinsight_analysis/request.py packs/libinsight-analysis/flow/libinsight_analysis/tasks.py packs/libinsight-analysis/flow/tests/synthetic_kit.py packs/libinsight-analysis/flow/tests/test_request_v2.py
git commit -m "feat(libinsight): request /2 with rule, kit catalogue, netlists, design and extraction list

Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---

### Task 5: `prepare-data`: facts lookup, QuaLib extraction, facts admission, netlist facts

**Files:**
- Create: `packs/libinsight-analysis/flow/libinsight_analysis/data.py` (host only)
- Modify: `packs/libinsight-analysis/flow/libinsight_analysis/common.py` (add `load_facts`)
- Modify: `packs/libinsight-analysis/flow/libinsight_analysis/tasks.py` (`prepare_data_task`, dispatch)
- Modify: `packs/libinsight-analysis/flow/libinsight_cli.py` (docstring lists `task-prepare-data`)
- Modify: `packs/libinsight-analysis/flow/tests/synthetic_kit.py` (add `prepared`)
- Create: `packs/libinsight-analysis/flow/tests/test_prepare_data.py`

**Interfaces:**
- Consumes: Task 4 prepared `/2` document; `vendored.VENDOR`, `vendored.load("netlist")` (`read_spice(path) -> dict[str, Subckt]`, `reduce(subckt) -> SwitchNet`, `arc_devices(net, input_pin, output_pin) -> list[dict]`).
- Produces:
  - `data.prepare_data(workspace, prepared_value, facts_store, runner, python, api_home) -> (value, artifacts)`; value `{preparedDataPath: "state/prepared-data.json", preparedDataSha256, facts: int, extracted: int, netlistCells: int, design: bool}`.
  - `state/prepared-data.json` (`hima-libinsight-prepared-data/1`): `{schema, requestId, preparedSha256, facts: [{liberty, libertySha256, facts, factsSha256, variant, corner, origin: "request"|"corpus"|"store"|"extracted"}], extracted: [{liberty, facts, seconds}], netlistFacts: {path, sha256, cells} | null, design: {netlist, timingReport} | null}`.
  - `state/netlist-facts.json` (`hima-libinsight-netlist-facts/1`): `{schema, netlists, factsFile, cells: {cell: {arcs: {"A1->ZN": [device, ...]}}}, missing, problems}`.
  - Extraction argv: `[runner, "env", "LIBERTY_API_HOME=<api>", "PYTHONPATH=<api>", "LD_LIBRARY_PATH=<api>/lib", python, "-X", "faulthandler", <vendor>/extract/libapi_extract.py, <liberty>, <workspace>/state/extract/<sha>.json.gz]`.
  - `tasks.execute("prepare-data", …)` reads `PREPARED`, `FACTS_STORE`, `QUALIB_RUNNER`, `QUALIB_PYTHON`, `QUALIB_API_HOME`.
  - `synthetic_kit.prepared(base, rule, variants=(), corners=(), needs=("facts",), design=False, mode="old", drop=(), runner="", python="", api_home="") -> dict` (kit paths plus `workspace`, `prepared`, `data`, `value`, `data_value`, `store`).

- [ ] **Step 1: Add the preparation helper to the synthetic Kit**

Append to `packs/libinsight-analysis/flow/tests/synthetic_kit.py`:
```python
def prepared(base, rule, variants=(), corners=(), needs=("facts",), design=False, mode="old", drop=(),
             runner="", python="", api_home=""):
    """Write the Kit, a /2 request for `rule` and run prepare-request and prepare-data like the route does."""
    import synthetic
    from libinsight_analysis import common, tasks
    paths = write_kit(os.path.join(base, "kit"))
    for name in drop:
        os.remove(os.path.join(paths["corpus"], KIT, name))
    workspace = synthetic.campaign(os.path.join(base, "campaign"))
    doc = request_v2(rule, kit={"name": KIT, "variants": list(variants), "corners": list(corners)}, needs=needs,
                     design={"netlist": paths["design_netlist"], "timingReport": paths["timing_report"]} if design else None)
    request_path = os.path.join(base, "request.json")
    with open(request_path, "w") as stream:
        json.dump(doc, stream)
    mode_file, store = os.path.join(base, "licence-mode"), os.path.join(base, "facts-store")
    with open(mode_file, "w") as stream:
        stream.write(mode + "\n")
    value, _ = tasks.prepare_task(workspace, {
        "ANALYSIS_REQUEST": request_path, "ANALYSIS_LIBRARY": os.path.join(base, "library"),
        "FACTS_CORPUS": paths["corpus"], "ENGINEERING_CAPABILITIES": "", "LICENCE_MODE_FILE": mode_file,
        "SOURCE_READ_ROOTS": base, "KIT_CATALOG": paths["catalog"], "FACTS_STORE": store})
    data_value, _ = tasks.prepare_data_task(workspace, {
        "PREPARED": value, "FACTS_STORE": store, "QUALIB_RUNNER": runner, "QUALIB_PYTHON": python, "QUALIB_API_HOME": api_home})
    return dict(paths, workspace=workspace, store=store, value=value, data_value=data_value,
                prepared=os.path.join(workspace, common.PREPARED_PATH), data=os.path.join(workspace, common.PREPARED_DATA_PATH))
```

- [ ] **Step 2: Write the failing test**

`packs/libinsight-analysis/flow/tests/test_prepare_data.py`:
```python
"""prepare-data: corpus facts, QuaLib extraction with a stand-in runner, facts admission, netlist facts."""
import json
import os
import shutil
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from libinsight_analysis import common  # noqa: E402
import synthetic_kit  # noqa: E402

# Called as `env env VAR=... <this> -X faulthandler <extractor> <liberty> <out>`; writes a facts record for
# the Liberty file it was given, or fails the way QuaLib does (FAKE_QUALIB=null) or changes the source (touch).
FAKE_QUALIB = r'''#!/usr/bin/env python3
import gzip, hashlib, json, os, sys
source, out = sys.argv[-2], sys.argv[-1]
with open(os.environ["FAKE_QUALIB_LOG"], "a") as log:
    log.write(source + "\n")
mode = os.environ.get("FAKE_QUALIB", "ok")
if mode == "null":
    sys.stderr.write("readTmlib returned a null handle\n")
    sys.exit(3)
data = open(source, "rb").read()
digest = hashlib.sha256(data).hexdigest()
if mode == "touch":
    open(source, "ab").write(b" ")
record = {"schema": "lib-insight-facts/1", "source": {"path": source, "bytes": len(data), "sha256": digest,
          "sha256_after": digest}, "status": "ok", "library": {"name": "x", "cells": []}}
with gzip.open(out, "wt") as stream:
    json.dump(record, stream)
'''
MISSING = "synth_7t_rvt_0p80v125c.json.gz"


class PrepareData(unittest.TestCase):
    def setUp(self):
        self.base = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.base)
        self.fake = os.path.join(self.base, "fake-qualib.py")
        with open(self.fake, "w") as stream:
            stream.write(FAKE_QUALIB)
        os.chmod(self.fake, os.stat(self.fake).st_mode | stat.S_IEXEC)
        self.log = os.path.join(self.base, "qualib.log")
        os.environ["FAKE_QUALIB_LOG"] = self.log
        os.environ.pop("FAKE_QUALIB", None)
        self.addCleanup(os.environ.pop, "FAKE_QUALIB", None)

    def run_prepare(self, **extra):
        return synthetic_kit.prepared(os.path.join(self.base, "run"), synthetic_kit.TINY_RULE, corners=["0p80v125c"], **extra)

    def calls(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log) as stream:
            return stream.read().split()

    def test_corpus_facts_are_used_without_qualib(self):
        paths = self.run_prepare()
        with open(paths["data"]) as stream:
            doc = json.load(stream)
        self.assertEqual(doc["schema"], "hima-libinsight-prepared-data/1")
        self.assertEqual(sorted(entry["variant"] for entry in doc["facts"]), sorted(synthetic_kit.VARIANTS))
        self.assertTrue(all(entry["origin"] == "corpus" for entry in doc["facts"]))
        for entry in doc["facts"]:
            self.assertEqual(entry["factsSha256"], common.sha256_file(entry["facts"]))
        self.assertEqual(paths["data_value"]["extracted"], 0)
        self.assertEqual(self.calls(), [])

    def test_a_missing_record_is_extracted_admitted_and_reused(self):
        paths = self.run_prepare(mode="new", drop=[MISSING], runner="/usr/bin/env", python=self.fake, api_home=self.base)
        self.assertEqual(paths["data_value"]["extracted"], 1)
        self.assertEqual(len(self.calls()), 1)
        with open(paths["data"]) as stream:
            doc = json.load(stream)
        extracted = [entry for entry in doc["facts"] if entry["origin"] == "extracted"]
        self.assertEqual(len(extracted), 1)
        admitted = extracted[0]["facts"]
        self.assertEqual(os.path.dirname(admitted), paths["store"])
        self.assertEqual(os.path.basename(admitted), extracted[0]["libertySha256"] + ".json.gz")
        self.assertFalse(os.stat(admitted).st_mode & stat.S_IWUSR, "admitted facts are read-only")

    def test_a_null_handle_stops_the_run_with_a_plain_reason(self):
        os.environ["FAKE_QUALIB"] = "null"
        with self.assertRaises(common.LiaError) as caught:
            self.run_prepare(mode="new", drop=[MISSING], runner="/usr/bin/env", python=self.fake, api_home=self.base)
        self.assertEqual(caught.exception.code, "extraction-failed")
        self.assertIn("null handle", caught.exception.detail)
        self.assertIn("does not start on partial data", caught.exception.detail)

    def test_a_source_changed_during_extraction_is_refused(self):
        os.environ["FAKE_QUALIB"] = "touch"
        with self.assertRaises(common.LiaError) as caught:
            self.run_prepare(mode="new", drop=[MISSING], runner="/usr/bin/env", python=self.fake, api_home=self.base)
        self.assertIn("changed during extraction", caught.exception.detail)

    def test_no_runner_bound_is_refused(self):
        with self.assertRaises(common.LiaError) as caught:
            self.run_prepare(mode="new", drop=[MISSING])
        self.assertIn("binds no QuaLib runner", caught.exception.detail)

    def test_design_files_are_carried(self):
        paths = self.run_prepare(needs=("facts", "design"), design=True)
        with open(paths["data"]) as stream:
            doc = json.load(stream)
        self.assertEqual(doc["design"]["timingReport"]["path"], paths["timing_report"])

    @unittest.skipIf(sys.version_info[:2] < (3, 9), "the vendored netlist reader needs Python 3.9+")
    def test_netlist_facts_list_the_devices_of_each_arc(self):
        paths = synthetic_kit.prepared(os.path.join(self.base, "netlists"), synthetic_kit.TINY_RULE,
                                       variants=["9t_hvt"], corners=["0p60vm40c"], needs=("facts", "netlists"))
        self.assertGreater(paths["data_value"]["netlistCells"], 0)
        with open(os.path.join(paths["workspace"], "state", "netlist-facts.json")) as stream:
            doc = json.load(stream)
        devices = doc["cells"]["NOR3X1"]["arcs"]["A1->ZN"]
        self.assertTrue(any(device["name"] == "MP1" for device in devices), devices)
        self.assertIn("NAND2X1", doc["missing"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run it to verify it fails**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_prepare_data.py'
```
Expected: ERROR `AttributeError: module 'libinsight_analysis.tasks' has no attribute 'prepare_data_task'`.

- [ ] **Step 4: Add `load_facts` to `common.py`**

Append to `packs/libinsight-analysis/flow/libinsight_analysis/common.py`:
```python
def load_facts(path):
    """The whole lib-insight-facts/1 record of a .json.gz (only status ok records)."""
    with gzip.open(path, "rb") as stream:
        doc = json.loads(stream.read().decode("utf-8"))
    if doc.get("schema") != FACTS_SCHEMA or doc.get("status") != "ok":
        raise LiaError("invalid-input", "facts file %s is not an ok %s record" % (path, FACTS_SCHEMA))
    return doc
```

- [ ] **Step 5: Write `data.py`**

`packs/libinsight-analysis/flow/libinsight_analysis/data.py`:
```python
"""prepare-data: every Liberty file as facts, the netlist facts and the design files (host only, ADR-0022).

Runs on the Site host's python3 (3.9 or later, for LibInsight's vendored netlist reader). Each Liberty
file of the prepared request takes its facts record from the read-only corpus or the Site facts store; a
file with neither is extracted with QuaLib, one process per file under the Site's QuaLib runner, by
LibInsight's own extractor, and the record is admitted into the facts store when its schema, status and
source hashes before and after all match. A missing input stops the Run with a plain reason.
"""
import os
import shutil
import subprocess
import time

from . import common, vendored
from .common import LiaError

EXTRACT_TIMEOUT_S = 1800
MAX_NETLIST_CELLS = 4000
MAX_NETLIST_ARCS = 40000
EXIT_REASONS = {2: "usage error", 3: "QuaLib returned a null handle: the licence is not served in mode new, or the file does not parse",
                4: "extraction error", 5: "round-trip mismatch"}


def _read_prepared(workspace, value):
    path = os.path.join(workspace, common.PREPARED_PATH)
    if common.sha256_file(path) != value.get("preparedSha256"):
        raise LiaError("identity-mismatch", "prepared request changed after prepare-request committed it")
    prepared = common.read_json_file(path, "prepared request")
    if prepared.get("schema") != common.PREPARED_SCHEMA_V2:
        raise LiaError("invalid-input", "prepare-data needs a %s document" % common.PREPARED_SCHEMA_V2)
    return prepared


def _liberty_files(prepared):
    files = [dict(item, variant=None, corner=None) for item in prepared["sources"] if item["kind"] == "liberty"]
    files += list((prepared.get("kit") or {}).get("files", []))
    seen, unique = set(), []
    for item in files:
        if item["path"] not in seen:
            seen.add(item["path"])
            unique.append(item)
    return unique


def _entry(item, facts_path, origin):
    header = common.facts_header(facts_path)
    return {"liberty": item["path"] if item else header["source"]["path"], "libertySha256": header["source"]["sha256"],
            "facts": facts_path, "factsSha256": common.sha256_file(facts_path),
            "variant": (item or {}).get("variant"), "corner": (item or {}).get("corner"), "origin": origin}


def admit_facts(candidate, store, liberty_sha):
    """Place a verified record at <store>/<Liberty sha256>.json.gz, read-only; returns its path."""
    if not store or not os.path.isabs(store):
        raise LiaError("invalid-input", "factsStore must be an absolute Site folder")
    if not os.path.isdir(store):
        os.makedirs(store)
    target = os.path.join(store, liberty_sha + ".json.gz")
    if os.path.lexists(target):
        if common.facts_header(target)["source"]["sha256"] != liberty_sha:
            raise LiaError("invalid-state", "facts store entry %s names another Liberty source" % target)
        return target
    stage = os.path.join(store, ".staging-%s-%d" % (liberty_sha, os.getpid()))
    shutil.copyfile(candidate, stage)
    os.chmod(stage, 0o444)
    os.rename(stage, target)
    return target


def extract_one(item, workspace, store, runner, python, api_home):
    """Extract one Liberty file: {liberty, facts, seconds}, or {liberty, reason} when it failed."""
    path = item["path"]
    if common.sha256_file(path) != item["sha256"]:
        return {"liberty": path, "reason": "the Liberty file changed after prepare-request"}
    out_dir = os.path.join(workspace, "state", "extract")
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    target = os.path.join(out_dir, item["sha256"] + ".json.gz")
    if os.path.exists(target):
        os.remove(target)
    vendored.verify()
    extractor = os.path.join(vendored.VENDOR, "extract", "libapi_extract.py")
    argv = [runner, "env", "LIBERTY_API_HOME=" + api_home, "PYTHONPATH=" + api_home,
            "LD_LIBRARY_PATH=" + os.path.join(api_home, "lib"), python, "-X", "faulthandler", extractor, path, target]
    started = time.time()
    try:
        completed = subprocess.run(argv, cwd=out_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=EXTRACT_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return {"liberty": path, "reason": "QuaLib extraction exceeded %d s" % EXTRACT_TIMEOUT_S}
    except OSError as error:
        return {"liberty": path, "reason": "the QuaLib runner %s could not start: %s" % (runner, error)}
    with open(os.path.join(out_dir, item["sha256"] + ".log"), "wb") as stream:
        stream.write(completed.stdout + b"\n--- stderr ---\n" + completed.stderr)
    if completed.returncode != 0:
        tail = (completed.stderr.decode("utf-8", "replace").strip().splitlines() or [""])[-1][:200]
        return {"liberty": path, "reason": "QuaLib extraction exited %d (%s) %s" % (
            completed.returncode, EXIT_REASONS.get(completed.returncode, "failed"), tail)}
    if common.sha256_file(path) != item["sha256"]:
        return {"liberty": path, "reason": "the Liberty file changed during extraction"}
    try:
        header = common.facts_header(target)
    except LiaError as error:
        return {"liberty": path, "reason": error.detail}
    if header["source"]["sha256"] != item["sha256"]:
        return {"liberty": path, "reason": "the extracted record names Liberty sha256 %s, not %s" % (
            header["source"]["sha256"], item["sha256"])}
    return {"liberty": path, "facts": admit_facts(target, store, item["sha256"]), "seconds": round(time.time() - started, 3)}


def netlist_facts(workspace, prepared, entries):
    """state/netlist-facts.json: the devices of every arc of every cell that has a subcircuit."""
    if not prepared.get("netlists"):
        return None
    for item in prepared["netlists"]:
        if common.sha256_file(item["path"]) != item["sha256"]:
            raise LiaError("identity-mismatch", "netlist %s changed after prepare-request" % item["path"])
    netlist = vendored.load("netlist")
    subckts = {}
    for item in prepared["netlists"]:
        subckts.update(netlist.read_spice(item["path"]))
    source = sorted(entries, key=lambda entry: entry["facts"])[0]
    facts = common.load_facts(source["facts"])
    cells, missing, problems, total = {}, [], [], 0
    for cell in facts["library"]["cells"][:MAX_NETLIST_CELLS]:
        sub = subckts.get(cell["name"])
        if sub is None:
            if len(missing) < 500:
                missing.append(cell["name"])
            continue
        try:
            net = netlist.reduce(sub)
        except Exception as error:  # one unreadable subcircuit is recorded, never fatal
            if len(problems) < 200:
                problems.append("%s: %s" % (cell["name"], error))
            continue
        arcs = {}
        for pin in cell.get("pins") or []:
            if pin.get("direction") != "output":
                continue
            for timing in pin.get("timing") or []:
                for related in str(timing.get("related_pin", "")).split():
                    key = "%s->%s" % (related, pin["name"])
                    if key in arcs or total >= MAX_NETLIST_ARCS:
                        continue
                    try:
                        arcs[key] = netlist.arc_devices(net, related, pin["name"])
                        total += 1
                    except Exception as error:  # an arc the reduction cannot trace is recorded
                        if len(problems) < 200:
                            problems.append("%s %s: %s" % (cell["name"], key, error))
        if arcs:
            cells[cell["name"]] = {"arcs": arcs}
    target = os.path.join(workspace, common.NETLIST_FACTS_PATH)
    common.write_json(target, {"schema": common.NETLIST_FACTS_SCHEMA,
                               "netlists": [{"path": i["path"], "sha256": i["sha256"]} for i in prepared["netlists"]],
                               "factsFile": source["facts"], "cells": cells, "missing": missing, "problems": problems})
    return {"path": common.NETLIST_FACTS_PATH, "sha256": common.sha256_file(target), "cells": len(cells)}


def prepare_data(workspace, value, store, runner, python, api_home):
    prepared = _read_prepared(workspace, value)
    store_root = (prepared.get("factsStore") or {}).get("path")
    entries, extracted, failed = [], [], []
    for item in prepared["sources"]:
        if item["kind"] == "facts":
            entries.append(_entry(None, item["path"], "request"))
    for item in _liberty_files(prepared):
        alternatives = item.get("factsAlternatives") or []
        stored = os.path.join(store, item["sha256"] + ".json.gz") if store else None
        if alternatives:
            chosen = alternatives[0]
            entries.append(_entry(item, chosen, "store" if store_root and common.inside(chosen, [store_root]) else "corpus"))
        elif stored and os.path.isfile(stored):
            entries.append(_entry(item, stored, "store"))
        elif not (runner and python and api_home):
            failed.append({"liberty": item["path"], "reason": "the Site binds no QuaLib runner, Python and API home"})
        else:
            done = extract_one(item, workspace, store, runner, python, api_home)
            if "reason" in done:
                failed.append(done)
            else:
                extracted.append(done)
                entries.append(_entry(item, done["facts"], "extracted"))
    if failed:
        raise LiaError("extraction-failed", "QuaLib could not extract %d of %d Liberty files, so the analysis does not "
                       "start on partial data: %s" % (len(failed), len(failed) + len(extracted),
                                                      "; ".join("%s: %s" % (f["liberty"], f["reason"]) for f in failed[:5])))
    if not entries:
        raise LiaError("missing-input", "the request names no Liberty data: name a kit or sources")
    design = prepared.get("design")
    if design:
        for key in ("netlist", "timingReport"):
            if common.sha256_file(design[key]["path"]) != design[key]["sha256"]:
                raise LiaError("identity-mismatch", "design %s %s changed after prepare-request" % (key, design[key]["path"]))
    netlists = netlist_facts(workspace, prepared, entries)
    target = os.path.join(workspace, common.PREPARED_DATA_PATH)
    common.write_json(target, {"schema": common.PREPARED_DATA_SCHEMA, "requestId": prepared["request"]["requestId"],
                               "preparedSha256": value["preparedSha256"], "facts": entries, "extracted": extracted,
                               "netlistFacts": netlists, "design": design})
    out = {"preparedDataPath": common.PREPARED_DATA_PATH, "preparedDataSha256": common.sha256_file(target),
           "facts": len(entries), "extracted": len(extracted), "netlistCells": netlists["cells"] if netlists else 0,
           "design": design is not None}
    artifacts = [{"name": "prepared-data", "path": common.PREPARED_DATA_PATH, "mediaType": "application/json"}]
    if netlists:
        artifacts.append({"name": "netlist-facts", "path": common.NETLIST_FACTS_PATH, "mediaType": "application/json"})
    return out, artifacts
```

- [ ] **Step 6: Dispatch the task**

In `packs/libinsight-analysis/flow/libinsight_analysis/tasks.py`, change the import line to `from . import common, data, delivery, library, request` and add:
```python
def prepare_data_task(workspace, inputs):
    return data.prepare_data(workspace, inputs["PREPARED"], inputs.get("FACTS_STORE") or "",
                             inputs.get("QUALIB_RUNNER") or "", inputs.get("QUALIB_PYTHON") or "",
                             inputs.get("QUALIB_API_HOME") or "")
```
and in `execute`, before `elif task == "admit-analysis":`, add:
```python
    elif task == "prepare-data":
        value, artifacts = prepare_data_task(workspace, inputs)
```
In `packs/libinsight-analysis/flow/libinsight_cli.py`, add the line `    libinsight_cli.py task-prepare-data    WORKSPACE TASK_INPUT TASK_OUTPUT` to the docstring's Program ABI block after `task-prepare-request`.

- [ ] **Step 7: Run all Pack tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'
```
Expected: PASS. If `test_netlist_facts_list_the_devices_of_each_arc` fails because `arc_devices` returns a different device key than `name`, read `vendor/libinsight/netlist.py` and assert on the key it returns for the device name; do not change the vendored file.

- [ ] **Step 8: Commit and push**

```bash
git add packs/libinsight-analysis/flow/libinsight_analysis/data.py packs/libinsight-analysis/flow/libinsight_analysis/common.py packs/libinsight-analysis/flow/libinsight_analysis/tasks.py packs/libinsight-analysis/flow/libinsight_cli.py packs/libinsight-analysis/flow/tests/synthetic_kit.py packs/libinsight-analysis/flow/tests/test_prepare_data.py
git commit -m "feat(libinsight): prepare-data finds or extracts facts, admits them and reads cell netlists

Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---
### Task 6: The insight Reader, its Judge rule and `check-delivery`

**Files:**
- Modify: `packs/libinsight-analysis/flow/libinsight_analysis/delivery.py` (add `insight_problems`, `insight_measures`)
- Modify: `packs/libinsight-analysis/flow/libinsight_cli.py` (`check-delivery` dispatches on the result schema)
- Create: `packs/libinsight-analysis/tools/read-insight.py`
- Create: `packs/libinsight-analysis/readers/libinsight-insight.yml`
- Create: `packs/libinsight-analysis/rules/insight-delivery-ready.yml`
- Modify: `packs/libinsight-analysis/semantics.yml` (add the four `li_insight_*` values)
- Create: `packs/libinsight-analysis/flow/tests/test_insight_delivery.py`

**Interfaces:**
- Consumes: Task 2 `vendored.load("insight_result").validate(result, *, prepared=None, root=None, byte_size=None, current_sha=None) -> list[str]` (P1a: `prepared` is the Pack's prepared request `{sources, readRoots, buildsOn}`, `root` resolves `code.*.path`); Task 4/5 prepared documents; `synthetic.materialize(private, workspace)` (existing helper).
- Produces:
  - `delivery.insight_problems(doc, root, prepared, prepared_data, byte_size, current_sha=common.sha256_file, require_validator=False) -> (problems: list[str], deferred: str | None)`; it calls `validate(doc, prepared=prepared, root=root, byte_size=byte_size, current_sha=current_sha)` of the vendored validator and adds only the confirmed-rule and design-file checks
  - `delivery.insight_measures(doc) -> {"items": int, "actions": int, "charts": int, "datasets": int}`
  - Reader `libinsight-insight` v1: argv `[/usr/bin/python3, READER, REPORT, OUT, WORKSPACE]`; on acceptance writes `{"values": [li_insight_error_count 0, li_insight_item_count, li_insight_action_count, li_insight_chart_count]}`; on rejection exit 1, problems in `REPORT.problems.txt`, `state/analysis-result.problems.txt` and stderr.
  - Judge rule `insight-delivery-ready`: `li_insight_error_count eq 0`.
  - CLI: `check-delivery ROOT [RESULT] [PREPARED] [PREPARED_DATA]`.

- [ ] **Step 1: Write the failing test**

`packs/libinsight-analysis/flow/tests/test_insight_delivery.py`:
```python
"""The insight Reader on a real delivery: accepted, and every rejection precise (Pack checks + LibInsight's validator)."""
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from libinsight_analysis import common, delivery, vendored  # noqa: E402
import synthetic  # noqa: E402
import synthetic_kit  # noqa: E402


class InsightReader(unittest.TestCase):
    def deliver(self, **extra):
        self.base = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.base)
        self.paths = synthetic_kit.prepared(self.base, synthetic_kit.TINY_RULE, variants=["9t_rvt"], corners=["0p80v125c"], **extra)
        self.workspace = self.paths["workspace"]
        self.private = os.path.join(self.base, "private")
        self.doc = synthetic_kit.run_rule(self.private, synthetic_kit.TINY_SCRIPT, self.paths["prepared"], self.paths["data"])
        synthetic.materialize(self.private, self.workspace)

    def setUp(self):
        self.deliver()

    def read(self, doc=None):
        folder = tempfile.mkdtemp(dir=self.workspace)
        report, out = os.path.join(folder, "input-report"), os.path.join(folder, "values.json")
        with open(report, "w") as stream:
            json.dump(self.doc if doc is None else doc, stream)
        completed = subprocess.run([sys.executable, synthetic_kit.READER, report, out, self.workspace],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        values = None
        if completed.returncode == 0:
            with open(out) as stream:
                values = dict((row["type"], row["value"]) for row in json.load(stream)["values"])
        return completed.returncode, values, completed.stderr.decode("utf-8", "replace")

    def changed(self, change):
        doc = copy.deepcopy(self.doc)
        change(doc)
        return doc

    def assertRejected(self, doc, fragment):
        code, values, stderr = self.read(doc)
        self.assertEqual(code, 1, stderr)
        self.assertIsNone(values)
        self.assertIn(fragment, stderr)
        with open(os.path.join(self.workspace, common.PROBLEMS_PATH)) as stream:
            self.assertTrue(stream.read().startswith("REJECTED delivery "))

    def test_a_valid_delivery_is_accepted_with_its_counts(self):
        code, values, stderr = self.read()
        self.assertEqual(code, 0, stderr)
        self.assertEqual(values, {"li_insight_error_count": 0, "li_insight_item_count": 3,
                                  "li_insight_action_count": 1, "li_insight_chart_count": 2})

    def test_an_analysis_v1_document_is_refused(self):
        self.assertRejected(self.changed(lambda d: d.update(schema="hima-libinsight-analysis/1")), "this Pack admits insight results")

    def test_the_rule_must_be_the_confirmed_one(self):
        self.assertRejected(self.changed(lambda d: d.update(id="vmin_bottleneck")), "must be the rule the person confirmed: tiny_rule")

    def test_libinsight_validator_problems_return_to_the_task(self):
        code, _, stderr = self.read(self.changed(lambda d: d["rule"].pop("sentence")))
        self.assertEqual(code, 1)
        self.assertIn("sentence", stderr.lower())

    def test_code_and_source_hashes_are_checked(self):
        self.assertRejected(self.changed(lambda d: d["code"]["main"].update(sha256="0" * 64)), "code.main")
        def wrong_source(doc):
            doc["sources"][0]["sha256Before"] = doc["sources"][0]["sha256After"] = "1" * 64
        self.assertRejected(self.changed(wrong_source), "sources[0]")

    def test_a_tampered_vendored_validator_is_a_pack_defect(self):
        target = os.path.join(self.workspace, "flow", "libinsight_analysis", "vendor", "libinsight", "insight_result.py")
        with open(target, "a") as stream:
            stream.write("\n# tampered\n")
        self.assertRejected(None, "Pack defect, not repairable in this task")

    def test_a_design_file_changed_during_the_run_is_refused(self):
        self.deliver(needs=("facts", "design"), design=True)
        with open(self.paths["timing_report"], "a") as stream:
            stream.write("\n")
        self.assertRejected(None, "changed while the analysis ran")

    def test_check_delivery_defers_to_the_reader_on_an_old_python(self):
        with open(os.path.join(self.private, "analysis-result.json"), "rb") as stream:
            size = len(stream.read())
        prepared = common.read_json_file(self.paths["prepared"], "prepared")
        prepared_data = common.read_json_file(self.paths["data"], "prepared data")
        found, deferred = delivery.insight_problems(self.doc, self.private, prepared, prepared_data, size)
        self.assertEqual((found, deferred), ([], None), "the validator runs here, as in the resident's Python 3.6")
        saved = dict(vendored.MIN_PYTHON)
        vendored.MIN_PYTHON["insight_result"] = (99, 0)
        try:
            found, deferred = delivery.insight_problems(self.doc, self.private, prepared, prepared_data, size)
            self.assertEqual(found, [])
            self.assertIn("Python 99.0 or later", deferred)
            found, _ = delivery.insight_problems(self.doc, self.private, prepared, prepared_data, size, require_validator=True)
            self.assertTrue(any("Pack defect" in line for line in found))
        finally:
            vendored.MIN_PYTHON.clear()
            vendored.MIN_PYTHON.update(saved)

    def test_check_delivery_cli_accepts_the_private_result(self):
        cli = os.path.join(self.workspace, "flow", "libinsight_cli.py")
        check = subprocess.run([sys.executable, cli, "check-delivery", self.private, "analysis-result.json"], stdout=subprocess.PIPE)
        self.assertEqual(check.returncode, 0, check.stdout)
        self.assertTrue(check.stdout.startswith(b"accepted "))
        self.assertIn(b'"items": 3', check.stdout)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_insight_delivery.py'
```
Expected: FAIL (`can't open file '…/tools/read-insight.py'`).

- [ ] **Step 3: Add the insight checks to `delivery.py`**

In `packs/libinsight-analysis/flow/libinsight_analysis/delivery.py`, change the import line to `from . import common, vendored` and append:
```python
def _design_unchanged(prepared_data, current_sha, out):
    design = (prepared_data or {}).get("design") or {}
    for key in ("netlist", "timingReport"):
        item = design.get(key)
        if not item:
            continue
        try:
            now = current_sha(item["path"])
        except (OSError, common.LiaError) as error:
            out.append("design %s %s cannot be re-hashed: %s" % (key, item["path"], getattr(error, "detail", error)))
            continue
        if now != item["sha256"]:
            out.append("design %s %s changed while the analysis ran (prepared sha256 %s, now %s)" % (
                key, item["path"], item["sha256"], now))


def insight_problems(doc, root, prepared, prepared_data, byte_size, current_sha=common.sha256_file, require_validator=False):
    """(problems, deferred) for a hima-libinsight-insight/1 delivery.

    LibInsight's vendored validator checks the result and, given the prepared request, the root that resolves
    code paths, the delivered byte size and the hash function, everything the 0.1 Reader checked (sources bound
    to the prepared request and re-hashed, code files on disk, run, datasets, nulls, size). The Pack adds what
    only this Run knows: the rule the person confirmed and the design files prepare-data hashed. `deferred`
    says why the validator did not run here, or is None when it ran."""
    if not isinstance(doc, dict) or doc.get("schema") != common.INSIGHT_SCHEMA:
        found = doc.get("schema") if isinstance(doc, dict) else None
        return ["schema must be %s, not %r; this Pack admits insight results (see insight-result-contract.md)" % (
            common.INSIGHT_SCHEMA, found)], None
    out = []
    confirmed = (prepared.get("rule") or {}).get("id")
    if doc.get("id") != confirmed:
        out.append("id %r must be the rule the person confirmed: %s" % (doc.get("id"), confirmed))
    _design_unchanged(prepared_data, current_sha, out)
    deferred = None
    try:
        validator = vendored.load("insight_result")
    except common.LiaError as error:
        if require_validator:
            out.append("Pack defect, not repairable in this task: %s" % error.detail)
        else:
            deferred = error.detail
    else:
        try:
            out.extend(str(problem) for problem in validator.validate(
                doc, prepared=prepared, root=root, byte_size=byte_size, current_sha=current_sha))
        except Exception as error:  # a crash of the validator is the Pack's problem, never an acceptance
            out.append("Pack defect, not repairable in this task: LibInsight's validator failed: %s: %s" % (
                type(error).__name__, error))
    seen, unique = set(), []
    for line in out:
        if line not in seen:
            seen.add(line)
            unique.append(line)
    return unique, deferred


def insight_measures(doc):
    """Counts the Reader emits for an accepted insight result."""
    items = doc["datasets"].get(doc["items"]["dataset"], {}).get("rows", [])
    charts = len(doc["library"].get("charts", [])) + len(doc["items"].get("charts", []))
    return {"items": len(items), "actions": len(doc["actions"]), "charts": charts, "datasets": len(doc["datasets"])}
```

- [ ] **Step 4: Write the Reader**

`packs/libinsight-analysis/tools/read-insight.py`:
```python
#!/usr/bin/env python3
"""Fail-closed Reader for hima-libinsight-insight/1 deliveries (reader id `libinsight-insight`, ADR-0022).

argv (readers/libinsight-insight.yml): [/usr/bin/python3, READER, REPORT, OUT, WORKSPACE]

The Host ships only this file into `<WORKSPACE>/hima-readers/<effect>/`, so the checks are imported from
the Campaign's deployed `<WORKSPACE>/flow/libinsight_analysis` package: the Pack's own checks (files,
hashes, the confirmed rule) and LibInsight's validator, vendored at the commit in
`flow/libinsight_analysis/vendor/VENDOR.json` and verified by SHA-256 before it is imported. The Reader
runs on the Site host's /usr/bin/python3 and never accepts without the validator.

On acceptance OUT receives `{"values": [...]}` with li_insight_error_count 0. On any problem this script
writes no OUT, writes the problems beside REPORT and to WORKSPACE/state/analysis-result.problems.txt,
prints them on stderr and exits 1: a non-zero Reader becomes the same-task repair message.
"""
import json
import os
import sys


def _write(path, text):
    try:
        parent = os.path.dirname(path)
        if parent and not os.path.isdir(parent):
            os.makedirs(parent)
        with open(path, "w", encoding="utf-8") as stream:
            stream.write(text)
    except OSError:
        pass


def main(argv):
    if len(argv) != 4:
        sys.stderr.write("usage: read-insight.py REPORT OUT WORKSPACE\n")
        return 2
    report, out, workspace = argv[1], argv[2], os.path.abspath(argv[3])
    sys.path.insert(0, os.path.join(workspace, "flow"))
    from libinsight_analysis import common, delivery

    problems_file = os.path.join(workspace, common.PROBLEMS_PATH)
    try:
        prepared = common.read_json_file(os.path.join(workspace, common.PREPARED_PATH), "prepared request")
        if prepared.get("schema") != common.PREPARED_SCHEMA_V2:
            raise common.LiaError("invalid-input", "prepared request has schema %r" % prepared.get("schema"))
        prepared_data = common.read_json_file(os.path.join(workspace, common.PREPARED_DATA_PATH), "prepared data")
        doc, data = delivery.load_result(os.path.abspath(report))
        found, _ = delivery.insight_problems(doc, workspace, prepared, prepared_data, len(data), require_validator=True)
        digest = common.sha256_bytes(data)
    except common.LiaError as error:
        found, digest = [error.detail], None
    if found:
        text = "REJECTED delivery %s\n%s\n" % (digest or "(unreadable)", "\n".join("- " + line for line in found))
        _write(report + ".problems.txt", text)
        _write(problems_file, text)
        sys.stderr.write("libinsight-insight Reader rejected the delivery (%d problems; also in %s):\n%s" % (
            len(found), problems_file, text))
        return 1
    counts = delivery.insight_measures(doc)
    values = [
        {"type": "li_insight_error_count", "unit": "count", "value": 0},
        {"type": "li_insight_item_count", "unit": "count", "value": counts["items"]},
        {"type": "li_insight_action_count", "unit": "count", "value": counts["actions"]},
        {"type": "li_insight_chart_count", "unit": "count", "value": counts["charts"]},
    ]
    _write(problems_file, "ACCEPTED delivery %s\n" % digest)
    with open(out, "w", encoding="utf-8") as stream:
        stream.write(json.dumps({"values": values}, sort_keys=True, allow_nan=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

`packs/libinsight-analysis/readers/libinsight-insight.yml`:
```yaml
id: libinsight-insight
version: "1"
file: tools/read-insight.py
argv: [/usr/bin/python3, '${READER}', '${REPORT}', '${OUT}', '${WORKSPACE}']
reportKind: hima-libinsight-insight/1
emits:
  - li_insight_error_count
  - li_insight_item_count
  - li_insight_action_count
  - li_insight_chart_count
```

`packs/libinsight-analysis/rules/insight-delivery-ready.yml`:
```yaml
id: insight-delivery-ready
version: "1"
title: The resident delivered an insight result that LibInsight's validator and the Pack checks accept
requires: [{ type: li_insight_error_count }]
subject: { type: li_insight_error_count }
predicate: { op: eq, threshold: 0, unit: count }
values:
  li_insight_error_count:
    unit: count
    description: Delivery problems found by the libinsight-insight Reader (Pack checks and LibInsight's own validator). It is emitted only as 0, because any problem fails the Reader closed and returns the problems to the same resident task.
  li_insight_item_count:
    unit: count
    description: Rows of the accepted result's item list.
  li_insight_action_count:
    unit: count
    description: Typed actions in the accepted result.
  li_insight_chart_count:
    unit: count
    description: Library and item charts in the accepted result.
```

Append to `packs/libinsight-analysis/semantics.yml` (under `values:`):
```yaml
  li_insight_error_count:
    unit: count
    description: Delivery problems found by the libinsight-insight Reader (Pack checks and LibInsight's own validator). It is emitted only as 0, because any problem fails the Reader closed and returns the problems to the same resident task.
  li_insight_item_count:
    unit: count
    description: Rows of the accepted result's item list.
  li_insight_action_count:
    unit: count
    description: Typed actions in the accepted result.
  li_insight_chart_count:
    unit: count
    description: Library and item charts in the accepted result.
```

- [ ] **Step 5: Let `check-delivery` read insight results**

In `packs/libinsight-analysis/flow/libinsight_cli.py`, replace `check_delivery` with:
```python
def check_delivery(argv):
    if not 1 <= len(argv) <= 4:
        return _fail("usage", "check-delivery ROOT [RESULT] [PREPARED] [PREPARED_DATA]", 2)
    root = os.path.abspath(argv[0])
    if len(argv) >= 2:
        result = argv[1] if os.path.isabs(argv[1]) else os.path.join(root, argv[1])
    else:
        result = os.path.join(root, "analysis-result.json")
        if not os.path.exists(result):
            result = os.path.join(root, common.RESULT_PATH)
    campaign = os.path.dirname(FLOW)
    prepared_path = argv[2] if len(argv) >= 3 else os.path.join(campaign, common.PREPARED_PATH)
    data_path = argv[3] if len(argv) == 4 else os.path.join(campaign, common.PREPARED_DATA_PATH)
    try:
        prepared = common.read_json_file(os.path.abspath(prepared_path), "prepared request")
        doc, data = delivery.load_result(os.path.abspath(result))
    except common.LiaError as error:
        print(error.detail)
        return 1
    if isinstance(doc, dict) and doc.get("schema") == common.INSIGHT_SCHEMA:
        try:
            prepared_data = common.read_json_file(os.path.abspath(data_path), "prepared data")
        except common.LiaError as error:
            print(error.detail)
            return 1
        found, deferred = delivery.insight_problems(doc, root, prepared, prepared_data, len(data))
        if found:
            for line in found:
                print(line)
            return 1
        note = "" if deferred is None else " (LibInsight's format checks run in the Reader: %s)" % deferred
        print("accepted %s sha256 %s: %s%s" % (result, common.sha256_bytes(data), json.dumps(delivery.insight_measures(doc), sort_keys=True), note))
        return 0
    found = delivery.problems(doc, root, prepared, len(data))
    if found:
        for line in found:
            print(line)
        return 1
    print("accepted %s sha256 %s: %s" % (result, common.sha256_bytes(data), json.dumps(delivery.measures(doc), sort_keys=True)))
    return 0
```
and change the docstring line `libinsight_cli.py check-delivery ROOT [RESULT] [PREPARED]` to `libinsight_cli.py check-delivery ROOT [RESULT] [PREPARED] [PREPARED_DATA]`.

- [ ] **Step 6: Run all Pack tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'
```
Expected: PASS (new Reader tests and the unchanged `/1` tests).

- [ ] **Step 7: Commit and push**

```bash
git add packs/libinsight-analysis/flow/libinsight_analysis/delivery.py packs/libinsight-analysis/flow/libinsight_cli.py packs/libinsight-analysis/tools/read-insight.py packs/libinsight-analysis/readers/libinsight-insight.yml packs/libinsight-analysis/rules/insight-delivery-ready.yml packs/libinsight-analysis/semantics.yml packs/libinsight-analysis/flow/tests/test_insight_delivery.py
git commit -m "feat(libinsight): insight Reader runs LibInsight's validator; rule insight-delivery-ready

Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---
### Task 7: Reference rules I — `size_coverage_gaps` and `vmin_bottleneck`

**Files:**
- Create: `packs/libinsight-analysis/flow/reference_rules/catalog.json`
- Create: `packs/libinsight-analysis/flow/reference_rules/size_coverage_gaps.py`
- Create: `packs/libinsight-analysis/flow/reference_rules/vmin_bottleneck.py`
- Modify: `packs/libinsight-analysis/flow/tests/synthetic_kit.py` (catalogue, reference setup)
- Create: `packs/libinsight-analysis/flow/tests/make_reference_results.py`
- Create: `packs/libinsight-analysis/flow/tests/test_reference_rules.py`
- Create (generated): `packs/libinsight-analysis/flow/reference_results/size_coverage_gaps.json`, `vmin_bottleneck.json`

**Interfaces:**
- Consumes: `insight_builder` (Task 3), `synthetic_kit.prepared` (Task 5), `vendored.load("insight_result")` (`validate`), `vendored.load("insight_actions")` (P1a: `generate(result, action_index, *, selection=None, now=None) -> {"filename","media_type","content"}`, `redesign_brief(result, action) -> str`). Result shapes: P1a "Normative details" (chart encodings incl. compound `gap`/`missing`/`class_box`; action `targets`/`params`; `redesign_cell` symptoms `low_voltage_slowdown`, `missing_size`, `slower_than_equivalent` and their lever kinds; devices exactly `{name, type, w_um, l_um, fingers, stack_pos, stack_depth}`; subjects incl. `… :: fn:<function>` and `design:<d> :: path:<p>/stage:<n>`; source kinds `facts`, `cell_netlist`, `design_netlist`, `timing_report`).
- Produces:
  - `flow/reference_rules/catalog.json` (`hima-libinsight-rule-catalog/1`): `rules[] = {id, title, sentence, dimension, needs[], data, parameters[{name,value,meaning}], example, script}` — the one source for the four rules (Task 12 tests the knowledge and the contract `offers` against it).
  - Rule scripts: `python3 analysis/<rule>.py --prepared P --data D [--out analysis-result.json] [--candidate resident-delivery.json] [--version N] [--main analysis/<rule>.py] [--builder analysis/insight_builder.py]`, Python 3.6, stdlib only.
  - `synthetic_kit.CATALOG`, `REFERENCE_RULES`, `REFERENCE_SETUP`, `catalog_rule(rule_id, overrides=None) -> rule dict`, `reference_result(base, rule_id) -> result dict`.

- [ ] **Step 1: Write the rule catalogue**

`packs/libinsight-analysis/flow/reference_rules/catalog.json`:
```json
{
  "schema": "hima-libinsight-rule-catalog/1",
  "rules": [
    {
      "id": "vmin_bottleneck",
      "title": "Vmin bottlenecks",
      "sentence": "A cell is a Vmin bottleneck when its delay grows from the nominal supply to the lowest supply by more than the reference inverter's does, plus a watch level of 5 %.",
      "dimension": "robustness",
      "needs": ["facts", "netlists"],
      "data": "Liberty facts of each variant at its lowest and its nominal supply, at every temperature; the cell netlists for the redesign brief.",
      "parameters": [{"name": "watch", "value": 0.05, "meaning": "extra slowdown over the reference inverter that flags a cell (0.05 is 5 %)"}],
      "example": "Which cells limit my Vmin in the SAED14 library?",
      "script": "flow/reference_rules/vmin_bottleneck.py"
    },
    {
      "id": "size_coverage_gaps",
      "title": "Size coverage gaps",
      "sentence": "A function has a size gap when two neighbouring drive strengths in one variant are more than 2.5 times apart, so a design must over- or under-size cells there.",
      "dimension": "ppa",
      "needs": ["facts"],
      "data": "Liberty facts of every variant at one corner.",
      "parameters": [{"name": "jump", "value": 2.5, "meaning": "drive ratio between neighbouring sizes that counts as a gap"}],
      "example": "Where are the size gaps in SAED14, by track and VT?",
      "script": "flow/reference_rules/size_coverage_gaps.py"
    },
    {
      "id": "table_spikes_kinks",
      "title": "Table spikes and kinks",
      "sentence": "A timing table has a spike or kink when one value differs by more than 10 % from the straight line between its neighbours at their real slew or load values.",
      "dimension": "quality",
      "needs": ["facts"],
      "data": "Liberty facts of the variants and corners to check.",
      "parameters": [{"name": "threshold", "value": 0.1, "meaning": "distance from the neighbours' straight line that flags a value (0.1 is 10 %)"},
                     {"name": "max_items", "value": 300, "meaning": "how many of the worst tables are listed"}],
      "example": "Find spikes and kinks in the SAED14 timing tables.",
      "script": "flow/reference_rules/table_spikes_kinks.py"
    },
    {
      "id": "critical_path_faster_cells",
      "title": "Faster cells on critical paths",
      "sentence": "A cell on a critical path has a faster swap when an equivalent cell of the same function and track is at least 3 % faster at that instance's own load and input slew.",
      "dimension": "none",
      "needs": ["facts", "design"],
      "data": "The design's timing report and netlist, and Liberty facts at the report's corner for every variant of the design's track.",
      "parameters": [{"name": "margin", "value": 0.03, "meaning": "how much faster an equivalent must be to count (0.03 is 3 %)"},
                     {"name": "corner", "value": "", "meaning": "the Kit corner the timing report was made at"},
                     {"name": "design_variant", "value": "", "meaning": "the variant of the design's cells, when cell names do not say it"}],
      "example": "On my design's worst paths, which cells have faster equivalents I could swap in?",
      "script": "flow/reference_rules/critical_path_faster_cells.py"
    }
  ]
}
```

- [ ] **Step 2: Add the catalogue helpers to the synthetic Kit**

Append to `packs/libinsight-analysis/flow/tests/synthetic_kit.py`:
```python
CATALOG = os.path.join(FLOW, "reference_rules", "catalog.json")
REFERENCE_RULES = ("vmin_bottleneck", "size_coverage_gaps", "table_spikes_kinks", "critical_path_faster_cells")
REFERENCE_SETUP = {
    "vmin_bottleneck": {"needs": ("facts", "netlists")},
    "size_coverage_gaps": {"corners": ("0p80v125c",)},
    "table_spikes_kinks": {"corners": ("0p80v125c", "0p60vm40c")},
    "critical_path_faster_cells": {"corners": (DESIGN_CORNER,), "needs": ("facts", "design"), "design": True,
                                   "parameters": {"corner": DESIGN_CORNER, "design_variant": DESIGN_VARIANT}},
}


def catalog_rule(rule_id, overrides=None):
    """The request rule {id, title, sentence, parameters} of one catalogue rule, with parameter overrides."""
    with open(CATALOG) as stream:
        catalog = json.load(stream)
    for rule in catalog["rules"]:
        if rule["id"] == rule_id:
            parameters = [dict(item, value=(overrides or {}).get(item["name"], item["value"])) for item in rule["parameters"]]
            return {"id": rule["id"], "title": rule["title"], "sentence": rule["sentence"], "parameters": parameters}
    raise KeyError(rule_id)


def reference_result(base, rule_id):
    """Run one reference rule on the synthetic Kit, as the resident would; returns the result."""
    setup = REFERENCE_SETUP[rule_id]
    paths = prepared(base, catalog_rule(rule_id, setup.get("parameters")), corners=setup.get("corners", ()),
                     needs=setup.get("needs", ("facts",)), design=setup.get("design", False))
    script = os.path.join(FLOW, "reference_rules", rule_id + ".py")
    return run_rule(os.path.join(base, "private"), script, paths["prepared"], paths["data"])
```

- [ ] **Step 3: Write the failing test**

`packs/libinsight-analysis/flow/tests/test_reference_rules.py`:
```python
"""The reference rules on the synthetic Kit: LibInsight's validator accepts them, their findings are the
injected ones, every action generates its file, and the committed reference results are reproduced."""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from libinsight_analysis import vendored  # noqa: E402
import synthetic_kit  # noqa: E402

RESULTS = os.path.join(synthetic_kit.FLOW, "reference_results")
IGNORED = ("sources", "run")


def rows(doc, name):
    dataset = doc["datasets"][name]
    names = [column["name"] for column in dataset["columns"]]
    return [dict(zip(names, row)) for row in dataset["rows"]]


@unittest.skipIf(sys.version_info[:2] < (3, 9), "prepare-data's netlist reader and LibInsight's generators need Python 3.9+")
class ReferenceRules(unittest.TestCase):
    RULES = ("size_coverage_gaps", "vmin_bottleneck")

    @classmethod
    def setUpClass(cls):
        cls.base = os.path.realpath(tempfile.mkdtemp())
        cls.results = dict((rule, synthetic_kit.reference_result(os.path.join(cls.base, rule), rule)) for rule in cls.RULES)
        cls.validate = staticmethod(vendored.load("insight_result").validate)
        cls.actions = vendored.load("insight_actions")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.base)

    def test_libinsight_accepts_every_reference_result(self):
        for rule, doc in self.results.items():
            self.assertEqual(self.validate(doc), [], rule)
            self.assertEqual(doc["id"], rule)

    def test_every_action_generates_its_file(self):
        for rule, doc in self.results.items():
            for index, action in enumerate(doc["actions"]):
                selection = None
                if action["targets"].get("selection") is True:
                    selection = [row["subject"] for row in rows(doc, action["targets"]["dataset"])][:1]
                made = self.actions.generate(doc, index, selection=selection, now="2026-10-08T12:00:00Z")
                self.assertTrue(made["filename"], (rule, action["kind"]))
                self.assertIn(rule, made["content"], (rule, action["kind"]))

    def test_size_gaps_find_the_missing_nand2_x4_in_9_track_only(self):
        doc = self.results["size_coverage_gaps"]
        gaps = rows(doc, "gaps")
        self.assertEqual(sorted(gap["variant"] for gap in gaps), ["9t_hvt", "9t_rvt"])
        for gap in gaps:
            self.assertEqual((gap["below"], gap["above"]), ("NAND2X2", "NAND2X8"))
            self.assertAlmostEqual(gap["jump"], 4.0, places=2)
            self.assertTrue(gap["subject"].endswith(":: fn:NAND2"))
        self.assertEqual([a["kind"] for a in doc["actions"]], ["roadmap_gap", "redesign_cell"])
        self.assertEqual(doc["actions"][1]["params"]["symptom"], "missing_size")
        self.assertEqual(doc["score"]["dimension"], "ppa")
        self.assertEqual(len(rows(doc, "matrix")), 4)

    def test_vmin_flags_series_stacks_never_the_inverter(self):
        doc = self.results["vmin_bottleneck"]
        flagged = rows(doc, "flagged")
        self.assertTrue(any(row["cell"] == "NOR3X1" for row in flagged))
        self.assertTrue(all(row["cell"].startswith(("NOR", "AOI")) for row in flagged), flagged)
        self.assertFalse([row for row in rows(doc, "all_cells") if row["cell"].startswith("INV") and row["role"] == "problem"])
        self.assertEqual([a["kind"] for a in doc["actions"]], ["derate", "dont_use", "redesign_cell"])
        self.assertEqual(doc["score"]["dimension"], "robustness")
        self.assertIn("cell_netlist", [source["kind"] for source in doc["sources"]])

    def test_vmin_redesign_brief_names_the_devices_of_the_arc(self):
        doc = self.results["vmin_bottleneck"]
        action = [a for a in doc["actions"] if a["kind"] == "redesign_cell"][0]
        self.assertTrue(action["params"]["cell"].startswith("NOR3"))
        self.assertEqual(action["params"]["symptom"], "low_voltage_slowdown")
        names = [device["name"] for device in action["params"]["circuit"]]
        self.assertTrue(names, "the arc's devices come from the synthetic netlist")
        self.assertTrue(any(name.startswith("MP") for name in names), names)
        brief = self.actions.redesign_brief(doc, action)
        for name in names:
            self.assertIn(name, brief)

    def test_committed_reference_results_are_reproduced(self):
        for rule, doc in self.results.items():
            with open(os.path.join(RESULTS, rule + ".json"), encoding="utf-8") as stream:
                committed = json.load(stream)
            for key in doc:
                if key not in IGNORED:
                    self.assertEqual(committed[key], doc[key], "%s.%s differs; run make_reference_results.py" % (rule, key))
            with open(os.path.join(synthetic_kit.FLOW, "reference_rules", rule + ".py"), encoding="utf-8") as stream:
                self.assertEqual(committed["code"]["main"]["text"], stream.read())
            self.assertEqual(self.validate(committed), [], rule)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 4: Run it to verify it fails**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_reference_rules.py'
```
Expected: ERROR in `setUpClass` (`…/reference_rules/size_coverage_gaps.py` not found).

- [ ] **Step 5: Write `size_coverage_gaps.py`**

`packs/libinsight-analysis/flow/reference_rules/size_coverage_gaps.py`:
```python
#!/usr/bin/env python3
"""size_coverage_gaps: functions whose neighbouring drive strengths in one variant are more than `jump`
times apart. Drive is measured, not read from names: it is the inverse of the delay slope against load,
relative to the weakest size. Python 3.6+, no numpy; reads the prepared facts (one corner per variant)."""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(os.path.dirname(HERE), "libinsight_analysis")]
import insight_builder as ib  # noqa: E402

RULE = "size_coverage_gaps"
CSV_COLUMNS = dict((name, name) for name in ("function", "variant", "below", "above", "jump", "suggested_drive", "suggested_area"))


def slope(library, cell):
    """(delay increase per unit load at the middle slew, input pin, output pin) of the first usable arc."""
    for pin, timing in ib.arcs(cell):
        item = ib.table(timing, "cell_rise")
        if item is None:
            continue
        slews, loads, value = ib.grid(library, item)
        middle = len(slews) // 2
        first, last = value(middle, 0), value(middle, len(loads) - 1)
        if first is None or last is None or loads[-1] <= loads[0]:
            continue
        result = (last - first) / (loads[-1] - loads[0])
        if result > 0:
            return result, timing.get("related_pin", ""), pin["name"]
    return None, None, None


def choose_entries(data, sources, corner):
    """One facts file per variant: the named corner, else the highest supply at the highest temperature."""
    by_variant = {}
    for entry in ib.facts_entries(data, corners=[corner] if corner else None):
        by_variant.setdefault(entry.get("variant") or "-", []).append(entry)
    chosen = {}
    for variant, entries in sorted(by_variant.items()):
        if len(entries) == 1:
            chosen[variant] = entries[0]
            continue
        best = None
        for entry in entries:
            point = ib.operating_point(sources.load(entry))
            if best is None or point > best[0]:
                best = (point, entry)
        chosen[variant] = best[1]
    return chosen


def main(argv=None):
    started = time.time()
    args = ib.arguments(RULE, __doc__).parse_args(argv)
    prepared, data = ib.read_json(args.prepared), ib.read_json(args.data)
    limit = float(ib.parameter(prepared, "jump", 2.5))
    kit = prepared.get("kit") or {}
    sources = ib.Sources()
    chosen = choose_entries(data, sources, str(ib.parameter(prepared, "corner", "")))
    gaps, ladder, matrix, checked = [], [], {}, 0
    for variant, entry in sorted(chosen.items()):
        library = sources.load(entry)["library"]
        track, vt = ib.split_variant(variant)
        matrix.setdefault((track, vt), 0)
        groups = {}
        for cell in library["cells"]:
            measured, input_pin, output_pin = slope(library, cell)
            if measured is None:
                continue
            groups.setdefault(ib.function_of(cell), []).append(
                {"cell": cell["name"], "slope": measured, "area": float(cell["area"]), "input": input_pin, "output": output_pin,
                 "function": cell.get("footprint") or ib.function_of(cell).split("|")[0]})
        for signature, sizes in sorted(groups.items()):
            if len(sizes) < 2:
                continue
            checked += 1
            weakest = max(size["slope"] for size in sizes)
            for size in sizes:
                size["drive"] = weakest / size["slope"]
            sizes.sort(key=lambda size: (size["drive"], size["cell"]))
            found = [(above["drive"] / below["drive"], below, above) for below, above in zip(sizes, sizes[1:])
                     if above["drive"] / below["drive"] > limit]
            if not found:
                continue
            jump, below, above = max(found, key=lambda gap: gap[0])
            suggested = (below["drive"] * above["drive"]) ** 0.5
            area = below["area"] + (above["area"] - below["area"]) * (suggested - below["drive"]) / (above["drive"] - below["drive"])
            item = "%s %s" % (below["function"], variant)
            pre = ib.prefix(kit.get("name"), kit.get("release"), variant, "*")
            gaps.append([item, variant, track, vt, below["function"], below["cell"], above["cell"], ib.r6(below["drive"]),
                         ib.r6(above["drive"]), ib.r6(jump), ib.r6(suggested), ib.r6(area),
                         ib.function_subject(pre, below["function"]),
                         "%s in %s jumps %.1f times from %s to %s; a %.1fx size would fill the gap." % (
                             below["function"], variant, jump, below["cell"], above["cell"], suggested),
                         below["input"], below["output"], ib.r6(below["area"]), ib.r6(above["area"])])
            matrix[(track, vt)] += 1
            for size in sizes:
                ladder.append([item, size["cell"], ib.r6(size["drive"]), ib.r6(size["area"]), "other",
                               ib.r6(below["drive"]), ib.r6(above["drive"]), ib.r6(suggested), ib.r6(area)])
    gaps.sort(key=lambda row: (-row[9], row[0]))
    datasets = {
        "gaps": ib.dataset([ib.column("item", "string"), ib.column("variant", "string"), ib.column("track", "string"),
                            ib.column("vt", "string"), ib.column("function", "string"), ib.column("below", "string"),
                            ib.column("above", "string"), ib.column("below_drive", "number", "x"),
                            ib.column("above_drive", "number", "x"), ib.column("jump", "number", "x"),
                            ib.column("suggested_drive", "number", "x"), ib.column("suggested_area", "number", "um2"),
                            ib.column("subject", "string"), ib.column("text", "string"), ib.column("input", "string"),
                            ib.column("output", "string"), ib.column("below_area", "number", "um2"),
                            ib.column("above_area", "number", "um2")], gaps),
        "ladder": ib.dataset([ib.column("item", "string"), ib.column("cell", "string"), ib.column("drive", "number", "x"),
                              ib.column("area", "number", "um2"), ib.column("role", "string"),
                              ib.column("gap_low", "number", "x"), ib.column("gap_high", "number", "x"),
                              ib.column("missing_drive", "number", "x"), ib.column("missing_area", "number", "um2")], ladder),
        "matrix": ib.dataset([ib.column("track", "string"), ib.column("vt", "string"), ib.column("gaps", "number")],
                             [[track, vt, count] for (track, vt), count in sorted(matrix.items())]),
        "widest": ib.dataset([ib.column("label", "string"), ib.column("jump", "number", "x")], [[row[0], row[9]] for row in gaps[:10]]),
    }
    actions = [ib.action("roadmap_gap", "Add the missing sizes to the roadmap", "library_provider",
                         "Designs must over- or under-size cells where a function's sizes are far apart.",
                         [ib.impact("Functions with a gap", len(gaps))], ib.rows_target("gaps", "item"),
                         {"columns": CSV_COLUMNS})]
    if gaps:
        top = gaps[0]
        actions.append(ib.action(
            "redesign_cell", "Add a %.1fx %s in %s" % (top[10], top[4], top[1]), "cell_designer", top[13],
            [ib.impact("Drive ratio between neighbours", top[9], "x")],
            ib.rows_target("gaps", "below", {"column": "item", "equals": top[0]}),
            {"cell": top[5], "arc": ib.arc_param(top[14], top[15]), "symptom": "missing_size", "metric": "drive strength",
             "now": None, "target": top[10], "unit": "x",
             "reference": "the geometric mean of %s and %s" % (top[5], top[6]),
             "siblings": [ib.sibling(top[5], drive=top[7], area=top[16]), ib.sibling(top[6], drive=top[8], area=top[17])],
             "levers": [ib.lever("add_size", "Add a %.1fx %s by interpolating the device widths of %s and %s." % (
                 top[10], top[4], top[5], top[6]), ib.effect(top[11], "um2", "area interpolated linearly in drive"))],
             "evidence": [ib.evidence("Drive ratio of the gap", "gaps", "jump", "item", top[0])]}))
    headline = "%d of %d functions have a size gap wider than %.1fx" % (len(gaps), checked, limit)
    parts = {
        "rule": ib.rule_block(prepared, ib.scope(prepared, list(chosen), [e.get("corner") for e in chosen.values()])),
        "summary": "%s. The widest is %s." % (headline, gaps[0][0] if gaps else "none"),
        "datasets": datasets,
        "library": ib.library_block(headline, checked, len(gaps), "functions",
                                    [ib.fact("Functions with two or more sizes", checked), ib.fact("Functions with a gap", len(gaps)),
                                     ib.fact("Gap limit", limit, "x"), ib.fact("Variants", len(chosen))],
                                    [ib.chart("gaps-by-track-vt", "Gaps by track and VT", "matrix", "matrix", row="track", col="vt", value="gaps"),
                                     ib.chart("widest-gaps", "Widest gaps", "bar", "widest", x="label", y="jump")]),
        "items": ib.items_block("gaps", "item", "item", "jump", "desc",
                                [ib.chart("size-ladder", "Sizes of this function", "ladder", "ladder", item_key="item",
                                          x="drive", y="area", label="cell", role="role",
                                          gap={"from": "gap_low", "to": "gap_high"},
                                          missing={"x": "missing_drive", "y": "missing_area"})], text="text"),
        "actions": actions,
        "score": ib.score_block("ppa", len(gaps), checked),
        "assumptions": ["Drive is the inverse of the cell_rise slope against load at the middle slew, relative to the "
                        "weakest size of the function.",
                        "Cells with the same output functions and input pins are one function."],
        "limits": ["One corner per variant is read.", "Functions with a single size are not checked."],
    }
    ib.finish(args, started, prepared, sources, parts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 6: Write `vmin_bottleneck.py`**

`packs/libinsight-analysis/flow/reference_rules/vmin_bottleneck.py`:
```python
#!/usr/bin/env python3
"""vmin_bottleneck: cells whose delay grows from the nominal to the lowest supply more than the reference
inverter's does, by more than the watch level. Each temperature compares its own lowest and highest
supply; the reference is each variant's smallest inverter. Python 3.6+, no numpy; reads the prepared facts
and, when present, the netlist facts for the redesign brief."""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(os.path.dirname(HERE), "libinsight_analysis")]
import insight_builder as ib  # noqa: E402

RULE = "vmin_bottleneck"
TIMING_KEYS = ("related_pin", "timing_type", "timing_sense", "when")
DEVICE_KEYS = ("name", "type", "w_um", "l_um", "fingers", "stack_pos", "stack_depth")
QUANTILES = (("p5", 0.05), ("p25", 0.25), ("p50", 0.5), ("p75", 0.75), ("p95", 0.95))
MAX_ITEMS = 2000


def summarise(library):
    """{cell: {"function", "arcs": {label: (delay, pin, timing keys)}}} at each table's middle grid point."""
    cells = {}
    for cell in library["cells"]:
        arcs = {}
        for pin, timing in ib.arcs(cell):
            item = ib.table(timing, "cell_rise")
            if item is None:
                continue
            slews, loads, _ = ib.grid(library, item)
            delay = ib.arc_delay(library, timing, slews[len(slews) // 2], loads[len(loads) // 2])
            if delay is not None and delay > 0:
                arcs[ib.arc_label(pin, timing)] = (delay, pin["name"], dict((k, timing.get(k, "")) for k in TIMING_KEYS))
        if arcs:
            cells[cell["name"]] = {"function": ib.function_of(cell), "arcs": arcs}
    return cells


def is_inverter(signature):
    outputs, inputs = signature.split("|")
    names = inputs.split(",")
    if len(names) != 1 or ";" in outputs or "=" not in outputs:
        return False
    function = outputs.split("=", 1)[1].replace(" ", "")
    return function in ("!%s" % names[0], "!(%s)" % names[0], "(!%s)" % names[0], "%s'" % names[0])


def ratio(cells_low, cells_nom, cell, label=None):
    """Worst (or one arc's) low/nominal delay ratio of one cell; None when it is not in both corners."""
    if cell not in cells_low or cell not in cells_nom:
        return None
    labels = [label] if label else list(cells_nom[cell]["arcs"])
    values = [cells_low[cell]["arcs"][l][0] / cells_nom[cell]["arcs"][l][0] for l in labels
              if l in cells_low[cell]["arcs"] and l in cells_nom[cell]["arcs"]]
    return max(values) if values else None


def devices(netlist, cell, label):
    return [dict((key, device[key]) for key in DEVICE_KEYS) for device in netlist.get(cell, {}).get("arcs", {}).get(label, [])]


def main(argv=None):
    started = time.time()
    args = ib.arguments(RULE, __doc__).parse_args(argv)
    prepared, data = ib.read_json(args.prepared), ib.read_json(args.data)
    watch = float(ib.parameter(prepared, "watch", 0.05))
    kit = prepared.get("kit") or {}
    sources = ib.Sources()
    conditions = {}  # (variant, temperature) -> {voltage: (corner, cells)}
    for entry in ib.facts_entries(data):
        facts = sources.load(entry)
        voltage, temperature = ib.operating_point(facts)
        conditions.setdefault((entry.get("variant") or "-", temperature), {})[voltage] = (entry.get("corner") or "-", summarise(facts["library"]))
        del facts
    worst = {}
    for (variant, temperature), by_voltage in sorted(conditions.items()):
        if len(by_voltage) < 2:
            continue
        low_v, nom_v = min(by_voltage), max(by_voltage)
        (low_corner, low_cells), (nom_corner, nom_cells) = by_voltage[low_v], by_voltage[nom_v]
        inverters = [(max(arc[0] for arc in info["arcs"].values()), name) for name, info in nom_cells.items()
                     if is_inverter(info["function"]) and name in low_cells]
        if not inverters:
            continue
        reference = max(inverters)[1]
        reference_ratio = ratio(low_cells, nom_cells, reference)
        for name, info in sorted(nom_cells.items()):
            pairs = [(low_cells[name]["arcs"][label][0] / info["arcs"][label][0], label) for label in info["arcs"]
                     if name in low_cells and label in low_cells[name]["arcs"]]
            if not pairs:
                continue
            value, label = max(pairs)
            excess = value / reference_ratio - 1.0
            key = (variant, name)
            if key not in worst or excess > worst[key]["excess"]:
                worst[key] = {"variant": variant, "cell": name, "function": info["function"], "arc": label, "ratio": value,
                              "reference": reference, "reference_ratio": reference_ratio, "excess": excess,
                              "temperature": temperature, "low": low_v, "nominal": nom_v, "corner": low_corner,
                              "corners": [low_corner, nom_corner], "pin": info["arcs"][label][1], "timing": info["arcs"][label][2]}
    netlist = {}
    if data.get("netlistFacts"):
        campaign = os.path.dirname(os.path.dirname(os.path.abspath(args.data)))
        with open(os.path.join(campaign, data["netlistFacts"]["path"]), "rb") as stream:
            facts_of_netlists = json.loads(stream.read().decode("utf-8"))
        for item in facts_of_netlists["netlists"]:
            sources.add_file(item["path"], "cell_netlist", item["sha256"])
        netlist = facts_of_netlists["cells"]
    flagged = [row for row in worst.values() if row["excess"] > watch]
    flagged.sort(key=lambda row: (-round(row["excess"], 9), 0 if row["cell"] in netlist else 1, row["variant"], row["cell"]))
    listed = flagged[:MAX_ITEMS]
    all_rows, flagged_rows, fan_rows = [], [], []
    for row in sorted(worst.values(), key=lambda r: (r["variant"], r["cell"])):
        pre = ib.prefix(kit.get("name"), kit.get("release"), row["variant"], row["corner"])
        all_rows.append(["%s/%s" % (row["variant"], row["cell"]), row["variant"], row["cell"], ib.pct(row["excess"]),
                         "problem" if row["excess"] > watch else "other", ib.cell_subject(pre, row["cell"])])
    for row in listed:
        key = "%s/%s" % (row["variant"], row["cell"])
        pre = ib.prefix(kit.get("name"), kit.get("release"), row["variant"], row["corner"])
        flagged_rows.append([key, row["variant"], row["cell"], row["arc"], row["temperature"], row["low"], row["nominal"],
                             ib.r6(row["ratio"]), row["reference"], ib.r6(row["reference_ratio"]), ib.pct(row["excess"]),
                             ib.arc_subject(pre, row["cell"], row["pin"], row["timing"]),
                             "%s on %s slows %.1f %% more than %s from %.2f V to %.2f V at %g C." % (
                                 row["cell"], row["arc"], 100 * row["excess"], row["reference"], row["nominal"], row["low"],
                                 row["temperature"])])
        order = 0
        for temperature in sorted(t for (v, t) in conditions if v == row["variant"]):
            by_voltage = conditions[(row["variant"], temperature)]
            nom_cells = by_voltage[max(by_voltage)][1]
            siblings = [name for name, info in nom_cells.items() if info["function"] == row["function"]]
            for voltage in sorted(by_voltage):
                cells_v = by_voltage[voltage][1]
                peers = [v for v in (ratio(cells_v, nom_cells, name) for name in siblings) if v is not None]
                fan_rows.append([key, row["cell"], "%.2f V, %g C" % (voltage, temperature), order,
                                 ib.r6(ratio(cells_v, nom_cells, row["cell"], row["arc"])),
                                 ib.r6(ratio(cells_v, nom_cells, row["reference"]))]
                                + [ib.r6(ib.quantile(peers, q)) for _, q in QUANTILES])
                order += 1
    datasets = {
        "all_cells": ib.dataset([ib.column("item", "string"), ib.column("variant", "string"), ib.column("cell", "string"),
                                 ib.column("excess_pct", "number", "%"), ib.column("role", "string"),
                                 ib.column("subject", "string")], all_rows),
        "flagged": ib.dataset([ib.column("item", "string"), ib.column("variant", "string"), ib.column("cell", "string"),
                               ib.column("arc", "string"), ib.column("temperature", "number", "C"),
                               ib.column("low_supply", "number", "V"), ib.column("nominal_supply", "number", "V"),
                               ib.column("ratio", "number", "x"), ib.column("reference", "string"),
                               ib.column("reference_ratio", "number", "x"), ib.column("excess_pct", "number", "%"),
                               ib.column("subject", "string"), ib.column("text", "string")], flagged_rows),
        "fan": ib.dataset([ib.column("item", "string"), ib.column("cell", "string"), ib.column("condition", "string"),
                           ib.column("order", "number"),
                           ib.column("item_value", "number", "x", "the cell is not characterised at this condition"),
                           ib.column("reference", "number", "x", "the reference inverter is not characterised at this condition")]
                          + [ib.column("class_" + name, "number", "x", "no cell of this function at this condition") for name, _ in QUANTILES],
                          fan_rows),
    }
    max_excess = max([row["excess"] for row in flagged] or [0.0])
    low_supply = min([row["low"] for row in flagged] or [0.0])
    actions = [
        ib.action("derate", "Derate the flagged cells at low supply", "chip_designer",
                  "They slow down more than the inverter the timing was signed off against.",
                  [ib.impact("Cells to derate", len(flagged)), ib.impact("Worst extra slowdown", ib.pct(max_excess), "%")],
                  ib.rows_target("flagged", "cell"),
                  {"factor": round(1.0 + max_excess + 0.005, 2), "when": "supply at or below %.2f V" % low_supply}),
        ib.action("dont_use", "Avoid the flagged cells in low-supply blocks", "chip_designer",
                  "A Vmin bottleneck limits how low the block's supply can go.",
                  [ib.impact("Cells", len(flagged))], ib.rows_target("flagged", "cell"), {"reason_column": "text"}),
    ]
    if flagged:
        top = flagged[0]
        key = "%s/%s" % (top["variant"], top["cell"])
        input_pin, output_pin = top["arc"].split("->")
        nom_cells = conditions[(top["variant"], top["temperature"])][top["nominal"]][1]
        low_cells = conditions[(top["variant"], top["temperature"])][top["low"]][1]
        siblings = sorted(name for name, info in nom_cells.items() if info["function"] == top["function"] and name != top["cell"])[:16]
        params = {"cell": top["cell"], "arc": ib.arc_param(input_pin, output_pin, "both", top["timing"]["when"]),
                  "symptom": "low_voltage_slowdown",
                  "metric": "delay at %.2f V over delay at %.2f V" % (top["low"], top["nominal"]),
                  "now": ib.r6(top["ratio"]), "target": ib.r6(top["reference_ratio"] * (1.0 + watch)), "unit": "x",
                  "reference": "the smallest inverter %s plus the %d %% watch level" % (top["reference"], round(100 * watch)),
                  "siblings": [ib.sibling(name, value=ib.r6(ratio(low_cells, nom_cells, name, top["arc"]))) for name in siblings],
                  "levers": [ib.lever("widen_deepest_stack", "Widen the deepest series stack on the %s path." % top["arc"]),
                             ib.lever("reorder_stack", "Reorder the stack so the latest input sits next to the output."),
                             ib.lever("split_stack", "Split the deep stack into two stages.")],
                  "evidence": [ib.evidence("Low-supply slowdown over the inverter", "flagged", "excess_pct", "item", key)],
                  "check": {"corners": top["corners"]}}
        circuit = devices(netlist, top["cell"], top["arc"])
        if circuit:
            params["circuit"] = circuit
            params["sibling_circuits"] = dict((name, devices(netlist, name, top["arc"])) for name in siblings
                                              if devices(netlist, name, top["arc"]))
        actions.append(ib.action("redesign_cell", "Redesign %s on %s" % (top["cell"], top["arc"]), "cell_designer",
                                 "It is the worst Vmin bottleneck of the library.",
                                 [ib.impact("Extra slowdown", ib.pct(top["excess"]), "%")],
                                 ib.rows_target("flagged", "cell", {"column": "item", "equals": key}), params))
    headline = "%d of %d cells slow down more than the inverter at low supply" % (len(flagged), len(worst))
    variants = sorted(set(v for (v, _) in conditions))
    corners = sorted(set(corner for by in conditions.values() for corner, _ in by.values()))
    parts = {
        "rule": ib.rule_block(prepared, ib.scope(prepared, variants, corners)),
        "summary": "%s (watch level %d %%). The worst is %s." % (
            headline, round(100 * watch),
            ("%s in %s at +%.0f %%" % (flagged[0]["cell"], flagged[0]["variant"], 100 * flagged[0]["excess"])) if flagged else "none"),
        "datasets": datasets,
        "library": ib.library_block(headline, len(worst), len(flagged), "cells",
                                    [ib.fact("Cells checked", len(worst)), ib.fact("Cells flagged", len(flagged)),
                                     ib.fact("Worst extra slowdown", ib.pct(max_excess), "%"),
                                     ib.fact("Watch level", round(100 * watch, 2), "%"), ib.fact("Variants", len(variants))],
                                    [ib.chart("excess-by-variant", "Extra low-supply slowdown by variant", "box", "all_cells",
                                              group="variant", value="excess_pct", role="role")]),
        "items": ib.items_block("flagged", "item", "cell", "excess_pct", "desc",
                                [ib.chart("supply-fan", "Slowdown across supply and temperature", "fan", "fan", item_key="item",
                                          x="condition", y="item_value", reference="reference", item="cell",
                                          class_box=dict((name, "class_" + name) for name, _ in QUANTILES))], text="text"),
        "actions": actions,
        "score": ib.score_block("robustness", len(flagged), len(worst)),
        "assumptions": ["Delay is the mean of cell_rise and cell_fall at the middle of each table's own grid.",
                        "The reference is the smallest inverter of the same variant.",
                        "Each temperature compares its own lowest and highest supply."],
        "limits": ["Only corners present in the prepared facts are compared.",
                   "Netlist devices are matched to cells by name.",
                   "At most %d flagged cells are listed, worst first." % MAX_ITEMS],
    }
    ib.finish(args, started, prepared, sources, parts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 7: Write the generator of the committed reference results**

`packs/libinsight-analysis/flow/tests/make_reference_results.py`:
```python
#!/usr/bin/env python3
"""Regenerate flow/reference_results/<rule>.json: each reference rule on the synthetic Kit.

    PYTHONDONTWRITEBYTECODE=1 python3 packs/libinsight-analysis/flow/tests/make_reference_results.py [rule ...]

The temporary Kit's folder is written as /synthetic-kit in the results (sources and run command)."""
import json
import os
import shutil
import sys
import tempfile

sys.path[:0] = [os.path.dirname(os.path.dirname(os.path.abspath(__file__))), os.path.dirname(os.path.abspath(__file__))]
import synthetic_kit  # noqa: E402

OUT = os.path.join(synthetic_kit.FLOW, "reference_results")


def main(argv):
    rules = argv or [rule for rule in synthetic_kit.REFERENCE_RULES
                     if os.path.exists(os.path.join(synthetic_kit.FLOW, "reference_rules", rule + ".py"))]
    base = os.path.realpath(tempfile.mkdtemp())
    try:
        if not os.path.isdir(OUT):
            os.makedirs(OUT)
        for rule in rules:
            doc = synthetic_kit.reference_result(os.path.join(base, rule), rule)
            text = json.dumps(doc, sort_keys=True, indent=1, ensure_ascii=False).replace(base, "/synthetic-kit")
            with open(os.path.join(OUT, rule + ".json"), "w", encoding="utf-8") as stream:
                stream.write(text + "\n")
            print("wrote reference result", rule)
    finally:
        shutil.rmtree(base)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 8: Generate the results and run the tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 packs/libinsight-analysis/flow/tests/make_reference_results.py size_coverage_gaps vmin_bottleneck
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'
```
Expected: two "wrote reference result" lines; all tests PASS. A `validate` or `generate` problem names the exact field and form (P1a "Normative details"); change only the dictionary in the rule script, or the builder helper when the shape is shared, regenerate, and re-run. Never edit the vendored files. Check `git status --short` shows no file outside the Pack.

- [ ] **Step 9: Commit and push**

```bash
git add packs/libinsight-analysis/flow/reference_rules packs/libinsight-analysis/flow/reference_results packs/libinsight-analysis/flow/tests/synthetic_kit.py packs/libinsight-analysis/flow/tests/make_reference_results.py packs/libinsight-analysis/flow/tests/test_reference_rules.py
git commit -m "feat(libinsight): reference rules size_coverage_gaps and vmin_bottleneck on the synthetic Kit

Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---
### Task 8: Reference rules II — `table_spikes_kinks` and `critical_path_faster_cells`

**Files:**
- Create: `packs/libinsight-analysis/flow/reference_rules/table_spikes_kinks.py`
- Create: `packs/libinsight-analysis/flow/reference_rules/critical_path_faster_cells.py`
- Modify: `packs/libinsight-analysis/flow/tests/test_reference_rules.py`
- Create (generated): `packs/libinsight-analysis/flow/reference_results/table_spikes_kinks.json`, `critical_path_faster_cells.json`

**Interfaces:**
- Consumes: Task 7 (catalogue, helpers, test module); `synthetic_kit.SPIKE`, `PATHS`, `DESIGN_CORNER`, `DESIGN_VARIANT`; prepared-data `design: {netlist: {path, sha256}, timingReport: {path, sha256}}`.
- Produces: the two scripts with the CLI of Task 7; reference results for all four rules.

- [ ] **Step 1: Extend the failing test**

In `packs/libinsight-analysis/flow/tests/test_reference_rules.py`, replace
`    RULES = ("size_coverage_gaps", "vmin_bottleneck")` with
`    RULES = synthetic_kit.REFERENCE_RULES`
and add these methods to `ReferenceRules`:
```python
    def test_tables_find_exactly_the_injected_spike(self):
        doc = self.results["table_spikes_kinks"]
        points = rows(doc, "points")
        spike = synthetic_kit.SPIKE
        self.assertEqual(sorted(p["arc"] for p in points), ["A1->ZN", "A2->ZN"])
        for point in points:
            self.assertEqual((point["variant"], point["corner"], point["cell"], point["table"], point["point"]),
                             (spike["variant"], spike["corner"], spike["cell"], spike["kind"], "(%d,%d)" % spike["at"]))
            self.assertGreater(point["deviation_pct"], 10.0)
        self.assertEqual([a["kind"] for a in doc["actions"]], ["recharacterise", "limits"])
        self.assertIn(doc["actions"][1]["params"]["limit"], ("max_capacitance", "max_transition"))
        self.assertEqual(doc["score"]["dimension"], "quality")

    def test_critical_paths_offer_faster_equivalents_at_each_operating_point(self):
        doc = self.results["critical_path_faster_cells"]
        stages = rows(doc, "stages")
        self.assertTrue(stages)
        for stage in stages:
            self.assertLess(stage["best_delay_ns"], stage["delay_ns"])
            self.assertTrue(stage["subject"].startswith("design:synth_top :: path:"))
        self.assertEqual(len(rows(doc, "paths")), len(synthetic_kit.PATHS))
        dont_use = doc["actions"][0]
        self.assertEqual((dont_use["kind"], dont_use["targets"]["selection"]), ("dont_use", True))
        self.assertEqual(doc["actions"][1]["params"]["symptom"], "slower_than_equivalent")
        self.assertEqual(doc["score"]["dimension"], "none")
        self.assertEqual(sorted(s["kind"] for s in doc["sources"] if s["kind"] != "facts"), ["design_netlist", "timing_report"])
```

- [ ] **Step 2: Run it to verify it fails**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_reference_rules.py'
```
Expected: ERROR in `setUpClass` (`…/reference_rules/table_spikes_kinks.py` not found).

- [ ] **Step 3: Write `table_spikes_kinks.py`**

`packs/libinsight-analysis/flow/reference_rules/table_spikes_kinks.py`:
```python
#!/usr/bin/env python3
"""table_spikes_kinks: timing tables with one value farther than `threshold` from the straight line between
its neighbours at their real slew or load values. Each table keeps its worst point. Python 3.6+, no numpy;
reads the prepared facts one file at a time."""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(os.path.dirname(HERE), "libinsight_analysis")]
import insight_builder as ib  # noqa: E402

RULE = "table_spikes_kinks"
KINDS = ("cell_rise", "cell_fall", "rise_transition", "fall_transition")
CSV_COLUMNS = dict((name, name) for name in ("variant", "corner", "cell", "arc", "when", "table", "point"))
MAX_STORED = 20000
MAX_ROWS = 20000


def worst_point(library, item, threshold):
    """(deviation, i, j, axis, expected) of the value farthest from its neighbours' chord, or None."""
    slews, loads, value = ib.grid(library, item)
    worst = None
    for i in range(len(slews)):
        for j in range(len(loads)):
            here = value(i, j)
            if here is None:
                continue
            chords = []
            if 0 < j < len(loads) - 1:
                chords.append(("load", value(i, j - 1), value(i, j + 1), loads[j - 1], loads[j], loads[j + 1]))
            if 0 < i < len(slews) - 1:
                chords.append(("slew", value(i - 1, j), value(i + 1, j), slews[i - 1], slews[i], slews[i + 1]))
            for axis, before, after, x0, x, x1 in chords:
                if before is None or after is None or x1 <= x0:
                    continue
                expected = before + (after - before) * (x - x0) / (x1 - x0)
                if expected <= 0:
                    continue
                deviation = (here - expected) / expected
                if abs(deviation) > threshold and (worst is None or abs(deviation) > abs(worst[0])):
                    worst = (deviation, i, j, axis, expected)
    return worst


def main(argv=None):
    started = time.time()
    args = ib.arguments(RULE, __doc__).parse_args(argv)
    prepared, data = ib.read_json(args.prepared), ib.read_json(args.data)
    threshold = float(ib.parameter(prepared, "threshold", 0.1))
    max_items = int(ib.parameter(prepared, "max_items", 300))
    kit = prepared.get("kit") or {}
    sources = ib.Sources()
    checked, found, flagged_total, by_variant, by_table = 0, [], 0, {}, {}
    variants, corners, largest_grid = set(), set(), 1
    for entry in ib.facts_entries(data):
        library = sources.load(entry)["library"]
        variant, corner = entry.get("variant") or "-", entry.get("corner") or "-"
        variants.add(variant)
        corners.add(corner)
        pre = ib.prefix(kit.get("name"), kit.get("release"), variant, corner)
        t_ns, c_ff = ib.time_scale_ns(library), ib.cap_scale_ff(library)
        for cell in library["cells"]:
            for pin, timing in ib.arcs(cell):
                for kind in KINDS:
                    item = ib.table(timing, kind)
                    if item is None:
                        continue
                    checked += 1
                    hit = worst_point(library, item, threshold)
                    if hit is None:
                        continue
                    flagged_total += 1
                    by_variant[variant] = by_variant.get(variant, 0) + 1
                    by_table[kind] = by_table.get(kind, 0) + 1
                    if len(found) >= MAX_STORED:
                        continue
                    deviation, i, j, axis, expected = hit
                    slews, loads, value = ib.grid(library, item)
                    largest_grid = max(largest_grid, len(slews) * len(loads))
                    found.append({
                        "deviation": deviation, "variant": variant, "corner": corner, "cell": cell["name"],
                        "arc": ib.arc_label(pin, timing), "pin": pin["name"], "when": timing.get("when", ""), "table": kind,
                        "point": "(%d,%d)" % (i, j), "axis": axis, "value": value(i, j), "expected": expected,
                        "subject": ib.table_subject(pre, cell["name"], pin["name"], timing, kind, item.get("sigma", ""), (i, j)),
                        "slice": [(x * (c_ff if axis == "load" else t_ns), value(i, k) if axis == "load" else value(k, j), k)
                                  for k, x in enumerate(loads if axis == "load" else slews)],
                        "grid": [(slews[a] * t_ns, loads[b] * c_ff, value(a, b), (a, b) == (i, j))
                                 for a in range(len(slews)) for b in range(len(loads))],
                        "limit": ("max_capacitance", loads[j - 1] * c_ff) if axis == "load" else ("max_transition", slews[i - 1] * t_ns),
                    })
    found.sort(key=lambda hit: (-abs(hit["deviation"]), hit["subject"]))
    keep = found[:max(1, min(max_items, MAX_ROWS // largest_grid))] if found else []
    points, slices, grids, transition_limits, load_limits = [], [], [], {}, {}
    for hit in keep:
        key = "%s/%s/%s/%s/%s" % (hit["variant"], hit["corner"], hit["cell"], hit["arc"], hit["table"])
        points.append([key, hit["variant"], hit["corner"], hit["cell"], hit["arc"], hit["when"], hit["table"], hit["point"],
                       hit["axis"], ib.r6(hit["value"]), ib.r6(hit["expected"]), ib.pct(hit["deviation"]), hit["subject"],
                       "%s %s of %s at %s is %.1f %% off the straight line between its neighbours along %s." % (
                           hit["table"], hit["arc"], hit["cell"], hit["point"], 100 * hit["deviation"], hit["axis"]), "problem"])
        flag_index = int(hit["point"].strip("()").split(",")[1 if hit["axis"] == "load" else 0])
        for x, y, k in hit["slice"]:
            slices.append([key, ib.r6(x), ib.r6(y), ib.r6(hit["expected"]) if k == flag_index else None, 1 if k == flag_index else 0])
        for slew, load, value, flagged in hit["grid"]:
            grids.append([key, ib.r6(slew), ib.r6(load), ib.r6(value), "problem" if flagged else "other"])
        limit, value = hit["limit"]
        bucket = load_limits if limit == "max_capacitance" else transition_limits
        cell_pin = (hit["cell"], hit["pin"])
        if cell_pin not in bucket or value < bucket[cell_pin][0]:
            bucket[cell_pin] = (value, hit["subject"])
    datasets = {
        "points": ib.dataset([ib.column("item", "string"), ib.column("variant", "string"), ib.column("corner", "string"),
                              ib.column("cell", "string"), ib.column("arc", "string"), ib.column("when", "string"),
                              ib.column("table", "string"), ib.column("point", "string"), ib.column("axis", "string"),
                              ib.column("value", "number"), ib.column("expected", "number"),
                              ib.column("deviation_pct", "number", "%"), ib.column("subject", "string"),
                              ib.column("text", "string"), ib.column("role", "string")], points),
        "slice": ib.dataset([ib.column("item", "string"), ib.column("x", "number"), ib.column("y", "number", None, "missing in the table"),
                             ib.column("expected", "number", None, "only the flagged point has an expected value"),
                             ib.column("flag", "number")], slices),
        "grid": ib.dataset([ib.column("item", "string"), ib.column("slew", "number", "ns"), ib.column("load", "number", "fF"),
                            ib.column("value", "number", None, "missing in the table"), ib.column("role", "string")], grids),
        "by_variant": ib.dataset([ib.column("variant", "string"), ib.column("tables", "number")], sorted(by_variant.items())),
        "by_table": ib.dataset([ib.column("table", "string"), ib.column("tables", "number")], sorted(by_table.items())),
    }
    actions = [ib.action("recharacterise", "Re-characterise the flagged tables", "library_provider",
                         "A value off its neighbours' line is usually a characterisation error.",
                         [ib.impact("Tables", len(points))], ib.rows_target("points", "item"), {"columns": CSV_COLUMNS})]
    for limit, bucket, unit in (("max_transition", transition_limits, "ns"), ("max_capacitance", load_limits, "fF")):
        if not bucket:
            continue
        name = "%s_limits" % limit
        datasets[name] = ib.dataset([ib.column("cell", "string"), ib.column("pin", "string"),
                                     ib.column("value", "number", unit), ib.column("subject", "string")],
                                    [[cell, pin, ib.r6(value), subject] for (cell, pin), (value, subject) in sorted(bucket.items())])
        actions.append(ib.action("limits", "Keep the flagged cells inside the trusted part of their tables", "chip_designer",
                                 "Beyond the last smooth point the table cannot be trusted until it is re-characterised.",
                                 [ib.impact("Cells", len(bucket))], ib.rows_target(name, "cell"),
                                 {"limit": limit, "value": {"column": "value"}, "unit": unit, "pin_column": "pin"}))
    headline = "%d of %d timing tables have a spike or kink above %d %%" % (flagged_total, checked, round(100 * threshold))
    parts = {
        "rule": ib.rule_block(prepared, ib.scope(prepared, sorted(variants), sorted(corners))),
        "summary": "%s. %d of them are listed, worst first." % (headline, len(points)),
        "datasets": datasets,
        "library": ib.library_block(headline, checked, flagged_total, "tables",
                                    [ib.fact("Tables checked", checked), ib.fact("Tables flagged", flagged_total),
                                     ib.fact("Threshold", round(100 * threshold, 2), "%"), ib.fact("Tables listed", len(points))],
                                    [ib.chart("flagged-by-variant", "Flagged tables by variant", "bar", "by_variant", x="variant", y="tables"),
                                     ib.chart("flagged-by-table", "Flagged tables by table kind", "bar", "by_table", x="table", y="tables")]),
        "items": ib.items_block("points", "item", "cell", "deviation_pct", "desc",
                                [ib.chart("table-slice", "The row or column through the flagged point", "slice", "slice", item_key="item",
                                          x="x", y="y", flag="flag", expected="expected"),
                                 ib.chart("table-grid", "The whole table", "heatmap", "grid", item_key="item",
                                          x="slew", y="load", value="value", role="role")], text="text"),
        "actions": actions,
        "score": ib.score_block("quality", flagged_total, checked),
        "assumptions": ["The expected value is the straight line between the two neighbours at their real axis values.",
                        "Each table keeps its single worst point."],
        "limits": ["Only cell_rise, cell_fall, rise_transition and fall_transition tables are checked.",
                   "Edge rows and columns have one neighbour and are checked only along the other axis."],
    }
    ib.finish(args, started, prepared, sources, parts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Write `critical_path_faster_cells.py`**

`packs/libinsight-analysis/flow/reference_rules/critical_path_faster_cells.py`:
```python
#!/usr/bin/env python3
"""critical_path_faster_cells: cells on the design's reported paths for which an equivalent cell (same
function, same track) is at least `margin` faster at that instance's own load and input slew, read from the
timing report (ns, fF). Python 3.6+, no numpy; reads the prepared facts at the report's corner and the
prepared design files."""
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(os.path.dirname(HERE), "libinsight_analysis")]
import insight_builder as ib  # noqa: E402

RULE = "critical_path_faster_cells"
STAGE = re.compile(r"^\s*(?P<instance>[^\s/]+)/(?P<pin>\S+)\s+\((?P<cell>[^)]+)\)\s*(?P<rest>.*)$")
NUMBER = re.compile(r"-?\d+(?:\.\d+)?")
SLACK = re.compile(r"^\s*slack\s*\(\w+\)\s+(-?\d+(?:\.\d+)?)")


def parse_report(path):
    """(design, [{start, end, slack, lines: [(instance, pin, cell, cap fF or None, trans ns)]}])."""
    design, paths, current = "design", [], None
    with open(path) as stream:
        for line in stream:
            if line.startswith("Design :"):
                design = line.split(":", 1)[1].strip()
            elif line.startswith("Startpoint:"):
                current = {"start": line.split()[1], "end": None, "slack": None, "lines": []}
                paths.append(current)
            elif line.startswith("Endpoint:") and current is not None:
                current["end"] = line.split()[1]
            elif current is not None:
                slack = SLACK.match(line)
                if slack:
                    current["slack"] = float(slack.group(1))
                    continue
                found = STAGE.match(line)
                if found:
                    numbers = [float(n) for n in NUMBER.findall(found.group("rest"))]
                    if len(numbers) >= 4:
                        current["lines"].append((found.group("instance"), found.group("pin"), found.group("cell"), numbers[-4], numbers[-3]))
                    elif len(numbers) == 3:
                        current["lines"].append((found.group("instance"), found.group("pin"), found.group("cell"), None, numbers[-3]))
    return design, paths


def worst_delay(library, cell, slew_ns, load_ff):
    """(delay ns, input pin, output pin) of the slowest arc at one operating point, or (None, None, None)."""
    t_ns, c_ff = ib.time_scale_ns(library), ib.cap_scale_ff(library)
    best = (None, None, None)
    for pin, timing in ib.arcs(cell):
        value = ib.arc_delay(library, timing, slew_ns / t_ns, load_ff / c_ff)
        if value is not None and (best[0] is None or value * t_ns > best[0]):
            best = (value * t_ns, timing.get("related_pin", ""), pin["name"])
    return best


def main(argv=None):
    started = time.time()
    args = ib.arguments(RULE, __doc__).parse_args(argv)
    prepared, data = ib.read_json(args.prepared), ib.read_json(args.data)
    margin = float(ib.parameter(prepared, "margin", 0.03))
    corner = str(ib.parameter(prepared, "corner", ""))
    design_variant = str(ib.parameter(prepared, "design_variant", ""))
    kit = prepared.get("kit") or {}
    design_files = data.get("design") or {}
    if not design_files:
        raise SystemExit("this rule needs the design's timing report and netlist in the prepared data")
    sources = ib.Sources()
    report = sources.add_file(design_files["timingReport"]["path"], "timing_report", design_files["timingReport"]["sha256"])
    sources.add_file(design_files["netlist"]["path"], "design_netlist", design_files["netlist"]["sha256"])
    design, paths = parse_report(report)
    entries = ib.facts_entries(data, corners=[corner] if corner else None)
    stage_cells = set(line[2] for path in paths for line in path["lines"])
    owners = {}  # stage cell name -> (signature, track, variant)
    for entry in entries:
        variant = entry.get("variant") or "-"
        for cell in sources.load(entry)["library"]["cells"]:
            if cell["name"] in stage_cells and (not design_variant or variant == design_variant) and cell["name"] not in owners:
                owners[cell["name"]] = (ib.function_of(cell), ib.split_variant(variant)[0], variant)
    stages = []
    for number, path in enumerate(paths, 1):
        slew, order = None, 0
        for instance, pin, cell, cap, trans in path["lines"]:
            if cell in owners and cap is not None and slew is not None:
                order += 1
                stages.append({"item": "p%d/%s" % (number, instance), "path": number, "order": order, "instance": instance,
                               "cell": cell, "load": cap, "slew": slew, "options": []})
            slew = trans
    wanted = set((owners[s["cell"]][0], owners[s["cell"]][1]) for s in stages)
    for entry in entries:
        variant = entry.get("variant") or "-"
        track = ib.split_variant(variant)[0]
        library = sources.load(entry)["library"]
        for cell in library["cells"]:
            signature = ib.function_of(cell)
            if (signature, track) not in wanted:
                continue
            for stage in stages:
                if owners[stage["cell"]][:2] != (signature, track):
                    continue
                delay, input_pin, output_pin = worst_delay(library, cell, stage["slew"], stage["load"])
                if delay is not None:
                    stage["options"].append({"cell": cell["name"], "variant": variant, "area": float(cell["area"]), "delay": delay,
                                             "input": input_pin, "output": output_pin,
                                             "own": cell["name"] == stage["cell"] and variant == owners[stage["cell"]][2]})
    path_rows, item_rows, path_stage_rows, equivalent_rows, swaps_by_path = [], [], [], [], {}
    for stage in stages:
        own = [o for o in stage["options"] if o["own"]]
        if not own:
            continue
        stage["delay"] = own[0]["delay"]
        stage["own"] = own[0]
        stage["faster"] = sorted((o for o in stage["options"] if o["delay"] < stage["delay"] * (1.0 - margin)),
                                 key=lambda o: (o["delay"], o["area"], o["cell"]))
    for stage in stages:
        if not stage.get("faster"):
            continue
        swaps_by_path[stage["path"]] = swaps_by_path.get(stage["path"], 0) + 1
        best = stage["faster"][0]
        gain = 1.0 - best["delay"] / stage["delay"]
        item_rows.append([stage["item"], stage["path"], stage["order"], stage["instance"], stage["cell"], ib.r6(stage["load"]),
                          ib.r6(stage["slew"]), ib.r6(stage["delay"]), best["cell"], ib.r6(best["delay"]), ib.pct(gain),
                          ib.stage_subject(design, stage["path"], stage["order"]),
                          "%s (%s) on path %d: %s is %.1f %% faster at this load and slew." % (
                              stage["instance"], stage["cell"], stage["path"], best["cell"], 100 * gain),
                          stage["own"]["input"], stage["own"]["output"]])
        for other in stages:
            if other["path"] == stage["path"] and "delay" in other:
                path_stage_rows.append([stage["item"], other["order"], "%s %s" % (other["instance"], other["cell"]),
                                        ib.r6(other["delay"]), "selected" if other is stage else "other"])
        for option in sorted(stage["options"], key=lambda o: (o["delay"], o["cell"], o["variant"])):
            role = "selected" if option["own"] else ("candidate" if option in stage["faster"] else "other")
            pre = ib.prefix(kit.get("name"), kit.get("release"), option["variant"], corner or "*")
            equivalent_rows.append([stage["item"], option["cell"], option["variant"], ib.r6(option["area"]), ib.r6(option["delay"]),
                                    role, ib.cell_subject(pre, option["cell"])])
    for number, path in enumerate(paths, 1):
        path_rows.append([number, path["start"], path["end"] or "", path["slack"], len([s for s in stages if s["path"] == number]),
                          swaps_by_path.get(number, 0), ib.stage_subject(design, number)])
    datasets = {
        "paths": ib.dataset([ib.column("path", "number"), ib.column("startpoint", "string"), ib.column("endpoint", "string"),
                             ib.column("slack_ns", "number", "ns", "the report states no slack"), ib.column("stages", "number"),
                             ib.column("swaps", "number"), ib.column("subject", "string")], path_rows),
        "stages": ib.dataset([ib.column("item", "string"), ib.column("path", "number"), ib.column("order", "number"),
                              ib.column("instance", "string"), ib.column("cell", "string"), ib.column("load_ff", "number", "fF"),
                              ib.column("slew_ns", "number", "ns"), ib.column("delay_ns", "number", "ns"),
                              ib.column("best_cell", "string"), ib.column("best_delay_ns", "number", "ns"),
                              ib.column("gain_pct", "number", "%"), ib.column("subject", "string"), ib.column("text", "string"),
                              ib.column("input", "string"), ib.column("output", "string")], item_rows),
        "path_stages": ib.dataset([ib.column("item", "string"), ib.column("order", "number"), ib.column("label", "string"),
                                   ib.column("delay_ns", "number", "ns"), ib.column("role", "string")], path_stage_rows),
        "equivalents": ib.dataset([ib.column("item", "string"), ib.column("cell", "string"), ib.column("variant", "string"),
                                   ib.column("area", "number", "um2"), ib.column("delay_ns", "number", "ns"),
                                   ib.column("role", "string"), ib.column("subject", "string")], equivalent_rows),
    }
    actions = [ib.action("dont_use", "Don't use the slower cells you mark", "chip_designer",
                         "On these paths a faster equivalent exists at the instance's own load and slew.",
                         [ib.impact("Stages with a faster equivalent", len(item_rows))], ib.selection_target("equivalents", "cell"),
                         {"scope": "cells marked on the reported paths of %s" % design})]
    if item_rows:
        top = max(item_rows, key=lambda row: (row[10], row[0]))
        actions.append(ib.action(
            "redesign_cell", "Swap %s for %s on %s" % (top[4], top[8], top[3]), "chip_designer", top[12],
            [ib.impact("Faster at this operating point", top[10], "%")],
            ib.rows_target("stages", "cell", {"column": "item", "equals": top[0]}),
            {"cell": top[4], "arc": ib.arc_param(top[13], top[14]), "symptom": "slower_than_equivalent",
             "metric": "delay at the instance's load and input slew", "now": top[7], "target": top[9], "unit": "ns",
             "reference": "the equivalent %s at the same load and slew" % top[8],
             "siblings": [ib.sibling(top[8], value=top[9])],
             "levers": [ib.lever("use_equivalent", "Use %s for %s." % (top[8], top[3]),
                                 ib.effect(top[10], "%", "delay at %.2f fF and %.3f ns from the Liberty tables" % (top[5], top[6])))],
             "evidence": [ib.evidence("Stage delay", "stages", "delay_ns", "item", top[0])]}))
    headline = "%d of %d reported paths have a cell with a faster equivalent" % (len(swaps_by_path), len(paths))
    parts = {
        "rule": ib.rule_block(prepared, ib.scope(prepared, [o[2] for o in owners.values()], [corner] if corner else [], design)),
        "summary": "%s. %d stages could use a faster equivalent at their own operating point." % (headline, len(item_rows)),
        "datasets": datasets,
        "library": ib.library_block(headline, len(paths), len(swaps_by_path), "paths",
                                    [ib.fact("Paths read", len(paths)), ib.fact("Stages checked", len([s for s in stages if "delay" in s])),
                                     ib.fact("Stages with a faster equivalent", len(item_rows)),
                                     ib.fact("Margin", round(100 * margin, 2), "%")],
                                    [ib.chart("worst-paths", "Reported paths", "table", "paths",
                                              columns=["path", "startpoint", "endpoint", "slack_ns", "swaps"])]),
        "items": ib.items_block("stages", "item", "instance", "gain_pct", "desc",
                                [ib.chart("path-stages", "The path, stage by stage", "stages", "path_stages", item_key="item",
                                          order="order", label="label", value="delay_ns", role="role"),
                                 ib.chart("equivalents", "Equivalent cells at this operating point", "scatter", "equivalents",
                                          item_key="item", x="area", y="delay_ns", role="role", label="cell")], text="text"),
        "actions": actions,
        "score": ib.score_block("none", len(swaps_by_path), len(paths)),
        "assumptions": ["Each stage's load is the report's Cap and its input slew is the previous line's Trans (ns, fF).",
                        "Equivalent cells have the same output functions and input pins and the same track.",
                        "Delay is the slowest arc's mean of cell_rise and cell_fall at that load and slew."],
        "limits": ["Only the paths in the timing report are read.", "Flip-flops without Liberty facts are skipped."],
    }
    ib.finish(args, started, prepared, sources, parts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Generate all four results and run the tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 packs/libinsight-analysis/flow/tests/make_reference_results.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'
```
Expected: four "wrote reference result" lines; all PASS. The same rule as Task 7 Step 8 applies to a validator or generator problem.

- [ ] **Step 6: Commit and push**

```bash
git add packs/libinsight-analysis/flow/reference_rules packs/libinsight-analysis/flow/reference_results packs/libinsight-analysis/flow/tests/test_reference_rules.py
git commit -m "feat(libinsight): reference rules table_spikes_kinks and critical_path_faster_cells

Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---
### Task 9: Host: request `/2`, the rule on the proposal, and insight results for the Guide

**Files:**
- Modify: `packages/harness/src/libinsight-analyses.ts`
- Modify: `packages/harness/src/tools.ts` (`hima_insight_analysis` description and parameters)
- Modify: `test/contract/libinsight-analyses.test.ts`

**Interfaces:**
- Consumes: the Pack request `/2` (Task 4); the installed Pack's `contract.version`; the Site binding `kitCatalog` (a `hima-libinsight-kits/1` file on the Site).
- Produces (all in `libinsight-analyses.ts`):
  - `libInsightRule` (zod), `libInsightAnalysisRequest` gains `rule?`, `kit?: {name, variants, corners}`, `netlists`, `design?: {netlist, timingReport}`, `needs: ('facts'|'netlists'|'design')[]`; `buildsOn` accepts rule names with `_`.
  - `writesInsightRequests(version: string): boolean` (true for Pack ≥ 0.2.0).
  - `LibInsightAnalysisProposal` gains `rule?`, `kit?`, `needs`.
  - `LibInsightInsightResult` (the fields the Host reads of a `hima-libinsight-insight/1` result) and `LibInsightAnalysisDetail.insight?: LibInsightInsightResult` (an analysis/1 result stays in `result`).
  - Deps gain `readSiteFile?(site, at): Promise<Uint8Array>`.
  - `tool('result')` for an insight result returns `insight: {ref: "<id>@<version>", rule: {id, title, sentence}, headline, counts, score}`, `charts`, `actions`.
  - `LibInsightAnalysisToolArgs` gains `rule?`, `kit?`, `netlists?`, `design?`, `needs?`.

- [ ] **Step 1: Write the failing tests**

Append to `test/contract/libinsight-analyses.test.ts`:
```ts
// ADR-0022: a Pack 0.2 proposal names its rule and Kit; an insight result is read for the Guide.
const catalogue = JSON.stringify({ schema: 'hima-libinsight-kits/1', kits: [{ name: 'saed14', title: 'SAED14', release: '1', libertyRoots: ['/pdk/lib'], pattern: '^(?P<variant>x)(?P<corner>y)$', netlistRoots: [], netlistPattern: '\\.sp$' }] });
const vmin = { id: 'vmin_bottleneck', title: 'Vmin bottlenecks', sentence: 'A cell is a Vmin bottleneck when its delay grows more than the inverter does.', parameters: [{ name: 'watch', value: 0.08, meaning: 'extra slowdown that flags a cell' }] };

async function insightHome(version: string, extra: Partial<Parameters<typeof createLibInsightAnalyses>[0]> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-insight-'));
  const packsDir = path.join(root, 'packs'), sitesDir = path.join(root, 'sites');
  await cp(path.join(repoRoot, 'packs/libinsight-analysis'), path.join(packsDir, 'libinsight-analysis'), { recursive: true, filter: p => !p.includes('__pycache__') });
  const contract = path.join(packsDir, 'libinsight-analysis', 'contract.yml');
  await writeFile(contract, (await readFile(contract, 'utf8')).replace(/^version: .*$/m, `version: ${version}`));
  await mkdir(sitesDir, { recursive: true });
  await writeFile(path.join(sitesDir, 'local.yml'), `name: local\nkind: local\nworkspaceRoot: ${root}/ws\npermit: ./local.permit.yml\nbindings:\n  analysisRequests: ${root}/ws/requests\n  kitCatalog: ${root}/ws/kits.json\ncapacity:\n  cores: 1\n  memoryGiB: 1\n  parallelJobs: 1\n`);
  await writeFile(path.join(sitesDir, 'local.permit.yml'), `allowedReadRoots: [${root}]\nallowedWriteRoots: [${root}/ws]\nallowedWrappers: [python3]\nforbidden: [services]\n`);
  const written: { at: string; body: Record<string, unknown> }[] = [];
  const analyses = createLibInsightAnalyses({
    packsDir, sitesDir, indexFile: path.join(root, 'home', 'libinsight-analyses.json'), site: 'local',
    preparation: () => ({ id: 'prep-1', ready: true, goal: {}, strategy: {}, budget: { timeBoxMinutes: { value: 45 } }, unknowns: [], nextActions: [] }) as never,
    startGuidedRun: () => { throw new Error('not used'); },
    listRunHeads: async () => [], readRunView: async () => undefined,
    readRetained: async () => Buffer.from('{}'), authorize: async () => undefined,
    writeSiteFile: async (_site, at, bytes) => { written.push({ at, body: JSON.parse(Buffer.from(bytes).toString('utf8')) }); return at; },
    readSiteFile: async () => Buffer.from(catalogue),
    ...extra,
  });
  return { analyses, written, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('a Pack 0.2 proposal writes request /2 with the rule and Kit and shows them', async () => {
  const f = await insightHome('0.2.0');
  try {
    const proposal = await f.analyses.propose('s', { question: 'Which cells limit my Vmin?', rule: vmin, kit: { name: 'saed14', corners: ['tt0p8v25c'] }, needs: ['facts', 'netlists'] });
    assert.equal(proposal.ready, true);
    assert.equal(proposal.rule?.sentence, vmin.sentence);
    assert.deepEqual(proposal.kit, { name: 'saed14', variants: [], corners: ['tt0p8v25c'] });
    assert.deepEqual(proposal.needs, ['facts', 'netlists']);
    const body = f.written[0]!.body;
    assert.equal(body.schema, 'hima-libinsight-request/2');
    assert.deepEqual(body.rule, vmin);
    assert.deepEqual(body.netlists, []);
    assert.equal(body.design, null);
  } finally { await f.cleanup(); }
});

test('an unknown Kit makes the proposal not ready, and a Pack 0.2 proposal needs a rule', async () => {
  const f = await insightHome('0.2.0');
  try {
    const proposal = await f.analyses.propose('s', { question: 'q', rule: vmin, kit: { name: 'nope' } });
    assert.equal(proposal.ready, false);
    assert.ok(proposal.unknowns.some(item => /The Kit nope is not in the Site kit catalogue \(known: saed14\)/.test(item)), proposal.unknowns.join('\n'));
    await assert.rejects(f.analyses.confirm('s', proposal.proposalId), /not ready/);
    await assert.rejects(f.analyses.propose('s', { question: 'q', kit: { name: 'saed14' } }), /needs the rule/);
    await assert.rejects(f.analyses.propose('s', { question: 'q', rule: vmin }), /name a Kit or at least one Liberty source/);
  } finally { await f.cleanup(); }
});

test('a Pack 0.1 proposal still writes request /1', async () => {
  const f = await insightHome('0.1.0');
  try {
    await f.analyses.propose('s', { question: 'q', rule: vmin, sources: ['/pdk/a.lib'] });
    assert.equal(f.written[0]!.body.schema, 'hima-libinsight-request/1');
    assert.equal('rule' in f.written[0]!.body, false);
  } finally { await f.cleanup(); }
});

test('an admitted insight result is read for the Guide with its rule, headline and reference', async () => {
  const insight = { schema: 'hima-libinsight-insight/1', id: 'vmin_bottleneck', version: 2, question: 'q', summary: 's',
    rule: { title: 'Vmin bottlenecks', sentence: vmin.sentence, parameters: [], scope: { kit: 'saed14', variants: [], corners: [] } },
    library: { headline: '3 of 40 cells slow down more than the inverter at low supply', counts: { checked: 40, flagged: 3, unit: 'cells' }, facts: [], charts: [{ id: 'b', title: 'By variant', kind: 'box', dataset: 'all' }] },
    items: { dataset: 'all', key: 'cell', label: 'cell', sort: { column: 'cell', order: 'asc' }, charts: [] },
    actions: [{ kind: 'derate', title: 'Derate', who: 'chip_designer', reason: 'r', impact: [], targets: { dataset: 'all', column: 'cell' }, params: {} }],
    score: { dimension: 'robustness', weight: 'custom', affected: 3, checked: 40 },
    datasets: { all: { columns: [{ name: 'cell', type: 'string' }], rows: [['NOR3X1']] } }, sources: [], assumptions: [], limits: [],
    code: { main: { path: 'analysis/v.py', sha256: sha('c'), text: '' }, files: [] }, run: { command: 'python3 v.py', exitCode: 0, elapsedSeconds: 1, usedQualib: false } };
  const f = await fixture({ 'run-ok': view({ value: { admitted: true, id: 'vmin_bottleneck', version: 2, resultSha256: sha('a') } }) },
    { readRetained: async () => Buffer.from(JSON.stringify(insight)) });
  try {
    const detail = await f.analyses.detail('s', 'run-ok');
    assert.equal(detail.insight?.library.headline, insight.library.headline);
    assert.equal(detail.result, undefined);
    const answer = await f.analyses.tool('g', { action: 'result', runId: 'run-ok' }) as Record<string, any>;
    assert.equal(answer.insight.ref, 'vmin_bottleneck@2');
    assert.equal(answer.insight.rule.sentence, vmin.sentence);
    assert.equal(answer.insight.headline, insight.library.headline);
    assert.deepEqual(answer.charts, [{ title: 'By variant', kind: 'box' }]);
    assert.match(answer.next, /Open in Data Insight/);
  } finally { await f.cleanup(); }
});
```
and change the first import line of the file to `import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';`.

- [ ] **Step 2: Run them to verify they fail**

```bash
cd /Users/lluzi/code/hima_harness_insight_v02 && pnpm run build
pnpm run test:local --files test/contract/libinsight-analyses.test.ts
```
Expected: the four new tests FAIL (TypeScript build of the test passes through type stripping; at run time `proposal.rule` is undefined, the body schema is `/1`, `detail.insight` is undefined).

- [ ] **Step 3: Implement the request `/2` and the rule on the proposal**

In `packages/harness/src/libinsight-analyses.ts`:

(a) Replace the block from `const requestSchema = 'hima-libinsight-request/1';` to the line `export type LibInsightAnalysisRequest = z.input<typeof libInsightAnalysisRequest>;` with:
```ts
const requestSchema = 'hima-libinsight-request/1';
const requestSchemaV2 = 'hima-libinsight-request/2';
const analysisSchema = 'hima-libinsight-analysis/1';
const insightSchema = 'hima-libinsight-insight/1';
const maxResultBytes = 4 * 1024 * 1024;
const ruleIdPattern = /^[a-z0-9][a-z0-9_-]{1,62}$/;
const sitePath = z.string().regex(/^\/[^\0]*$/, 'a Site path is absolute').refine(p => !p.split('/').includes('..'), 'a Site path may not climb with ..');

/** A rule as the person confirms it (ADR-0022): its name, a short title, one plain sentence and its parameters. */
export const libInsightRule = z.strictObject({
  id: z.string().regex(ruleIdPattern, 'a rule name is lowercase letters, digits, _ or -, like vmin_bottleneck'),
  title: z.string().trim().min(1).max(120),
  sentence: z.string().trim().min(1).max(300),
  parameters: z.array(z.strictObject({ name: z.string().min(1).max(64), value: z.union([z.number().finite(), z.string().max(200)]),
    meaning: z.string().min(1).max(300), unit: z.string().min(1).max(32).optional() })).max(12).default([]),
});

export const libInsightAnalysisRequest = z.strictObject({
  question: z.string().trim().min(1).max(4000),
  rule: libInsightRule.optional(),
  kit: z.strictObject({ name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/, 'a Kit name from the Site kit catalogue'),
    variants: z.array(z.string().min(1).max(64)).max(16).default([]), corners: z.array(z.string().min(1).max(64)).max(32).default([]) }).optional(),
  sources: z.array(sitePath).max(32).default([]),
  netlists: z.array(sitePath).max(16).default([]),
  design: z.strictObject({ netlist: sitePath, timingReport: sitePath }).optional(),
  needs: z.array(z.enum(['facts', 'netlists', 'design'])).max(3).default(['facts']),
  buildsOn: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{1,62}@[1-9][0-9]*$/, 'build on an admitted analysis as id@version')).max(8).default([]),
});
export type LibInsightAnalysisRequest = z.input<typeof libInsightAnalysisRequest>;
export type LibInsightRule = z.infer<typeof libInsightRule>;

/** A Pack from 0.2.0 on reads hima-libinsight-request/2 (rule, Kit, netlists, design); older ones /1. */
export function writesInsightRequests(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(part => Number.parseInt(part, 10));
  return major > 0 || minor >= 2;
}
```

(b) After the `LibInsightAnalysisResult` interface add:
```ts
/** The fields the Host reads of a Reader-accepted hima-libinsight-insight/1 result; LibInsight draws the rest. */
export interface LibInsightInsightResult {
  readonly schema: typeof insightSchema;
  readonly id: string;
  readonly version: number;
  readonly question: string;
  readonly summary: string;
  readonly rule: { readonly title: string; readonly sentence: string; readonly parameters: readonly { readonly name: string; readonly value: unknown; readonly unit?: string; readonly meaning: string }[];
    readonly scope: { readonly kit: string; readonly variants: readonly string[]; readonly corners: readonly string[]; readonly design?: string } };
  readonly library: { readonly headline: string; readonly counts: { readonly checked: number; readonly flagged: number; readonly unit: string };
    readonly facts: readonly { readonly label: string; readonly value: number | string; readonly unit?: string }[];
    readonly charts: readonly { readonly id: string; readonly title: string; readonly kind: string; readonly dataset: string }[] };
  readonly items: { readonly dataset: string; readonly key: string; readonly label: string; readonly charts: readonly { readonly id: string; readonly title: string; readonly kind: string; readonly dataset: string }[] };
  readonly actions: readonly { readonly kind: string; readonly title: string; readonly who: string; readonly reason: string }[];
  readonly score: { readonly dimension: string; readonly weight: string | number; readonly affected: number; readonly checked: number };
  readonly sources: readonly { readonly path: string; readonly kind: string; readonly sha256Before: string; readonly sha256After: string }[];
  readonly datasets: LibInsightAnalysisResult['datasets'];
  readonly code: LibInsightAnalysisResult['code'];
  readonly run: LibInsightAnalysisResult['run'];
  readonly assumptions: readonly string[];
  readonly limits: readonly string[];
}
const isInsightResult = (value: unknown): value is LibInsightInsightResult => {
  const doc = value as Partial<LibInsightInsightResult> | null;
  return doc !== null && typeof doc === 'object' && doc.schema === insightSchema && typeof doc.library === 'object' && doc.library !== null
    && typeof doc.items === 'object' && doc.items !== null && typeof doc.datasets === 'object' && doc.datasets !== null && typeof doc.rule === 'object' && doc.rule !== null;
};
```

(c) In `LibInsightAnalysisProposal`, after `readonly buildsOn: readonly string[];` add:
```ts
  /** The rule the person confirms (Pack ≥ 0.2), its Kit selection and the inputs it needs. */
  readonly rule?: LibInsightRule;
  readonly kit?: { readonly name: string; readonly variants: readonly string[]; readonly corners: readonly string[] };
  readonly needs: readonly string[];
```
In `LibInsightAnalysisDetail`, after `readonly result?: LibInsightAnalysisResult;` add `  /** A Reader-accepted insight result (ADR-0022); LibInsight draws it in Data Insight. */\n  readonly insight?: LibInsightInsightResult;`.
In `LibInsightAnalysesDeps`, after `writeSiteFile?…;` add `  /** Reads a Site file (the kit catalogue); tests may replace it. */\n  readSiteFile?(site: Site, at: string): Promise<Uint8Array>;`.
Change `interface Pending { … readonly row: IndexRow; readonly humanMessages?: number }` to add `readonly ready: boolean;` after `proposal: PreparationView;`.

(d) Replace the body of `propose` from `const parsed = libInsightAnalysisRequest.safeParse(input);` to its `return` with:
```ts
    const parsed = libInsightAnalysisRequest.safeParse(input);
    if (!parsed.success) throw new LibInsightAnalysisError('bad-request', parsed.error.issues.map(i => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '));
    const { pack, site, folder } = loaded();
    const insight = writesInsightRequests(pack.contract.version), data = parsed.data;
    if (insight && data.rule === undefined) throw new LibInsightAnalysisError('bad-request', 'propose needs the rule: its name (like vmin_bottleneck), a short title and one plain sentence');
    if (insight && data.kit === undefined && data.sources.length === 0) throw new LibInsightAnalysisError('bad-request', 'name a Kit or at least one Liberty source: a rule needs Liberty data');
    const needs = [...new Set(['facts', ...data.needs])];
    const kitIssue = insight && data.kit ? await kitProblem(site, data.kit.name) : undefined;
    const at = now(), stamp = at.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const requestId = `req-${stamp}-${randomBytes(4).toString('hex').slice(0, 6)}`;
    const requestPath = pathsOf(site).join(folder, `${requestId}.json`);
    const kit = data.kit ? { name: data.kit.name, variants: data.kit.variants, corners: data.kit.corners } : undefined;
    const body = insight
      ? { schema: requestSchemaV2, requestId, question: data.question, rule: data.rule, kit: kit ?? null, sources: data.sources, netlists: data.netlists, design: data.design ?? null, needs, buildsOn: data.buildsOn, createdAt: at.toISOString() }
      : { schema: requestSchema, requestId, question: data.question, sources: data.sources, buildsOn: data.buildsOn, createdAt: at.toISOString() };
    await (deps.writeSiteFile ?? writeNewSiteFile)(site, requestPath, Buffer.from(`${JSON.stringify(body, null, 2)}\n`));
    // A preparation with overrides fills no Goal from defaults; this Pack's Goal is its own declared one.
    const goal = Object.fromEntries(Object.entries(pack.contract.goal ?? {}).map(([name, declared]) => [name, declared.default]));
    const overrides: PreparationOverrides = { goal, inputs: { [libInsightAnalysisDefaults.requestInput]: requestPath } };
    const proposal = deps.preparation(pack, site, overrides);
    const ready = proposal.ready && kitIssue === undefined;
    const unknowns = [...proposal.unknowns, ...(kitIssue ? [kitIssue] : [])];
    const row: IndexRow = { requestId, question: body.question, sources: body.sources, buildsOn: body.buildsOn, requestPath, createdAt: body.createdAt };
    for (const [id, held] of pending) if (held.sessionId === sessionId) pending.delete(id);
    const heard = deps.humanMessages?.(sessionId);
    pending.set(proposal.id, { sessionId, pack: packId, site: siteName, overrides, proposal, ready, row, ...(heard === undefined ? {} : { humanMessages: heard }) });
    return { proposalId: proposal.id, ready, requestId, question: body.question, sources: body.sources, buildsOn: body.buildsOn,
      ...(insight && data.rule ? { rule: data.rule } : {}), ...(insight && kit ? { kit } : {}), needs: insight ? needs : ['facts'],
      pack: { id: pack.contract.id, version: pack.contract.version }, site: siteName, timeBoxMinutes: proposal.budget.timeBoxMinutes.value,
      unknowns, nextActions: proposal.nextActions };
```
and add, inside `createLibInsightAnalyses` before `async function propose`, the catalogue check:
```ts
  /** Why a Kit name cannot be prepared on this Site, or undefined when its kit catalogue lists it. */
  async function kitProblem(site: Site, name: string): Promise<string | undefined> {
    const at = site.bindings.kitCatalog;
    if (typeof at !== 'string' || !at.startsWith('/')) return `The Site ${site.name} binds no kit catalogue, so the Kit ${name} cannot be found.`;
    let parsed: { kits?: { name?: unknown }[] };
    try { parsed = JSON.parse(Buffer.from(await (deps.readSiteFile ?? ((s: Site, p: string) => channelFor(s).readFile(p)))(site, at)).toString('utf8')) as typeof parsed; }
    catch (error) { return `The Site kit catalogue ${at} cannot be read: ${(error as Error).message}`; }
    const names = Array.isArray(parsed.kits) ? parsed.kits.map(kit => String(kit.name)) : [];
    return names.includes(name) ? undefined : `The Kit ${name} is not in the Site kit catalogue (known: ${names.join(', ') || 'none'}).`;
  }
```

(e) In `confirm`, replace `if (!held.proposal.ready) throw` with `if (!held.ready) throw`.

(f) In `detail`, replace the two lines
```ts
      const value = JSON.parse(bytes.toString('utf8')) as LibInsightAnalysisResult;
      if (value?.schema !== analysisSchema || !Array.isArray(value.plots) || typeof value.datasets !== 'object' || value.datasets === null) return { ...answer, resultUnavailable: 'The accepted result is not a recognised analysis document.' };
```
with
```ts
      const value = JSON.parse(bytes.toString('utf8')) as unknown;
      if (isInsightResult(value)) return { ...answer, insight: value };
      const analysis = value as LibInsightAnalysisResult;
      if (analysis?.schema !== analysisSchema || !Array.isArray(analysis.plots) || typeof analysis.datasets !== 'object' || analysis.datasets === null) return { ...answer, resultUnavailable: 'The accepted result is not a recognised analysis document.' };
      return { ...answer, result: analysis };
```
and delete the following line `      return { ...answer, result: value };`.

(g) In `tool`, change the `propose` call to pass the new fields:
```ts
      const proposal = await propose(sessionId, { question: args.question, sources: [...args.sources ?? []], buildsOn: [...args.buildsOn ?? []],
        ...(args.rule ? { rule: { ...args.rule, parameters: [...args.rule.parameters] } } : {}),
        ...(args.kit ? { kit: { name: args.kit.name, variants: [...args.kit.variants ?? []], corners: [...args.kit.corners ?? []] } } : {}),
        netlists: [...args.netlists ?? []],
        ...(args.design ? { design: args.design } : {}), needs: [...args.needs ?? ['facts']] });
      return { action: 'propose', ...proposal,
        next: proposal.ready ? 'Show this proposal to the person in your own words: the rule name and its sentence first, then the Kit, parameters and time box. Ask whether to start it, and end your turn. Call confirm with this proposalId only after they explicitly agree in their next message; if they correct the rule or a parameter, propose again.'
          : 'This proposal is not ready; tell the person what it lists and what would resolve it. Do not confirm it.' };
```
and replace the `result` return (from `const result = read.result;` to the end of that `return {...}` statement) with:
```ts
    const result = read.result, insight = read.insight;
    const shared = { action: 'result', runId: args.runId, page: page(args.runId), ...(entry.status ? { status: entry.status } : {}), ...(entry.task ? { task: entry.task } : {}),
      admission: read.admission, ...(entry.analysis?.id && entry.analysis.version ? { analysis: `${entry.analysis.id}@${String(entry.analysis.version)}` } : {}),
      ...(read.resultUnavailable ? { resultUnavailable: read.resultUnavailable } : {}) };
    if (insight) {
      return { ...shared, question: insight.question, summary: insight.summary, assumptions: insight.assumptions, limits: insight.limits,
        insight: { ref: `${insight.id}@${String(insight.version)}`, rule: { id: insight.id, title: insight.rule.title, sentence: insight.rule.sentence },
          headline: insight.library.headline, counts: insight.library.counts, score: insight.score },
        charts: [...insight.library.charts, ...insight.items.charts].map(chart => ({ title: chart.title, kind: chart.kind })),
        actions: insight.actions.map(action => ({ kind: action.kind, title: action.title, who: action.who })),
        datasets: boundedDatasets(insight.datasets), sources: insight.sources, run: insight.run,
        next: read.admission.admitted ? 'Report the headline in one plain sentence, say which rule and sentence it answers, and tell the person that the Open in Data Insight button on this card shows its charts, cells and files. Name the limits. Do not paste page paths; they are not links in the conversation.'
          : 'Explain where the analysis stands or why it was not admitted, from these facts; do not present an unadmitted result as established.' };
    }
    return { ...shared, ...(result ? { question: result.question, summary: result.summary, assumptions: result.assumptions, limits: result.limits,
        plots: result.plots.map(plot => ({ title: plot.title, kind: plot.kind, dataset: plot.dataset })),
        datasets: boundedDatasets(result.datasets), sources: result.sources, run: result.run } : {}),
      next: read.admission.admitted ? 'Explain the verified outcome from these datasets (the summary is the resident\'s reading of them) and name its limits. The charts are on the analysis page: point the person to the Open analysis page button on this result, and do not paste the page path, which is not a link in the conversation.'
        : 'Explain where the analysis stands or why it was not admitted, from these facts; do not present an unadmitted result as established.' };
```

(h) Extend `LibInsightAnalysisToolArgs`:
```ts
export interface LibInsightAnalysisToolArgs {
  readonly action: 'propose' | 'confirm' | 'list' | 'result';
  readonly question?: string;
  readonly rule?: LibInsightRule;
  readonly kit?: { readonly name: string; readonly variants?: readonly string[]; readonly corners?: readonly string[] };
  readonly sources?: readonly string[];
  readonly netlists?: readonly string[];
  readonly design?: { readonly netlist: string; readonly timingReport: string };
  readonly needs?: readonly ('facts' | 'netlists' | 'design')[];
  readonly buildsOn?: readonly string[];
  readonly proposalId?: string;
  readonly runId?: string;
}
```

- [ ] **Step 4: Teach the Guide tool the new fields**

In `packages/harness/src/tools.ts`, replace the `hima_insight_analysis` `description` and `parameters` with:
```ts
    description:'Library insight rules run by the resident engineering agent (ADR-0021, ADR-0022). Use it when the person asks a library question: map it to a rule the libinsight-analysis Pack offers (the inventory lists them) or to a new rule with a snake_case name and one plain sentence. The resident writes and runs the rule on the analysis Site from prepared Liberty facts; the Pack Reader checks the result with LibInsight\'s validator, and only an admitted result is established. Actions: propose {question, rule, kit | sources, needs?, netlists?, design?, buildsOn?} writes the request and prepares a bounded proposal; it starts nothing. Show the rule name and sentence and ask the person to confirm. confirm {proposalId} starts the Run; call it only after the person explicitly agrees in this conversation. list shows this project\'s analyses. result {runId} reads one: status, admission, the rule, headline, charts, actions, bounded datasets. needs: always facts; add netlists for a redesign brief; add design (with design {netlist, timingReport} Site paths) for a design rule.',
    parameters:{action:{type:'string',required:true,enum:['propose','confirm','list','result']},
      question:{type:'string',description:'propose: the person\'s question in their words.'},
      rule:{type:'object',description:'propose: {id: snake_case rule name, title, sentence: one plain sentence (at most 300 characters), parameters: [{name, value, meaning, unit?}]}. Use an offered rule\'s id, sentence and parameters, changed only as the person asked.'},
      kit:{type:'object',description:'propose: {name: a Kit of the Site kit catalogue such as saed14, variants?: [...], corners?: [...]} to analyse.'},
      sources:{type:'array',items:{type:'string'},description:'propose: absolute Site paths of .lib files, when no Kit is named.'},
      netlists:{type:'array',items:{type:'string'},description:'propose: absolute Site paths of cell netlists beyond the Kit\'s own.'},
      design:{type:'object',description:'propose: {netlist, timingReport} absolute Site paths, for a design rule.'},
      needs:{type:'array',items:{type:'string'},description:'propose: facts, and netlists and/or design when the rule needs them.'},
      buildsOn:{type:'array',items:{type:'string'},description:'propose: admitted results to build on, as id@version.'},
      proposalId:{type:'string',description:'confirm: the proposalId returned by propose.'},
      runId:{type:'string',description:'result: the analysis Run.'}},
```

- [ ] **Step 5: Build and run the tests to verify they pass**

```bash
pnpm run build && pnpm run typecheck
pnpm run test:local --files test/contract/libinsight-analyses.test.ts
node scripts/run-contract-tests.mjs atcs-dry --files test/contract/libinsight-resident-durable.host.test.ts
```
Expected: all PASS; the durable L2 still runs Pack 0.1 with request `/1` (the Host writes `/1` for it).

- [ ] **Step 6: Commit and push**

```bash
git add packages/harness/src/libinsight-analyses.ts packages/harness/src/tools.ts test/contract/libinsight-analyses.test.ts
git commit -m "feat(harness): insight rule requests and results in hima_insight_analysis

Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---
### Task 10: Pack 0.2.0 route switch, Site bindings and the durable L2

**Files:**
- Rewrite: `packs/libinsight-analysis/contract.yml`, `packs/libinsight-analysis/graph.yml`
- Modify: `packs/libinsight-analysis/schemas/tasks.json` (patch script below), `packs/libinsight-analysis/semantics.yml` (drop `li_analysis_*`)
- Rewrite: `packs/libinsight-analysis/flow/libinsight_analysis/delivery.py`, `library.py`
- Modify: `packs/libinsight-analysis/flow/libinsight_analysis/request.py`, `tasks.py`, `flow/libinsight_cli.py`, `flow/tests/synthetic.py`
- Delete: `packs/libinsight-analysis/tools/read-analysis.py`, `readers/libinsight-analysis.yml`, `rules/analysis-delivery-ready.yml`, `flow/tests/test_delivery.py`, `flow/tests/test_tasks.py`
- Create: `packs/libinsight-analysis/flow/tests/test_route.py`
- Modify: `sites/linglong-libinsight/site.yml`, `permit.yml`, `README.md`; Create: `sites/linglong-libinsight/kits.json`, `sites/linglong-libinsight/engineering-capabilities-libinsight-v2.json`
- Modify: `test/fixtures/libinsight-resident-dry/acp.py`, `test/contract/support/libinsight-resident-durable-worker.ts`, `test/contract/support/libinsight-analyses-guide-worker.ts`, `test/contract/libinsight-resident-durable.host.test.ts`
- Modify: `scripts/package-trial.mjs` (`assertLibInsightPackAssets`), `test/contract/trial-package.test.ts` (its fixture)

**Interfaces:**
- Consumes: Tasks 4–8 (request `/2`, `prepare-data`, Reader `libinsight-insight`, reference rules); Task 9 (Host writes `/2` for Pack ≥ 0.2.0).
- Produces: the route `prepare-request → prepare-data → custom-analysis → admit-analysis → deliver`; contract inputs `kitCatalog`, `factsStore`, `qualibRunner`, `qualibPython`, `qualibApiHome`; outputs `preparedData` (`state/prepared-data.json`); admission adds `resultSchema` and `rule {title, sentence}`; `deliver` value `analysis = {id, version, summary, headline, charts, items, datasets}`; library entries `<library>/<rule id>/v<version>/{admission.json, analysis-result.json, analysis/...}` (analysis/1 entries stay readable for `buildsOn`).

- [ ] **Step 1: Write the failing route test**

`packs/libinsight-analysis/flow/tests/test_route.py`:
```python
"""The 0.2 route on real small files: prepare-request, prepare-data, a reference rule as the resident runs it,
the Host's materialization, the Reader, admission and the final report; and the CLI task ABI."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from libinsight_analysis import common, library, tasks  # noqa: E402
import synthetic  # noqa: E402
import synthetic_kit  # noqa: E402

RULE = "size_coverage_gaps"


class Route(unittest.TestCase):
    def setUp(self):
        self.base = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.base)
        self.paths = synthetic_kit.prepared(self.base, synthetic_kit.catalog_rule(RULE), corners=["0p80v125c"])
        self.workspace = self.paths["workspace"]
        self.library = os.path.join(self.base, "library")

    def deliver(self, private="private", summary=None):
        """Run the rule in a private workspace, materialize its candidate, run the Reader; returns admit inputs."""
        folder = os.path.join(self.base, private)
        synthetic_kit.run_rule(folder, os.path.join(synthetic_kit.FLOW, "reference_rules", RULE + ".py"),
                               self.paths["prepared"], self.paths["data"])
        if summary is not None:
            result_path = os.path.join(folder, "analysis-result.json")
            with open(result_path) as stream:
                doc = json.load(stream)
            doc["summary"] = summary
            with open(result_path, "w") as stream:
                json.dump(doc, stream)
        result = synthetic.materialize(folder, self.workspace)
        readers = tempfile.mkdtemp(dir=self.workspace)
        report, out = os.path.join(readers, "input-report"), os.path.join(readers, "values.json")
        shutil.copyfile(result, report)
        completed = subprocess.run([sys.executable, synthetic_kit.READER, report, out, self.workspace],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(completed.returncode, 0, completed.stderr.decode())
        with open(out) as stream:
            values = json.load(stream)["values"]
        digest = common.sha256_file(report)
        ref = {"runId": "run-test", "taskId": "custom-analysis", "effectId": "e", "name": "domain-report",
               "path": os.path.relpath(report, self.workspace), "sha256": digest}
        return {"READER_VALUE": {"observations": [{"id": "obs", "contentSha256": digest, "values": values}],
                                 "engineering": {"outcome": "completed", "summary": "done", "stopReason": "analysis complete"}},
                "DOMAIN_REPORT": ref, "PREPARED": self.paths["value"], "PREPARED_DATA": self.paths["data_value"],
                "ANALYSIS_LIBRARY": self.library}

    def test_admission_is_idempotent_and_refuses_a_conflicting_version(self):
        inputs = self.deliver()
        first = library.admit_task(self.workspace, inputs)
        self.assertTrue(first["admitted"])
        self.assertEqual(first["resultSchema"], "hima-libinsight-insight/1")
        self.assertEqual(first["rule"]["title"], "Size coverage gaps")
        target = os.path.join(self.library, RULE, "v1")
        self.assertEqual(sorted(os.listdir(target)), ["admission.json", "analysis", "analysis-result.json"])
        self.assertEqual(sorted(os.listdir(os.path.join(target, "analysis"))), ["insight_builder.py", RULE + ".py"])
        self.assertTrue(library.admit_task(self.workspace, inputs)["reused"])
        shutil.rmtree(os.path.join(self.workspace, "analysis"))
        changed = self.deliver(private="private2", summary="A different result under the same version.")
        with self.assertRaises(common.LiaError) as raised:
            library.admit_task(self.workspace, changed)
        self.assertEqual(raised.exception.code, "version-conflict")

    def test_a_blocked_outcome_is_reported_and_not_admitted(self):
        inputs = self.deliver()
        inputs["READER_VALUE"]["engineering"] = {"outcome": "blocked", "summary": "licence", "stopReason": "QuaLib licence not served"}
        value = library.admit_task(self.workspace, inputs)
        self.assertFalse(value["admitted"])
        delivered, _ = tasks.deliver_task(self.workspace, {"ADMISSION": value, "PREPARED": inputs["PREPARED"], "TARGET_ADMITTED": 1})
        self.assertFalse(delivered["goalMet"])

    def test_deliver_reports_the_rule_and_its_headline(self):
        inputs = self.deliver()
        admission = library.admit_task(self.workspace, inputs)
        value, artifacts = tasks.deliver_task(self.workspace, {"ADMISSION": admission, "PREPARED": inputs["PREPARED"], "TARGET_ADMITTED": 1})
        self.assertTrue(value["goalMet"])
        self.assertEqual(value["analysis"]["charts"], 3)
        self.assertEqual(value["analysis"]["items"], 2)
        self.assertTrue(value["analysis"]["headline"].startswith("2 of "))
        with open(os.path.join(self.workspace, "delivery", "REPORT.md")) as stream:
            report = stream.read()
        self.assertIn("Admitted: size_coverage_gaps@1", report)
        self.assertIn("A function has a size gap", report)

    def test_cli_task_abi_and_check_delivery(self):
        cli = os.path.join(self.workspace, "flow", "libinsight_cli.py")
        task_input, output = os.path.join(self.base, "input.json"), os.path.join(self.base, "output.json")
        with open(task_input, "w") as stream:
            json.dump({"PREPARED": self.paths["value"], "FACTS_STORE": self.paths["store"], "QUALIB_RUNNER": "",
                       "QUALIB_PYTHON": "", "QUALIB_API_HOME": ""}, stream)
        completed = subprocess.run([sys.executable, cli, "task-prepare-data", self.workspace, task_input, output])
        self.assertEqual(completed.returncode, 0)
        with open(output) as stream:
            self.assertEqual(json.load(stream)["value"]["facts"], 4)
        folder = os.path.join(self.base, "private-cli")
        synthetic_kit.run_rule(folder, os.path.join(synthetic_kit.FLOW, "reference_rules", RULE + ".py"),
                               self.paths["prepared"], self.paths["data"])
        check = subprocess.run([sys.executable, cli, "check-delivery", folder], stdout=subprocess.PIPE)
        self.assertEqual(check.returncode, 0, check.stdout)
        self.assertTrue(check.stdout.startswith(b"accepted "))
        old = subprocess.run([sys.executable, cli, "task-prepare-request", self.workspace, os.path.join(self.base, "absent.json"), output],
                             stderr=subprocess.PIPE)
        self.assertEqual(old.returncode, 2)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_route.py'
```
Expected: FAIL (`KeyError: 'resultSchema'`, and `the libinsight-analysis Reader did not accept` because admission still reads `li_analysis_error_count`).

- [ ] **Step 3: Rewrite `delivery.py` for insight results only**

`packs/libinsight-analysis/flow/libinsight_analysis/delivery.py`:
```python
"""The hima-libinsight-insight/1 delivery: LibInsight's vendored validator plus the checks only this Run can
make, shared by the Reader, admit-analysis and the resident's own `check-delivery` (ADR-0022).

`insight_problems(...)` returns precise sentences; an empty list is the only acceptance. A Reader rejection
is sent back to the same resident task as its repair message.
"""
from . import common, vendored

MAX_BYTES = 4 * 1024 * 1024


def _design_unchanged(prepared_data, current_sha, out):
    design = (prepared_data or {}).get("design") or {}
    for key in ("netlist", "timingReport"):
        item = design.get(key)
        if not item:
            continue
        try:
            now = current_sha(item["path"])
        except (OSError, common.LiaError) as error:
            out.append("design %s %s cannot be re-hashed: %s" % (key, item["path"], getattr(error, "detail", error)))
            continue
        if now != item["sha256"]:
            out.append("design %s %s changed while the analysis ran (prepared sha256 %s, now %s)" % (
                key, item["path"], item["sha256"], now))


def insight_problems(doc, root, prepared, prepared_data, byte_size, current_sha=common.sha256_file, require_validator=False):
    """(problems, deferred) for a hima-libinsight-insight/1 delivery.

    LibInsight's vendored validator checks the result and, given the prepared request, the root that resolves
    code paths, the delivered byte size and the hash function, everything the 0.1 Reader checked (sources bound
    to the prepared request and re-hashed, code files on disk, run, datasets, nulls, size). The Pack adds what
    only this Run knows: the rule the person confirmed and the design files prepare-data hashed. `deferred`
    says why the validator did not run here, or is None when it ran."""
    if not isinstance(doc, dict) or doc.get("schema") != common.INSIGHT_SCHEMA:
        found = doc.get("schema") if isinstance(doc, dict) else None
        return ["schema must be %s, not %r; this Pack admits insight results (see insight-result-contract.md)" % (
            common.INSIGHT_SCHEMA, found)], None
    out = []
    confirmed = (prepared.get("rule") or {}).get("id")
    if doc.get("id") != confirmed:
        out.append("id %r must be the rule the person confirmed: %s" % (doc.get("id"), confirmed))
    _design_unchanged(prepared_data, current_sha, out)
    deferred = None
    try:
        validator = vendored.load("insight_result")
    except common.LiaError as error:
        if require_validator:
            out.append("Pack defect, not repairable in this task: %s" % error.detail)
        else:
            deferred = error.detail
    else:
        try:
            out.extend(str(problem) for problem in validator.validate(
                doc, prepared=prepared, root=root, byte_size=byte_size, current_sha=current_sha))
        except Exception as error:  # a crash of the validator is the Pack's problem, never an acceptance
            out.append("Pack defect, not repairable in this task: LibInsight's validator failed: %s: %s" % (
                type(error).__name__, error))
    seen, unique = set(), []
    for line in out:
        if line not in seen:
            seen.add(line)
            unique.append(line)
    return unique, deferred


def insight_measures(doc):
    """Counts the Reader emits for an accepted insight result."""
    items = doc["datasets"].get(doc["items"]["dataset"], {}).get("rows", [])
    charts = len(doc["library"].get("charts", [])) + len(doc["items"].get("charts", []))
    return {"items": len(items), "actions": len(doc["actions"]), "charts": charts, "datasets": len(doc["datasets"])}


def load_result(path):
    """(document, bytes) of a delivered result file, raising LiaError with a precise reason."""
    common.plain_file(path, "insight result")
    with open(path, "rb") as stream:
        data = stream.read()
    if len(data) > MAX_BYTES:
        raise common.LiaError("invalid-result", "result is %d bytes; a delivery is at most %d bytes (4 MiB)" % (len(data), MAX_BYTES))
    try:
        return common.loads_strict(data.decode("utf-8")), data
    except (UnicodeDecodeError, ValueError) as error:
        raise common.LiaError("invalid-result", "result is not strict UTF-8 JSON: %s" % error)
```

- [ ] **Step 4: Admit insight results**

In `packs/libinsight-analysis/flow/libinsight_analysis/library.py`:

(a) in `_observation`, replace the two lines reading `li_analysis_error_count` with:
```python
    errors = values.get("li_insight_error_count", {}).get("value")
    if errors != 0:
        raise LiaError("invalid-result", "the libinsight-insight Reader did not accept this delivery (error count %r)" % (errors,))
```
(b) replace `admission_document` with:
```python
def admission_document(doc, target, files):
    return {
        "schema": common.ADMISSION_SCHEMA,
        "id": doc["id"],
        "version": doc["version"],
        "path": target,
        "question": doc["question"],
        "resultSchema": doc["schema"],
        "rule": {"title": doc["rule"]["title"], "sentence": doc["rule"]["sentence"]},
        "resultSha256": common.sha256_bytes(files["analysis-result.json"]),
        "codeSha256s": dict((path, common.sha256_bytes(data)) for path, data in sorted(files.items())
                            if path != "analysis-result.json"),
    }
```
(c) in `admit_task`, replace the lines from `prepared = common.read_json_file(prepared_path, "prepared request")` to the `raise LiaError("invalid-result", "admission re-check …` line with:
```python
    prepared = common.read_json_file(prepared_path, "prepared request")
    data_path = os.path.join(workspace, common.PREPARED_DATA_PATH)
    if common.sha256_file(data_path) != (inputs.get("PREPARED_DATA") or {}).get("preparedDataSha256"):
        raise LiaError("identity-mismatch", "prepared data changed after prepare-data committed it")
    prepared_data = common.read_json_file(data_path, "prepared data")
    doc, data = delivery.load_result(report)
    found, _ = delivery.insight_problems(doc, workspace, prepared, prepared_data, len(data), require_validator=True)
    if found:
        raise LiaError("invalid-result", "admission re-check refused the accepted delivery: " + "; ".join(found[:5]))
```

- [ ] **Step 5: Report the rule; drop request `/1`**

In `packs/libinsight-analysis/flow/libinsight_analysis/tasks.py`, replace `_markdown` and the `"analysis": {…}` entry of `deliver_task` with:
```python
def _markdown(value, doc):
    lines = ["# LibInsight insight rule", "", "Request: %s" % value["requestId"], "", "Question: %s" % value["question"], ""]
    if value["admitted"]:
        lines += ["Admitted: %s@%d at %s%s" % (value["id"], value["version"], value["path"],
                                                " (identical version already admitted)" if value.get("reused") else ""), "",
                  "Rule: %s (%s)" % (doc["rule"]["title"], doc["id"]), "", "> %s" % doc["rule"]["sentence"], "",
                  "Headline: %s" % doc["library"]["headline"], "", "Resident outcome: %s" % value.get("outcome"), "",
                  "## Summary", "", doc["summary"], "", "## Charts", ""]
        lines += ["- %s `%s` (%s)" % (chart["kind"], chart["id"], chart["title"]) for chart in doc["library"]["charts"] + doc["items"]["charts"]]
        lines += ["", "## Actions", ""]
        lines += ["- %s for %s: %s" % (action["kind"], action["who"].replace("_", " "), action["title"]) for action in doc["actions"]] or ["- none"]
        lines += ["", "## Sources", ""]
        lines += ["- %s %s sha256 %s" % (source["kind"], source["path"], source["sha256Before"]) for source in doc["sources"]]
        lines += ["", "## Code", "", "Main script `%s` sha256 %s; run `%s` exit %d in %.3f s." % (
            doc["code"]["main"]["path"], doc["code"]["main"]["sha256"], doc["run"]["command"], doc["run"]["exitCode"],
            doc["run"]["elapsedSeconds"]), "", "## Assumptions", ""]
        lines += ["- " + item for item in doc["assumptions"]] or ["- none stated"]
        lines += ["", "## Limits", ""]
        lines += ["- " + item for item in doc["limits"]] or ["- none stated"]
    else:
        lines += ["Not admitted: %s" % value["reason"], "", "The Reader-checked result is retained for inspection but was "
                  "not added to the analysis library.", "", "## Summary", "", doc["summary"]]
    return "\n".join(lines) + "\n"
```
```python
        "analysis": {"id": doc["id"], "version": doc["version"], "summary": doc["summary"],
                     "headline": doc["library"]["headline"],
                     "charts": len(doc["library"]["charts"]) + len(doc["items"]["charts"]),
                     "items": len(doc["datasets"][doc["items"]["dataset"]]["rows"]), "datasets": len(doc["datasets"])},
```
In `prepare_task`, delete the `else:` branch with `request.goal_text(...)` (a prepared document is always `/2` now) and un-indent the `/2` branch.

In `packs/libinsight-analysis/flow/libinsight_analysis/request.py`: delete `REQUEST_KEYS`, `validate_request` and `goal_text`; replace `prepare` with:
```python
def prepare(workspace, request_path, library, corpus, capability_path, mode_file="", source_roots=None,
            kit_catalog_path="", facts_store=""):
    raw = common.read_json_file(request_path, "analysis request")
    if not isinstance(raw, dict) or raw.get("schema") != common.REQUEST_SCHEMA_V2:
        raise LiaError("invalid-input", "this Pack reads %s requests, which HimaHarness writes for libinsight-analysis "
                       "0.2.0 and later; got %r" % (common.REQUEST_SCHEMA_V2, raw.get("schema") if isinstance(raw, dict) else raw))
    return prepare_v2(workspace, request_path, validate_request_v2(raw), library, corpus, capability_path, mode_file,
                      source_roots, kit_catalog_path, facts_store)
```

In `packs/libinsight-analysis/flow/libinsight_cli.py`, replace `check_delivery` with:
```python
def check_delivery(argv):
    if not 1 <= len(argv) <= 4:
        return _fail("usage", "check-delivery ROOT [RESULT] [PREPARED] [PREPARED_DATA]", 2)
    root = os.path.abspath(argv[0])
    if len(argv) >= 2:
        result = argv[1] if os.path.isabs(argv[1]) else os.path.join(root, argv[1])
    else:
        result = os.path.join(root, "analysis-result.json")
        if not os.path.exists(result):
            result = os.path.join(root, common.RESULT_PATH)
    campaign = os.path.dirname(FLOW)
    prepared_path = argv[2] if len(argv) >= 3 else os.path.join(campaign, common.PREPARED_PATH)
    data_path = argv[3] if len(argv) == 4 else os.path.join(campaign, common.PREPARED_DATA_PATH)
    try:
        prepared = common.read_json_file(os.path.abspath(prepared_path), "prepared request")
        prepared_data = common.read_json_file(os.path.abspath(data_path), "prepared data")
        doc, data = delivery.load_result(os.path.abspath(result))
    except common.LiaError as error:
        print(error.detail)
        return 1
    found, deferred = delivery.insight_problems(doc, root, prepared, prepared_data, len(data))
    if found:
        for line in found:
            print(line)
        return 1
    note = "" if deferred is None else " (LibInsight's format checks run in the Reader: %s)" % deferred
    print("accepted %s sha256 %s: %s%s" % (result, common.sha256_bytes(data), json.dumps(delivery.insight_measures(doc), sort_keys=True), note))
    return 0
```

In `packs/libinsight-analysis/flow/tests/synthetic.py`, make `campaign` deploy everything `workspace.copy` names: replace its body after `os.makedirs(flow)` with:
```python
    shutil.copy(CLI, flow)
    for name in ("libinsight_analysis", "reference_rules", "reference_results"):
        source = os.path.join(FLOW, name)
        if os.path.isdir(source):
            shutil.copytree(source, os.path.join(flow, name), ignore=shutil.ignore_patterns("__pycache__"))
    return root
```

Delete the 0.1 files:
```bash
git rm packs/libinsight-analysis/tools/read-analysis.py packs/libinsight-analysis/readers/libinsight-analysis.yml packs/libinsight-analysis/rules/analysis-delivery-ready.yml packs/libinsight-analysis/flow/tests/test_delivery.py packs/libinsight-analysis/flow/tests/test_tasks.py
```
and remove the four `li_analysis_*` entries from `packs/libinsight-analysis/semantics.yml` (the `li_insight_*` entries of Task 6 stay).

- [ ] **Step 6: Rewrite the contract and graph**

`packs/libinsight-analysis/contract.yml`:
```yaml
id: libinsight-analysis
version: 0.2.0
title: LibInsight insight rules by the resident engineering agent
status: development
minimumHarnessVersion: 0.3.0
ontology:
  aliases:
    analysisResult:
    - insight rule result
    - library insight result
budget:
  timeBoxMs: 2700000
  closingReserveMs: 300000
  minimumGenerations: 1
inputs:
- name: analysisRequest
  description: Site path of one hima-libinsight-request/2 JSON file the Host writes for this Run (requestId, question,
    rule {id, title, sentence, parameters}, kit {name, variants, corners} or null, Liberty or facts sources, netlists,
    design {netlist, timingReport} or null, needs, buildsOn, createdAt). Each Run overrides it with its own file.
- name: analysisLibrary
  description: Site directory of admitted results, one <rule id>/v<version>/ folder each. admit-analysis adds the
    accepted delivery here; later requests build on it through buildsOn.
- name: factsCorpus
  description: Read-only Site directory of QuaLib-extracted lib-insight-facts/1 files. prepare-request looks every
    Liberty file up here by its SHA-256.
- name: factsStore
  description: Site directory of facts records prepare-data extracted with QuaLib and admitted, one
    <Liberty sha256>.json.gz each; later Runs find them like the corpus.
- name: kitCatalog
  description: Site hima-libinsight-kits/1 file naming each Kit's Liberty folders, its file-name pattern (variant,
    corner groups) and its cell-netlist folders.
- name: qualibRunner
  description: The Site's EDA command runner (edarun) under which prepare-data runs LibInsight's QuaLib extractor,
    one Liberty file per process.
- name: qualibPython
  description: The vendor Python of the QuaLib 2026 Liberty API runtime.
- name: qualibApiHome
  description: The QuaLib 2026 Liberty API folder (LIBERTY_API_HOME).
- name: engineeringCapabilities
  description: The Site's resident engineering capability. prepare-request reads its sandbox read-only roots to
    refuse a file the resident could not read.
- name: licenceModeFile
  description: The Site's one-word Empyrean licence mode file (`new` serves the QuaLib Liberty API, `old` serves
    XTop). prepare-request refuses a request whose Liberty files need extraction while the mode is not `new`; the Pack
    never changes it.
- name: sourceReadRoots
  description: The Site Permit's read roots as absolute directories separated by ':'. Pack tools run on the Site and
    cannot read the Permit, so the Site states the same roots here.
- name: workspaceRoot
  description: Campaign-private output root allowed by the Site Permit.
outputs:
- name: preparedRequest
  path: state/prepared-request.json
  description: hima-libinsight-prepared-request/2 — the request and rule, every source and Kit Liberty file with its
    sha256 and facts alternatives, netlists, design files, the extraction list and the admitted-result catalog.
- name: preparedData
  path: state/prepared-data.json
  description: hima-libinsight-prepared-data/1 — every Liberty file as a facts record (corpus, store or extracted
    now), the netlist facts and the design files, all hashed.
- name: analysisResult
  path: state/analysis-result.json
  reader: libinsight-insight
  description: The resident's hima-libinsight-insight/1 result — the rule and its sentence, typed datasets, the
    library overview, items, charts, typed actions, the score block, hashed sources, the exact code and how it ran.
- name: admission
  path: state/admission.json
  description: hima-libinsight-admission/1 — where the accepted result was admitted in the library, with result and
    code hashes, or why it was not admitted.
- name: finalReport
  path: delivery/report.json
  description: Explicit goalMet (the result was admitted), the rule, its headline, the library path and the Markdown
    report.
environment:
  wrappers:
  - python3
  - /usr/bin/python3
workspace:
  source: pack
  copy:
  - libinsight_cli.py
  - libinsight_analysis
  - reference_rules
  - reference_results
tools:
- id: prepare-request
  file: flow/libinsight_cli.py
  description: Validate the Host-written request and rule; resolve the Kit from the Site kit catalogue; hash every
    Liberty file, netlist and design file; look each Liberty file up in the facts corpus and store; list what needs
    extraction; resolve buildsOn.
  inputs:
  - WORKSPACE
  - TASK_INPUT
  - TASK_OUTPUT
  argv:
  - python3
  - ${WORKSPACE}/flow/libinsight_cli.py
  - task-prepare-request
  - ${WORKSPACE}
  - ${TASK_INPUT}
  - ${TASK_OUTPUT}
- id: prepare-data
  file: flow/libinsight_cli.py
  description: Give every Liberty file as facts — from the corpus or store, or extracted now with LibInsight's QuaLib
    extractor under the Site's runner and admitted to the store when its hashes before and after match — and read the
    cell netlists into netlist facts with LibInsight's netlist reader. Missing data stops the Run.
  inputs:
  - WORKSPACE
  - TASK_INPUT
  - TASK_OUTPUT
  licences:
    QuaLib-2026-new-59099: 1
  argv:
  - python3
  - ${WORKSPACE}/flow/libinsight_cli.py
  - task-prepare-data
  - ${WORKSPACE}
  - ${TASK_INPUT}
  - ${TASK_OUTPUT}
- id: custom-analysis
  file: flow/libinsight_cli.py
  description: Own the person's insight rule as a complete engineering task on this Site. Read the prepared request
    (the rule, its sentence and parameters) and the prepared data (facts records, netlist facts, design files); write
    the rule's script in the private workspace under analysis/, starting from the reference rule closest to it; run
    it on the Site with python3 and deliver one hima-libinsight-insight/1 result built with insight_builder.py. Check
    it with check-delivery before writing the delivery candidate. Do not change licences, start or switch licence
    services, write beside a source, use the network, or present prose in place of computed datasets.
  inputs:
  - WORKSPACE
  licences:
    QuaLib-2026-new-59099: 1
  argv:
  - python3
  - ${WORKSPACE}/flow/libinsight_cli.py
  - check-delivery
  - ${WORKSPACE}
  outsourcing:
    role: resident-engineering-agent
    reads:
    - preparedRequest
    - preparedData
    knowledge:
    - custom-analysis-contract.md
    - qualib-api-playbook.md
    - facts-schema.md
    - analysis-library.md
    - example-custom-analysis.md
    artifactPrefix: analysis
    produces: analysisResult
- id: admit-analysis
  file: flow/libinsight_cli.py
  description: Re-check the Reader-accepted result with the same checks and copy it and its code into the library as
    <rule id>/v<version>/; idempotent for identical content, refused for a different admitted version.
  inputs:
  - WORKSPACE
  - TASK_INPUT
  - TASK_OUTPUT
  argv:
  - python3
  - ${WORKSPACE}/flow/libinsight_cli.py
  - task-admit-analysis
  - ${WORKSPACE}
  - ${TASK_INPUT}
  - ${TASK_OUTPUT}
- id: deliver
  file: flow/libinsight_cli.py
  description: Write the final JSON and Markdown report (rule, sentence, headline) and a copy of the accepted result.
  inputs:
  - WORKSPACE
  - TASK_INPUT
  - TASK_OUTPUT
  argv:
  - python3
  - ${WORKSPACE}/flow/libinsight_cli.py
  - task-deliver
  - ${WORKSPACE}
  - ${TASK_INPUT}
  - ${TASK_OUTPUT}
rules:
- insight-delivery-ready
goal:
  admitted_analyses:
    type: number
    unit: count
    min: 1
    max: 1
    default: 1
words:
  admitted_analyses:
    label: Reader-accepted insight results admitted into the library
    unit: count
knowledge:
- file: custom-analysis-contract.md
  purpose: The 0.1 delivery contract; replaced by insight-result-contract.md in the knowledge task of this release.
- file: qualib-api-playbook.md
  purpose: How to program against the QuaLib 2026 Liberty API on linglong and how to run facts-mode scripts with python3.
- file: facts-schema.md
  purpose: The lib-insight-facts/1 record QuaLib extraction writes.
- file: analysis-library.md
  purpose: The admitted-result library layout and how to build on an admitted result through buildsOn.
- file: example-custom-analysis.md
  purpose: One verified 0.1 worked example; replaced by insight-playbook.md in the knowledge task of this release.
```

`packs/libinsight-analysis/graph.yml`:
```yaml
schema: hima-flow/1
id: libinsight-analysis
version: 0.2.0
flow:
  kind: sequence
  id: insight-rule-route
  steps:
  - kind: task
    id: prepare-request
    tool: prepare-request
    inputs:
      ANALYSIS_REQUEST: {source: runInput, path: [analysisRequest]}
      ANALYSIS_LIBRARY: {source: runInput, path: [analysisLibrary]}
      FACTS_CORPUS: {source: runInput, path: [factsCorpus]}
      FACTS_STORE: {source: runInput, path: [factsStore]}
      KIT_CATALOG: {source: runInput, path: [kitCatalog]}
      ENGINEERING_CAPABILITIES: {source: runInput, path: [engineeringCapabilities]}
      LICENCE_MODE_FILE: {source: runInput, path: [licenceModeFile]}
      SOURCE_READ_ROOTS: {source: runInput, path: [sourceReadRoots]}
    contract:
      input: {version: '1', schema: {$schema: https://json-schema.org/draft/2020-12/schema, $ref: schemas/tasks.json#/$defs/prepare-request-input}}
      output: {version: '1', schema: {$schema: https://json-schema.org/draft/2020-12/schema, $ref: schemas/tasks.json#/$defs/prepare-request-output}}
  - kind: task
    id: prepare-data
    tool: prepare-data
    inputs:
      PREPARED: {source: committedOutput, taskId: prepare-request, path: []}
      FACTS_STORE: {source: runInput, path: [factsStore]}
      QUALIB_RUNNER: {source: runInput, path: [qualibRunner]}
      QUALIB_PYTHON: {source: runInput, path: [qualibPython]}
      QUALIB_API_HOME: {source: runInput, path: [qualibApiHome]}
    contract:
      input: {version: '1', schema: {$schema: https://json-schema.org/draft/2020-12/schema, $ref: schemas/tasks.json#/$defs/prepare-data-input}}
      output: {version: '1', schema: {$schema: https://json-schema.org/draft/2020-12/schema, $ref: schemas/tasks.json#/$defs/prepare-data-output}}
  - kind: task
    id: custom-analysis
    tool: custom-analysis
    inputs:
      goal: {source: committedOutput, taskId: prepare-request, path: [goal]}
      REQUEST_ID: {source: committedOutput, taskId: prepare-request, path: [requestId]}
      QUESTION: {source: committedOutput, taskId: prepare-request, path: [question]}
      PREPARED_REQUEST: {source: committedOutput, taskId: prepare-request, path: [preparedPath]}
      PREPARED_SHA256: {source: committedOutput, taskId: prepare-request, path: [preparedSha256]}
      PREPARED_DATA: {source: committedOutput, taskId: prepare-data, path: [preparedDataPath]}
      PREPARED_DATA_SHA256: {source: committedOutput, taskId: prepare-data, path: [preparedDataSha256]}
    contract:
      input: {version: '1', schema: {$schema: https://json-schema.org/draft/2020-12/schema, $ref: schemas/tasks.json#/$defs/custom-analysis-input}}
      output: {version: '1', schema: {$schema: https://json-schema.org/draft/2020-12/schema, $ref: schemas/tasks.json#/$defs/custom-analysis-output}}
  - kind: task
    id: admit-analysis
    budget: closing
    tool: admit-analysis
    inputs:
      READER_VALUE: {source: committedOutput, taskId: custom-analysis, path: []}
      DOMAIN_REPORT: {source: artifactRef, taskId: custom-analysis, name: domain-report}
      PREPARED: {source: committedOutput, taskId: prepare-request, path: []}
      PREPARED_DATA: {source: committedOutput, taskId: prepare-data, path: []}
      ANALYSIS_LIBRARY: {source: runInput, path: [analysisLibrary]}
    contract:
      input: {version: '1', schema: {$schema: https://json-schema.org/draft/2020-12/schema, $ref: schemas/tasks.json#/$defs/admit-analysis-input}}
      output: {version: '1', schema: {$schema: https://json-schema.org/draft/2020-12/schema, $ref: schemas/tasks.json#/$defs/admit-analysis-output}}
  - kind: task
    id: deliver
    budget: closing
    tool: deliver
    inputs:
      ADMISSION: {source: committedOutput, taskId: admit-analysis, path: []}
      PREPARED: {source: committedOutput, taskId: prepare-request, path: []}
      TARGET_ADMITTED: {source: goal, path: [admitted_analyses]}
    contract:
      input: {version: '1', schema: {$schema: https://json-schema.org/draft/2020-12/schema, $ref: schemas/tasks.json#/$defs/deliver-input}}
      output: {version: '1', schema: {$schema: https://json-schema.org/draft/2020-12/schema, $ref: schemas/tasks.json#/$defs/deliver-output}}
```

- [ ] **Step 7: Patch the task schemas**

```bash
python3 - <<'EOF'
import json
path = "packs/libinsight-analysis/schemas/tasks.json"
with open(path) as stream:
    doc = json.load(stream)
d = doc["$defs"]
text = lambda: {"type": "string", "minLength": 1}
hex64 = {"type": "string", "pattern": "^[0-9a-f]{64}$"}
rule_id = "^[a-z0-9][a-z0-9_-]{1,62}$"
d["prepare-request-input"]["properties"].update(KIT_CATALOG=text(), FACTS_STORE=text())
d["prepare-request-input"]["required"] += ["KIT_CATALOG", "FACTS_STORE"]
out = d["prepare-request-output"]
out["properties"]["buildsOn"]["items"]["pattern"] = "^[a-z0-9][a-z0-9_-]{1,62}@[1-9][0-9]{0,8}$"
out["properties"]["rule"] = {"type": "object", "properties": {"id": {"type": "string", "pattern": rule_id},
    "title": {"type": "string", "minLength": 1, "maxLength": 120}, "sentence": {"type": "string", "minLength": 1, "maxLength": 300}},
    "required": ["id", "title", "sentence"], "additionalProperties": False}
out["properties"]["kit"] = {"type": ["string", "null"]}
out["properties"]["needs"] = {"type": "array", "minItems": 1, "maxItems": 3, "items": {"enum": ["facts", "netlists", "design"]}}
out["properties"]["extract"] = {"type": "array", "maxItems": 64, "items": text()}
out["required"] += ["rule", "kit", "needs", "extract"]
d["prepare-data-input"] = {"type": "object", "properties": {"PREPARED": {"$ref": "#/$defs/prepare-request-output"},
    "FACTS_STORE": text(), "QUALIB_RUNNER": text(), "QUALIB_PYTHON": text(), "QUALIB_API_HOME": text()},
    "required": ["PREPARED", "FACTS_STORE", "QUALIB_RUNNER", "QUALIB_PYTHON", "QUALIB_API_HOME"], "additionalProperties": False}
d["prepare-data-output"] = {"type": "object", "properties": {
    "preparedDataPath": {"type": "string", "const": "state/prepared-data.json"}, "preparedDataSha256": hex64,
    "facts": {"type": "integer", "minimum": 1}, "extracted": {"type": "integer", "minimum": 0},
    "netlistCells": {"type": "integer", "minimum": 0}, "design": {"type": "boolean"}},
    "required": ["preparedDataPath", "preparedDataSha256", "facts", "extracted", "netlistCells", "design"], "additionalProperties": False}
ci = d["custom-analysis-input"]
ci["properties"].update(PREPARED_DATA=text(), PREPARED_DATA_SHA256=hex64)
ci["required"] += ["PREPARED_DATA", "PREPARED_DATA_SHA256"]
ai = d["admit-analysis-input"]
ai["properties"]["PREPARED_DATA"] = {"$ref": "#/$defs/prepare-data-output"}
ai["required"].append("PREPARED_DATA")
ao = d["admit-analysis-output"]
ao["properties"]["id"]["pattern"] = rule_id
ao["properties"]["resultSchema"] = {"type": "string", "const": "hima-libinsight-insight/1"}
ao["properties"]["rule"] = {"type": "object", "properties": {"title": text(), "sentence": text()},
                            "required": ["title", "sentence"], "additionalProperties": False}
analysis = d["deliver-output"]["properties"]["analysis"]
analysis["properties"] = {"id": text(), "version": {"type": "integer", "minimum": 1}, "summary": text(),
    "headline": {"type": "string", "minLength": 1, "maxLength": 160}, "charts": {"type": "integer", "minimum": 0},
    "items": {"type": "integer", "minimum": 0}, "datasets": {"type": "integer", "minimum": 1}}
analysis["required"] = ["id", "version", "summary", "headline", "charts", "items", "datasets"]
with open(path, "w") as stream:
    stream.write(json.dumps(doc, indent=2) + "\n")
EOF
```

- [ ] **Step 8: Run the Pack suite**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'
```
Expected: PASS (`test_route.py`, Tasks 2–8 tests, and the unchanged `test_knowledge.py`).

- [ ] **Step 9: Bind the Site**

`sites/linglong-libinsight/kits.json` (paths only, no library data):
```json
{
  "schema": "hima-libinsight-kits/1",
  "kits": [
    {
      "name": "saed14",
      "title": "SAED14 standard cells (RVT, LVT, HVT, SLVT)",
      "release": "saed14",
      "libertyRoots": ["/data/eda/pdk/saed14/stdcell_rvt/db_nldm", "/data/eda/pdk/saed14/stdcell_lvt/db_nldm",
                       "/data/eda/pdk/saed14/stdcell_hvt/db_nldm", "/data/eda/pdk/saed14/stdcell_slvt/db_nldm"],
      "pattern": "^saed14(?P<variant>rvt|lvt|hvt|slvt)_(?P<corner>[a-z0-9]+)\\.lib$",
      "netlistRoots": [],
      "netlistPattern": "\\.(cdl|sp|spi|spice)$"
    }
  ]
}
```
(Task 17 fills `netlistRoots` with the SAED14 netlist folders found on linglong, and corrects a Liberty folder that does not exist there.)

`sites/linglong-libinsight/site.yml` — add under `bindings:` after `factsCorpus:`:
```yaml
  factsStore: /data/eda/project/hima_harness/libinsight-runs/facts
  kitCatalog: /data/eda/project/hima_harness/libinsight-runs/kits.json
  qualibRunner: /usr/local/bin/edarun
  qualibPython: /data/eda/venvs/qualib-libapi-2026-py37/bin/python
  qualibApiHome: /data/eda/software/eda_tools/empyrean/libapi-2026.master.c68db94/API
```
and change `engineeringCapabilities:` to `/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/engineering-capabilities-libinsight-v2.json`.

`sites/linglong-libinsight/permit.yml` — add `  - /data/eda/project/design_zoo` to `allowedReadRoots` after `/data/eda/project/techlib/tsmc28`, and append `:/data/eda/project/design_zoo` in the same position of `sourceReadRoots` in `site.yml` (the knowledge test checks both lists are equal).

`sites/linglong-libinsight/engineering-capabilities-libinsight-v2.json`: a copy of `engineering-capabilities-libinsight-v1.json` with two changes: `wrapper.argv[2]` names `…/engineering-capabilities-libinsight-v2.json`, and `sandbox.readOnlyRoots` gains `"/data/eda/project/hima_harness/libinsight-runs/facts"` and `"/data/eda/project/design_zoo"` after the `…/libinsight-runs/requests` entry:
```bash
python3 - <<'EOF'
import json
src = "sites/linglong-libinsight/engineering-capabilities-libinsight-v1.json"
dst = "sites/linglong-libinsight/engineering-capabilities-libinsight-v2.json"
with open(src) as stream:
    cap = json.load(stream)
cap["wrapper"]["argv"][2] = cap["wrapper"]["argv"][2].replace("-v1.json", "-v2.json")
cap["sandbox"]["readOnlyRoots"] += ["/data/eda/project/hima_harness/libinsight-runs/facts", "/data/eda/project/design_zoo"]
with open(dst, "w") as stream:
    stream.write(json.dumps(cap, indent=2) + "\n")
EOF
```
In `sites/linglong-libinsight/README.md`, add rows for `…/libinsight-runs/facts` (`factsStore`, written by prepare-data), `…/libinsight-runs/kits.json` (`kitCatalog`, copied from `kits.json` here) and `/data/eda/project/design_zoo` (read root for design rules); add to the install record: "3. (0.2) `kits.json` and `engineering-capabilities-libinsight-v2.json` copied unchanged, mode 0444, next to v1; `mkdir -p /data/eda/project/hima_harness/libinsight-runs/facts`"; add to Known constraints: "prepare-data runs `/usr/local/bin/edarun` from inside its python3 Job for each Liberty file that needs extraction (the Site binds it as `qualibRunner`); extraction needs licence mode `new`, which prepare-request checks first."

- [ ] **Step 10: Move the durable L2 and its ACP stand-in to the insight route**

`test/fixtures/libinsight-resident-dry/acp.py` — replace the `EXAMPLE = …` line with `SCRIPT = "size_coverage_gaps.py"`, the first docstring paragraph's "run the Pack's verified example script (`inv_drive_delay.py`) on the prepared facts source" with "run the Pack's reference rule `size_coverage_gaps.py` on the prepared data", and `candidate` and `analyse` with:
```python
def candidate(native, summary, outcome="completed"):
    artifacts = [{"path": "analysis-result.json", "sha256": sha(native / "analysis-result.json"), "kind": "result"}]
    artifacts += [{"path": "analysis/" + name, "sha256": sha(native / "analysis" / name), "kind": "support"}
                  for name in (SCRIPT, "insight_builder.py")]
    (native / "resident-delivery.json").write_text(json.dumps({
        "schema": "hima-resident-engineering-candidate/1", "outcome": outcome, "summary": summary,
        "stopReason": "analysis complete", "artifacts": artifacts}))


def analyse(native, campaign):
    flow = campaign / "flow"
    (native / "analysis").mkdir(exist_ok=True)
    shutil.copyfile(flow / "reference_rules" / SCRIPT, native / "analysis" / SCRIPT)
    shutil.copyfile(flow / "libinsight_analysis" / "insight_builder.py", native / "analysis" / "insight_builder.py")
    run = subprocess.run([sys.executable, "analysis/" + SCRIPT, "--prepared", str(campaign / "state/prepared-request.json"),
                          "--data", str(campaign / "state/prepared-data.json"), "--out", "analysis-result.json"],
                         cwd=native, capture_output=True, text=True, timeout=120)
    assert run.returncode == 0, run.stderr
    check = subprocess.run([sys.executable, str(flow / "libinsight_cli.py"), "check-delivery", str(native),
                            "analysis-result.json"], capture_output=True, text=True, timeout=60)
    assert check.returncode == 0, check.stdout + check.stderr
    return json.loads((native / "analysis-result.json").read_text())
```

`test/contract/support/libinsight-resident-durable-worker.ts` — replace the block from `// Synthetic facts in the extractor's exact shape;` through `await writeFile(requestFile,JSON.stringify({schema:'hima-libinsight-request/1',…}));` with:
```ts
// The synthetic Kit (stub Liberty files, their facts in the corpus, a kit catalogue); facts mode needs no licence.
const made=spawnSync('python3',['-c',`import sys,json;sys.path.insert(0,${JSON.stringify(packTests)});sys.path.insert(0,${JSON.stringify(path.dirname(packTests))});import synthetic_kit;print(json.dumps({"kit":synthetic_kit.write_kit(${JSON.stringify(path.join(workspace,'kit'))}),"rule":synthetic_kit.catalog_rule("size_coverage_gaps")}))`],{encoding:'utf8'});
assert.equal(made.status,0,made.stderr);
const {kit,rule}=JSON.parse(made.stdout) as {kit:{corpus:string;catalog:string};rule:{id:string}};
await writeFile(modeFile,'old\n');
const requestFile=path.join(requests,`${requestId}.json`);
const question='Where are the size gaps in the synthetic Kit, by track and VT?';
await writeFile(requestFile,JSON.stringify({schema:'hima-libinsight-request/2',requestId,question,rule,kit:{name:'synthetic',variants:[],corners:['0p80v125c']},
 sources:[],netlists:[],design:null,needs:['facts'],buildsOn:[],createdAt:'2026-10-08T13:00:00Z'}));
```
replace `factsCorpus:corpus,` in the `local.yml` bindings with
`factsCorpus:kit.corpus,factsStore:path.join(workspace,'facts-store'),kitCatalog:kit.catalog,qualibRunner:'/usr/bin/env',qualibPython:'/usr/bin/python3',qualibApiHome:workspace,`
and delete the now unused `corpus` constant from the `const admin=…` line and from the `mkdir` list. Replace the assertions after `const tasks=…` with:
```ts
 assert.deepEqual(tasks.map((task:any)=>task.taskId).sort(),['admit-analysis','custom-analysis','deliver','prepare-data','prepare-request']);
 for(const task of tasks)assert.equal(task.projection.state,'succeeded',JSON.stringify(task.projection));
 const byId=(id:string)=>tasks.find((task:any)=>task.taskId===id);
 assert.equal(byId('prepare-request').result.value.requestId,requestId);
 assert.equal(byId('prepare-request').result.value.rule.id,'size_coverage_gaps');
 assert.equal(byId('prepare-data').result.value.facts,4);
 const observation=byId('custom-analysis').result.value.observations[0];
 assert.equal(observation.outputName,'analysisResult');
 const value=(type:string)=>observation.values.find((row:any)=>row.type===type).value;
 assert.equal(value('li_insight_error_count'),0);assert.equal(value('li_insight_item_count'),2);assert.equal(value('li_insight_chart_count'),3);
 const admission=byId('admit-analysis').result.value;
 assert.equal(admission.admitted,true);assert.equal(admission.reused,false);assert.equal(admission.resultSchema,'hima-libinsight-insight/1');
 const target=path.join(library,'size_coverage_gaps','v1');assert.equal(admission.path,target);
 assert.deepEqual((await readdir(target)).sort(),['admission.json','analysis','analysis-result.json']);
 assert.deepEqual((await readdir(path.join(target,'analysis'))).sort(),['insight_builder.py','size_coverage_gaps.py']);
 const retained=await readFile(observation.retainedPath);
 assert.equal(createHash('sha256').update(retained).digest('hex'),observation.contentSha256,'Host retained the exact Reader input bytes');
 assert.deepEqual(await readFile(path.join(target,'analysis-result.json')),retained,'admitted result is the Reader-accepted bytes');
 const final=byId('deliver');assert.equal(final.result.value.goalMet,true);assert.equal(view.run.goalState,'met');
 assert.ok(final.result.artifacts.some((ref:any)=>ref.name==='final-report'));
 const report=await readFile(path.join(campaign,'delivery/REPORT.md'),'utf8');assert.match(report,/Admitted: size_coverage_gaps@1/);
```
In the same file change `view.tasks.filter((task:any)=>task.result).length===4` to `===5`, `'reader-libinsight-analysis'` to `'reader-libinsight-insight'`, the repair problems match to `assert.match(String(promptRows[1].problems),/^REJECTED delivery [0-9a-f]{64}\n- .*code\.main/);`, and `tasks:4` in the proof to `tasks:5`. In `test/contract/libinsight-resident-durable.host.test.ts` change `assert.equal(proof.tasks,4);` to `assert.equal(proof.tasks,5);`.

`test/contract/support/libinsight-analyses-guide-worker.ts` — apply the same Kit setup (replace the facts block with the `made`/`kit`/`rule` block above, without the request file; set `question` to `'Where are the size gaps in the synthetic Kit, by track and VT?'`), the same `local.yml` bindings change, and these assertion changes:
- `const proposed=await tool(guide,{action:'propose',question,sources:[facts]});` → `const proposed=await tool(guide,{action:'propose',question,rule,kit:{name:'synthetic',corners:['0p80v125c']}});`
- add after the `assert.match(proposal.requestId,…)` line: `assert.equal(proposal.rule.sentence,rule.sentence);assert.deepEqual(proposal.kit,{name:'synthetic',variants:[],corners:['0p80v125c']});`
- the `written` comparison → `assert.deepEqual({schema:written.schema,requestId:written.requestId,question:written.question,rule:written.rule,kit:written.kit,buildsOn:written.buildsOn},{schema:'hima-libinsight-request/2',requestId:proposal.requestId,question,rule,kit:{name:'synthetic',variants:[],corners:['0p80v125c']},buildsOn:[]});`
- the `entry.analysis` comparison → `assert.deepEqual({id:entry.analysis.id,version:entry.analysis.version,admitted:entry.analysis.admitted},{id:'size_coverage_gaps',version:1,admitted:true});`
- `assert.equal(answered.json.analysis,'saed14-inv-drive-delay@1');assert.equal(answered.json.plots.length,5);` → `assert.equal(answered.json.analysis,'size_coverage_gaps@1');assert.equal(answered.json.insight.ref,'size_coverage_gaps@1');assert.equal(answered.json.charts.length,3);assert.equal(answered.json.insight.rule.sentence,rule.sentence);`
- `assert.equal(detail.result.schema,'hima-libinsight-analysis/1');assert.equal(detail.result.plots.length,5);` → `assert.equal(detail.insight.schema,'hima-libinsight-insight/1');assert.equal(detail.result,undefined);`
- `assert.deepEqual(detail.result,JSON.parse(…` → `assert.deepEqual(detail.insight,JSON.parse(…`
- `path.join(library,'saed14-inv-drive-delay','v1','analysis-result.json')` → `path.join(library,'size_coverage_gaps','v1','analysis-result.json')`
- `done.html.includes('saed14-inv-drive-delay@1')` → `done.html.includes('size_coverage_gaps@1')`; delete the `for(const plot of detail.result.plots)…` line (Task 14 adds the insight page checks)
- the proof: `plots:detail.result.plots.length` → `charts:detail.insight.library.charts.length+detail.insight.items.charts.length`

and in `test/contract/libinsight-resident-durable.host.test.ts` change `assert.equal(proof.plots,5);` to `assert.equal(proof.charts,3);`.

- [ ] **Step 11: Update the packaging asset check**

In `scripts/package-trial.mjs` `assertLibInsightPackAssets`, replace `'tools/read-analysis.py'` with `'tools/read-insight.py', 'flow/libinsight_analysis/vendor/VENDOR.json'`. In `test/contract/trial-package.test.ts`, replace the fixture line
`    await writeFile(path.join(analysis, 'tools/read-analysis.py'), '# fixture\n'); await writeFile(path.join(analysis, 'flow/libinsight_cli.py'), '# fixture\n');` with
```ts
    await mkdir(path.join(analysis, 'flow/libinsight_analysis/vendor'), { recursive: true });
    await writeFile(path.join(analysis, 'tools/read-insight.py'), '# fixture\n'); await writeFile(path.join(analysis, 'flow/libinsight_cli.py'), '# fixture\n');
    await writeFile(path.join(analysis, 'flow/libinsight_analysis/vendor/VENDOR.json'), '{}\n');
```

- [ ] **Step 12: Run every affected check**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'
pnpm run build && pnpm run typecheck
pnpm run test:local --files test/contract/libinsight-analyses.test.ts test/contract/trial-package.test.ts
node scripts/run-contract-tests.mjs atcs-dry --files test/contract/libinsight-resident-durable.host.test.ts
```
Expected: all PASS — 3 durable cases (clean, repair, Guide) each through the five tasks and the Reader `reader-libinsight-insight` (`startRun` runs `checkPack` on the 0.2.0 contract and graph first).

- [ ] **Step 13: Commit and push**

```bash
git add -A packs/libinsight-analysis sites/linglong-libinsight test/fixtures/libinsight-resident-dry test/contract/support/libinsight-resident-durable-worker.ts test/contract/support/libinsight-analyses-guide-worker.ts test/contract/libinsight-resident-durable.host.test.ts test/contract/trial-package.test.ts scripts/package-trial.mjs
git status --short
git commit -m "feat(libinsight): 0.2.0 route prepare-data and insight results end to end

Pack libinsight-analysis 0.2.0: prepare-request -> prepare-data -> resident rule ->
libinsight-insight Reader (LibInsight's validator) -> admission -> report. Site binds the
kit catalogue, facts store and QuaLib runner. Durable L2 runs the size_coverage_gaps
reference rule through the real Host, wrapper, Reader and admission.
Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---
### Task 11: Guide recognition — Pack `offers` in the contract, the inventory and the product context

**Files:**
- Modify: `packages/harness/src/packs.ts` (`packOffer`, `packContract.offers`, `PackOverview.offers`, `packOverview`)
- Modify: `packages/harness/src/index.ts` (`HIMA_PRODUCT_CONTEXT`, `himaRuntimeContext`)
- Create: `test/contract/pack-offers.test.ts`; Modify: `test/contract-groups.json` (add it to `local`)
- Modify: `test/contract/product-context.host.test.ts`

**Interfaces:**
- Produces: `packOffer` (zod) `{id: ^[a-z0-9][a-z0-9_-]{1,62}$, title ≤ 80, sentence ≤ 300, example ≤ 300, parameters ≤ 12 × {name, value: number | string, meaning}}`; `packContract.offers` (≤ 12, default `[]`, so every existing Pack stays valid); `PackOverview.offers`; inventory line `Offers of <pack>: <id> "<title>": <sentence> Example: "<example>". Parameters: <name>=<value>, …`.

- [ ] **Step 1: Write the failing test**

`test/contract/pack-offers.test.ts`:
```ts
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { himaRuntimeContext, loadPack, packOverview } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';

// ADR-0022: a Pack names what it offers the Guide; the Guide inventory lists it so a library question is
// recognised as that Pack's work. An offer starts nothing.
const offer = '{"id": "vmin_bottleneck", "title": "Vmin bottlenecks", "sentence": "A cell is a Vmin bottleneck when it slows down more than the inverter.", "example": "Which cells limit my Vmin?", "parameters": [{"name": "watch", "value": 0.05, "meaning": "extra slowdown that flags a cell"}]}';

async function home(offers: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-offers-'));
  const packsDir = path.join(root, 'packs'), sitesDir = path.join(root, 'sites');
  await cp(path.join(repoRoot, 'packs/libinsight-analysis'), path.join(packsDir, 'libinsight-analysis'), { recursive: true, filter: p => !p.includes('__pycache__') });
  await mkdir(sitesDir, { recursive: true });
  const contract = path.join(packsDir, 'libinsight-analysis', 'contract.yml');
  const text = (await readFile(contract, 'utf8')).replace(/^offers:\n(?:- .*\n)*/m, '');
  await writeFile(contract, `${text}offers:\n${offers}`);
  return { packsDir, sitesDir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('a Pack offer is read, summarised and named in the Guide inventory', async () => {
  const f = await home(`- ${offer}\n`);
  try {
    const overview = packOverview(loadPack(f.packsDir, 'libinsight-analysis'));
    assert.equal(overview.offers.length, 1);
    assert.equal(overview.offers[0]!.sentence, 'A cell is a Vmin bottleneck when it slows down more than the inverter.');
    const inventory = himaRuntimeContext({ runs: () => [] } as never, f.packsDir, f.sitesDir, []);
    assert.match(inventory, /Offers of libinsight-analysis: vmin_bottleneck "Vmin bottlenecks": A cell is a Vmin bottleneck when it slows down more than the inverter\. Example: "Which cells limit my Vmin\?"\. Parameters: watch=0\.05\./);
  } finally { await f.cleanup(); }
});

test('an offer with a bad name or an over-long sentence is refused', async () => {
  const bad = await home(`- ${offer.replace('vmin_bottleneck', 'Vmin Bottleneck')}\n`);
  try { assert.throws(() => loadPack(bad.packsDir, 'libinsight-analysis'), /offers/); } finally { await bad.cleanup(); }
  const long = await home(`- ${offer.replace('A cell is a Vmin', `${'x'.repeat(300)} A cell`)}\n`);
  try { assert.throws(() => loadPack(long.packsDir, 'libinsight-analysis'), /offers/); } finally { await long.cleanup(); }
});
```
Add `"test/contract/pack-offers.test.ts",` to `local` in `test/contract-groups.json` after `"test/contract/pack.test.ts",`.

In `test/contract/product-context.host.test.ts`, after the line `assert.match(HIMA_PRODUCT_CONTEXT, /Do not search product source code/i);` add:
```ts
  assert.match(HIMA_PRODUCT_CONTEXT, /offered rule.*rule name and its sentence.*Open in Data Insight/i);
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm run build
pnpm run test:local --files test/contract/pack-offers.test.ts test/contract/product-context.host.test.ts
```
Expected: FAIL (`offers` is an unexpected contract key; the product context names no offered rule).

- [ ] **Step 3: Implement `offers`**

In `packages/harness/src/packs.ts`, before `export const packContract = z.strictObject({`, add:
```ts
/**
 * A named capability a Pack offers the Guide (ADR-0022): its name, one plain sentence, an example request and
 * the parameters a person may change. The Guide inventory lists offers so a person's words can be matched to one;
 * an offer starts nothing and carries no method of its own.
 */
export const packOffer = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,62}$/, 'an offer id is a rule name like vmin_bottleneck'),
  title: z.string().min(1).max(80),
  sentence: z.string().min(1).max(300),
  example: z.string().min(1).max(300),
  parameters: z.array(z.strictObject({ name: z.string().min(1).max(64), value: z.union([z.number(), z.string().max(200)]), meaning: z.string().min(1).max(300) })).max(12).default([]),
});
export type PackOffer = z.infer<typeof packOffer>;
```
in `packContract`, after `rules: z.array(z.string().min(1)).default([]),` add:
```ts
  /** What this Pack offers the Guide by name (ADR-0022); empty for a Pack that offers nothing by name. */
  offers: z.array(packOffer).max(12).default([]),
```
in `PackOverview`, after `readonly knowledge: …;` add `  readonly offers: readonly PackOffer[];`, and in `packOverview`, after `knowledge: pack.contract.knowledge,` add `    offers: pack.contract.offers,`.

- [ ] **Step 4: List offers for the Guide**

In `packages/harness/src/index.ts`, replace the last element of `HIMA_PRODUCT_CONTEXT`
(`'Data Insight shows the default library analyses. For a library question …'`) with:
```ts
  'Data Insight shows LibInsight\'s pages and the insight rules admitted for this Home. For a library question, use hima_insight_analysis: map the person\'s words to an offered rule from the inventory, or to a new rule with a snake_case name and one plain sentence; propose it, show the rule name and its sentence, confirm only after the person agrees in this conversation, and report the admitted headline with the Open in Data Insight button on the result card.',
```
and in `himaRuntimeContext`, replace `return [`HimaHarness: ${versionLine()}.`, packLine, siteLine, campaignLine].join('\n');` with:
```ts
  const offerLines = packs.flatMap((id) => {
    try {
      const offers = loadPack(packsDir, id).contract.offers;
      if (offers.length === 0) return [];
      return [`Offers of ${id}: ${offers.map((offer) => `${offer.id} "${offer.title}": ${offer.sentence} Example: "${offer.example}".${offer.parameters.length === 0 ? '' : ` Parameters: ${offer.parameters.map((p) => `${p.name}=${String(p.value)}`).join(', ')}.`}`).join(' ')}`];
    } catch {
      return [];
    }
  });
  return [`HimaHarness: ${versionLine()}.`, packLine, ...offerLines, siteLine, campaignLine].join('\n');
```

- [ ] **Step 5: Build and run the tests**

```bash
pnpm run build && pnpm run typecheck
pnpm run test:local --files test/contract/pack-offers.test.ts test/contract/product-context.host.test.ts test/contract/pack.test.ts test/contract/pack-method-assets.test.ts
```
Expected: PASS. A test that compares a whole `packOverview` with `deepEqual` and fails only on the new `offers: []` field is updated to include `offers: []` (name the file in the commit body).

- [ ] **Step 6: Commit and push**

```bash
git add packages/harness/src/packs.ts packages/harness/src/index.ts test/contract/pack-offers.test.ts test/contract/product-context.host.test.ts test/contract-groups.json
git commit -m "feat(harness): Packs name their offers; the Guide inventory lists them

Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---
### Task 12: Knowledge — insight playbook, result contract, rule catalogue; contract offers; Pack records

**Files:**
- Create: `packs/libinsight-analysis/knowledge/insight-playbook.md`, `insight-result-contract.md`, `rule-catalog.md`
- Modify: `packs/libinsight-analysis/knowledge/qualib-api-playbook.md`, `analysis-library.md`
- Delete: `packs/libinsight-analysis/knowledge/custom-analysis-contract.md`, `example-custom-analysis.md`, `flow/tests/fixtures/saed14-inv-drive-delay/`, `flow/tests/fixtures/qualib-live/analysis/live_inv_delivery.py`, `flow/tests/fixtures/qualib-live/analysis-result.json`, `flow/tests/fixtures/qualib-live/prepared-request.json`
- Modify: `packs/libinsight-analysis/contract.yml` (knowledge list, outsourcing knowledge, `offers`)
- Rewrite: `packs/libinsight-analysis/flow/tests/synthetic.py`, `flow/tests/test_knowledge.py`
- Rewrite: `packs/libinsight-analysis/INTENT.md`, `SPEC.md`, `FABRIC.md`, `TEST.md`

**Interfaces:**
- Consumes: `flow/reference_rules/catalog.json` (Task 7) as the single source of the rule catalogue; Task 11 `offers`.
- Produces: contract `offers` = the catalogue's `{id, title, sentence, example, parameters[{name, value, meaning}]}`; knowledge files the resident receives: `insight-playbook.md`, `insight-result-contract.md`, `rule-catalog.md`, `qualib-api-playbook.md`, `facts-schema.md`, `analysis-library.md`.

- [ ] **Step 1: Write the failing knowledge test**

Replace `packs/libinsight-analysis/flow/tests/test_knowledge.py` with:
```python
"""Knowledge carries the real reference script, the catalogue the contract offers, and the exact refusals."""
import json
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from libinsight_analysis import request  # noqa: E402
import synthetic_kit  # noqa: E402

PACK = synthetic_kit.PACK
KNOWLEDGE = os.path.join(PACK, "knowledge")


def read(path):
    with open(path, encoding="utf-8") as stream:
        return stream.read()


def embedded(doc, name, language):
    found = re.search(r"<!-- BEGIN %s -->\n```%s\n(.*?)```\n<!-- END %s -->" % (
        re.escape(name), language, re.escape(name)), read(os.path.join(KNOWLEDGE, doc)), re.S)
    if not found:
        raise AssertionError("%s has no embedded %s" % (doc, name))
    return found.group(1)


def catalogue():
    with open(synthetic_kit.CATALOG) as stream:
        return json.load(stream)["rules"]


class Knowledge(unittest.TestCase):
    def test_the_playbook_embeds_the_real_reference_rule(self):
        script = os.path.join(synthetic_kit.FLOW, "reference_rules", "size_coverage_gaps.py")
        self.assertEqual(embedded("insight-playbook.md", "size_coverage_gaps.py", "python"), read(script))

    def test_the_rule_catalogue_matches_its_json_source(self):
        text = read(os.path.join(KNOWLEDGE, "rule-catalog.md"))
        sections = dict((m.group(1), m.group(2)) for m in re.finditer(r"^## (\w+)\n(.*?)(?=^## |\Z)", text, re.M | re.S))
        rules = catalogue()
        self.assertEqual(sorted(sections), sorted(rule["id"] for rule in rules))
        for rule in rules:
            body = sections[rule["id"]]
            self.assertIn("- Sentence: %s\n" % rule["sentence"], body)
            self.assertIn('- Example prompt: "%s"\n' % rule["example"], body)
            self.assertIn("- Needs: %s\n" % ", ".join(rule["needs"]), body)
            self.assertIn("- Score: %s\n" % rule["dimension"], body)
            self.assertTrue(os.path.isfile(os.path.join(PACK, rule["script"])), rule["script"])
            self.assertTrue(os.path.isfile(os.path.join(synthetic_kit.FLOW, "reference_results", rule["id"] + ".json")))

    def test_the_contract_offers_the_catalogue(self):
        contract = read(os.path.join(PACK, "contract.yml"))
        offers = [json.loads(line[2:]) for line in contract.split("\noffers:\n", 1)[1].splitlines() if line.startswith("- {")]
        expected = [{"id": r["id"], "title": r["title"], "sentence": r["sentence"], "example": r["example"],
                     "parameters": [{"name": p["name"], "value": p["value"], "meaning": p["meaning"]} for p in r["parameters"]]}
                    for r in catalogue()]
        self.assertEqual(offers, expected)

    def test_the_qualib_playbook_keeps_the_live_script_and_the_licence_refusal(self):
        live = os.path.join(synthetic_kit.TESTS, "fixtures", "qualib-live", "analysis", "qualib_inv_tables.py")
        self.assertEqual(embedded("qualib-api-playbook.md", "qualib_inv_tables.py", "python"), read(live))
        playbook = read(os.path.join(KNOWLEDGE, "qualib-api-playbook.md")).replace("\n  ", " ")
        self.assertIn(request.XTOP_MODE_MESSAGE, playbook)
        self.assertNotIn("hima-libinsight-analysis/1", playbook)

    def test_linglong_site_source_read_roots_repeat_its_permit(self):
        site_dir = os.path.join(os.path.dirname(os.path.dirname(PACK)), "sites", "linglong-libinsight")
        if not os.path.isdir(site_dir):
            self.skipTest("Pack copied outside the repository")
        bound = re.search(r"^  sourceReadRoots: (\S+)$", read(os.path.join(site_dir, "site.yml")), re.M).group(1)
        permit = read(os.path.join(site_dir, "permit.yml"))
        roots = re.findall(r"^  - (\S+)$", permit.split("allowedReadRoots:")[1].split("allowedWriteRoots:")[0], re.M)
        self.assertEqual(bound.split(":"), roots)

    def test_every_declared_knowledge_file_exists_and_the_resident_gets_the_insight_ones(self):
        contract = read(os.path.join(PACK, "contract.yml"))
        declared = re.findall(r"^- file: (\S+)$", contract, re.M)
        for name in declared:
            self.assertTrue(os.path.isfile(os.path.join(KNOWLEDGE, name)), name)
        for name in ("insight-playbook.md", "insight-result-contract.md", "rule-catalog.md"):
            self.assertIn(name, declared)
            self.assertIn("    - %s\n" % name, contract)
        for gone in ("custom-analysis-contract.md", "example-custom-analysis.md"):
            self.assertNotIn(gone, contract)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_knowledge.py'
```
Expected: FAIL (`knowledge/insight-playbook.md` missing, no `offers:` in the contract).

- [ ] **Step 3: Write `insight-result-contract.md`**

`packs/libinsight-analysis/knowledge/insight-result-contract.md`:
````markdown
# Insight result contract (`hima-libinsight-insight/1`)

Your task ends with one result file and one delivery candidate in your private workspace. The Host
copies them back; the Pack Reader `libinsight-insight` checks the result with LibInsight's own
validator (vendored in `<campaignWorkspace>/flow/libinsight_analysis/vendor/libinsight/insight_result.py`,
the same code Data Insight uses) and with the checks only this Run can make. Only an accepted result is
admitted and shown in Data Insight. When this file and the validator disagree, the validator wins: read
its problem list and change your result.

Build the result with `insight_builder.py` (copy it to `analysis/insight_builder.py`); it writes every
shape below. The four reference rules under `<campaignWorkspace>/flow/reference_rules/` use it, and their
results under `flow/reference_results/` are accepted examples of every chart kind the rules need.

## Files you deliver

| File (private workspace) | Candidate `kind` | Lands in the Campaign at |
| --- | --- | --- |
| `analysis-result.json` | `result` (exactly one) | `state/analysis-result.json` |
| `analysis/<your script>.py`, `analysis/insight_builder.py` | `support` | `analysis/...` |
| `resident-delivery.json` | the candidate itself | — |

Candidate: `{"schema": "hima-resident-engineering-candidate/1", "outcome": "completed" | "best-effort" |
"blocked" | "cancelled", "summary", "stopReason", "artifacts": [{path, sha256, kind}]}`. `blocked` and
`cancelled` are shown, never admitted. Delivered support files are immutable: a repaired script gets a
new path (for example `analysis/r2/vmin_bottleneck.py`).

## Top-level keys (exactly these; there is no `plots`)

`schema, id, version, rule, question, summary, sources, datasets, library, items, actions, score, code,
run, assumptions, limits`.

- `id`: the rule name the person confirmed (`prepared-request.json` → `rule.id`); anything else is
  refused. `version`: 1, or the highest admitted version of that id + 1 when you improve it.
- `rule`: `{title, sentence, parameters, scope, prompt}` — copy title, sentence and parameters from the
  prepared rule (with the values you used); `scope = {kit, variants, corners[, design]}`; `prompt` is the
  person's question. The sentence is at most 300 characters.
- `sources`: every file you read, `{path, kind, sha256Before, sha256After}`; `kind` is `facts` (also
  `libertySha256`), `cell_netlist`, `design_netlist` or `timing_report`. The Reader re-hashes each on the
  Site; a file outside the prepared read roots is refused. `insight_builder.Sources` does this.
- `datasets`: `{name: {columns: [{name, type: number|string, unit?, nullMeans?}], rows: [[...]]}}`;
  ≤ 16 datasets, ≤ 20 000 rows each, result ≤ 4 MiB. A missing value is `null` in a column that declares
  `nullMeans`; never write 0 for a missing value. A `subject` column (a LibInsight address) makes rows
  drillable; a `role` column (`problem`, `selected`, `reference`, `candidate`, `other`) colours marks.
- `library`: `{headline (≤ 160 characters), counts {checked, flagged, unit: cells|arcs|tables|functions|paths},
  facts (≤ 8 × {label, value, unit?}), charts (≤ 3)}`; `flagged ≤ checked`.
- `items`: `{dataset, key, label, sort {column, order: asc|desc}, text?, charts (≤ 3)}`; one row per item
  (≤ 2 000), unique keys; every item chart has `filter {column: <a column of the item key's type>, equals: "$item"}`.
- `actions`: ≤ 8 typed actions (below). `score`: `{dimension, weight, affected, checked}`.
- `code`: `{main: {path, sha256, text}, files: [{path, sha256}]}` under `analysis/`; `run`:
  `{command, exitCode: 0, elapsedSeconds, usedQualib}`; `assumptions`, `limits`: plain sentences.

## Subjects

| Subject | Form |
| --- | --- |
| cell | `<kit>/<release>/<variant>/<corner>/<view> :: <cell>` (a segment may be `*`) |
| arc | `… :: <cell>/<pin>/{<related>,<type>,<sense>,<when>}` |
| table | `<arc>/<kind>[<sigma>]`; a point adds ` @ (<i>,<j>)` |
| function set | `… :: fn:<function>` |
| path, stage | `design:<design> :: path:<path>[/stage:<n>]` |

## Charts (closed catalogue; LibInsight draws them)

Every chart is `{id, title, kind, dataset, …encodings, filter?}`; an encoding is `{column[, label]}`.

| Kind | Required | Optional |
| --- | --- | --- |
| `table` | — | `columns: [names]` |
| `bar` | `x`, `y` (number) | `series` |
| `line` | `x`, `y` (numbers) | `series` |
| `scatter` | `x`, `y` (numbers) | `series`, `role`, `label` |
| `heatmap` | `x`, `y`, `value` (number) | `role` |
| `box` | `group`, and `value` or all of `p5, p25, p50, p75, p95` | `points`, `role` |
| `fan` | `x` (ordered condition), `y` (the item's value), `reference` (number), `item` (string: the item's name) | `box`, `class_box`: `{p5..p95}` |
| `ladder` | `x` (drive), `y` | `gap: {from, to}`, `missing: {x, y}`, `label`, `role` |
| `slice` | `x`, `y`, `flag` (non-zero at the flagged point) | `expected`, `siblings` |
| `matrix` | `row`, `col` (strings), `value` | — |
| `stages` | `order`, `label`, `value` | `role` |

## Actions

`{kind, title, who: chip_designer|cell_designer|library_provider, reason, impact: [{label, value, unit?}] (≤ 6),
targets, params}`. `targets` is `{dataset, column[, filter {column, equals}]}` (the column holds the cell
name for `dont_use`, `derate`, `limits`, `redesign_cell`; the row identity for the table kinds) or
`{selection: true, dataset, column}` (the person marks rows in the page; the dataset needs `subject`).

| Kind | Params |
| --- | --- |
| `dont_use` | optional `reason_column`, `scope` |
| `derate` | `factor` (number > 0 or `{column}`), `when` (text) |
| `limits` | `limit`: `max_transition` or `max_capacitance`; `value` (number or `{column}`); `unit`; optional `pin_column` |
| `recharacterise` | `columns`: `{variant, corner, cell, arc, when, table, point}` → your dataset's columns |
| `roadmap_gap` | `columns`: `{function, variant, below, above, jump, suggested_drive, suggested_area}` → columns |
| `corner_plan` | `columns`: `{class, check, limiting_corner}` → columns |
| `redesign_cell` | `cell`; `arc {input, output, edge, when}` (edge `rise`, `fall` or `both`); `symptom`; `metric`; `now` (null only for `missing_size`); `target`; `unit`; `siblings [{cell, drive, value, area, input_cap, leakage}]`; `levers [{kind, change, effect}]` (1..4; `effect` is null or `{value, unit, basis}`); `evidence [{label, dataset, column, where {column, equals}}]`; optional `reference`, `pass`, `cost`, `check {corners}`, `circuit [device]`, `sibling_circuits {cell: [device]}` |

Symptoms and their lever kinds: `effort_off_trend` → `widen_driven`, `match_stack_order`;
`low_voltage_slowdown` → `widen_deepest_stack`, `reorder_stack`, `split_stack`; `rise_fall_imbalance` →
`reratio_pn`; `missing_size` → `add_size`; `slower_than_equivalent` → any of these except `add_size`, plus
`use_equivalent`. A device is exactly a netlist-facts device `{name, type: n|p, w_um, l_um, fingers,
stack_pos (1 = next to the output), stack_depth}`: copy them from `state/netlist-facts.json`
(`cells.<cell>.arcs."<input>-><output>"`). An effect you did not compute is `null` (qualitative), never a guess.

## Score

`dimension`: `quality` (the library's data is wrong or rough), `ppa` (coverage, area, speed, power),
`robustness` (supply, temperature, variation), `none` (a design-specific rule; it never changes the
library score). `weight`: `"custom"` unless the person named a weight class. `affected ≤ checked`, counted
in the same subjects as `library.counts`.

## What the Reader adds to LibInsight's checks

- The result is `hima-libinsight-insight/1` and its `id` is the confirmed rule.
- The design files prepare-data hashed are unchanged.
- It runs the validator with the prepared request (sources bound and re-hashed), the Campaign
  workspace (code files on disk) and the delivered byte size. Its problems come back to this same task in
  `<campaignWorkspace>/state/analysis-result.problems.txt`; fix every line and deliver again.

## Self-check

`python3 <campaignWorkspace>/flow/libinsight_cli.py check-delivery . analysis-result.json` runs the same
validator with Python 3.6 in your sandbox and prints `accepted …` or one problem per line.
````

- [ ] **Step 4: Write `insight-playbook.md` and embed the reference rule**

`packs/libinsight-analysis/knowledge/insight-playbook.md`:
````markdown
# Insight playbook: from the person's question to an admitted insight result

You own one **rule**: a named, versioned analysis that answers one question about a Kit and delivers an
insight result (`insight-result-contract.md`). The person confirmed the rule's name, sentence and
parameters; LibInsight draws your result in Data Insight beside the other rules. You write data, never
charts and never tool scripts: chart kinds and action files are LibInsight's.

## 1. What you receive (read-only, in the Campaign workspace)

| File | Content |
| --- | --- |
| `state/prepared-request.json` | `rule {id, title, sentence, parameters}`, the question, `kit {name, release, files}`, `needs`, `sources`, `netlists`, `design`, `buildsOn`, the admitted `library` |
| `state/prepared-data.json` | `facts[] {liberty, libertySha256, facts, factsSha256, variant, corner, origin}` for every Liberty file (corpus, store or extracted for this Run), `netlistFacts {path}` and `design {netlist, timingReport}` |
| `state/netlist-facts.json` | per cell and arc the devices the input drives (when `needs` has netlists) |
| `flow/reference_rules/*.py`, `catalog.json` | the four reference rules (`rule-catalog.md`) |
| `flow/reference_results/*.json` | their accepted results on a synthetic Kit |
| `flow/libinsight_analysis/insight_builder.py` | the builder every rule uses; copy it to `analysis/` |

## 2. The rule

Keep the confirmed `rule.id`. The sentence states the test in plain words (cell, arc, corner, slew, load,
supply), with its threshold. Read every parameter from `prepared-request.json` → `rule.parameters` with
`insight_builder.parameter(...)`; never hard-code a value the person can change. If the question is one of
the reference rules, start from its script; otherwise write a new script in the same shape.

## 3. Data plan

- Facts first: every file in `prepared-data.json` → `facts` is ready; read them with
  `insight_builder.Sources().load(entry)`, one file at a time, and keep only a compact summary per file
  (the SAED14 records parse to hundreds of MB).
- Choose corners by their operating point (`insight_builder.operating_point`), not by their names.
- Use live QuaLib only for an attribute the facts lack (`qualib-api-playbook.md`), in licence mode `new`.
- Netlists only for a redesign brief; design files only for a design rule (`prepared-data.json` → `design`).
- Bound every loop by the data's size; the result holds at most 20 000 rows per dataset.

## 4. Analysis

- Python 3.6, standard library only (the sandbox has no numpy).
- Compare cells at one operating point: interpolate (`insight_builder.interpolate`) to a common slew
  and load inside each table's grid; tables are drive-scaled.
- A value you cannot compute is `null` with a `nullMeans` reason. Never 0.
- Identify functions by signature (`insight_builder.function_of`), never by cell-name stems.

## 5. Charts by question type

| The question is about | Library chart | Item chart |
| --- | --- | --- |
| a distribution (by variant, by class) | `box` | — |
| change across a condition (supply, temperature) | `bar` of counts | `fan` |
| choosing among alternatives | `table` | `scatter` (area against delay, `role`) |
| coverage of sizes | `matrix` (track × VT), `bar` of the widest | `ladder` with `gap` and `missing` |
| table quality | `bar` by variant or table kind | `slice` and `heatmap` |
| a timing path | `table` of paths | `stages`, then `scatter` |

At most 3 library charts and 3 item charts; every item chart filters on the item key with `"$item"`.

## 6. Items

One row per flagged subject in one dataset: a unique `key`, a readable `label`, a one-sentence `text`
("NOR3X1 on A1->ZN slows 37.9 % more than INVX1 from 0.80 V to 0.60 V at 125 C."), a `subject` column,
sorted worst first. Not flagged means not an item; the library charts show everything.

## 7. Actions

Give the person what to do, per role (`chip_designer`, `cell_designer`, `library_provider`), with typed
actions from `insight-result-contract.md`: `derate`, `dont_use`, `limits` for chip designers;
`redesign_cell` for cell designers (one brief, the worst item, devices from `netlist-facts.json`);
`recharacterise`, `roadmap_gap` for library providers. Use `{selection: true, dataset, column}` when the
person should pick the cells (the critical-path rule). `impact` says what it costs or saves, in numbers
from your datasets.

## 8. Score

`dimension` by what the rule measures: data errors → `quality`; coverage, area, speed → `ppa`; supply,
temperature, variation → `robustness`; one design → `none`. `affected` = flagged subjects, `checked` =
checked subjects, the same unit as `library.counts`.

## 9. Deliver

1. Run: `python3 analysis/<rule>.py --prepared <campaignWorkspace>/state/prepared-request.json --data
   <campaignWorkspace>/state/prepared-data.json --out analysis-result.json --candidate resident-delivery.json`.
2. Self-check: `python3 <campaignWorkspace>/flow/libinsight_cli.py check-delivery . analysis-result.json`;
   fix every line it prints and run again.
3. A Reader rejection arrives in this same task; read `state/analysis-result.problems.txt`, repair, deliver
   again under new support paths when a script changed.
4. Blocked (a licence, an unreadable file): candidate `outcome: "blocked"` with the reason in
   `stopReason`; never present guessed numbers.

## 10. Worked example: `size_coverage_gaps`

The reference rule below ran on the synthetic Kit, and its result is
`flow/reference_results/size_coverage_gaps.json`. It shows the whole shape: parameters, one facts file
per variant, a measured drive, items with a function-set subject, a `ladder` with `gap` and `missing`,
`roadmap_gap` with its column map and a `redesign_cell` brief for a missing size.

````
Then embed the script:
```bash
python3 - <<'EOF'
root = "packs/libinsight-analysis"
with open(root + "/flow/reference_rules/size_coverage_gaps.py", encoding="utf-8") as stream:
    script = stream.read()
with open(root + "/knowledge/insight-playbook.md", "a", encoding="utf-8") as stream:
    stream.write("<!-- BEGIN size_coverage_gaps.py -->\n```python\n" + script + "```\n<!-- END size_coverage_gaps.py -->\n")
EOF
```

- [ ] **Step 5: Write `rule-catalog.md` and the contract `offers` from the catalogue**

```bash
python3 - <<'EOF'
import json
root = "packs/libinsight-analysis"
with open(root + "/flow/reference_rules/catalog.json") as stream:
    rules = json.load(stream)["rules"]
lines = ["# Rule catalogue", "",
         "The four insight rules this Pack offers by name. The Guide maps a person's words to one of them",
         "(\"which cells limit my Vmin\", \"slow at low voltage\" -> vmin_bottleneck; \"missing sizes\", \"drive",
         "coverage\" -> size_coverage_gaps; \"odd values\", \"noisy tables\" -> table_spikes_kinks; \"swap cells on my",
         "worst paths\" -> critical_path_faster_cells) or to a new rule with its own snake_case name and one plain",
         "sentence. Each rule's script and accepted result on a synthetic Kit are named below; start from the",
         "closest one.", ""]
for rule in rules:
    lines += ["## %s" % rule["id"], "", "- Title: %s" % rule["title"], "- Sentence: %s" % rule["sentence"],
              "- Score: %s" % rule["dimension"], "- Needs: %s" % ", ".join(rule["needs"]), "- Data: %s" % rule["data"],
              "- Parameters: %s" % "; ".join("%s = %s (%s)" % (p["name"], json.dumps(p["value"]), p["meaning"]) for p in rule["parameters"]),
              '- Example prompt: "%s"' % rule["example"],
              "- Script: %s; result: flow/reference_results/%s.json" % (rule["script"], rule["id"]), ""]
with open(root + "/knowledge/rule-catalog.md", "w", encoding="utf-8") as stream:
    stream.write("\n".join(lines))
offers = ["- " + json.dumps({"id": r["id"], "title": r["title"], "sentence": r["sentence"], "example": r["example"],
          "parameters": [{"name": p["name"], "value": p["value"], "meaning": p["meaning"]} for p in r["parameters"]]},
          ensure_ascii=False) for r in rules]
with open(root + "/contract.yml", "a", encoding="utf-8") as stream:
    stream.write("offers:\n" + "\n".join(offers) + "\n")
EOF
```

- [ ] **Step 6: Point the remaining knowledge at the insight result**

In `packs/libinsight-analysis/contract.yml`, replace the `custom-analysis` tool's `outsourcing.knowledge` list with:
```yaml
    knowledge:
    - insight-playbook.md
    - insight-result-contract.md
    - rule-catalog.md
    - qualib-api-playbook.md
    - facts-schema.md
    - analysis-library.md
```
and the top-level `knowledge:` list with:
```yaml
knowledge:
- file: insight-playbook.md
  purpose: From the person's question to an admitted insight result — data plan, analysis, charts by question type, items, actions, score, delivery — with the size_coverage_gaps reference rule embedded.
- file: insight-result-contract.md
  purpose: The exact hima-libinsight-insight/1 result and delivery candidate, LibInsight's chart and action catalogues, subjects, and what the Reader checks.
- file: rule-catalog.md
  purpose: The four offered rules — name, sentence, score, needs, data, parameters, example prompt, script and reference result — and how a person's words map to them.
- file: qualib-api-playbook.md
  purpose: How to program against the QuaLib 2026 Liberty API on linglong for an attribute the facts lack, and the licence rules.
- file: facts-schema.md
  purpose: The lib-insight-facts/1 record QuaLib extraction writes.
- file: analysis-library.md
  purpose: The admitted-result library layout and how to build on an admitted result (insight or older analysis) through buildsOn.
```
In `packs/libinsight-analysis/knowledge/qualib-api-playbook.md`:
- replace the first paragraph's opening sentence (lines 3–4, from "You answer one custom library-analysis question" to "(see `custom-analysis-contract.md`).") with:
  ```text
  You deliver one `hima-libinsight-insight/1` result (see `insight-result-contract.md` and
  `insight-playbook.md`). prepare-data has already given every Liberty file of the request as facts in
  `state/prepared-data.json`; use live QuaLib only for an attribute the facts lack.
  ```
- replace the code block of section 6 with
  ```sh
  python3 analysis/<your_rule>.py --prepared <campaignWorkspace>/state/prepared-request.json \
      --data <campaignWorkspace>/state/prepared-data.json --out analysis-result.json --candidate resident-delivery.json
  ```
  and its "Verified 2026-10-05: `example-custom-analysis.md` ran this …" sentence with "Verified 2026-10-05 for the 0.1 delivery: a facts-mode script over the 20 MB SAED14 facts file ran with `/usr/bin/python3` 3.12.3 on linglong (1.46 s) and with `python3` 3.6.8 in the edarunner image (1.72 s). Facts layout: `facts-schema.md`."
- replace the bullets of section 7 with the single bullet "Use `insight_builder.Sources`: it hashes every facts file, netlist and design file before you read it and again when the result is written, and refuses one that changed since prepare-data."
- replace the numbered list of section 8 with the four steps of `insight-playbook.md` section 9 (copy them verbatim).
- delete everything from the line `## Appendix B. \`analysis/live_inv_delivery.py\` (plain python3 second step)` to the end of the file.

In `packs/libinsight-analysis/knowledge/analysis-library.md`: replace `the accepted hima-libinsight-analysis/1 result` with `the accepted result (hima-libinsight-insight/1; entries admitted by Pack 0.1 hold hima-libinsight-analysis/1)`; add after the `admission.json` sentence: "Pack 0.2 admissions add `resultSchema` and `rule {title, sentence}`. Folder names are rule names (`vmin_bottleneck`); 0.1 entries keep their slugs (`saed14-inv-drive-delay`)."; in "Building on an admitted analysis" step 3 replace "a new `id`, `version: 1`" with "the confirmed rule's `id`, `version: 1` (the id is always the confirmed rule)"; replace the closing example with: "Example: the library holds `vmin_bottleneck@1`. The person asks \"same, but with an 8 % watch level\". The Guide proposes `vmin_bottleneck` with `watch = 0.08` and `buildsOn: [\"vmin_bottleneck@1\"]`; deliver version 2, the version-1 script copied to `analysis/base/` if you build from it."

Delete the 0.1 knowledge and fixtures:
```bash
git rm packs/libinsight-analysis/knowledge/custom-analysis-contract.md packs/libinsight-analysis/knowledge/example-custom-analysis.md
git rm -r packs/libinsight-analysis/flow/tests/fixtures/saed14-inv-drive-delay
git rm packs/libinsight-analysis/flow/tests/fixtures/qualib-live/analysis/live_inv_delivery.py packs/libinsight-analysis/flow/tests/fixtures/qualib-live/analysis-result.json packs/libinsight-analysis/flow/tests/fixtures/qualib-live/prepared-request.json
grep -rn "saed14-inv-drive-delay\|live_inv_delivery\|qualib-live/analysis-result\|read-analysis" packs/libinsight-analysis test/fixtures test/contract | grep -v "/vendor/" ; echo "grep exit $?"
```
Expected: the grep prints nothing (`grep exit 1`).

Replace `packs/libinsight-analysis/flow/tests/synthetic.py` with:
```python
"""Campaign and delivery helpers for the Pack tests and the Host durable fixture (the synthetic Kit is in synthetic_kit.py)."""
import hashlib
import json
import os
import shutil

TESTS = os.path.dirname(os.path.abspath(__file__))
FLOW = os.path.dirname(TESTS)
PACK = os.path.dirname(FLOW)
CLI = os.path.join(FLOW, "libinsight_cli.py")


def sha256(path):
    with open(path, "rb") as stream:
        return hashlib.sha256(stream.read()).hexdigest()


def campaign(root):
    """A Campaign-shaped workspace whose flow/ is this Pack's deployed copy (contract workspace.copy)."""
    os.makedirs(os.path.join(root, "state"))
    flow = os.path.join(root, "flow")
    os.makedirs(flow)
    shutil.copy(CLI, flow)
    for name in ("libinsight_analysis", "reference_rules", "reference_results"):
        source = os.path.join(FLOW, name)
        if os.path.isdir(source):
            shutil.copytree(source, os.path.join(flow, name), ignore=shutil.ignore_patterns("__pycache__"))
    return root


def materialize(private, workspace):
    """Do what the Host does with a delivery candidate: support files under analysis/, the result at state/."""
    with open(os.path.join(private, "resident-delivery.json")) as stream:
        candidate = json.load(stream)
    for artifact in candidate["artifacts"]:
        source = os.path.join(private, artifact["path"])
        target = (os.path.join(workspace, "state", "analysis-result.json") if artifact["kind"] == "result"
                  else os.path.join(workspace, artifact["path"]))
        if not os.path.isdir(os.path.dirname(target)):
            os.makedirs(os.path.dirname(target))
        shutil.copyfile(source, target)
    return os.path.join(workspace, "state", "analysis-result.json")
```

- [ ] **Step 7: Rewrite the Pack records**

`packs/libinsight-analysis/INTENT.md`:
```markdown
# LibInsight insight rules 0.2

## Business

A library user asks a question in the Hima Harness chat ("which cells limit my Vmin?"). The Guide turns it
into a named rule with one plain sentence and its parameters (lib_insight spec §9.1); the person confirms
it. One durable Run prepares every Liberty file of the Kit as facts on linglong (extracting with QuaLib
what the corpus lacks), hands the rule to the resident engineering agent, which writes and runs the rule's
script, and admits the insight result that LibInsight's own validator accepts. The Host exports it to the
folder Data Insight lists, where LibInsight draws its charts, items, actions and score effect (ADR-0022).

## Golden Flow

prepare-request → prepare-data → custom-analysis → admit-analysis → deliver. The four reference rules
(`vmin_bottleneck`, `size_coverage_gaps`, `table_spikes_kinks`, `critical_path_faster_cells`) are the
golden examples; their results on a synthetic Kit pass the validator.

## Answers

The answer is the admitted insight result: the rule and its sentence, the library headline and counts,
the items with their charts, typed actions LibInsight turns into files, and the score block, all traceable
to hashed sources and the exact script. The summary is the resident's reading of those datasets.

## Ambiguities resolved

- The result's id is the rule the person confirmed; a change of rule is a new proposal.
- Extraction is a deterministic Pack step (LibInsight's extractor under the Site runner), not the
  resident's; it needs licence mode `new`, checked before the Run starts work.
- The validator is LibInsight's, vendored at the Data Insight pin; the Pack adds only the checks that need
  this Run (confirmed rule, design files unchanged).
- Results admitted by 0.1 stay readable for buildsOn; 0.2 admits only insight results.

## Knowledge applied

`insight-playbook.md`, `insight-result-contract.md`, `rule-catalog.md`, `qualib-api-playbook.md`,
`facts-schema.md`, `analysis-library.md`; lib_insight spec `docs/spec/library-insight-rules.md` §4–§10 and
the P1a plan's normative details.
```
`packs/libinsight-analysis/SPEC.md`:
```markdown
# LibInsight insight rules 0.2.0 run contract

## Goal template

`admitted_analyses` = 1 (count; min = max = default = 1). `deliver` sets `goalMet` exactly when one
Reader-accepted insight result was admitted; a blocked or cancelled outcome ends with `goalMet: false`.

## Constraints

- Inputs: `analysisRequest` (`hima-libinsight-request/2`, written by the Host per Run), `analysisLibrary`,
  `factsCorpus`, `factsStore`, `kitCatalog`, `qualibRunner`, `qualibPython`, `qualibApiHome`,
  `engineeringCapabilities`, `licenceModeFile`, `sourceReadRoots`, `workspaceRoot`.
- Request: `{schema, requestId, question, rule {id, title, sentence ≤ 300, parameters ≤ 12}, kit {name,
  variants, corners} | null, sources ≤ 32, netlists ≤ 16, design {netlist, timingReport} | null, needs ⊇
  [facts], buildsOn ≤ 8, createdAt}`; a Kit or a source is required.
- A Kit selects at most 64 Liberty files; every file must be inside the Site read roots and the resident's
  sandbox roots. A Liberty file without facts needs extraction; with licence mode not `new`,
  prepare-request fails with "linglong's Empyrean licence is in XTop mode; …".
- `needs` netlists without any netlist, or design without design files, fails prepare-request.
- An extraction failure fails prepare-data: the analysis never starts on partial data.
- Budget: 45 minute time box, 5 minute closing reserve.

## Run contract

| Task | Producer | Output |
| --- | --- | --- |
| prepare-request | `task-prepare-request` | `state/prepared-request.json` (`/2`); value `{requestId, question, rule, kit, needs, extract, preparedPath, preparedSha256, sources, buildsOn, libraryAnalyses, goal}` |
| prepare-data | `task-prepare-data` (QuaLib seat) | `state/prepared-data.json`, `state/netlist-facts.json`; facts store entries |
| custom-analysis | resident engineering agent | `state/analysis-result.json` (`hima-libinsight-insight/1`) + `analysis/...` |
| admit-analysis | `task-admit-analysis` | `<library>/<rule id>/v<version>/…`; `state/admission.json` |
| deliver | `task-deliver` | `delivery/report.json`, `delivery/REPORT.md`, `delivery/analysis-result.json` |

## Semantics

`li_insight_error_count` (0 only after LibInsight's validator and the Pack checks accept), `li_insight_item_count`,
`li_insight_action_count`, `li_insight_chart_count`, all `count`.

## Judge rules

`insight-delivery-ready`: `li_insight_error_count eq 0`.

## Endings

`ended-goal-met` when admitted; `ended-goal-not-met` for an honest blocked or cancelled delivery; a Reader
rejection never ends the Run, it is repaired in the same resident task until the time box.
```
`packs/libinsight-analysis/FABRIC.md`:
```markdown
# LibInsight insight rules 0.2 Fabric record

## Files written

`contract.yml` (0.2.0, `offers` for the Guide), `graph.yml` (five tasks), `schemas/tasks.json`.
`flow/libinsight_analysis/`: `request.py` (request /2, kit catalogue), `data.py` (prepare-data, host only),
`delivery.py` (vendored validator + run checks), `library.py`, `tasks.py`, `vendored.py`,
`insight_builder.py` (Python 3.6, for rule scripts), `vendor/` (LibInsight at the Data Insight pin, verified
by `vendor/VENDOR.json`; regenerate with `scripts/vendor-libinsight.py`). `flow/reference_rules/` and
`flow/reference_results/` are deployed to the Campaign. `tools/read-insight.py` is the Reader.

## Gaps

prepare-data starts the Site's `edarun` from its python3 Job for extraction: the Permit checks the Job's
`python3`, and the Site binds the runner explicitly. Netlist devices are matched to cells by name.
```
`packs/libinsight-analysis/TEST.md`:
```markdown
# LibInsight insight rules 0.2 test record

## Site

Development Pack, not released. Real verification is Task 18 of
`docs/superpowers/plans/2026-10-08-libinsight-analysis-insight-rules-v0.2.md` (linglong, packaged App,
Catsights); record its Runs here when they have ended.

## Run

L2: `test/contract/libinsight-resident-durable.host.test.ts` (clean, repair, Guide) runs the five tasks on
the synthetic Kit through the real Host, wrapper, Reader and admission, with an ACP stand-in that runs the
`size_coverage_gaps` reference rule.

## Code

`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'`.

## Refusals

Reader: schema, unconfirmed rule, LibInsight validator problems, code and source hashes, design files
changed, tampered vendored code. prepare-request: unknown Kit, too many files, missing netlists or design,
extraction in licence mode `old`, bad rule. prepare-data: null handle, source changed during extraction, no
runner bound.

## Disagreements

None recorded.
```

- [ ] **Step 8: Run all Pack tests and the Host checks that read the Pack**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'
pnpm run build
pnpm run test:local --files test/contract/pack-offers.test.ts test/contract/product-context.host.test.ts test/contract/trial-package.test.ts
node scripts/run-contract-tests.mjs atcs-dry --files test/contract/libinsight-resident-durable.host.test.ts
```
Expected: all PASS; the durable L2's prompt names `insight-playbook.md` in its goal.

- [ ] **Step 9: Commit and push**

```bash
git add -A packs/libinsight-analysis
git status --short
git commit -m "docs(libinsight): insight playbook, result contract and rule catalogue; the Pack offers its four rules

Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---
### Task 13: Export admitted results to the Harness folder that the viewer lists (`--analyses-root`)

**Files:**
- Modify: `packages/harness/src/libinsight-viewer.ts`
- Modify: `packages/harness/src/libinsight-analyses.ts` (export)
- Modify: `packages/harness/src/index.ts` (wiring, re-export)
- Modify: `test/fixtures/libinsight-viewer/app/server.py` (stand-in takes `--analyses-root` and `?insight=`)
- Modify: `test/contract/libinsight-viewer.test.ts`, `test/contract/libinsight-analyses.test.ts`, `test/contract/support/libinsight-analyses-guide-worker.ts`

**Interfaces:**
- Consumes: LibInsight prerequisite 2 (`app/server.py --analyses-root DIR`); P1a discovery layout `<root>/<id>/v<version>/result.json`; Task 9 `LibInsightAnalysisDetail.insight`.
- Produces:
  - `libInsightResultsRoot(home: string): string` = `<home>/libinsight-results` (exported from `@hima/harness`), used by the viewer and the export alike.
  - `LibInsightViewerOptions.analysesRoot?: string`; `LibInsightViewerStatus` `ready` gains `analysesRoot?: string` (present when the running LibInsight took the argument).
  - `LibInsightAnalysesDeps.exportRoot?: string`; `InsightExport = {ref, exported, path?, reason?}`; `LibInsightAnalysisDetail.exported?: InsightExport`; `analyses.exportAll(): Promise<readonly InsightExport[]>`; the Guide's `result` adds `insight.exported: boolean` (and `insight.exportReason` when false).
  - Export rule: only an admitted insight result whose admission names the same id and version; written once, read-only, staged outside the root and renamed into `<root>/<id>/v<version>/result.json`; identical bytes are a no-op; different bytes under an exported `id@version` are refused with a reason. Harness never writes LibInsight's data folder.

- [ ] **Step 1: Teach the stand-in viewer the new argument and focus**

Replace `test/fixtures/libinsight-viewer/app/server.py` with:
```python
# A stand-in for LibInsight's own app/server.py (contract tests only): the same argv (--config, --port and the
# repeatable results-folder argument), the same loopback bind and the same first route the Host waits on.
# A Kit named "crash" fails the way a missing numpy would: a message on stderr and a non-zero exit before
# listening. "/" names the rule a ?insight= focus asks for and the results it lists.
import argparse, json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
ap = argparse.ArgumentParser(); ap.add_argument("--config"); ap.add_argument("--port", type=int)
ap.add_argument("--analyses-root", action="append", default=[], dest="roots")
a = ap.parse_args()
roots = getattr(a, "roots", [])
cfg = json.load(open(a.config))
ids = [k["id"] for k in cfg["kits"]]
if "crash" in ids:
    print("ModuleNotFoundError: No module named 'numpy'", file=sys.stderr); sys.exit(3)
def rules():
    found = []
    for root in roots:
        for rule in (sorted(os.listdir(root)) if os.path.isdir(root) else []):
            for version in sorted(os.listdir(os.path.join(root, rule))):
                if os.path.isfile(os.path.join(root, rule, version, "result.json")):
                    found.append("%s@%s" % (rule, version[1:]))
    return found
class H(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/":
            focus = parse_qs(url.query).get("insight", ["none"])[0]
            body = ("<!doctype html><title>LibInsight fixture</title><h1>LibInsight fixture</h1><p>Kits: %s</p><p>Focus: %s</p><p>Rules: %s</p>"
                    % (", ".join(ids), focus, ", ".join(rules()) or "none")).encode()
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers(); self.wfile.write(body); return
        body = json.dumps([{"id": i} for i in ids] if url.path == "/api/kits" else sorted(os.environ) if url.path == "/env"
                          else dict(self.headers) if url.path == "/headers" else {"roots": roots} if url.path == "/args"
                          else {"rules": rules()} if url.path == "/api/insight/rules" else {"cwd": os.getcwd()}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
print("listening", a.port, flush=True)
ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()
```

- [ ] **Step 2: Write the failing tests**

Append to `test/contract/libinsight-viewer.test.ts`:
```ts
// ADR-0022: the Harness's admitted insight results are listed by LibInsight from a Harness-owned folder named on
// the viewer's command line; an older LibInsight without that argument starts exactly as before.
test('the viewer is told the Harness results folder, and an older LibInsight starts without it', async () => {
  const f = await fixture();
  try {
    const analysesRoot = path.join(f.root, 'home', 'libinsight-results');
    const viewer = createLibInsightViewer({ codeRoot: f.code, settingsFile: f.settingsFile, defaultDataFolder: f.data, analysesRoot });
    const status = ready(await viewer.open());
    assert.equal(status.analysesRoot, analysesRoot);
    const args = await (await fetch(new URL('/args', status.url.replace('localhost', '127.0.0.1')))).json() as { roots: string[] };
    assert.deepEqual(args.roots, [analysesRoot]);
    await viewer.stop();
    const server = path.join(f.code, 'app', 'server.py');
    await writeFile(server, (await readFile(server, 'utf8')).replace(/^ap\.add_argument\("--analyses-root".*\n/m, ''));
    const older = ready(await viewer.open({ restart: true }));
    assert.equal(older.analysesRoot, undefined);
    assert.deepEqual((await (await fetch(new URL('/args', older.url.replace('localhost', '127.0.0.1')))).json() as { roots: string[] }).roots, []);
    await viewer.stop();
  } finally { await f.cleanup(); }
});
```
Append to `test/contract/libinsight-analyses.test.ts`:
```ts
// ADR-0022: an admitted insight result is placed once in the Harness folder the viewer lists.
const insightBytes = (id: string, version: number, summary = 's') => Buffer.from(JSON.stringify({ schema: 'hima-libinsight-insight/1', id, version, question: 'q', summary,
  rule: { title: 'T', sentence: 'S.', parameters: [], scope: { kit: 'k', variants: [], corners: [] } },
  library: { headline: 'h', counts: { checked: 1, flagged: 1, unit: 'cells' }, facts: [], charts: [] },
  items: { dataset: 'd', key: 'k', label: 'k', sort: { column: 'k', order: 'asc' }, charts: [] }, actions: [],
  score: { dimension: 'quality', weight: 'custom', affected: 1, checked: 1 }, datasets: { d: { columns: [{ name: 'k', type: 'string' }], rows: [['a']] } },
  sources: [], assumptions: [], limits: [], code: { main: { path: 'analysis/m.py', sha256: sha('c'), text: '' }, files: [] },
  run: { command: 'python3 m.py', exitCode: 0, elapsedSeconds: 1, usedQualib: false } }));

test('an admitted insight result is exported once, never over a different one, and older results never', async () => {
  const exportRoot = await mkdtemp(path.join(os.tmpdir(), 'hima-results-'));
  const admitted = { 'run-ok': view({ value: { admitted: true, id: 'vmin_bottleneck', version: 2, resultSha256: sha('a') } }) };
  const first = await fixture(admitted, { exportRoot, readRetained: async () => insightBytes('vmin_bottleneck', 2) });
  const other = await fixture(admitted, { exportRoot, readRetained: async () => insightBytes('vmin_bottleneck', 2, 'different') });
  const older = await fixture(admitted, { exportRoot });
  try {
    const detail = await first.analyses.detail('s', 'run-ok');
    const file = path.join(exportRoot, 'vmin_bottleneck', 'v2', 'result.json');
    assert.deepEqual(detail.exported, { ref: 'vmin_bottleneck@2', exported: true, path: file });
    assert.deepEqual(await readFile(file), insightBytes('vmin_bottleneck', 2));
    assert.equal((await first.analyses.detail('s', 'run-ok')).exported?.exported, true, 'the same bytes again are a no-op');
    const refused = await other.analyses.detail('s', 'run-ok');
    assert.equal(refused.exported?.exported, false);
    assert.match(refused.exported?.reason ?? '', /A different result is already in Data Insight as vmin_bottleneck@2/);
    assert.deepEqual(await readFile(file), insightBytes('vmin_bottleneck', 2), 'the exported bytes stay');
    assert.equal((await older.analyses.detail('s', 'run-ok')).exported, undefined, 'an analysis/1 result is not exported');
    const answer = await first.analyses.tool('g', { action: 'result', runId: 'run-ok' }) as Record<string, any>;
    assert.equal(answer.insight.exported, true);
    assert.deepEqual((await readdir(exportRoot)).sort(), ['vmin_bottleneck'], 'nothing but results in the root');
  } finally { await first.cleanup(); await other.cleanup(); await older.cleanup(); await rm(exportRoot, { recursive: true, force: true }); }
});

test('exportAll places every admitted insight result and skips the rest', async () => {
  const exportRoot = await mkdtemp(path.join(os.tmpdir(), 'hima-results-'));
  const f = await fixture({
    'run-ok': view({ value: { admitted: true, id: 'size_coverage_gaps', version: 1, resultSha256: sha('a') } }),
    'run-blocked': view({ value: { admitted: false, id: 'size_coverage_gaps', version: 1, reason: 'blocked' } }),
  }, { exportRoot, readRetained: async () => insightBytes('size_coverage_gaps', 1) });
  try {
    const placed = await f.analyses.exportAll();
    assert.deepEqual(placed.map(item => [item.ref, item.exported]), [['size_coverage_gaps@1', true]]);
    assert.ok((await readFile(path.join(exportRoot, 'size_coverage_gaps', 'v1', 'result.json'))).length > 0);
  } finally { await f.cleanup(); await rm(exportRoot, { recursive: true, force: true }); }
});
```
and add `readdir` to that file's `node:fs/promises` import.

- [ ] **Step 3: Run them to verify they fail**

```bash
pnpm run build
pnpm run test:local --files test/contract/libinsight-viewer.test.ts test/contract/libinsight-analyses.test.ts
```
Expected: the three new tests FAIL (`status.analysesRoot` undefined; `detail.exported` undefined; `exportAll` is not a function).

- [ ] **Step 4: Pass the results folder to the viewer**

In `packages/harness/src/libinsight-viewer.ts`:
- in the `ready` variant of `LibInsightViewerStatus`, add `; readonly analysesRoot?: string` after `kits: readonly string[]`;
- in `LibInsightViewerOptions`, after `defaultDataFolder?`, add:
```ts
  /** The Harness-owned folder of admitted insight results (ADR-0022) that LibInsight lists beside its own
   *  `analyses_roots`; passed as `--analyses-root` when the LibInsight code takes it. */
  readonly analysesRoot?: string;
```
- after `libInsightViewerOptions`, add and use the folder:
```ts
/** Where the Host places admitted insight results for Data Insight: its own folder, never LibInsight's. */
export const libInsightResultsRoot = (home: string): string => path.join(home, 'libinsight-results');
```
and in `libInsightViewerOptions` change the returned object to start with `{ settingsFile: path.join(home, 'libinsight-viewer.json'), analysesRoot: libInsightResultsRoot(home), …`;
- change `let running: { readonly url: string; readonly dataFolder: string; readonly kits: readonly string[] } | undefined;` to `let running: { readonly url: string; readonly dataFolder: string; readonly kits: readonly string[]; readonly analysesRoot?: string } | undefined;`;
- before `const launch = async (`, add:
```ts
  /** The launch arguments that name the Harness results folder, when this LibInsight takes them. An older
   *  pinned LibInsight has no such argument and starts as before. */
  const analysesArgs = async (root: LibInsightCode): Promise<string[]> => {
    if (options.analysesRoot === undefined) return [];
    const server = await readFile(path.join(root.root, 'app', 'server.py'), 'utf8').catch(() => '');
    if (!server.includes('--analyses-root')) return [];
    await mkdir(options.analysesRoot, { recursive: true });
    return ['--analyses-root', options.analysesRoot];
  };
```
- in `launch`, after `log = [];` add `const extra = await analysesArgs(root);`, append `...extra` to the `spawn` argument list after `String(port)`, and replace the two lines that record and return the ready state with:
```ts
          running = { url, dataFolder, kits, ...(extra.length > 0 ? { analysesRoot: options.analysesRoot! } : {}) }; failure = undefined;
          await remember({ port }).catch(() => undefined);
          return { state: 'ready', url, code: root, dataFolder, kits, ...(running.analysesRoot ? { analysesRoot: running.analysesRoot } : {}) };
```
- in `status`, replace the `ready` return with `return { state: 'ready', url: running.url, code: root, dataFolder: running.dataFolder, kits: running.kits, ...(running.analysesRoot ? { analysesRoot: running.analysesRoot } : {}) };`, and in `openNow` the early `ready` return with the same spread of `running.analysesRoot`.

- [ ] **Step 5: Export admitted insight results**

In `packages/harness/src/libinsight-analyses.ts`:
- change the `node:fs/promises` import to `import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';`;
- after the `LibInsightAnalysisDetail` interface add:
```ts
/** Whether an admitted insight result is in the Harness folder Data Insight lists (ADR-0022), and why not. */
export interface InsightExport { readonly ref: string; readonly exported: boolean; readonly path?: string; readonly reason?: string }
```
and in `LibInsightAnalysisDetail` add `  readonly exported?: InsightExport;`;
- in `LibInsightAnalysesDeps` add `  /** The Harness-owned folder Data Insight lists (libInsightResultsRoot); absent means results are not exported. */\n  readonly exportRoot?: string;`;
- inside `createLibInsightAnalyses`, after `admissionOf`, add:
```ts
  /** Place one admitted insight result at <exportRoot>/<id>/v<version>/result.json: once, read-only, staged
   *  outside the root so LibInsight never lists a half-written folder. */
  async function writeExport(admission: { id?: string; version?: number }, bytes: Buffer, doc: LibInsightInsightResult): Promise<InsightExport> {
    const ref = `${doc.id}@${String(doc.version)}`;
    if (admission.id !== doc.id || admission.version !== doc.version) return { ref, exported: false, reason: 'The admission names a different rule or version than the accepted result.' };
    if (deps.exportRoot === undefined) return { ref, exported: false, reason: 'This Host has no LibInsight results folder.' };
    if (!ruleIdPattern.test(doc.id) || !Number.isInteger(doc.version) || doc.version < 1) return { ref, exported: false, reason: 'The result names no valid rule and version.' };
    const folder = path.join(deps.exportRoot, doc.id, `v${String(doc.version)}`), file = path.join(folder, 'result.json');
    const existing = await readFile(file).catch(() => undefined);
    if (existing !== undefined) return existing.equals(bytes) ? { ref, exported: true, path: file } : { ref, exported: false, reason: `A different result is already in Data Insight as ${ref}.` };
    const stage = path.join(path.dirname(deps.exportRoot), '.libinsight-results-staging', `${doc.id}-v${String(doc.version)}-${String(process.pid)}-${randomBytes(3).toString('hex')}`);
    await mkdir(stage, { recursive: true });
    await writeFile(path.join(stage, 'result.json'), bytes, { mode: 0o444 });
    await mkdir(path.dirname(folder), { recursive: true });
    try { await rename(stage, folder); }
    catch (error) {
      await rm(stage, { recursive: true, force: true });
      const now = await readFile(file).catch(() => undefined);
      if (now?.equals(bytes)) return { ref, exported: true, path: file };
      return { ref, exported: false, reason: `The result could not be placed in Data Insight: ${(error as Error).message}` };
    }
    return { ref, exported: true, path: file };
  }
  const exportedRuns = new Set<string>();
  /** Export every admitted insight result of this Pack (Data Insight is opened): Host-wide, not per project. */
  async function exportAll(): Promise<readonly InsightExport[]> {
    const placed: InsightExport[] = [];
    for (const head of (await deps.listRunHeads()).filter(row => row.packId === packId)) {
      if (exportedRuns.has(head.id)) continue;
      const view = await deps.readRunView(head.id).catch(() => undefined);
      const observation = observationOf(view);
      if (!observation) continue;
      const admission = admissionOf(view, observation);
      if (!admission.admitted) continue;
      try {
        const bytes = await deps.readRetained(head.id, { ...observation, type: 'observation' }, maxResultBytes);
        const doc = JSON.parse(bytes.toString('utf8')) as unknown;
        if (!isInsightResult(doc)) continue;
        const done = await writeExport(admission, bytes, doc);
        if (done.exported) exportedRuns.add(head.id);
        placed.push(done);
      } catch (error) {
        placed.push({ ref: head.id, exported: false, reason: (error as Error).message });
      }
    }
    return placed;
  }
```
- in `detail`, replace `if (isInsightResult(value)) return { ...answer, insight: value };` with:
```ts
      if (isInsightResult(value)) {
        if (!admission.admitted) return { ...answer, insight: value };
        return { ...answer, insight: value, exported: await writeExport(admission, bytes, value) };
      }
```
- in `tool`'s insight branch, extend `insight: {…}` with `exported: read.exported?.exported === true, ...(read.exported && !read.exported.exported && read.exported.reason ? { exportReason: read.exported.reason } : {})`;
- return `exportAll` from the factory: `return { status, propose, confirm, list, summary, detail, tool, exportAll };`.

- [ ] **Step 6: Wire the Host**

In `packages/harness/src/index.ts`:
- change the import from `./libinsight-viewer.js` to `import { createLibInsightViewer, libInsightResultsRoot, libInsightViewerOptions } from './libinsight-viewer.js';` and the re-export line to also export `libInsightResultsRoot`;
- in `libInsightAnalyses()`, add `exportRoot: libInsightResultsRoot(localDatabaseHome()),` after `indexFile: …,`;
- replace `libInsight: request => request.action === 'status' ? libInsight.status() : libInsight.open(request),` with:
```ts
          // Opening Data Insight first places every admitted insight result in the folder the viewer lists (ADR-0022).
          libInsight: async request => {
            if (request.action === 'status') return libInsight.status();
            await analyses.exportAll().catch(() => undefined);
            return libInsight.open(request);
          },
```

In `test/contract/support/libinsight-analyses-guide-worker.ts`, after `assert.equal(answered.json.insight.rule.sentence,rule.sentence);` add:
```ts
 assert.equal(answered.json.insight.exported,true,JSON.stringify(answered.json.insight));
```
and after the `assert.deepEqual(detail.insight,JSON.parse(…` line add:
```ts
 assert.equal(detail.exported.ref,'size_coverage_gaps@1');assert.ok(detail.exported.path.endsWith(path.join('libinsight-results','size_coverage_gaps','v1','result.json')));
 assert.deepEqual(await readFile(detail.exported.path),await readFile(observation.retainedPath),'Data Insight lists the very bytes the Reader accepted');
```

- [ ] **Step 7: Build and run**

```bash
pnpm run build && pnpm run typecheck
pnpm run test:local --files test/contract/libinsight-viewer.test.ts test/contract/libinsight-analyses.test.ts
node scripts/run-contract-tests.mjs atcs-dry --files test/contract/libinsight-resident-durable.host.test.ts
```
Expected: all PASS.

- [ ] **Step 8: Commit and push**

```bash
git add packages/harness/src/libinsight-viewer.ts packages/harness/src/libinsight-analyses.ts packages/harness/src/index.ts test/fixtures/libinsight-viewer/app/server.py test/contract/libinsight-viewer.test.ts test/contract/libinsight-analyses.test.ts test/contract/support/libinsight-analyses-guide-worker.ts
git commit -m "feat(harness): admitted insight results are placed where Data Insight lists them

The Host exports each admitted hima-libinsight-insight/1 result once, read-only, to
<Home>/libinsight-results/<id>/v<version>/result.json and starts the LibInsight viewer with
--analyses-root naming that folder (ADR-0022); LibInsight's data folder is never written.
Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---
### Task 14: The analysis page keeps the summary and opens Data Insight

**Files:**
- Modify: `packages/harness/src/analysis-page.ts`
- Modify: `packages/harness/src/analysis-page.test.ts`
- Modify: `test/contract/support/libinsight-analyses-guide-worker.ts`

**Interfaces:**
- Consumes: Task 9 `detail.insight`, Task 13 `detail.exported`.
- Produces: for an insight result the page shows the rule (name, title, sentence, parameters), the headline, an "Open in Data Insight" link `hima://data-insight/?insight=<id>%40<version>` (only when admitted and exported; otherwise the reason), the library counts and facts, the score effect, the summary, the actions (title, role, reason), the data tables, assumptions, limits and provenance. No chart is redrawn: LibInsight draws them. The page keeps `default-src 'none'` and no script.

- [ ] **Step 1: Write the failing test**

Append to `packages/harness/src/analysis-page.test.ts`:
```ts
type Insight = NonNullable<Input['detail']['insight']>;
const insight: Insight = {
  schema: 'hima-libinsight-insight/1', id: 'vmin_bottleneck', version: 2, question: 'Which cells limit my Vmin?', summary: 'NOR stacks slow down most.',
  rule: { title: 'Vmin bottlenecks', sentence: 'A cell is a Vmin bottleneck when its delay grows <more> than the inverter\'s.', parameters: [{ name: 'watch', value: 0.08, meaning: 'extra slowdown that flags a cell' }],
    scope: { kit: 'saed14', variants: [], corners: [] } },
  library: { headline: '3 of 40 cells slow down more than the inverter at low supply', counts: { checked: 40, flagged: 3, unit: 'cells' },
    facts: [{ label: 'Worst extra slowdown', value: 37.9, unit: '%' }], charts: [{ id: 'b', title: 'By variant', kind: 'box', dataset: 'cells' }] },
  items: { dataset: 'cells', key: 'cell', label: 'cell', charts: [] },
  actions: [{ kind: 'derate', title: 'Derate the flagged cells at low supply', who: 'chip_designer', reason: 'They slow down more than the inverter.' }],
  score: { dimension: 'robustness', weight: 'custom', affected: 3, checked: 40 },
  sources: [{ path: '/libs/a.json.gz', kind: 'facts', sha256Before: before, sha256After: before }],
  datasets: { cells: { columns: [{ name: 'cell', type: 'string' }], rows: [['NOR3X1']] } },
  code: { main: { path: 'analysis/vmin.py', sha256: mainSha, text: 'print(1)\n' }, files: [] },
  run: { command: 'python3 analysis/vmin.py', exitCode: 0, elapsedSeconds: 2, usedQualib: false }, assumptions: ['Mid-grid delay.'], limits: ['Names match netlists.'],
};
const insightEntry = { runId: 'run-9', createdAt: '2026-10-08T10:00:00Z', status: 'ended-goal-met' as const,
  analysis: { id: 'vmin_bottleneck', version: 2, admitted: true, resultSha256: resultSha } };

test('an insight result page keeps the rule, headline and summary and opens Data Insight', () => {
  const html = analysisPage({ runId: 'run-9', entry: insightEntry as never,
    detail: { runId: 'run-9', insight, admission: { admitted: true }, exported: { ref: 'vmin_bottleneck@2', exported: true, path: '/h/r.json' } } });
  assert.match(html, /<code>vmin_bottleneck<\/code> · Vmin bottlenecks/);
  assert.ok(html.includes('grows &lt;more&gt; than the inverter&#39;s.'), 'the sentence is escaped');
  assert.ok(html.includes('3 of 40 cells slow down more than the inverter at low supply'));
  assert.match(html, /href="hima:\/\/data-insight\/\?insight=vmin_bottleneck%402"[^>]*>Open in Data Insight</);
  assert.ok(html.includes('Worst extra slowdown') && html.includes('Derate the flagged cells at low supply') && html.includes('NOR stacks slow down most.'));
  assert.ok(html.includes('robustness, 3 of 40 affected'));
  assert.equal(/<script/i.test(html), false);
  assert.equal(/<svg/i.test(html), false, 'LibInsight draws the charts');
});

test('an insight result not yet in Data Insight says why instead of linking', () => {
  const html = analysisPage({ runId: 'run-9', entry: insightEntry as never,
    detail: { runId: 'run-9', insight, admission: { admitted: true }, exported: { ref: 'vmin_bottleneck@2', exported: false, reason: 'A different result is already in Data Insight as vmin_bottleneck@2.' } } });
  assert.equal(html.includes('hima://data-insight'), false);
  assert.ok(html.includes('A different result is already in Data Insight as vmin_bottleneck@2.'));
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test packages/harness/src/analysis-page.test.ts
```
Expected: FAIL (no rule section, no link).

- [ ] **Step 3: Render insight results**

In `packages/harness/src/analysis-page.ts`:
- change the type import to `import type { InsightExport, LibInsightAnalysisDetail, LibInsightAnalysisEntry, LibInsightAnalysisResult, LibInsightInsightResult } from './libinsight-analyses.js';`;
- append to `STYLE` (before the closing backtick):
```css
.rule h3 code{font-size:15px}.sentence{font-size:17px;line-height:1.55;margin:10px 0 0;max-width:46em;overflow-wrap:anywhere}
.open{margin:22px 0 0;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.button{display:inline-block;padding:9px 16px;border-radius:10px;background:var(--accent);color:var(--card);font-weight:650;text-decoration:none}.button:hover{opacity:.88}
.actions{margin:0;padding-left:22px}.actions li+li{margin-top:12px}
```
- in `statusOf`, change `result = detail.result;` to `result = detail.result ?? detail.insight;`;
- in `analysisPage`, replace `const { runId, entry, detail, refreshSeconds } = input, result = detail.result;` and the `question` line with:
```ts
  const { runId, entry, detail, refreshSeconds } = input, result = detail.result, insight = detail.insight;
  const question = result?.question ?? insight?.question ?? entry?.question ?? 'Library analysis';
```
  after the `if (result !== undefined) meta.push(…plot…)` line add
```ts
  if (insight !== undefined) meta.push(`<span>${plural(insight.library.charts.length + insight.items.charts.length, 'chart')} · ${plural(insight.datasets[insight.items.dataset]?.rows.length ?? 0, 'item')}</span>`);
```
  and replace `else if (result !== undefined) body += resultBody(result);` with
```ts
  else if (result !== undefined) body += resultBody(result);
  else if (insight !== undefined) body += insightBody(insight, detail.exported, detail.admission.admitted);
```
- change `function provenance(result: LibInsightAnalysisResult): string {` to `function provenance(result: Pick<LibInsightAnalysisResult, 'sources' | 'run' | 'code'>): string {`;
- add after `resultBody`:
```ts
/** An insight result (ADR-0022): the rule and what it found, in words; LibInsight draws its charts in Data Insight. */
function insightBody(insight: LibInsightInsightResult, exported: InsightExport | undefined, admitted: boolean): string {
  const ref = `${insight.id}@${String(insight.version)}`;
  const parameters = insight.rule.parameters.length === 0 ? '' : `<ul class="notes">${insight.rule.parameters.map(p =>
    `<li>${esc(p.name)} = ${esc(String(p.value))}${p.unit ? ` ${esc(p.unit)}` : ''} · ${esc(p.meaning)}</li>`).join('')}</ul>`;
  let out = `<section class="card rule"><h2>Rule</h2><h3><code>${esc(insight.id)}</code> · ${esc(insight.rule.title)}</h3><p class="sentence">${esc(insight.rule.sentence)}</p>${parameters}</section>`;
  out += `<p class="lead">${esc(insight.library.headline)}</p>`;
  out += admitted && exported?.exported === true
    ? `<p class="open"><a class="button" href="hima://data-insight/?insight=${encodeURIComponent(ref)}" data-hima-open-insight="${esc(ref)}">Open in Data Insight</a><span class="notes">Its charts, cells and files are there.</span></p>`
    : `<p class="notes">${esc(admitted ? exported?.reason ?? 'Not yet placed in Data Insight; reload this page.' : 'Data Insight shows this rule once it is admitted.')}</p>`;
  const counts = insight.library.counts, score = insight.score;
  const facts: [string, string][] = [['Checked', `${String(counts.checked)} ${counts.unit}`], ['Flagged', `${String(counts.flagged)} ${counts.unit}`],
    ...insight.library.facts.map((fact): [string, string] => [fact.label, `${String(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`]),
    ['Score', score.dimension === 'none' ? 'design-specific; the library score does not change' : `${score.dimension}, ${String(score.affected)} of ${String(score.checked)} affected`]];
  out += `<section><h2>Library</h2><div class="card"><dl class="facts">${facts.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl></div></section>`;
  if (insight.summary) out += `<section><h2>Summary</h2><div class="card"><p style="margin:0">${esc(insight.summary)}</p></div></section>`;
  if (insight.actions.length > 0) out += `<section><h2>What to do</h2><div class="card"><ol class="actions">${insight.actions.map(action =>
    `<li><strong>${esc(action.title)}</strong> · ${esc(action.who.replaceAll('_', ' '))}<br><span class="notes">${esc(action.reason)}</span></li>`).join('')}</ol></div></section>`;
  const datasets = Object.entries(insight.datasets ?? {}).filter(([, data]) => data !== null && typeof data === 'object' && Array.isArray(data.rows));
  if (datasets.length > 0) out += `<section><h2>Data</h2><div class="card">${datasets.map(([name, data]) =>
    `<details><summary>Data table · ${esc(name)} · ${plural(data.rows.length, 'row')}</summary>${dataTable(projectTable(data))}</details>`).join('')}</div></section>`;
  const list = (title: string, items: readonly string[]) => `<div class="card"><h2>${title}</h2>${items.length === 0 ? '<p class="notes">None stated.</p>' : `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`}</div>`;
  out += `<section class="pair">${list('Assumptions', insight.assumptions)}${list('Limits', insight.limits)}</section>`;
  return out + provenance(insight);
}
```

In `test/contract/support/libinsight-analyses-guide-worker.ts`, after `assert.ok(done.html.includes('size_coverage_gaps@1'),'the page names the admitted analysis');` add:
```ts
 assert.ok(done.html.includes(rule.sentence),'the page states the rule');assert.ok(done.html.includes(detail.insight.library.headline),'and its headline');
 assert.match(done.html,/href="hima:\/\/data-insight\/\?insight=size_coverage_gaps%401"[^>]*>Open in Data Insight</);
```

- [ ] **Step 4: Run the tests**

```bash
node --test packages/harness/src/analysis-page.test.ts
pnpm run build && pnpm run typecheck && pnpm run test:unit
node scripts/run-contract-tests.mjs atcs-dry --files test/contract/libinsight-resident-durable.host.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add packages/harness/src/analysis-page.ts packages/harness/src/analysis-page.test.ts test/contract/support/libinsight-analyses-guide-worker.ts
git commit -m "feat(harness): the analysis page states the rule and its headline and opens Data Insight

Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---
### Task 15: Conversation card, Data Insight focus and the desktop link (with the L3 window test)

**Files:**
- Create: `packages/harness/src/client/insight-focus.ts`, `packages/harness/src/client/insight-focus.test.ts`
- Modify: `packages/harness/src/client/workbench-address.ts`, `HimaWorkbench.tsx`, `LibInsightAppPanel.tsx`, `index.ts`
- Modify: `packages/harness/src/client/insight-analysis-card.ts`, `insight-analysis-card.test.ts`, `InsightAnalysisCard.tsx`
- Create: `packages/desktop/src/insight-link.ts`, `packages/desktop/src/insight-link.test.ts`; Modify: `packages/desktop/src/main.ts`
- Modify: `test/contract/unified-workbench.test.ts` (one new L3 test)

**Interfaces:**
- Produces:
  - `insight-focus.ts`: `INSIGHT_REF` (regex `^[a-z0-9][a-z0-9_-]{1,62}@[1-9][0-9]{0,8}$`), `OPEN_INSIGHT_EVENT = 'hima:open-insight'`, `insightFrameUrl(viewerUrl, ref?) -> string` (`?insight=<ref>`).
  - `WorkbenchAddress` `insight` variant gains `insight?: string`.
  - `LibInsightAppPanel` prop `focus?: string`; the section carries `data-hima-state-focus`.
  - `InsightAnalysisCard` prop `openInsight?(ref: string): void`; proposal card shows the rule name, title, sentence, parameters and Kit; result card shows the headline and an "Open in Data Insight" button (`data-hima-control="open-in-data-insight"`) when the result is in Data Insight.
  - Client `apply`: `openInsight(ref)` opens the Workbench tab with params `{kind: 'insight', insight: ref}`; a window event `hima:open-insight` with `detail.insight` does the same.
  - Desktop: `dataInsightLink(url) -> ref | undefined` for `hima://data-insight/?insight=<ref>`; `openInsightScript(ref) -> string`; page and main windows hand such a link to the main window.

- [ ] **Step 1: Write the failing unit tests**

`packages/harness/src/client/insight-focus.test.ts`:
```ts
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) { if (specifier.startsWith('.') && specifier.endsWith('.js')) return next(`${specifier.slice(0, -3)}.ts`, context); throw error; }
} });

const { insightFrameUrl, INSIGHT_REF }: typeof import('./insight-focus.js') = await import(`./insight-focus.${'ts'}`);
const { workbenchAddressOf, workbenchAddressKey }: typeof import('./workbench-address.js') = await import(`./workbench-address.${'ts'}`);

test('a rule reference focuses the LibInsight frame; anything else leaves it alone', () => {
  assert.equal(insightFrameUrl('http://localhost:5001/', 'vmin_bottleneck@2'), 'http://localhost:5001/?insight=vmin_bottleneck%402');
  assert.equal(insightFrameUrl('http://localhost:5001/', 'not a rule'), 'http://localhost:5001/');
  assert.equal(insightFrameUrl('http://localhost:5001/', undefined), 'http://localhost:5001/');
  assert.ok(INSIGHT_REF.test('size_coverage_gaps@1'));
  assert.equal(INSIGHT_REF.test('Size@1'), false);
  assert.equal(INSIGHT_REF.test('size@0'), false);
});

test('a Workbench address can name the rule Data Insight opens on', () => {
  assert.deepEqual(workbenchAddressOf({ kind: 'insight', insight: 'vmin_bottleneck@2' }), { kind: 'insight', insight: 'vmin_bottleneck@2' });
  assert.equal(workbenchAddressOf({ kind: 'insight', insight: 'not a rule' }).kind, 'invalid');
  assert.notEqual(workbenchAddressKey({ kind: 'insight', insight: 'a_b@1' }), workbenchAddressKey({ kind: 'insight' }));
});
```
Append to `packages/harness/src/client/insight-analysis-card.test.ts`:
```ts
test('a rule proposal names the rule and its sentence, and an insight result offers Data Insight', () => {
  const card = readInsightAnalysisCard(block({ action: 'propose', proposalId: 'p', ready: true, question: 'Which cells limit my Vmin?', sources: [], buildsOn: [],
    rule: { id: 'vmin_bottleneck', title: 'Vmin bottlenecks', sentence: 'A cell is a Vmin bottleneck when it slows down more than the inverter.', parameters: [{ name: 'watch', value: 0.08, meaning: 'm' }] },
    kit: { name: 'saed14', variants: [], corners: ['tt0p8v25c'] }, needs: ['facts'], unknowns: [] }));
  assert.equal(card.kind, 'proposal');
  if (card.kind !== 'proposal') return;
  assert.deepEqual(card.rule, { id: 'vmin_bottleneck', title: 'Vmin bottlenecks', sentence: 'A cell is a Vmin bottleneck when it slows down more than the inverter.', parameters: [{ name: 'watch', value: '0.08' }] });
  assert.equal(card.kit, 'saed14 · tt0p8v25c');
  const result = readInsightAnalysisCard(block({ action: 'result', runId: 'run-1', page, status: 'ended-goal-met', admission: { admitted: true }, analysis: 'vmin_bottleneck@2',
    insight: { ref: 'vmin_bottleneck@2', headline: '3 of 40 cells slow down more than the inverter at low supply', exported: true } }));
  assert.equal(result.kind, 'result');
  if (result.kind !== 'result') return;
  assert.deepEqual(result.insight, { ref: 'vmin_bottleneck@2', headline: '3 of 40 cells slow down more than the inverter at low supply', exported: true });
});
```
`packages/desktop/src/insight-link.test.ts`:
```ts
import assert from 'node:assert/strict';
import test from 'node:test';

const { dataInsightLink, openInsightScript }: typeof import('./insight-link.js') = await import(`./insight-link.${'ts'}`);

test('only a well-formed Data Insight link names a rule', () => {
  assert.equal(dataInsightLink('hima://data-insight/?insight=vmin_bottleneck%402'), 'vmin_bottleneck@2');
  assert.equal(dataInsightLink('hima://data-insight/?insight=Bad@1'), undefined);
  assert.equal(dataInsightLink('hima://elsewhere/?insight=vmin_bottleneck@2'), undefined);
  assert.equal(dataInsightLink('https://data-insight/?insight=vmin_bottleneck@2'), undefined);
  assert.equal(dataInsightLink('not a url'), undefined);
});

test('the script the main window runs carries only a checked reference', () => {
  assert.equal(openInsightScript('vmin_bottleneck@2'), `window.dispatchEvent(new CustomEvent('hima:open-insight', { detail: { insight: "vmin_bottleneck@2" } }))`);
  assert.throws(() => openInsightScript('x"); alert(1); ("'), /not a rule reference/);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
node --test packages/harness/src/client/insight-focus.test.ts packages/harness/src/client/insight-analysis-card.test.ts packages/desktop/src/insight-link.test.ts
```
Expected: FAIL (modules missing; `card.rule` undefined).

- [ ] **Step 3: Implement the focus helpers and the address**

`packages/harness/src/client/insight-focus.ts`:
```ts
// Data Insight focused on one admitted insight rule (ADR-0022): the reference a conversation card, an analysis
// page or the desktop shell names, and the LibInsight frame address that opens on it.
export const INSIGHT_REF = /^[a-z0-9][a-z0-9_-]{1,62}@[1-9][0-9]{0,8}$/;
export const OPEN_INSIGHT_EVENT = 'hima:open-insight';

/** The viewer page opened on one rule (LibInsight reads `?insight=<id>@<version>`), or the page itself. */
export function insightFrameUrl(viewerUrl: string, ref?: string): string {
  if (ref === undefined || !INSIGHT_REF.test(ref)) return viewerUrl;
  const url = new URL(viewerUrl);
  url.searchParams.set('insight', ref);
  return url.toString();
}
```
In `packages/harness/src/client/workbench-address.ts`:
- add `import { INSIGHT_REF } from './insight-focus.js';` at the top;
- change the `insight` variant to `| { readonly kind: 'insight'; readonly reportRef?: string; readonly scope?: string; readonly insight?: string }`;
- add `readonly insight?: unknown` to `NavigationParams`;
- replace the `if (value.kind === 'insight') { … }` block with:
```ts
  if (value.kind === 'insight') {
    if (value.reportRef !== undefined && text(value.reportRef) === undefined) return invalid('Insight reportRef must be a non-empty string when present.');
    if (value.scope !== undefined && text(value.scope) === undefined) return invalid('Insight scope must be a non-empty string when present.');
    if (value.insight !== undefined && (typeof value.insight !== 'string' || !INSIGHT_REF.test(value.insight))) return invalid('Insight focus must be a rule reference like vmin_bottleneck@2.');
    return { kind: 'insight', ...(text(value.reportRef) === undefined ? {} : { reportRef: text(value.reportRef)! }), ...(text(value.scope) === undefined ? {} : { scope: text(value.scope)! }),
      ...(typeof value.insight === 'string' ? { insight: value.insight } : {}) };
  }
```
- in `workbenchAddressKey`, change the insight tuple to `JSON.stringify(['insight', address.reportRef ?? null, address.scope ?? null, address.insight ?? null])`.

- [ ] **Step 4: Show the rule on the cards**

In `packages/harness/src/client/insight-analysis-card.ts`:
- in `CardProposal`, after `readonly unknowns: readonly string[];` add:
```ts
  /** The rule the person confirms (ADR-0022) and the Kit it reads. */
  readonly rule?: { readonly id: string; readonly title: string; readonly sentence: string; readonly parameters: readonly { readonly name: string; readonly value: string; readonly unit?: string }[] };
  readonly kit?: string;
```
- in `CardResult`, after `readonly plotCount?: number;` add `  /** An admitted insight result: its reference, headline and whether Data Insight lists it. */\n  readonly insight?: { readonly ref: string; readonly headline: string; readonly exported: boolean };`;
- in the `'propose'` case, before `unknowns: strings(value.unknowns) };`, add:
```ts
        ...ruleOf(value.rule), ...(kitOf(value.kit) === undefined ? {} : { kit: kitOf(value.kit)! }),
```
- in the `'result'` case, after `...(Array.isArray(value.plots) ? { plotCount: value.plots.length } : {})`, add `, ...insightOf(value.insight)`;
- add before `export function readInsightAnalysisCard`:
```ts
function ruleOf(raw: unknown): Pick<CardProposal, 'rule'> {
  const rule = raw as { id?: unknown; title?: unknown; sentence?: unknown; parameters?: unknown } | undefined;
  if (!rule || !text(rule.id) || !text(rule.sentence)) return {};
  const parameters = (Array.isArray(rule.parameters) ? rule.parameters as Record<string, unknown>[] : []).flatMap(p => text(p.name)
    ? [{ name: String(p.name), value: String(p.value), ...(text(p.unit) ? { unit: String(p.unit) } : {}) }] : []);
  return { rule: { id: String(rule.id), title: text(rule.title) ?? String(rule.id), sentence: String(rule.sentence), parameters } };
}
function kitOf(raw: unknown): string | undefined {
  const kit = raw as { name?: unknown; variants?: unknown; corners?: unknown } | undefined;
  return kit && text(kit.name) ? [String(kit.name), ...strings(kit.variants), ...strings(kit.corners)].join(' · ') : undefined;
}
function insightOf(raw: unknown): Pick<CardResult, 'insight'> {
  const insight = raw as { ref?: unknown; headline?: unknown; exported?: unknown } | undefined;
  return insight && text(insight.ref) && text(insight.headline) ? { insight: { ref: String(insight.ref), headline: String(insight.headline), exported: insight.exported === true } } : {};
}
```

Replace `packages/harness/src/client/InsightAnalysisCard.tsx` with:
```tsx
// The conversation card of one `hima_insight_analysis` call (ADR-0021, ADR-0022). A proposal names the rule and
// its sentence for the person to answer in the conversation, never with a confirm button; a started or finished
// analysis opens its own page, and an admitted insight result opens Data Insight on its rule.
import type { ReactElement } from 'react';
import type { ToolBlock } from './HimaRunCard.js';
import { readInsightAnalysisCard } from './insight-analysis-card.js';
import { HIMA_STYLE } from './workbench-style.js';

function OpenPage({ page }: { readonly page: string }): ReactElement {
  return <button type='button' className='hima-button hima-analysis-card-open' data-hima-control='open-analysis-page'
    onClick={() => { window.open(page, '_blank', 'noopener'); }}>Open analysis page</button>;
}

export function InsightAnalysisCard({ block, openInsight }: { readonly block: ToolBlock; readonly openInsight?: (ref: string) => void }): ReactElement {
  const card = readInsightAnalysisCard(block);
  const body = (() => {
    switch (card.kind) {
      case 'pending': return <p className='hima-muted'>Working on the library analysis…</p>;
      case 'text': return <pre className={card.error ? 'hima-analysis-card-error' : 'hima-receipt-body'}>{card.text}</pre>;
      case 'proposal': return <>
        <span className='hima-analysis-card-eyebrow'>Library insight rule · proposal</span>
        {card.rule === undefined ? null : <div className='hima-analysis-card-rule' data-hima-region='insight-rule'>
          <p><code>{card.rule.id}</code> <strong>{card.rule.title}</strong></p>
          <p className='hima-analysis-card-sentence'>{card.rule.sentence}</p>
          {card.rule.parameters.length === 0 ? null : <ul>{card.rule.parameters.map(p => <li key={p.name}>{p.name} = {p.value}{p.unit ? ` ${p.unit}` : ''}</li>)}</ul>}
        </div>}
        <p className='hima-analysis-card-question'>{card.question}</p>
        <dl className='hima-analysis-card-facts'>
          {card.kit === undefined ? null : <><dt>Kit</dt><dd>{card.kit}</dd></>}
          <dt>Libraries</dt><dd>{card.sources.length === 0 ? (card.kit === undefined ? 'Found by the resident agent on the Site' : 'The Kit\'s Liberty files') : <ul>{card.sources.map(source => <li key={source}><code>{source}</code></li>)}</ul>}</dd>
          {card.buildsOn.length === 0 ? null : <><dt>Builds on</dt><dd>{card.buildsOn.map(ref => <code key={ref}>{ref}</code>)}</dd></>}
          {card.pack === undefined ? null : <><dt>Pack</dt><dd>{card.pack}</dd></>}
          {card.site === undefined ? null : <><dt>Site</dt><dd>{card.site}</dd></>}
          {card.timeBoxMinutes === undefined ? null : <><dt>Time box</dt><dd>{card.timeBoxMinutes} min</dd></>}
        </dl>
        {card.ready ? <p className='hima-analysis-card-next'>Nothing runs yet. Reply in the conversation to start it, or to change the rule.</p>
          : <div className='hima-analysis-card-unready'><p>Not ready to start:</p><ul>{card.unknowns.map(item => <li key={item}>{item}</li>)}</ul></div>}
      </>;
      case 'started': return <>
        <span className='hima-analysis-card-eyebrow'>Library insight rule · started</span>
        <p>The resident agent is writing and running the rule. Its page fills in as it works.</p>
        <p className='hima-small'>Run <code>{card.runId}</code></p>
        <OpenPage page={card.page} />
      </>;
      case 'result': return <>
        <span className='hima-analysis-card-eyebrow'>Library insight rule</span>
        <p className='hima-analysis-card-state' data-state={card.state}>{card.said}</p>
        {card.insight === undefined ? null : <p className='hima-analysis-card-headline' data-hima-region='insight-headline'>{card.insight.headline}</p>}
        {card.question === undefined ? null : <p className='hima-analysis-card-question'>{card.question}</p>}
        {card.summary === undefined ? null : <p className='hima-analysis-card-summary'>{card.summary}</p>}
        <div className='hima-analysis-card-actions'>
          {card.insight?.exported && openInsight ? <button type='button' className='hima-button' data-hima-control='open-in-data-insight'
            onClick={() => { openInsight(card.insight!.ref); }}>Open in Data Insight</button> : null}
          <OpenPage page={card.page} />
        </div>
      </>;
      case 'list': return <>
        <span className='hima-analysis-card-eyebrow'>Library analyses</span>
        {card.rows.length === 0 ? <p className='hima-muted'>No analyses in this project yet.</p>
          : <ul className='hima-analysis-card-list'>{card.rows.map(row => <li key={row.runId}>
              <span>{row.question ?? row.runId}</span><span className='hima-small'>{row.said}</span>
              <button type='button' className='hima-button' data-hima-control='open-analysis-page' onClick={() => { window.open(row.page, '_blank', 'noopener'); }}>Open</button>
            </li>)}</ul>}
      </>;
    }
  })();
  return <div className='hima-run-card hima-analysis-card hima-root' data-hima-region='insight-analysis' data-hima-state-card={card.kind}>
    <style>{HIMA_STYLE}</style>
    {body}
  </div>;
}
```

- [ ] **Step 5: Focus the Workbench and the frame**

In `packages/harness/src/client/index.ts`:
- change the `sidebarRight` line of `ClientContext` to `readonly sidebarRight: { openTab(kind: string, options?: { params?: Readonly<Record<string, string>> }): void };`;
- add `import { INSIGHT_REF, OPEN_INSIGHT_EVENT } from './insight-focus.js';`;
- in `apply`, after `const openRun = …;` add:
```ts
  // Data Insight opened on one admitted rule (ADR-0022): from a result card, or from an analysis page's link,
  // which the desktop shell turns into this window event.
  const openInsight = (insight: string) => ctx.sidebarRight.openTab(WORKBENCH_KIND, { params: { kind: 'insight', insight } });
  ctx.effect(() => {
    const onOpen = (event: Event) => {
      const insight = (event as CustomEvent<{ insight?: unknown }>).detail?.insight;
      if (typeof insight === 'string' && INSIGHT_REF.test(insight)) openInsight(insight);
    };
    window.addEventListener(OPEN_INSIGHT_EVENT, onOpen);
    return () => { window.removeEventListener(OPEN_INSIGHT_EVENT, onOpen); };
  });
```
- change the card registration to `claimed.push(ctx.slots.register({ name: 'tool.call.toolview', key: 'hima_insight_analysis', inject: () => ({ openInsight }) }, InsightAnalysisCard));`.

In `packages/harness/src/client/HimaWorkbench.tsx`:
- in the effect that follows `tab.navigation.revision`, after `if (requestedAddress.kind === 'insight') lastInsightAddress.current = requestedAddress;` add `if (requestedAddress.kind === 'insight' && requestedAddress.insight !== undefined) setInsightSurface('libinsight');`;
- change the `LibInsightAppPanel` element to `<LibInsightAppPanel sessionId={activeSessionId} hidden={!showingLibInsight} focus={address.kind === 'insight' ? address.insight : undefined} pickFolder={pickFolder} onShowReports={() => setInsightSurface('reports')} />`.

In `packages/harness/src/client/LibInsightAppPanel.tsx`:
- add `import { insightFrameUrl } from './insight-focus.js';`;
- change the props to `{ sessionId, hidden, focus, pickFolder, onShowReports }: { readonly sessionId: string; readonly hidden: boolean; readonly focus?: string; readonly pickFolder?: () => Promise<string | null>; onShowReports(): void }`;
- after the first `useEffect` add:
```ts
  // A rule named by a card or a page (ADR-0022): opening asks the Host to place every admitted result in the
  // folder LibInsight lists, then the frame reloads on that rule.
  useEffect(() => {
    if (focus === undefined || hidden || status === undefined || status.state !== 'ready') return;
    void open();
  }, [focus]);
```
- add `data-hima-state-focus={focus ?? ''}` to the `<section …>` element, add `{focus === undefined ? null : <span className='hima-small' data-hima-control='libinsight-focus'>Rule {focus}</span>}` after the Version span in the header, and change the iframe to
```tsx
      : status.state === 'ready' ? <iframe key={`${insightFrameUrl(status.url, focus)}#${String(reload)}`} className='hima-libinsight-frame' src={insightFrameUrl(status.url, focus)} title='LibInsight' data-hima-control='libinsight-frame'
          sandbox='allow-scripts allow-same-origin allow-forms allow-downloads' referrerPolicy='no-referrer'/>
```

- [ ] **Step 6: Hand Data Insight links to the main window**

`packages/desktop/src/insight-link.ts`:
```ts
// A Data Insight link from a Host page (ADR-0022): `hima://data-insight/?insight=<rule id>@<version>`. The shell
// never navigates to it; it opens the Workbench on that rule in the window that holds the conversation.
const INSIGHT_REF = /^[a-z0-9][a-z0-9_-]{1,62}@[1-9][0-9]{0,8}$/;

export function dataInsightLink(target: string): string | undefined {
  let url: URL;
  try { url = new URL(target); } catch { return undefined; }
  if (url.protocol !== 'hima:' || url.hostname !== 'data-insight') return undefined;
  const ref = url.searchParams.get('insight') ?? '';
  return INSIGHT_REF.test(ref) ? ref : undefined;
}

/** The one script the main window runs for such a link; only a checked reference is ever embedded. */
export function openInsightScript(ref: string): string {
  if (!INSIGHT_REF.test(ref)) throw new Error('not a rule reference');
  return `window.dispatchEvent(new CustomEvent('hima:open-insight', { detail: { insight: ${JSON.stringify(ref)} } }))`;
}
```
In `packages/desktop/src/main.ts`:
- add `import { dataInsightLink, openInsightScript } from './insight-link.js';`;
- change `function fenceNavigation(win: BrowserWindow, allowedOrigin: () => string | undefined): void {` to `function fenceNavigation(win: BrowserWindow, allowedOrigin: () => string | undefined, onInsight: (ref: string) => void): void {`;
- make the first statement of the `setWindowOpenHandler` callback `const insight = dataInsightLink(url); if (insight !== undefined) { onInsight(insight); return { action: 'deny' }; }`, and the first statement of the `will-navigate` handler `const insight = dataInsightLink(url); if (insight !== undefined) { event.preventDefault(); onInsight(insight); return; }`;
- in `openPageWindow`, change `fenceNavigation(page, allowedOrigin);` to `fenceNavigation(page, allowedOrigin, ref => { showDataInsight(opener, ref); });`;
- change the main window's `fenceNavigation(win, () => host?.origin);` to `fenceNavigation(win, () => host?.origin, ref => { showDataInsight(win, ref); });`;
- add after `openPageWindow`:
```ts
/** Open the Workbench on Data Insight focused on one rule (ADR-0022), in the window that holds the conversation. */
function showDataInsight(target: BrowserWindow, ref: string): void {
  if (target.isDestroyed()) return;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
  void target.webContents.executeJavaScript(openInsightScript(ref));
}
```

- [ ] **Step 7: Write the L3 window test**

Add to `test/contract/unified-workbench.test.ts`, after the test `'Data Insight shows the LibInsight pages in place and keeps them across a mode switch (ADR-0019)'`:
```ts
test('a rule opens Data Insight focused on it, and the viewer lists the Harness results folder (ADR-0022)', async t => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  const code = path.join(home.h.home, 'libinsight-test', 'code'), data = path.join(home.h.home, 'libinsight-test', 'checkout', 'data');
  await mkdir(path.join(code, 'app'), { recursive: true });
  await writeFile(path.join(code, 'app', 'server.py'), await readFile(path.join(repoRoot, 'test/fixtures/libinsight-viewer/app/server.py')));
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, 'app.json'), JSON.stringify({ data_root: 'data', kits: [{ id: 'fixture-kit', manifest: 'kits/fixture-kit.json' }] }));
  const port = await freePort();
  const d = await bootDriver(t, { existing: home.h, remoteDebuggingPort: port, window: { width: 1440, height: 960 },
    env: { HIMA_TEST_SILENT_AGENT: '1', HIMA_LIBINSIGHT_ROOT: code, HIMA_LIBINSIGHT_DATA: data } });
  if (!d) { await home.h.dispose(); return; }
  let browser: Inspector | undefined;
  try {
    browser = await inspectWindow(port);
    const { host, cookie, sessionId } = await prepareSession(d, browser);
    // What the desktop shell does for an analysis page's link, and what a result card's button calls.
    const open = (ref: string) => browser!.evaluate(`window.dispatchEvent(new CustomEvent('hima:open-insight', { detail: { insight: ${JSON.stringify(ref)} } }))`);
    await open('size_coverage_gaps@1');
    await browser.wait(`document.querySelector('[data-hima-region="libinsight"]')?.getAttribute('data-hima-state-viewer') === 'ready'`, 30_000);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-region="studio"]').getAttribute('data-hima-state-mode')`), 'insight');
    await browser.wait(`document.querySelector('[data-hima-region="libinsight"]').getAttribute('data-hima-state-focus') === 'size_coverage_gaps@1'`, 10_000);
    await browser.wait(`/[?]insight=size_coverage_gaps%401$/.test(document.querySelector('[data-hima-control="libinsight-frame"]').src)`, 10_000);
    const src = await browser.evaluate<string>(`document.querySelector('[data-hima-control="libinsight-frame"]').src`);
    let frame: Inspector | undefined;
    for (let i = 0; i < 40 && frame === undefined; i += 1) {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; url: string }[];
      if (targets.some(entry => entry.type === 'iframe' && entry.url === src)) frame = await inspectWindow(port, entry => entry.type === 'iframe' && entry.url === src);
      else await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(frame, 'the focused LibInsight frame is its own rendered document');
    try {
      await frame.wait(`document.body.innerText.includes('Focus: size_coverage_gaps@1')`, 10_000);
      const status = await (await api(host, cookie, `/hima/api/libinsight?sessionId=${encodeURIComponent(sessionId)}`)).json() as { analysesRoot?: string };
      assert.ok(status.analysesRoot?.endsWith('libinsight-results'), JSON.stringify(status));
      assert.deepEqual((await frame.evaluate(`fetch('/args').then(r => r.json())`) as { roots: string[] }).roots, [status.analysesRoot]);
    } finally { frame.close(); }
    await capture(d, browser, 'data-insight-focused-rule');
    await open('vmin_bottleneck@2');
    await browser.wait(`/[?]insight=vmin_bottleneck%402$/.test(document.querySelector('[data-hima-control="libinsight-frame"]').src)`, 10_000);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="libinsight-focus"]').textContent`), 'Rule vmin_bottleneck@2');
  } finally { await finish(d, browser); await home.h.dispose(); }
});
```

- [ ] **Step 8: Run unit, local and desktop checks (desktop on the Catsights display)**

```bash
node --test packages/harness/src/client/insight-focus.test.ts packages/harness/src/client/insight-analysis-card.test.ts packages/desktop/src/insight-link.test.ts
pnpm run build && pnpm run typecheck && pnpm run test:unit
pnpm run test:local --files test/contract/view.test.ts test/contract/view-run.test.ts
pnpm run test:desktop --files test/contract/unified-workbench.test.ts test/contract/window.test.ts
```
Expected: PASS. The desktop group runs real Electron windows: confirm the Catsights display is online first (docs/testing-strategy.md, 2026-09-13); without it the desktop group is BLOCKED, not passed — record that and stop this step.

- [ ] **Step 9: Commit and push**

```bash
git add packages/harness/src/client packages/desktop/src/insight-link.ts packages/desktop/src/insight-link.test.ts packages/desktop/src/main.ts test/contract/unified-workbench.test.ts
git commit -m "feat(harness): rule cards and analysis pages open Data Insight on their rule

Proposal cards name the rule and its sentence; result cards carry the headline and Open in
Data Insight; hima://data-insight links from the analysis page are handed by the desktop shell
to the main window; the LibInsight frame opens on ?insight=<id>@<version>.
Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

---
### Task 16: ADR-0022 (revises ADR-0021), vocabulary and the spec revision

**Files:**
- Create: `docs/adr/0022-insight-rules-delivered-to-data-insight.md`
- Modify: `docs/adr/0021-guide-chat-starts-library-analyses-shown-on-their-own-page.md` (pointer line)
- Modify: `CONTEXT.md` (two terms)
- Modify: `docs/specs/libinsight-resident/spec.zh-CN.md` (revision section)

**Interfaces:** documentation only; it records the decisions this plan implemented (Tasks 1–15) so the next session can act without this plan.

- [ ] **Step 1: Write the ADR**

`docs/adr/0022-insight-rules-delivered-to-data-insight.md`:
```markdown
---
status: accepted
---

# 库洞察规则：对话提出规则，结果由 LibInsight 在 Data Insight 中呈现

用户于 2026-10-08 采纳 LibInsight「insight rules」规格（`lib_insight/docs/spec/library-insight-rules.md`，§9、§9.1、
§11 P2）：每条分析都是一条**规则**（名称 + 一句话 + 参数），交付同一种结果格式 `hima-libinsight-insight/1`，
由 LibInsight 用唯一的渲染器、封闭的图表种类和固定的动作文件生成器呈现。本 ADR 修订
[ADR-0021](0021-guide-chat-starts-library-analyses-shown-on-their-own-page.md) 的结果呈现部分；
[ADR-0019](0019-data-insight-frames-the-libinsight-app.md)、[ADR-0020](0020-guide-conducts-libinsight-through-the-resident-agent.md)
与 ADR-0021 的对话入口、一次人工确认规则、Run 所有权、Reader 判定和许可证模式不变。

## 决定

- **Pack `libinsight-analysis` 0.2.0。** 路线为 prepare-request → prepare-data → custom-analysis → admit-analysis
  → deliver。请求改为 `hima-libinsight-request/2`（rule、kit、netlists、design、needs）；Host 只对 0.2.0 及以后的 Pack
  写 `/2`。prepare-data 从 facts 语料库或 Site facts 仓库取每个 Liberty 文件的 facts；缺失时在 Site 的 `edarun` 下用
  LibInsight 自己的提取器逐文件提取，前后 hash 一致才接纳入仓库；并用 LibInsight 的网表读取器生成 netlist facts。
  需要提取而许可证模式不是 `new` 时在 prepare-request 拒绝；提取失败则 Run 停止，不在部分数据上分析。
- **唯一校验器。** Reader `libinsight-insight` 运行 LibInsight 的 `insight_result.validate(result, prepared=…, root=…,
  byte_size=…, current_sha=…)`。Pack 在 `flow/libinsight_analysis/vendor/` 携带该文件（以及 `insight_actions`、
  `netlist` 的导入闭包和 `extract/libapi_extract.py`），提交固定为 `packages/desktop/libinsight.pin.json` 的同一提交，
  `vendor/VENDOR.json` 记录每个文件的 SHA-256，导入前核对；不一致即 Pack 缺陷，Reader 不接受。Pack 只补充本 Run
  才知道的检查：结果 id 是用户确认的规则；prepare-data 记录的设计文件未变。规则 `insight-delivery-ready` 判定
  `li_insight_error_count = 0`。
- **结果进入 Data Insight。** Host 把已接纳的 insight 结果按原字节、只读写入 Harness 自有目录
  `<Home>/libinsight-results/<id>/v<version>/result.json`（先在目录外暂存再改名；同字节幂等；同 id@version 不同字节
  拒绝并说明）。Host 启动 LibInsight viewer 时以 `--analyses-root <该目录>` 传入；LibInsight 在内存中把它加到 `app.json`
  的 `analyses_roots` 之后。Harness 不写 LibInsight 的数据文件夹，也不生成派生 `app.json`。所固定的 LibInsight 不支持
  该参数时（`app/server.py` 中没有 `--analyses-root`），viewer 照旧启动，状态中不报告结果目录。
- **识别与提案。** Pack 合同新增通用可选字段 `offers`（名称、标题、一句话、示例、可改参数），Guide 的 inventory 列出
  它们；产品上下文要求把用户问题映射到某条 offer 或一条新规则。提案卡显示规则名与一句话、参数和 Kit；确认仍是用户在
  对话中的回答。
- **呈现。** 结果卡显示 headline 与 “Open in Data Insight”；独立分析页（ADR-0021）保留摘要、规则、headline、库层事实、
  动作、数据表、假设、限制与溯源，并以 `hima://data-insight/?insight=<id>@<version>` 链接打开 Data Insight——桌面壳
  拦截该链接，在主窗口打开 Workbench 的 Data Insight，iframe 地址带 `?insight=<id>@<version>`。图表只由 LibInsight 绘制。

## 保持

- 每次请求是一个任务局部 Run（ADR-0017 Q5）；连续开发依靠 Site 库与 `buildsOn`，0.1 已登记的 analysis/1 条目仍可被
  `buildsOn` 读取。
- 驻场 Agent 的自述不构成事实；只有 Reader 接受并登记的结果进入 Data Insight。
- 许可证模式由用户在 linglong 上切换；Pack 与 Host 从不切换。

## 回滚

本 ADR 的实现提交可整体回退：Pack 回到 0.1.0，Host 对 0.1 Pack 写 `/1`，viewer 不传结果目录。Harness 结果目录可删除，
不影响 LibInsight 数据文件夹。

## 验证

L1/L2：Pack Python 测试（vendor、builder、request `/2`、prepare-data、Reader 反例、四条参考规则、路线、知识）；
`libinsight-analyses.test.ts`、`libinsight-viewer.test.ts`、`pack-offers.test.ts`、`analysis-page.test.ts`、客户端单测；
`libinsight-resident-durable.host.test.ts`（clean、repair、Guide，五个任务，导出字节等于 Reader 接受的字节）。
L3：`unified-workbench.test.ts` 的 Data Insight 规则聚焦。L4：打包 App 在 Catsights 上于 linglong 完成 §9.1 四个故事，
记录见 Pack `TEST.md`。
```

- [ ] **Step 2: Point ADR-0021 at it**

In `docs/adr/0021-guide-chat-starts-library-analyses-shown-on-their-own-page.md`, add after the title line:
```markdown

> 2026-10-08：结果呈现部分由 [ADR-0022](0022-insight-rules-delivered-to-data-insight.md) 修订——规则结果由 LibInsight 在
> Data Insight 中呈现，本页面保留摘要并链接到 Data Insight。对话入口与一次人工确认规则不变。
```

- [ ] **Step 3: Add the vocabulary**

In `CONTEXT.md`, after the `**Design-specific 分析**` entry, add:
```markdown
**Insight 规则（Rule）**:
回答一个 Kit 问题、以名称和一句话陈述、带版本的分析；交付 `hima-libinsight-insight/1` 结果，由 LibInsight 在 Data Insight 中与其他规则并列呈现。来源可以是内置检查、公司规则或对话中提出的定制规则。
_Avoid_: 页面、图表、一次 Run（作为规则本身的同义词）

**Insight 结果**:
一条规则交付的单一结果文件：规则、数据集、库层概览、条目、图表、类型化动作与评分块，可追溯到源 hash 与脚本；只有 Reader 接受并登记后才进入 Data Insight。
_Avoid_: 报告、截图、模型的总结（作为结果本身的同义词）
```

- [ ] **Step 4: Record the revision in the spec**

Append to `docs/specs/libinsight-resident/spec.zh-CN.md`:
```markdown

## 2026-10-08 再修订：insight 规则（Pack 0.2）

依据 [ADR-0022](../../adr/0022-insight-rules-delivered-to-data-insight.md) 与 LibInsight 规格
`library-insight-rules.md` §9。实施计划：`docs/superpowers/plans/2026-10-08-libinsight-analysis-insight-rules-v0.2.md`。

- 交付格式改为 `hima-libinsight-insight/1`，由 LibInsight 的校验器判定；结果导出到 Harness 自有目录，经 viewer 的
  `--analyses-root` 进入 Data Insight。
- 新增 prepare-data：facts 查找、QuaLib 提取与接纳、netlist facts；Site 新增 `kitCatalog`、`factsStore`、
  `qualibRunner`、`qualibPython`、`qualibApiHome` 绑定与 capability v2。
- 对话提案以规则名与一句话为中心；结果卡与分析页提供 “Open in Data Insight”。
- 验收：§9.1 演示的四个故事，各从一条对话消息开始，到其 Data Insight 页面结束。
```

- [ ] **Step 5: Check links and commit**

```bash
grep -o '](\.\./[^)]*\|](0[0-9]*-[^)]*' docs/adr/0022-insight-rules-delivered-to-data-insight.md docs/adr/0021-guide-chat-starts-library-analyses-shown-on-their-own-page.md | head
ls docs/adr/0019-data-insight-frames-the-libinsight-app.md docs/adr/0020-guide-conducts-libinsight-through-the-resident-agent.md docs/adr/0021-guide-chat-starts-library-analyses-shown-on-their-own-page.md
git add docs/adr/0022-insight-rules-delivered-to-data-insight.md docs/adr/0021-guide-chat-starts-library-analyses-shown-on-their-own-page.md CONTEXT.md docs/specs/libinsight-resident/spec.zh-CN.md
git commit -m "docs(adr): 0022 insight rules are delivered to Data Insight (revises 0021)

Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```
Expected: every linked ADR file exists.

---
### Task 17: Site preparation on linglong and the packaged App candidate

**Files:**
- Modify: `sites/linglong-libinsight/kits.json` (real SAED14 folders and netlist roots), `sites/linglong-libinsight/README.md` (install record)
- Modify: `packages/desktop/package.json` (next trial version)

**Interfaces:**
- Consumes: Tasks 1–16 on the branch; the Site's one-time administrator preparation (the user approves it).
- Produces: linglong with `libinsight-runs/{facts,kits.json}` and `engineering-capabilities-libinsight-v2.json` installed; a packaged App candidate built from the branch head with the pinned LibInsight; the demo inputs (Kit corners, netlist folders, one SAED14 design with its timing report) written into the L4 checklist of Task 18.

- [ ] **Step 1: Read-only discovery on linglong**

The commands below only list and read (no writes, no sudo, no licence or network change). Run them one at a time:
```bash
ssh -o BatchMode=yes luzi@192.168.50.41 'free -h; /usr/bin/python3 --version; /usr/bin/python3 -c "import numpy; print(numpy.__version__)"; ls -l /usr/local/bin/edarun; cat /data/eda/env/empyrean-license-mode'
ssh -o BatchMode=yes luzi@192.168.50.41 'for v in rvt lvt hvt slvt; do ls /data/eda/pdk/saed14/stdcell_$v/db_nldm/*.lib 2>/dev/null | head -40; done'
ssh -o BatchMode=yes luzi@192.168.50.41 'find /data/eda/pdk/saed14 -maxdepth 4 \( -iname "*.cdl" -o -iname "*.sp" -o -iname "*.spi" -o -iname "*.spice" \) | head -40'
ssh -o BatchMode=yes luzi@192.168.50.41 'ls /data/eda/project/hima_harness/library-intelligence-prototypes/claude-libint-20260923-01/canonical/saed14/'
ssh -o BatchMode=yes luzi@192.168.50.41 'ls /data/eda/project/design_zoo; grep -rl --include="*.rpt" -m1 "saed14" /data/eda/project/design_zoo 2>/dev/null | head -20'
ssh -o BatchMode=yes luzi@192.168.50.41 'ls -ld /data/eda/project/hima_harness/operator-admin/resident-engineering-v1 /data/eda/project/hima_harness/libinsight-runs'
```
Write down: (a) the four Liberty folders that exist and their file names; (b) the SAED14 corners with at least two supplies at the same temperature (for `vmin_bottleneck`); (c) the cell-netlist folder(s); (d) one SAED14 design whose timing report (PrimeTime `report_timing` style, ns and fF) and gate netlist are under `/data/eda/project/design_zoo`, and the corner it was timed at; (e) which SAED14 corners already have facts in the corpus; (f) whether the two admin folders are writable by `luzi`. If no SAED14 design with a timing report exists, stop the critical-path story here and ask the user for a design (never fabricate one); the other three stories continue.

- [ ] **Step 2: Correct the Kit catalogue**

Edit `sites/linglong-libinsight/kits.json`: keep only Liberty folders that exist; set `pattern` to match their file names with the `variant` and `corner` groups (test it locally: `python3 -c 'import re,sys; p=re.compile(sys.argv[1]); print([n for n in sys.argv[2:] if p.search(n)])' '<pattern>' <file names from step 1>`); set `netlistRoots` to the folder(s) from (c) and `netlistPattern` to their extension. Then:
```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_knowledge.py'
```
Expected: PASS.

- [ ] **Step 3: Ask the user to approve the one-time Site preparation**

Show the user exactly these commands and run them only after an explicit yes in the chat (they write only under the Site's own Hima folders; no sudo):
```bash
scp sites/linglong-libinsight/kits.json luzi@192.168.50.41:/data/eda/project/hima_harness/libinsight-runs/kits.json
scp sites/linglong-libinsight/engineering-capabilities-libinsight-v2.json luzi@192.168.50.41:/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/engineering-capabilities-libinsight-v2.json
ssh -o BatchMode=yes luzi@192.168.50.41 'chmod 0444 /data/eda/project/hima_harness/libinsight-runs/kits.json /data/eda/project/hima_harness/operator-admin/resident-engineering-v1/engineering-capabilities-libinsight-v2.json && mkdir -p /data/eda/project/hima_harness/libinsight-runs/facts && sha256sum /data/eda/project/hima_harness/libinsight-runs/kits.json /data/eda/project/hima_harness/operator-admin/resident-engineering-v1/engineering-capabilities-libinsight-v2.json'
sha256sum sites/linglong-libinsight/kits.json sites/linglong-libinsight/engineering-capabilities-libinsight-v2.json
```
Expected: the remote and local SHA-256 values are equal. If a folder is not writable by `luzi`, stop and ask the user; do not use sudo.

- [ ] **Step 4: Record the install and bump the trial version**

Add to the install record of `sites/linglong-libinsight/README.md` the date, the two SHA-256 values and the demo inputs (Liberty folders, corners, netlist folder, design paths and its corner). Set `packages/desktop/package.json` `version` to the next unused trial number:
```bash
node -e "const fs=require('fs');const f='packages/desktop/package.json';const p=JSON.parse(fs.readFileSync(f,'utf8'));const m=p.version.match(/^(.*trial\.)(\d+)$/);p.version=m[1]+(Number(m[2])+1);fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n');console.log(p.version)"
git add sites/linglong-libinsight/kits.json sites/linglong-libinsight/README.md packages/desktop/package.json
git commit -m "chore(site): linglong-libinsight 0.2 install record and SAED14 kit catalogue; next trial version

Model: Opus 5.5 (Claude Code sub-agent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```

- [ ] **Step 5: Full local gate, then package**

```bash
pnpm run check:local
python3 scripts/vendor-libinsight.py --verify --source /Users/lluzi/code/lib_insight
node scripts/package-trial.mjs --output /Users/lluzi/code/hima_harness_insight_v02/.hima-tmp/candidates/$(node -p "require('./packages/desktop/package.json').version") \
  --postgres-prefix <the PG 16.15 prefix of the previous candidate> --postgres-build-manifest <its identity.json> \
  --node-build-manifest <its node identity.json> --node-archive <its node archive> \
  --electron-build-manifest <its electron identity.json> --electron-archive <its electron archive> \
  --notice-materials <its notice-materials.json> --internal-candidate --libinsight-source /Users/lluzi/code/lib_insight
node scripts/package-trial.mjs --verify <the native artifact the previous command printed>
```
The native inputs are the retained files of the previous packaged candidate: open the newest `trial-manifest.json` under `.hima-tmp/` (or the one named in the last trial record) and copy each path from its `runtimeInputs`; ask the coordinator if none is retained. Expected: `check:local` PASS; `--verify` prints `package-trial: libinsight lib_insight <LI_P1> (N files)` and the Pack asset check names `libinsight-analysis`. Nothing to commit (the candidate is under the git-ignored `.hima-tmp/`).

---

### Task 18: L4 — the §9.1 demo on linglong in the packaged App (Catsights)

**Files:**
- Modify: `packs/libinsight-analysis/TEST.md` (the Runs and endings)
- Evidence (git-ignored): `.hima-tmp/libinsight-insight-l4/<YYYYMMDD>/`

**Interfaces:**
- Consumes: the candidate of Task 17; the demo inputs recorded in `sites/linglong-libinsight/README.md`.
- Produces: four admitted insight results, each started from one chat message and ending on its Data Insight page; a `redesign_cell` brief; TEST.md entries.

Executed by the Claude Code main agent (Opus 5.5) with the `himaharness-human-like-tester` skill: real clicks and typing in the packaged App on the Catsights display, nothing driven through APIs except the read-only checks named below.

- [ ] **Step 1: Preconditions**

- Catsights display online (else BLOCKED, not run). Fresh Home for this candidate; the Site `linglong-libinsight` installed in Settings the way trial.42 did, then `GET /hima/api/sites` shows its bindings include `kitCatalog`, `factsStore`, `qualibRunner`.
- Licence mode: `ssh -o BatchMode=yes luzi@192.168.50.41 cat /data/eda/env/empyrean-license-mode`. Story 1 extracts the SAED14 corners the corpus lacks (Task 17 (e)); if any are missing, tell the user: "Story 1 needs QuaLib extraction; please run `empyrean-license new` on linglong and tell me when done." Wait for the user's reply.
- Check memory first: `ssh -o BatchMode=yes luzi@192.168.50.41 free -h`. One story at a time.

- [ ] **Step 2: Story 1 — `vmin_bottleneck`**

In a new conversation type: `Which cells limit my Vmin in the SAED14 library? Compare <the corners from Task 17 (b)>, RVT and HVT.`
Check: the proposal card shows `vmin_bottleneck`, "Vmin bottlenecks", the rule sentence, `watch = 0.05`, Kit `saed14 · rvt · hvt · …`; nothing runs. Correct it in words: `Use 8 %, only HVT.` Check: a new proposal with `watch = 0.08` and variant `hvt`. Confirm: `Yes, start it.` Check: started card, the Run's five tasks; `prepare-data` reports the number extracted; the result card shows the headline and "Open in Data Insight". Click it: the Workbench switches to Data Insight on `vmin_bottleneck@1`; the page lists the rule beside the others with its score effect, items, the fan chart and the actions. Screenshot each step.
After `prepare-data` of this story has finished, remind the user: "Extraction is done; please switch linglong back with `empyrean-license old`."

- [ ] **Step 3: Story 2 — `size_coverage_gaps`**

Type: `Where are the size gaps in SAED14, by track and VT? Use one corner, <a nominal corner from Task 17>.` Check the proposal (rule name and sentence), confirm, follow to "Open in Data Insight": matrix and widest-gap charts, ladder per item, the roadmap file.

- [ ] **Step 4: Story 3 — `table_spikes_kinks`**

Type: `Find spikes and kinks in the SAED14 timing tables at <one corner>.` Confirm and follow to Data Insight: slice and heatmap of the worst table, the re-characterisation file.

- [ ] **Step 5: Story 4 — `critical_path_faster_cells`**

Type: `On the worst paths of <design from Task 17 (d)>, which cells have faster equivalents I could swap in? The netlist is <netlist path>, the timing report is <report path>, timed at <corner>.` Check that the proposal needs `design` and names both files; confirm; in Data Insight select a stage, click two slower cells in the equivalents chart and check that the don't-use file regenerates with those cells; download it into the evidence folder.

- [ ] **Step 6: Close on the redesign brief**

Open `vmin_bottleneck` in Data Insight again (from the story 1 result card), select the worst item and open its `redesign_cell` file: check the five parts and that "Where in the circuit" lists the arc's devices from the SAED14 netlist (or says no netlist was found, which is then a recorded finding). Also open story 1's analysis page from its card and click "Open in Data Insight" there: the main window must switch to the same rule.

- [ ] **Step 7: Clean-up checks and record**

Quit the App; then read-only:
```bash
ssh -o BatchMode=yes luzi@192.168.50.41 'podman ps -a --format "{{.Names}}" | grep -c resident || true; tmux ls 2>/dev/null | grep -c hima || true; cat /data/eda/env/empyrean-license-mode'
pgrep -fl "app/server.py" || echo "no viewer process"
```
Expected: no resident container or Hima tmux session left; licence mode `old` (if not, remind the user once more); no viewer process. Append to `packs/libinsight-analysis/TEST.md` for each story: Run id, ending, elapsed time, Reader attempts, admitted `id@version`, result SHA-256, product model calls if available (else "not measured"), and any finding; reference the evidence folder (git-ignored, SAED14 only). Then:
```bash
git add packs/libinsight-analysis/TEST.md
git status --short
git commit -m "test(libinsight): L4 demo of the four insight rules on linglong in the packaged App

Model: Opus 5.5 (Claude Code main agent, himaharness-human-like-tester).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/libinsight-insight-rules-v0.2 | cut -f1)" && echo "remote at $(git rev-parse --short HEAD)"
```
A failed story is recorded as failed with its first failing step and the retained evidence; it is fixed in the smallest responsible task above and re-run in a fresh Home, never reported as passed.

---

## Self-review

**Spec coverage (lib_insight `library-insight-rules.md`):**

| Spec | Task |
| --- | --- |
| §9 delivery schema `hima-libinsight-insight/1`; analysis/1 readable for buildsOn | 6, 10 (Reader, admission; `library_catalog` accepts old slugs), 12 (analysis-library.md) |
| §9 Reader vendors the validator at a pinned commit with its hash | 1 (pin), 2 (vendor, VENDOR.json, verify), 6 (Reader) |
| §9 `li_insight_error_count/item_count/action_count/chart_count`; rule `insight-delivery-ready` | 6 |
| §9 knowledge: insight-playbook, insight-result-contract, rule-catalog; four reference results (synthetic) | 7, 8 (rules, results), 12 (knowledge, offers) |
| §9 proposal card shows rule name and sentence | 9 (proposal), 15 (card) |
| §9 Site inputs: facts or live QuaLib, netlists, design files | 4 (request /2, kit catalogue), 5 (prepare-data, extraction, netlist facts), 10 (Site bindings), 17 (real paths) |
| §9 export to a Harness-owned `analyses_roots` folder; never LibInsight's data folder; page adds "Open in Data Insight"; new ADR revising ADR-0021 | 13 (export, `--analyses-root`), 14 (page), 15 (link), 16 (ADR-0022) |
| §9.1 step 1 recognition and catalogue | 11 (offers, inventory, product context), 12 (contract offers) |
| §9.1 step 2 story → rule, correction in words, real confirmation | 9, 15; L4 Step 2 |
| §9.1 step 3 data on the Site, extraction and admission, missing inputs stop the Run | 4, 5; L4 Step 2 |
| §9.1 step 4 resident script, Reader, repair in the same task | 10 (durable L2 repair case), 12 (playbook) |
| §9.1 step 5 presentation: export, headline + Open in Data Insight | 13, 14, 15 |
| §9.1 step 6 follow-up as a new version via buildsOn | 4 (buildsOn with rule names), 12 (analysis-library.md example) |
| §9.1 demo script, four stories, selection don't-use, redesign brief | 18 |
| §11 P2 done-when | 18 |
| §12 testing (Pack side) | 2–8, 10, 12 (Pack unit), 9, 11, 13 (L2), 14, 15 (unit, L3), 18 (L4) |

**Placeholders:** the only values left to the executor are facts that exist only at execution time — the P1 commit the coordinator names (Task 1), the linglong paths discovered read-only (Task 17), and the previous candidate's native input files (Task 17) — each with the exact command that obtains it.

**Names used across tasks:** `insight_problems(doc, root, prepared, prepared_data, byte_size, current_sha, require_validator) -> (problems, deferred)` (6, 10); `vendored.load/verify/manifest`, `MIN_PYTHON` dict (2, 6); `synthetic_kit.prepared/run_rule/catalog_rule/reference_result/TINY_RULE/READER` (3, 5, 7, 10); `PREPARED_SCHEMA_V2`, `PREPARED_DATA_PATH`, `NETLIST_FACTS_PATH`, `INSIGHT_SCHEMA`, `RULE_ID` (4); `LibInsightInsightResult`, `detail.insight`, `detail.exported`, `InsightExport`, `exportAll`, `libInsightResultsRoot`, `writesInsightRequests` (9, 13, 14); `INSIGHT_REF`, `OPEN_INSIGHT_EVENT`, `insightFrameUrl`, `dataInsightLink`, `openInsightScript` (15).

**Risks named for the executor:** the P1 validator, generators and `netlist.arc_devices` are written in parallel; Tasks 3, 7 and 8 say how to align a script to the validator's message without touching vendored code. The SAED14 design for story 4 may not exist on linglong; Task 17 stops that story and asks the user rather than inventing one.
